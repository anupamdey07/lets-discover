# Pi Sessions Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bloated `pi_observability.html` with a minimal session viewer: directory tiles → session list → parsed session view with one-line briefs and expand-on-click.

**Architecture:** Single HTML file embedded in FastAPI. Three new server-side API endpoints parse JSONL session files and return structured data. The HTML uses vanilla JS with no dependencies. Existing observability routes and HTML are deleted and replaced.

**Tech Stack:** FastAPI (Python), vanilla HTML/CSS/JS, no frameworks, no external dependencies.

## Global Constraints

- Dark theme: `#0d1117` background, `#161b22` surfaces, `#58a6ff` accent
- No external dependencies — no CDN, no npm packages, no CSS frameworks
- Session JSONL path: `~/.pi/agent/sessions/<dir>/<file>.jsonl`
- AGENT_DIR is `Path.home() / ".pi" / "agent"` (defined in `web.py:343`)
- Each task ends with a commit
- DRY, YAGNI, TDD, frequent commits

---

### Task 1: Write failing tests for session parsing logic

**Files:**
- Create: `tests/test_sessions_parse.py`

**Interfaces:**
- Consumes: nothing yet
- Produces: test functions that will drive the parsing API

- [ ] **Step 1: Write failing tests**

```python
"""Tests for pi sessions observability parsing logic."""
import json
import tempfile
from pathlib import Path

# We'll import these after Task 2 creates them
# from dashboard.sessions import list_directories, list_sessions, parse_session


def test_list_directories_returns_sorted_names():
    """Directories are returned as a sorted list of names."""
    with tempfile.TemporaryDirectory() as tmpdir:
        (Path(tmpdir) / "alpha").mkdir()
        (Path(tmpdir) / "beta").mkdir()
        (Path(tmpdir) / "gamma").mkdir()
        result = list_directories(Path(tmpdir))
        assert result == ["alpha", "beta", "gamma"]


def test_list_directories_ignores_files():
    """Non-directory entries are excluded."""
    with tempfile.TemporaryDirectory() as tmpdir:
        (Path(tmpdir) / "dir1").mkdir()
        (Path(tmpdir) / "file.txt").write_text("hello")
        result = list_directories(Path(tmpdir))
        assert result == ["dir1"]


def test_list_sessions_returns_metadata():
    """Each session file returns id, timestamp, cwd, entryCount."""
    with tempfile.TemporaryDirectory() as tmpdir:
        d = Path(tmpdir) / "testdir"
        d.mkdir()
        session_file = d / "2026-07-22T10-00-00-000Z_abc123.jsonl"
        session_file.write_text(
            json.dumps({"type": "session", "id": "abc123", "timestamp": "2026-07-22T10:00:00.000Z", "cwd": "/home/test"}) + "\n"
            + json.dumps({"type": "message", "message": {"role": "user", "content": [{"type": "text", "text": "hi"}]}}) + "\n"
        )
        result = list_sessions(Path(tmpdir) / "testdir")
        assert len(result) == 1
        assert result[0]["id"] == "abc123"
        assert result[0]["cwd"] == "/home/test"
        assert result[0]["entryCount"] == 2


def test_parse_session_groups_by_type():
    """Entries are grouped into user, assistant, toolCall, thinking, custom, compaction."""
    with tempfile.TemporaryDirectory() as tmpdir:
        session_file = Path(tmpdir) / "test.jsonl"
        session_file.write_text(
            json.dumps({"type": "session", "id": "x", "timestamp": "2026-07-22T10:00:00.000Z", "cwd": "/home/test"}) + "\n"
            + json.dumps({"type": "message", "message": {"role": "user", "content": [{"type": "text", "text": "hello"}]}}) + "\n"
            + json.dumps({"type": "message", "message": {"role": "assistant", "content": [{"type": "thinking", "thinking": "let me think"}]}}) + "\n"
            + json.dumps({"type": "toolCall", "name": "bash", "arguments": {"command": "ls"}}) + "\n"
            + json.dumps({"type": "compaction", "tokensBefore": 5000, "summary": "summarized"}) + "\n"
        )
        result = parse_session(str(session_file))
        assert "user" in result
        assert "assistant" in result
        assert "toolCall" in result
        assert "thinking" in result
        assert "compaction" in result
        assert len(result["user"]) == 1
        assert len(result["assistant"]) == 1
        assert len(result["toolCall"]) == 1
        assert len(result["compaction"]) == 1


def test_parse_session_briefs_are_truncated():
    """Briefs are truncated to ~120 chars with ellipsis."""
    with tempfile.TemporaryDirectory() as tmpdir:
        session_file = Path(tmpdir) / "test.jsonl"
        long_text = "x" * 300
        session_file.write_text(
            json.dumps({"type": "session", "id": "x", "timestamp": "2026-07-22T10:00:00.000Z", "cwd": "/home/test"}) + "\n"
            + json.dumps({"type": "message", "message": {"role": "user", "content": [{"type": "text", "text": long_text}]}}) + "\n"
        )
        result = parse_session(str(session_file))
        brief = result["user"][0]["brief"]
        assert len(brief) <= 123  # 120 chars + "..."
        assert brief.endswith("...")
        # Full content is preserved
        assert result["user"][0]["full"] == long_text


def test_parse_session_toolCall_brief_shows_name_and_args():
    """ToolCall brief shows tool name and truncated arguments."""
    with tempfile.TemporaryDirectory() as tmpdir:
        session_file = Path(tmpdir) / "test.jsonl"
        session_file.write_text(
            json.dumps({"type": "session", "id": "x", "timestamp": "2026-07-22T10:00:00.000Z", "cwd": "/home/test"}) + "\n"
            + json.dumps({"type": "toolCall", "name": "bash", "arguments": {"command": "ls -la /very/long/path/that/should/be/truncated"}}) + "\n"
        )
        result = parse_session(str(session_file))
        brief = result["toolCall"][0]["brief"]
        assert "bash" in brief
        assert len(brief) <= 123


def test_parse_session_empty_file():
    """Empty or session-only file returns empty groups."""
    with tempfile.TemporaryDirectory() as tmpdir:
        session_file = Path(tmpdir) / "test.jsonl"
        session_file.write_text(
            json.dumps({"type": "session", "id": "x", "timestamp": "2026-07-22T10:00:00.000Z", "cwd": "/home/test"}) + "\n"
        )
        result = parse_session(str(session_file))
        for key in result:
            assert len(result[key]) == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/projects/llm-dashboard && python -m pytest tests/test_sessions_parse.py -v`
