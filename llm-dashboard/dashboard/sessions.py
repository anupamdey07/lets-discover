"""Session parsing for pi observability."""
import json
from pathlib import Path


def list_directories(sessions_dir: Path) -> list[dict]:
    """Return sorted list of session directory names with counts.
    
    Returns list of {name, count} dicts.
    """
    if not sessions_dir.exists():
        return []
    result = []
    for d in sorted(sessions_dir.iterdir()):
        if d.is_dir():
            count = sum(1 for _ in d.glob("*.jsonl"))
            result.append({"name": d.name, "count": count})
    return result


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
                text = block["text"]
                text = text[:120] + ("..." if len(text) > 120 else "")
                if role == "toolResult":
                    tool_name = msg.get("toolName", "")
                    if tool_name:
                        return f"{tool_name}: {text}"
                return text
            if block.get("type") == "thinking" and block.get("thinking"):
                text = block["thinking"]
                return "[thinking] " + text[:100] + ("..." if len(text) > 100 else "")
        return f"[{role} message]"

    if etype == "toolCall":
        name = entry.get("name", "unknown")
        args = entry.get("arguments", {})
        if "command" in args:
            cmd = args["command"]
            return f"{name}: {cmd[:100]}{'...' if len(cmd) > 100 else ''}"
        return f"{name}: {json.dumps(args)[:100]}"

    if etype == "thinking":
        text = entry.get("thinking", "")
        return "[thinking] " + text[:120] + ("..." if len(text) > 120 else "")

    if etype == "compaction":
        tokens = entry.get("tokensBefore", 0)
        summary = entry.get("summary", "")
        brief = f"[compaction] {tokens} tokens"
        if summary:
            brief += f" \u2014 {summary[:80]}"
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
    
    Returns dict with keys: user, assistant, toolCall, thinking,
    toolResult, custom, compaction, other.
    Each value is a list of {brief: str, full: str, raw: dict}.
    """
    groups = {
        "user": [],
        "assistant": [],
        "toolCall": [],
        "thinking": [],
        "toolResult": [],
        "custom": [],
        "compaction": [],
        "other": [],
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
                    elif role == "toolResult":
                        groups["toolResult"].append({
                            "brief": _extract_brief(entry),
                            "full": _extract_full(entry),
                            "raw": entry,
                        })
                    else:
                        groups["other"].append({
                            "brief": _extract_brief(entry),
                            "full": _extract_full(entry),
                            "raw": entry,
                        })
                elif etype in ("toolCall",):
                    groups["toolCall"].append({
                        "brief": _extract_brief(entry),
                        "full": _extract_full(entry),
                        "raw": entry,
                    })
                elif etype == "session":
                    # Skip session metadata entries
                    pass
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
                else:
                    # Catch-all: model_change, thinking_level_change,
                    # custom_message, session_info, etc.
                    groups["other"].append({
                        "brief": _extract_brief(entry),
                        "full": _extract_full(entry),
                        "raw": entry,
                    })
    except FileNotFoundError:
        return groups

    return groups


def validate_session_path(file_path: str, sessions_dir: Path) -> str | None:
    """Validate that a session file path is within the sessions directory.
    
    Returns the resolved absolute path string if valid, None if traversal detected.
    """
    resolved = (sessions_dir / file_path).resolve()
    base = sessions_dir.resolve()
    # Ensure resolved path starts with the base sessions dir
    try:
        resolved.relative_to(base)
    except ValueError:
        return None
    if not resolved.is_file():
        return None
    return str(resolved)
