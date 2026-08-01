"""Entry point: python -m dashboard [command]"""

from __future__ import annotations

import sys


def main():
    """CLI entry point for llm-dashboard."""
    args = sys.argv[1:]

    if not args or args[0] in ("tui", "textual", ""):
        # Launch the TUI
        from .app import LLMDashboard
        app = LLMDashboard()
        app.run()
    elif args[0] in ("web", "serve"):
        from .web import serve_web
        port = int(args[1]) if len(args) > 1 else 8765
        serve_web(port=port)
    elif args[0] in ("status", "list"):
        from .process_manager import get_all_status
        statuses = get_all_status()
        for s in statuses:
            icon = "🟢" if s["healthy"] else ("🟡" if s["running"] else "🔴")
            lat = f"({s['healthy_latency_ms']}ms)" if s.get("healthy_latency_ms") else ""
            print(f"{icon} {s['label']:30s}  :{s['port']:<5d}  {'RUN' if s['running'] else 'STOP':>4s}  {lat}")
    elif args[0] in ("start",) and len(args) >= 2:
        from .process_manager import start_model
        result = start_model(args[1])
        if result["success"]:
            print(f"✅ Started {args[1]} (PID {result['pid']})")
        else:
            print(f"❌ {result.get('error', 'unknown')}")
            sys.exit(1)
    elif args[0] in ("stop",) and len(args) >= 2:
        from .process_manager import stop_model
        result = stop_model(args[1])
        if result["success"]:
            print(f"⏹ Stopped {args[1]}")
        else:
            print(f"⚠️  {result.get('error', 'unknown')}")
    elif args[0] in ("stats", "sys"):
        from .process_manager import get_system_stats
        import json
        stats = get_system_stats()
        print(json.dumps(stats, indent=2, default=str))
    elif args[0] in ("--help", "-h", "help"):
        print("""LLM Dashboard — v0.1

Usage:
  llm-dashboard              Launch Textual TUI dashboard
  llm-dashboard web [PORT]   Launch web API server (default port 8765)
  llm-dashboard status       List model statuses (CLI mode)
  llm-dashboard start NAME   Start a model
  llm-dashboard stop NAME    Stop a model
  llm-dashboard stats        Show system stats (JSON)
  llm-dashboard --help       This help

Models:
  qwen35-fp8     — Qwen3.6-35B-FP8 (vLLM :8136)
  gemma26-fp8    — Gemma-4-26B-FP8 (vLLM :8133)
  gemma4-fp8     — Gemma-4-E4B-FP8 (vLLM :8170)
  gemma4-e2b     — Gemma-4-E2B (llama :8040)
  qwen35-q4      — Qwen3.6-35B-Q4_K_XL (llama :8036)
  mistral-24b    — Mistral-24B (llama :8042)
  gemma-12b      — Gemma-4-12B (llama :8043)
  qwen-coder     — Qwen3-Coder-Next (llama :8051)
""")
    else:
        print(f"Unknown command: {args[0]}")
        sys.exit(1)


if __name__ == "__main__":
    main()