Expected: FAIL with "module not found" or "function not defined"

- [ ] **Step 3: Create the test directory**

```bash
mkdir -p ~/projects/llm-dashboard/tests
touch ~/projects/llm-dashboard/tests/__init__.py
```

- [ ] **Step 4: Commit**

```bash
cd ~/projects/llm-dashboard
git add tests/test_sessions_parse.py tests/__init__.py
git commit -m "test: add failing tests for sessions parsing"
```

---

### Task 2: Implement session parsing module

**Files:**
- Create: `dashboard/sessions.py`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `list_directories(sessions_dir: Path) -> list[str]` — returns sorted directory names
  - `list_sessions(dir_path: Path) -> list[dict]` — returns list of session metadata dicts
  - `parse_session(file_path: str) -> dict` — returns grouped entries with briefs and full content

- [ ] **Step 1: Write the module**

```python
"""Session parsing for pi observability."""
import json
from pathlib import Path


def list_directories(sessions_dir: Path) -> list[str]:
    """Return sorted list of session directory names."""
    if not sessions_dir.exists():
        return []
    return sorted(
        d.name for d in sessions_dir.iterdir() if d.is_dir()
    )


def list_sessions(dir_path: Path) -> list[dict]:
    """Return session file metadata for all .jsonl files in a directory."""
    sessions = []
    if not dir_path.exists():
        return sessions
    for f in sorted(dir_path.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            entry_count = 0
            session_id = ""
            timestamp = ""
            cwd = ""
            with open(f) as fh:
                for line in fh:
                    entry_count += 1
                    try:
                        entry = json.loads(line.strip())
                        if entry.get("type") == "session":
                            session_id = entry.get("id", "")
                            timestamp = entry.get("timestamp", "")
                            cwd = entry.get("cwd", "")
                    except json.JSONDecodeError:
                        continue
            sessions.append({
                "name": f.name,
                "id": session_id,
                "timestamp": timestamp,
                "cwd": cwd,
                "entryCount": entry_count,
            })
        except Exception:
            continue
    return sessions


def _extract_brief(entry: dict) -> str:
    """Extract a one-line brief from a parsed entry."""
    etype = entry.get("type", "")
    
    if etype == "message":
        msg = entry.get("message", {})
        role = msg.get("role", "")
        content = msg.get("content", [])
        for block in content:
            if block.get("type") == "text" and block.get("text"):
                return block["text"][:120] + ("..." if len(block["text"]) > 120 else "")
            if block.get("type") == "thinking" and block.get("thinking"):
                return "[thinking] " + block["thinking"][:100] + ("..." if len(block["thinking"]) > 100 else "")
        return f"[{role} message]"
    
    if etype == "toolCall":
        name = entry.get("name", "unknown")
        args = entry.get("arguments", {})
        if "command" in args:
            return f"{name}: {args['command'][:100]}{'...' if len(args.get('command', '')) > 100 else ''}"
        return f"{name}: {json.dumps(args)[:100]}"
    
    if etype == "thinking":
        text = entry.get("thinking", "")
        return "[thinking] " + text[:120] + ("..." if len(text) > 120 else "")
    
    if etype == "compaction":
        tokens = entry.get("tokensBefore", 0)
        summary = entry.get("summary", "")
        brief = f"[compaction] {tokens} tokens"
        if summary:
            brief += f" — {summary[:80]}"
        return brief
    
    if etype == "custom":
        ctype = entry.get("customType", "custom")
        return f"[{ctype}]"
    
    return f"[{etype}]"


def _extract_full(entry: dict) -> str:
    """Extract full readable content from a parsed entry."""
    etype = entry.get("type", "")
    
    if etype == "message":
        msg = entry.get("message", {})
        role = msg.get("role", "")
        content = msg.get("content", [])
        parts = []
        for block in content:
            if block.get("type") == "text" and block.get("text"):
                parts.append(block["text"])
            if block.get("type") == "thinking" and block.get("thinking"):
                parts.append(f"[thinking]\n{block['thinking']}")
            if block.get("type") == "toolCall":
                name = block.get("name", "unknown")
                args = json.dumps(block.get("arguments", {}), indent=2)
                parts.append(f"[toolCall: {name}]\n{args}")
        return "\n\n".join(parts) if parts else f"[{role} message]"
    
    if etype == "toolCall":
        name = entry.get("name", "unknown")
        args = json.dumps(entry.get("arguments", {}), indent=2)
        return f"[toolCall: {name}]\n{args}"
    
    if etype == "thinking":
        return f"[thinking]\n{entry.get('thinking', '')}"
    
    if etype == "compaction":
        tokens = entry.get("tokensBefore", 0)
        summary = entry.get("summary", "")
        return f"[compaction] {tokens} tokens\n{summary}"
    
    if etype == "custom":
        ctype = entry.get("customType", "custom")
        data = entry.get("data", {})
        return f"[{ctype}]\n{json.dumps(data, indent=2)}"
    
    return json.dumps(entry, indent=2)


def parse_session(file_path: str) -> dict:
    """Parse a session JSONL file and return grouped entries.
    
    Returns dict with keys: user, assistant, toolCall, thinking, custom, compaction.
    Each value is a list of {brief: str, full: str, raw: dict}.
    """
    groups = {
        "user": [],
        "assistant": [],
        "toolCall": [],
        "thinking": [],
        "custom": [],
        "compaction": [],
    }
    
    try:
        with open(file_path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                
                etype = entry.get("type", "")
                
                if etype == "message":
                    msg = entry.get("message", {})
                    role = msg.get("role", "")
                    if role == "user":
                        groups["user"].append({
                            "brief": _extract_brief(entry),
                            "full": _extract_full(entry),
                            "raw": entry,
                        })
                    elif role == "assistant":
                        groups["assistant"].append({
                            "brief": _extract_brief(entry),
                            "full": _extract_full(entry),
                            "raw": entry,
                        })
                elif etype == "toolCall":
                    groups["toolCall"].append({
                        "brief": _extract_brief(entry),
                        "full": _extract_full(entry),
                        "raw": entry,
                    })
                elif etype == "thinking":
                    groups["thinking"].append({
                        "brief": _extract_brief(entry),
                        "full": _extract_full(entry),
                        "raw": entry,
                    })
                elif etype == "custom":
                    groups["custom"].append({
                        "brief": _extract_brief(entry),
                        "full": _extract_full(entry),
                        "raw": entry,
                    })
                elif etype == "compaction":
                    groups["compaction"].append({
                        "brief": _extract_brief(entry),
                        "full": _extract_full(entry),
                        "raw": entry,
                    })
    except FileNotFoundError:
        return groups
    
    return groups
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd ~/projects/llm-dashboard && python -m pytest tests/test_sessions_parse.py -v`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
cd ~/projects/llm-dashboard
git add dashboard/sessions.py tests/test_sessions_parse.py
git commit -m "feat: add session parsing module with directory listing, session listing, and JSONL parsing"
```

---

### Task 3: Add API endpoints to web.py

**Files:**
- Modify: `dashboard/web.py`

**Interfaces:**
- Consumes: `dashboard.sessions.list_directories`, `list_sessions`, `parse_session`
- Produces:
  - `GET /api/sessions/directories` → `JSONResponse(list[str])`
  - `GET /api/sessions/list?dir=<name>` → `JSONResponse(list[dict])`
  - `GET /api/sessions/parse?file=<path>` → `JSONResponse(dict)`

- [ ] **Step 1: Add imports**

Add after line 345 in `web.py`:
```python
from .sessions import list_directories, list_sessions, parse_session
```

- [ ] **Step 2: Add the three API routes**

Add after line 345 (before the existing `/api/observability/skills` route):
```python
    # ── Pi Sessions Observability ──
    SESSIONS_DIR = AGENT_DIR / "sessions"

    @app.get("/api/sessions/directories")
    async def api_sessions_directories():
        """List all session directories."""
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
        """Parse a session file and return grouped entries."""
        if not file:
            return JSONResponse({}, status_code=400)
        return JSONResponse(parse_session(file))
