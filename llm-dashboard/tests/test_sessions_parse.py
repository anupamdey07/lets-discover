"""Tests for pi sessions observability parsing logic."""
import json
import tempfile
from pathlib import Path

# We'll import these after Task 2 creates them
from dashboard.sessions import list_directories, list_sessions, parse_session


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


def test_parse_session_with_real_file():
    """Parse an actual session JSONL file from ~/.pi/agent/sessions/."""
    import os
    sessions_dir = Path.home() / ".pi" / "agent" / "sessions"
    # Find a session with toolCall entries
    real_file = None
    for d in sorted(sessions_dir.iterdir(), reverse=True):
        if not d.is_dir():
            continue
        for f in d.glob("*.jsonl"):
            if sum(1 for _ in open(f)) > 10:
                real_file = str(f)
                break
        if real_file:
            break
    assert real_file is not None, f"No real session file found under {sessions_dir}"
    result = parse_session(real_file)
    # Should have at least user and assistant groups
    assert "user" in result
    assert "assistant" in result
    assert "toolCall" in result
    # Should have at least one user message
    assert len(result["user"]) >= 1
    assert len(result["assistant"]) >= 1
    # Each entry has brief and full
    for entry in result["user"][:3]:
        assert "brief" in entry
        assert "full" in entry
        assert isinstance(entry["brief"], str)
        assert isinstance(entry["full"], str)
        assert len(entry["brief"]) > 0
    # Briefs should be truncated
    for entry in result["user"][:3]:
        assert len(entry["brief"]) <= 123
    # toolCall entries should have tool names in brief
    if len(result["toolCall"]) > 0:
        tc = result["toolCall"][0]
        assert "brief" in tc
        assert "full" in tc