"""FastAPI web server — serves model controls as JSON API + basic HTML dashboard.

Run with: python -m dashboard web [port]
Access at: http://localhost:8765/
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

from .config import MODEL_MAP, MODELS, STATE_DIR
from .process_manager import (
    get_all_status,
    get_logs,
    get_model_params,
    get_system_stats,
    reload_config,
    save_model_params,
    start_auto_restart,
    start_model,
    stop_all_models,
    stop_model,
)
from .p0_services import (
    get_all_p0_status,
    restart_service,
    start_service,
    stop_service,
    get_systemd_logs,
)
from .sessions import list_directories, list_sessions, parse_session, validate_session_path


INDEX_HTML = Path(__file__).parent / "index.html"

def serve_web(port: int = 8765):
    """Start the FastAPI web server."""
    try:
        from fastapi import FastAPI
        from fastapi.responses import HTMLResponse, JSONResponse
        import uvicorn
    except ImportError:
        print("Need: pip install fastapi uvicorn")
        sys.exit(1)

    app = FastAPI(title="LLM Manager API", version="0.2", docs_url="/api/docs")

    # ── start auto-restart loop (opt-in: LLM_AUTORESTART=1) ──
    # Default OFF — prevents respawn loops on crash-prone heavy models.
    # Enable by setting Environment=LLM_AUTORESTART=1 in llm-manager.service
    # AND auto_restart=True on the specific ModelDef(s) to watch.
    _autorestart_on = os.environ.get("LLM_AUTORESTART") == "1"
    if _autorestart_on:
        start_auto_restart(interval=15.0)

    # ── routes ──

    @app.get("/")
    async def index():
        return HTMLResponse(INDEX_HTML.read_text())

    @app.get("/api/models")
    async def api_models():
        return JSONResponse(get_all_status())

    @app.get("/api/params/{name}")
    async def api_get_params(name: str):
        """Get saved params for a model."""
        return JSONResponse(get_model_params(name))

    @app.post("/api/params/{name}")
    async def api_save_params(name: str, body: dict):
        """Save params for a model (partial or full update)."""
        data = get_model_params(name)
        data.update(body)  # partial merge
        save_model_params(name, data)
        return JSONResponse({"success": True})

    @app.get("/api/stats")
    async def api_stats():
        return JSONResponse(get_system_stats())

    @app.get("/api/metrics/{name}")
    async def api_metrics(name: str):
        """Proxy Prometheus metrics for a configured llama.cpp model."""
        import httpx

        model = MODEL_MAP.get(name)
        if model is None:
            return JSONResponse({"error": "not found"}, status_code=404)
        if model.metrics_port is None:
            return JSONResponse({"enabled": False, "error": "metrics are not configured for this model"})

        try:
            async with httpx.AsyncClient(timeout=2.5) as client:
                response = await client.get(f"http://127.0.0.1:{model.metrics_port}/metrics")
            if response.status_code != 200:
                return JSONResponse({
                    "enabled": False,
                    "status_code": response.status_code,
                    "error": "llama.cpp metrics are not enabled; restart with --metrics",
                })

            metrics = {}
            for line in response.text.splitlines():
                if not line or line.startswith("#"):
                    continue
                key, _, value = line.rpartition(" ")
                if not key:
                    continue
                metric_name = key.split("{", 1)[0]
                try:
                    metrics[metric_name] = float(value)
                except ValueError:
                    continue
            return JSONResponse({"enabled": True, "metrics": metrics})
        except (httpx.HTTPError, OSError) as exc:
            return JSONResponse({"enabled": False, "error": str(exc)})

    @app.post("/api/start/{name}")
    async def api_start(name: str, params: dict | None = None, force: bool = False):
        """Start a model, optionally with edited parameters.
        
        Args:
            name: Model name
            params: Optional param overrides
            force: If True, skip memory warning and start anyway
        """
        return JSONResponse(start_model(name, edited_params=params, force=force))

    @app.post("/api/stop/{name}")
    async def api_stop(name: str):
        """Stop a model. Returns dep_warnings if other services depend on it."""
        return JSONResponse(stop_model(name))

    @app.get("/api/models/{name}")
    async def api_model(name: str):
        for s in get_all_status():
            if s["name"] == name:
                return JSONResponse(s)
        return JSONResponse({"error": "not found"}, status_code=404)

    @app.get("/api/logs/{name}")
    async def api_logs(name: str, lines: int = 100):
        """Tail recent log lines for a model."""
        logs = get_logs(name, lines=lines)
        return JSONResponse({"name": name, "lines": len(logs), "logs": logs})

    @app.get("/api/heartbeat")
    async def api_heartbeat():
        """Lightweight health check for systemd WatchdogSec — no full model scan."""
        return JSONResponse({
            "status": "ok",
            "time": time.time(),
            "uptime": time.time() - _start_time,
        })

    @app.get("/api/p0-services")
    async def api_p0_services():
        """Status of all P0 services."""
        return JSONResponse(get_all_p0_status())

    @app.post("/api/p0/start/{name}")
    async def api_p0_start(name: str):
        """Start a P0 service."""
        return JSONResponse(start_service(name))

    @app.post("/api/p0/stop/{name}")
    async def api_p0_stop(name: str):
        """Stop a P0 service."""
        return JSONResponse(stop_service(name))

    @app.post("/api/p0/restart/{name}")
    async def api_p0_restart(name: str):
        """Restart a P0 service."""
        return JSONResponse(restart_service(name))

    @app.get("/api/p0/logs/{name}")
    async def api_p0_logs(name: str, lines: int = 30):
        """Get systemd logs for a P0 service."""
        logs = get_systemd_logs(name, lines=lines)
        return JSONResponse({"name": name, "lines": len(logs), "logs": logs})

    @app.post("/api/reload")
    async def api_reload():
        """Hot-reload model definitions from config.py without restarting.

        Running models are NOT affected. New model tiles appear immediately
        in the UI. Removed models disappear (but their processes persist
        until stopped manually).
        """
        return JSONResponse(reload_config())

    @app.post("/api/stop-all")
    async def api_stop_all():
        """Stop all running models (used during graceful shutdown)."""
        results = stop_all_models(timeout=15)
        return JSONResponse({"stopped": len(results), "results": results})

    # ── Pi Sessions Observability ──
    SESSIONS_DIR = Path.home() / ".pi" / "agent" / "sessions"

    @app.get("/api/sessions/directories")
    async def api_sessions_directories():
        """List all session directories with session counts."""
        return JSONResponse(list_directories(SESSIONS_DIR))

    @app.get("/api/sessions/list")
    async def api_sessions_list(dir: str = ""):
        """List session files in a directory."""
        if not dir:
            return JSONResponse([])
        dir_path = SESSIONS_DIR / dir
        return JSONResponse(list_sessions(dir_path))

    @app.get("/api/sessions/parse")
    async def api_sessions_parse(file: str = ""):
        """Parse a session file and return grouped entries.
        Path traversal protected — resolved path must be within SESSIONS_DIR.
        """
        if not file:
            return JSONResponse({}, status_code=400)
        resolved = validate_session_path(file, SESSIONS_DIR)
        if resolved is None:
            return JSONResponse({"error": "invalid path"}, status_code=400)
        return JSONResponse(parse_session(resolved))

    OBS_HTML = Path(__file__).parent / "pi_sessions.html"

    @app.get("/pi-observability")
    async def pi_observability_dashboard():
        return HTMLResponse(OBS_HTML.read_text())

    # ── Memory Compaction Dashboard ──
    MEMORY_HTML = Path(__file__).parent / "memory_compaction.html"

    @app.get("/memory-compaction")
    async def memory_compaction_dashboard():
        return HTMLResponse(MEMORY_HTML.read_text())

    @app.get("/api/memory/status")
    async def memory_status():
        import urllib.request
        last_run_path = Path.home() / ".pi" / "agent" / "memory-observer-last-run.json"
        facts_path = Path.home() / ".pi" / "agent" / "memory" / "memory-observer-longterm.json"
        last_run = json.loads(last_run_path.read_text()) if last_run_path.exists() else {}
        total_facts = 0
        if facts_path.exists():
            try: total_facts = len(json.loads(facts_path.read_text()).get("facts", []))
            except Exception: pass
        bm25_docs = 0
        bm25_status = "unknown"
        try:
            r = urllib.request.urlopen("http://127.0.0.1:8050/health", timeout=3)
            bm25_data = json.loads(r.read())
            bm25_docs = bm25_data.get("documents", 0)
            bm25_status = "ok"
        except Exception: bm25_status = "down"
        return JSONResponse({
            "enabled": True, "last_run": last_run.get("lastRun"),
            "last_status": last_run.get("status", "unknown"),
            "sessions_processed": last_run.get("sessionsProcessed", 0),
            "facts_extracted": last_run.get("factsExtracted", 0),
            "total_facts": total_facts, "total_bm25_docs": bm25_docs,
            "bm25_status": bm25_status,
            "uptime": round(time.time() - _start_time, 1),
        })

    @app.get("/api/memory/pipeline")
    async def memory_pipeline():
        last_run_path = Path.home() / ".pi" / "agent" / "memory-observer-last-run.json"
        last_run = json.loads(last_run_path.read_text()) if last_run_path.exists() else {}
        sessions_ok = last_run.get("sessionsProcessed", 0) > 0
        facts_ok = last_run.get("factsExtracted", 0) > 0
        phases = [
            {"id": 1, "name": "Session Scan", "icon": "🔍", "status": "ok" if sessions_ok else "idle"},
            {"id": 2, "name": "Refine", "icon": "✨", "status": "ok" if sessions_ok else "idle"},
            {"id": 3, "name": "Backup & Swap", "icon": "💾", "status": "ok" if sessions_ok else "idle"},
            {"id": 4, "name": "Extract Facts", "icon": "📋", "status": "ok" if facts_ok else "idle"},
            {"id": 5, "name": "BM25 Reindex", "icon": "🔎", "status": "ok"},
        ]
        return JSONResponse({"phases": phases, "last_run": last_run.get("lastRun"),
                             "total_sessions": last_run.get("sessionsProcessed", 0),
                             "total_facts": last_run.get("factsExtracted", 0)})

    @app.get("/api/memory/facts")
    async def memory_facts():
        facts_path = Path.home() / ".pi" / "agent" / "memory" / "memory-observer-longterm.json"
        if not facts_path.exists():
            return JSONResponse({"total": 0, "top_categories": {}})
        try:
            data = json.loads(facts_path.read_text())
            facts_raw = data.get("facts", [])
            # Normalize: extract string text from either format
            facts_list = []
            for f in facts_raw:
                if isinstance(f, str):
                    facts_list.append(f)
                elif isinstance(f, dict):
                    facts_list.append(f.get("fact", ""))
            cats = {"abort_prevention": 0, "intent_alignment": 0, "format": 0,
                    "user_communication": 0, "tool_usage": 0, "other": 0}
            for f in facts_list:
                fl = f.lower()
                if "abort" in fl or "skip" in fl or "close" in fl: cats["abort_prevention"] += 1
                elif "intent" in fl or "objective" in fl: cats["intent_alignment"] += 1
                elif "format" in fl or "code block" in fl: cats["format"] += 1
                elif "concise" in fl or "affirmative" in fl: cats["user_communication"] += 1
                elif "tool" in fl or "verify" in fl: cats["tool_usage"] += 1
                else: cats["other"] += 1
            return JSONResponse({"total": len(facts_list), "top_categories": cats})
        except Exception:
            return JSONResponse({"total": 0, "top_categories": {}})

    @app.get("/api/memory/daily")
    async def memory_daily(date: str = None):
        """Return daily memory files. If ?date=YYYY-MM-DD, return that file's content.
        If no date param, return the latest file's content plus a list of all dates."""
        from datetime import datetime
        daily_dir = Path.home() / ".pi" / "agent" / "memory" / "daily"
        result = {"files": [], "latest": None, "content": None, "error": None}
        if not daily_dir.exists():
            result["error"] = "No daily memory directory found"
            return JSONResponse(result)
        # Collect all .md files sorted by date descending
        md_files = sorted(
            [f for f in daily_dir.iterdir() if f.suffix == ".md" and f.is_file()],
            key=lambda f: f.stem,
            reverse=True,
        )
        file_list = []
        for f in md_files:
            try:
                size = f.stat().st_size
                file_list.append({"date": f.stem, "path": f.name, "size": size, "size_human": f"{size:,}B"})
            except Exception:
                pass
        result["files"] = file_list
        if not file_list:
            result["error"] = "No daily memory files found"
            return JSONResponse(result)
        result["latest"] = file_list[0]["date"]
        # If a specific date was requested, return that file
        if date:
            target = daily_dir / f"{date}.md"
            if target.exists():
                result["content"] = target.read_text()
                result["requested_date"] = date
            else:
                result["error"] = f"No file for date {date}"
            return JSONResponse(result)
        # No date param: return the latest file's content
        latest = daily_dir / f"{file_list[0]['date']}.md"
        if latest.exists():
            result["content"] = latest.read_text()
        return JSONResponse(result)

    @app.get("/api/memory/scan")
    async def memory_scan():
        """Scan all session files for compaction entries."""
        from datetime import datetime
        from collections import defaultdict
        sessions_dir = Path.home() / ".pi" / "agent" / "sessions"
        stats = {"directories": {}, "total_compactions": 0, "total_sessions": 0, "last_compaction": None}
        if sessions_dir.exists():
            for dir_path in sorted(sessions_dir.iterdir()):
                if not dir_path.is_dir():
                    continue
                dir_name = dir_path.name
                dir_stats = {"sessions": 0, "compactions": 0, "total_tokens_compacted": 0, "recent_compactions": []}
                for session_file in sorted(dir_path.glob("*.jsonl")):
                    dir_stats["sessions"] += 1
                    stats["total_sessions"] += 1
                    try:
                        with open(session_file) as f:
                            for line in f:
                                try:
                                    entry = json.loads(line.strip())
                                    if entry.get("type") == "compaction":
                                        dir_stats["compactions"] += 1
                                        stats["total_compactions"] += 1
                                        tokens = entry.get("tokensBefore", 0)
                                        dir_stats["total_tokens_compacted"] += tokens
                                        ts = entry.get("timestamp", "")
                                        if ts and (not stats["last_compaction"] or ts > stats["last_compaction"]):
                                            stats["last_compaction"] = ts
                                        if len(dir_stats["recent_compactions"]) < 3:
                                            dir_stats["recent_compactions"].append({
                                                "file": session_file.name[:50],
                                                "tokens": tokens,
                                                "time": ts
                                            })
                                except json.JSONDecodeError:
                                    continue
                    except Exception:
                        continue
                if dir_stats["compactions"] > 0:
                    stats["directories"][dir_name] = dir_stats
        return JSONResponse(stats)

    # ── Pi Observability API ──
    AGENT_DIR = Path.home() / ".pi" / "agent"
    SKILLS_DIR = AGENT_DIR / "skills"
    EXTENSIONS_DIR = AGENT_DIR / "extensions"

    @app.get("/api/observability/skills")
    async def observability_skills():
        """List all skills with name, description, and path."""
        skills = []
        if SKILLS_DIR.exists():
            for d in sorted(SKILLS_DIR.iterdir()):
                if d.is_dir():
                    skill_file = d / "SKILL.md"
                    desc = ""
                    if skill_file.exists():
                        try:
                            content = skill_file.read_text()
                            # Extract description from frontmatter or first heading
                            if content.startswith("---"):
                                end = content.find("\n---", 3)
                                if end > 0:
                                    for line in content[4:end].split("\n"):
                                        if line.startswith("description:"):
                                            desc = line.split(":", 1)[1].strip()
                                            break
                            if not desc:
                                # Try first heading
                                for line in content.split("\n"):
                                    if line.startswith("# "):
                                        desc = line[2:].strip()
                                        break
                        except Exception:
                            pass
                    skills.append({
                        "name": d.name,
                        "description": desc,
                        "path": str(d),
                    })
        return JSONResponse(skills)

    @app.get("/api/observability/extensions")
    async def observability_extensions():
        """List all extensions with name, description, and path."""
        extensions = []
        if EXTENSIONS_DIR.exists():
            for d in sorted(EXTENSIONS_DIR.iterdir()):
                if d.is_dir():
                    # Check for SKILL.md or index.ts
                    skill_file = d / "SKILL.md"
                    desc = ""
                    if skill_file.exists():
                        try:
                            content = skill_file.read_text()
                            if content.startswith("---"):
                                end = content.find("\n---", 3)
                                if end > 0:
                                    for line in content[4:end].split("\n"):
                                        if line.startswith("description:"):
                                            desc = line.split(":", 1)[1].strip()
                                            break
                        except Exception:
                            pass
                    extensions.append({
                        "name": d.name,
                        "description": desc,
                        "path": str(d),
                    })
        return JSONResponse(extensions)

    @app.get("/api/observability/sessions")
    async def observability_sessions(limit: int = 100):
        """List all session files with compaction info, sorted by last modified."""
        sessions = []
        sessions_dir = AGENT_DIR / "sessions"
        if not sessions_dir.exists():
            return JSONResponse([])

        for dir_path in sorted(sessions_dir.iterdir()):
            if not dir_path.is_dir():
                continue
            for session_file in sorted(dir_path.glob("*.jsonl"),
                                       key=lambda p: p.stat().st_mtime, reverse=True):
                try:
                    stat = session_file.stat()
                    compactions = 0
                    tokens_compacted = 0
                    last_compaction = None
                    with open(session_file) as f:
                        for line in f:
                            try:
                                entry = json.loads(line.strip())
                                if entry.get("type") == "compaction":
                                    compactions += 1
                                    tokens_compacted += entry.get("tokensBefore", 0)
                                    ts = entry.get("timestamp", "")
                                    if ts and (not last_compaction or ts > last_compaction):
                                        last_compaction = ts
                            except json.JSONDecodeError:
                                continue
                    sessions.append({
                        "name": session_file.name,
                        "id": "",
                        "directory": dir_path.name,
                        "path": str(session_file),
                        "sizeBytes": stat.st_size,
                        "lastModified": last_compaction or datetime.fromtimestamp(stat.st_mtime).isoformat(),
                        "compactions": compactions,
                        "tokensCompacted": tokens_compacted,
                    })
                    if len(sessions) >= limit:
                        return JSONResponse(sessions)
                except Exception:
                    continue

        return JSONResponse(sessions[:limit])

    @app.get("/api/observability/session-detail")
    async def observability_session_detail(name: str, dir: str = ""):
        """Get detailed info about a specific session file."""
        sessions_dir = AGENT_DIR / "sessions"
        if dir:
            session_file = sessions_dir / dir / name
        else:
            # Search all directories
            session_file = None
            for d in sessions_dir.iterdir():
                if d.is_dir():
                    candidate = d / name
                    if candidate.exists():
                        session_file = candidate
                        break

        if not session_file or not session_file.exists():
            return JSONResponse({"error": "session not found"}, status_code=404)

        try:
            stat = session_file.stat()
            entry_types = {}
            compactions = []
            last_compaction = None
            tokens_compacted = 0

            with open(session_file) as f:
                for line in f:
                    try:
                        entry = json.loads(line.strip())
                        etype = entry.get("type", "unknown")
                        entry_types[etype] = entry_types.get(etype, 0) + 1
                        if etype == "compaction":
                            compactions.append({
                                "time": entry.get("timestamp", ""),
                                "tokens": entry.get("tokensBefore", 0),
                                "summary": entry.get("summary", "")[:100],
                            })
                            tokens_compacted += entry.get("tokensBefore", 0)
                            ts = entry.get("timestamp", "")
                            if ts and (not last_compaction or ts > last_compaction):
                                last_compaction = ts
                    except json.JSONDecodeError:
                        continue

            return JSONResponse({
                "name": session_file.name,
                "directory": session_file.parent.name,
                "path": str(session_file),
                "sizeBytes": stat.st_size,
                "entryCount": sum(entry_types.values()),
                "compactions": len(compactions),
                "tokensCompacted": tokens_compacted,
                "lastCompaction": last_compaction,
                "compactionDetails": compactions,
                "entryTypes": entry_types,
            })
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    @app.post("/api/observability/summarize")
    async def observability_summarize():
        """Summarize the current active session using Gemini 2.5 Flash."""
        import urllib.request
        import urllib.error

        # Find the most recent session file (current active session)
        sessions_dir = AGENT_DIR / "sessions"
        latest_file = None
        latest_time = 0
        if sessions_dir.exists():
            for dir_path in sessions_dir.iterdir():
                if not dir_path.is_dir():
                    continue
                for sf in dir_path.glob("*.jsonl"):
                    try:
                        mt = sf.stat().st_mtime
                        if mt > latest_time:
                            latest_time = mt
                            latest_file = sf
                    except Exception:
                        continue

        if not latest_file:
            return JSONResponse({"error": "No session files found"}, status_code=404)

        # Read and serialize the session
        try:
            messages = []
            with open(latest_file) as f:
                for line in f:
                    try:
                        entry = json.loads(line.strip())
                        if entry.get("type") == "message" and entry.get("message"):
                            msg = entry["message"]
                            role = msg.get("role", "unknown")
                            content_parts = msg.get("content", [])
                            if isinstance(content_parts, list):
                                text = " ".join(
                                    p.get("text", "") for p in content_parts
                                    if isinstance(p, dict) and p.get("type") == "text"
                                )
                            elif isinstance(content_parts, str):
                                text = content_parts
                            else:
                                text = str(content_parts)
                            if text.strip():
                                messages.append(f"[{role}]: {text[:500]}")
                    except (json.JSONDecodeError, Exception):
                        continue
        except Exception as e:
            return JSONResponse({"error": f"Failed to read session: {e}"}, status_code=500)

        if not messages:
            return JSONResponse({"error": "No message content found in session"}, status_code=400)

        # Build serialized conversation
        serialized = "\n\n".join(messages[:200])  # Limit to last 200 messages
        if len(serialized) > 50000:
            serialized = serialized[:50000] + "\n... (truncated)"

        # Call Gemini 2.5 Flash for summarization
        try:
            gemini_key = None
            models_json = AGENT_DIR / "models.json"
            if models_json.exists():
                try:
                    models_data = json.loads(models_json.read_text())
                    # Look for Gemini API key in providers
                    providers = models_data.get("providers", {})
                    for provider in ["gemini", "google", "default"]:
                        if provider in providers:
                            key = providers[provider].get("apiKey", "")
                            if key:
                                gemini_key = key
                                break
                    # Also check top-level
                    if not gemini_key:
                        gemini_key = models_data.get("apiKey", "") or models_data.get("GEMINI_API_KEY", "")
                except Exception:
                    pass

            if not gemini_key:
                # Fallback: check environment variable
                import os
                gemini_key = os.environ.get("GEMINI_API_KEY", "")

            if not gemini_key:
                return JSONResponse({"error": "Gemini API key not found in models.json or GEMINI_API_KEY env"}, status_code=500)

            prompt = """Summarize this conversation. Use exactly these headings:
## Goal
What is the user trying to accomplish

## Progress
Done/In Progress/Blocked with bullet points

## Key Decisions
Bold decision names with rationale

## Next Steps
Ordered numbered list

## Critical Context
File paths, function names, config values, error messages

Conversation:
""" + serialized

            import http.client
            conn = http.client.HTTPSConnection("generativelanguage.googleapis.com")
            payload = json.dumps({
                "contents": [{"parts": [{"text": prompt}], "role": "user"}],
                "generationConfig": {
                    "temperature": 0.2,
                    "maxOutputTokens": 4096,
                },
            })
            conn.request("POST", "/v1beta/models/gemini-2.5-flash:generateContent?key=" + gemini_key,
                         payload, {"Content-Type": "application/json"})
            resp = conn.getresponse()
            data = json.loads(resp.read())

            if "error" in data:
                return JSONResponse({"error": data["error"].get("message", "Gemini API error")}, status_code=500)

            summary = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
            return JSONResponse({"summary": summary})

        except http.client.HTTPException as e:
            return JSONResponse({"error": f"Gemini API error: {e}"}, status_code=500)
        except Exception as e:
            return JSONResponse({"error": f"Summarization failed: {e}"}, status_code=500)

    # ── startup / shutdown ──
    global _start_time
    _start_time = time.time()

    @app.on_event("startup")
    async def on_startup():
        _notify_systemd_ready()
        print("  ❤️  sd_notify: READY sent to systemd")

        # Start watchdog ping thread (every 15s when WatchdogSec=30)
        import threading as _t
        def _ping():
            while True:
                _t.Event().wait(15)
                _notify_systemd_watchdog()
        _t.Thread(target=_ping, daemon=True).start()

    @app.on_event("shutdown")
    async def on_shutdown():
        """Gracefully stop all running models before dashboard exits.
        
        This prevents orphaned child processes from holding GPU memory when
        the dashboard restarts (PR_SET_PDEATHSIG would SIGKILL them otherwise).
        """
        print("\n  🛑 Dashboard shutting down — stopping running models...")
        statuses = get_all_status()
        running = [s for s in statuses if s["running"]]
        if running:
            print(f"  ⚠️  {len(running)} model(s) still running:")
            for s in running:
                print(f"     - {s['label']} (port {s['port']}, PID {s['pid']})")
            print("  Stopping via SIGTERM...")
            results = stop_all_models(timeout=15)
            for r in results:
                if r.get("success"):
                    print(f"  ✅ Stopped {r['name']}")
                else:
                    print(f"  ⚠️  Failed to stop {r['name']}: {r.get('error', 'unknown')}")
        else:
            print("  ✅ No running models — safe to exit.")
        print("  🛑 Dashboard stopped.\n")

    print(f"🌐 LLM Manager web UI: http://127.0.0.1:{port}")
    print(f"📡 API: http://127.0.0.1:{port}/api/models")
    print(f"❤️  Heartbeat: http://127.0.0.1:{port}/api/heartbeat")
    print(f"🔄 Auto-restart: {'active (check every 15s)' if _autorestart_on else 'OFF — set LLM_AUTORESTART=1 to enable'}")
    print(f"📋 Logs: ~/.local/share/llm-dashboard/logs/")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")


_start_time = 0.0
_watchdog_notifier = None


def _notify_systemd_ready():
    """Notify systemd that the service is ready (sd_notify)."""
    global _watchdog_notifier
    try:
        from sdnotify import SystemdNotifier
        _watchdog_notifier = SystemdNotifier()
        _watchdog_notifier.notify("READY=1")
        return True
    except Exception:
        return False


def _notify_systemd_watchdog():
    """Send periodic watchdog ping (WATCHDOG=1)."""
    try:
        if _watchdog_notifier is not None:
            _watchdog_notifier.notify("WATCHDOG=1")
            return True
    except Exception:
        pass
    return False