```

- [ ] **Step 3: Run the server and test endpoints**

```bash
cd ~/projects/llm-dashboard
python -m dashboard web 8765 &
sleep 2
curl -s http://localhost:8765/api/sessions/directories | python3 -m json.tool | head -20
curl -s "http://localhost:8765/api/sessions/list?dir=--home-deepmind-projects-llm-dashboard--" | python3 -m json.tool | head -20
curl -s "http://localhost:8765/api/sessions/parse?file=$(find ~/.pi/agent/sessions/--home-deepmind-projects-llm-dashboard--/ -name '*.jsonl' | head -1)" | python3 -m json.tool | head -30
kill %1 2>/dev/null
```

Expected: All three endpoints return valid JSON data.

- [ ] **Step 4: Commit**

```bash
cd ~/projects/llm-dashboard
git add dashboard/web.py
git commit -m "feat: add /api/sessions/* endpoints for directory listing, session listing, and session parsing"
```

---

### Task 4: Create the new pi_sessions.html

**Files:**
- Create: `dashboard/pi_sessions.html`
- Delete: `dashboard/pi_observability.html`

**Interfaces:**
- Consumes: `/api/sessions/directories`, `/api/sessions/list?dir=<name>`, `/api/sessions/parse?file=<path>`
- Produces: Single-page SPA with 3 views (directory tiles, session list, parsed session)

- [ ] **Step 1: Write the HTML file**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Pi Sessions · GB10</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: #0d1117; --surface: #161b22; --surface2: #21262d; --border: #30363d;
  --text: #c9d1d9; --text2: #8b949e; --text3: #484f58;
  --accent: #58a6ff; --green: #3fb950; --orange: #d29922; --red: #f85149;
  --purple: #bc8cff; --cyan: #39d2c0;
}
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', monospace; background: var(--bg); color: var(--text); padding: 20px; min-height: 100vh; }
.header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.header h1 { font-size: 1.1rem; font-weight: 600; color: var(--accent); }
.btn { padding: 6px 14px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface2); color: var(--text); font-size: 0.78rem; cursor: pointer; }
.btn:hover { border-color: var(--accent); }
.breadcrumb { font-size: 0.78rem; color: var(--text2); margin-bottom: 16px; }
.breadcrumb span { cursor: pointer; }
.breadcrumb span:hover { color: var(--accent); text-decoration: underline; }
.breadcrumb .sep { margin: 0 6px; color: var(--text3); }
.tile-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
.tile { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px; cursor: pointer; transition: border-color 0.15s; }
.tile:hover { border-color: var(--accent); }
.tile-name { font-size: 0.85rem; font-weight: 600; margin-bottom: 4px; word-break: break-all; }
.tile-count { font-size: 0.72rem; color: var(--text2); }
.session-list { display: flex; flex-direction: column; gap: 4px; }
.session-row { display: grid; grid-template-columns: 1fr 140px 160px 60px; gap: 12px; padding: 10px 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; cursor: pointer; font-size: 0.78rem; align-items: center; }
.session-row:hover { border-color: var(--accent); background: var(--surface2); }
.session-id { font-family: monospace; color: var(--accent); max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.session-cwd { color: var(--text2); font-size: 0.72rem; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.session-time { color: var(--text2); }
.session-entries { color: var(--text3); text-align: center; }
.group { margin-bottom: 16px; }
.group-header { font-size: 0.82rem; font-weight: 600; padding: 8px 0; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 8px; }
.group-badge { font-size: 0.65rem; padding: 2px 8px; border-radius: 10px; font-weight: 600; }
.group-badge.user { background: rgba(88,166,255,0.15); color: var(--accent); }
.group-badge.assistant { background: rgba(63,185,80,0.15); color: var(--green); }
.group-badge.toolCall { background: rgba(210,153,34,0.15); color: var(--orange); }
.group-badge.thinking { background: rgba(188,140,255,0.15); color: var(--purple); }
.group-badge.custom { background: rgba(57,210,192,0.15); color: var(--cyan); }
.group-badge.compaction { background: rgba(248,81,73,0.15); color: var(--red); }
.brief { font-size: 0.78rem; padding: 6px 12px; margin: 2px 0; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: background 0.15s; }
.brief:hover { background: var(--surface2); }
.brief.expanded { white-space: normal; overflow: visible; text-overflow: clip; }
.brief-full { display: none; margin-top: 4px; padding: 8px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; font-size: 0.75rem; white-space: pre-wrap; font-family: monospace; line-height: 1.5; max-height: 400px; overflow-y: auto; }
.brief.expanded + .brief-full { display: block; }
.loading { color: var(--text2); text-align: center; padding: 40px; }
</style>
</head>
<body>
<div class="header">
  <h1>📋 Pi Sessions</h1>
  <button class="btn" onclick="refresh()">⟳ Refresh</button>
</div>
<div class="breadcrumb" id="breadcrumb"></div>
<div id="content"><div class="loading">Loading…</div></div>
<script>
const API = '/api';
let state = { view: 'directories', dir: '', file: '' };
function breadcrumb() {
  const bc = document.getElementById('breadcrumb');
  if (state.view === 'directories') bc.innerHTML = '<span onclick="goDirectories()">📁 Sessions</span>';
  else if (state.view === 'list') bc.innerHTML = `<span onclick="goDirectories()">📁 Sessions</span><span class="sep">›</span><span>${state.dir}</span>`;
  else bc.innerHTML = `<span onclick="goDirectories()">📁 Sessions</span><span class="sep">›</span><span onclick="goList()">${state.dir}</span><span class="sep">›</span><span>${state.file}</span>`;
}
function goDirectories() { state = { view: 'directories', dir: '', file: '' }; render(); }
function goList() { state = { view: 'list', dir: state.dir, file: '' }; render(); }
async function fetchJSON(path) { try { const r = await fetch(API + path); return await r.json(); } catch { return null; } }
async function refresh() { if (state.view === 'directories') renderDirectories(); else if (state.view === 'list') renderList(); else renderParse(); }
async function renderDirectories() {
  const dirs = await fetchJSON('/api/sessions/directories');
  const content = document.getElementById('content');
  if (!dirs || dirs.length === 0) { content.innerHTML = '<div class="loading">No session directories found</div>'; return; }
  const counts = {};
  for (const dir of dirs) { const sessions = await fetchJSON(`/api/sessions/list?dir=${encodeURIComponent(dir)}`); counts[dir] = sessions ? sessions.length : 0; }
  content.innerHTML = `<div class="tile-grid">${dirs.map(d => `<div class="tile" onclick="openDir('${d.replace(/'/g, "\\'")}')"><div class="tile-name">${d}</div><div class="tile-count">${counts[d] || 0} sessions</div></div>`).join('')}</div>`;
  breadcrumb();
}
function openDir(dir) { state = { view: 'list', dir, file: '' }; renderList(); }
async function renderList() {
  const sessions = await fetchJSON(`/api/sessions/list?dir=${encodeURIComponent(state.dir)}`);
  const content = document.getElementById('content');
  if (!sessions || sessions.length === 0) { content.innerHTML = '<div class="loading">No sessions found</div>'; return; }
  content.innerHTML = `<div class="session-list">${sessions.map(s => `<div class="session-row" onclick="openSession('${s.name.replace(/'/g, "\\'")}')"><div class="session-id" title="${s.id}">${s.id}</div><div class="session-cwd" title="${s.cwd}">${s.cwd}</div><div class="session-time">${s.timestamp ? new Date(s.timestamp).toLocaleString() : '—'}</div><div class="session-entries">${s.entryCount || 0}</div></div>`).join('')}</div>`;
  breadcrumb();
}
function openSession(name) { state = { view: 'parse', dir: state.dir, file: name }; renderParse(); }
async function renderParse() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading">Loading session…</div>';
  const parsed = await fetchJSON(`/api/sessions/parse?file=${encodeURIComponent(state.dir + '/' + state.file)}`);
  if (!parsed) { content.innerHTML = '<div class="loading">Failed to load session</div>'; return; }
  const emojis = { user: '📝', assistant: '💬', toolCall: '🔧', thinking: '🧠', custom: '🔌', compaction: '📦' };
  const labels = { user: 'User Messages', assistant: 'Assistant Messages', toolCall: 'Tool Calls', thinking: 'Thinking', custom: 'Custom Events', compaction: 'Compactions' };
  const colors = { user: 'user', assistant: 'assistant', toolCall: 'toolCall', thinking: 'thinking', custom: 'custom', compaction: 'compaction' };
  let html = '';
  for (const [type, entries] of Object.entries(parsed)) {
    if (entries.length === 0) continue;
    html += `<div class="group"><div class="group-header">${emojis[type] || '📄'} ${labels[type] || type} <span class="group-badge ${colors[type]}">${entries.length}</span></div>`;
    for (const entry of entries) { html += `<div class="brief" onclick="this.classList.toggle('expanded')">${entry.brief}</div><div class="brief-full">${escapeHtml(entry.full)}</div>`; }
    html += `</div>`;
  }
  content.innerHTML = html || '<div class="loading">No entries found</div>';
  breadcrumb();
}
function escapeHtml(str) { return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function render() { breadcrumb(); if (state.view === 'directories') renderDirectories(); else if (state.view === 'list') renderList(); else renderParse(); }
render();
</script>
</body>
</html>
```

- [ ] **Step 2: Delete the old HTML file**

```bash
rm ~/projects/llm-dashboard/dashboard/pi_observability.html
```

- [ ] **Step 3: Test the page**

```bash
cd ~/projects/llm-dashboard
python -m dashboard web 8765 &
sleep 2
# Open http://localhost:8765/pi-observability in browser
# Verify: directory tiles load, clicking navigates to session list, clicking session shows parsed view
kill %1 2>/dev/null
```

- [ ] **Step 4: Commit**

```bash
cd ~/projects/llm-dashboard
git add dashboard/pi_sessions.html
git rm dashboard/pi_observability.html
git commit -m "feat: replace pi_observability with minimal pi_sessions viewer"
```

---

### Task 5: Update the route to serve the new HTML

**Files:**
- Modify: `dashboard/web.py:169-174`

**Interfaces:**
- Consumes: the new `pi_sessions.html`
- Produces: `/pi-observability` route serving the new page

- [ ] **Step 1: Update the route**

Replace lines 169-174 in `web.py`:
```python
    OBS_HTML = Path(__file__).parent / "pi_sessions.html"

    @app.get("/pi-observability")
    async def pi_observability_dashboard():
        return HTMLResponse(OBS_HTML.read_text())
```

- [ ] **Step 2: Test the route**

```bash
cd ~/projects/llm-dashboard
python -m dashboard web 8765 &
sleep 2
curl -s -o /dev/null -w "%{http_code}" http://localhost:8765/pi-observability
# Expected: 200
kill %1 2>/dev/null
```

- [ ] **Step 3: Commit**

```bash
cd ~/projects/llm-dashboard
git add dashboard/web.py
git commit -m "fix: update /pi-observability route to serve pi_sessions.html"
```

---

## Self-Review

1. **Spec coverage:** All spec requirements covered — directory tiles (Task 4), session list (Task 4), parsed view with briefs (Task 2+4), removed clutter (Task 4 delete + Task 3 new endpoints replace old), single HTML file (Task 4).
2. **Placeholder scan:** No "TBD", "TODO", or vague requirements. All code is complete.
3. **Type consistency:** All function signatures match across tasks. `list_directories(Path) -> list[str]`, `list_sessions(Path) -> list[dict]`, `parse_session(str) -> dict`.
4. **Scope check:** Focused on the session viewer only. No extra features.