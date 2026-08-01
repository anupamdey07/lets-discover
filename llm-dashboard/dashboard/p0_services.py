"""P0 Services Watcher — lightweight health monitoring for critical services.

Monitors 9 P0 services, reports status (green/yellow/red) with restart buttons.
Uses systemd user bus for service control, minimal dependencies.
"""

from __future__ import annotations

import json
import os
import subprocess
from dataclasses import dataclass, field
from typing import Optional

import httpx

HOME = os.environ["HOME"]


@dataclass
class ServiceDef:
    """Definition of a P0 service to monitor."""

    name: str  # systemd unit name (without .service)
    label: str
    port: Optional[int] = None
    url: Optional[str] = None
    health_path: str = "/api/heartbeat"
    group: str = "core"  # core, finance, infra
    critical: bool = True
    # For non-systemd services (npm native modules, static binaries):
    process_pattern: str = ""  # substring to grep in ps aux
    health_check: str = ""  # "systemd" | "process" | "http" | "none"

    @property
    def unit(self) -> str:
        return f"{self.name}.service"


# P0 services definition
P0_SERVICES = [
    # Core infrastructure (LLM stack)
    ServiceDef("llm-manager", "LLM Manager", port=8765, group="core", critical=True),
    ServiceDef("bm25-memory", "BM25 Memory", port=8050, group="infra", critical=False, health_path="/health"),

    # Finance stack
    ServiceDef("fin-intelligence", "FinIntel", port=9588, group="finance", critical=True),
    ServiceDef("finbrief", "FinBrief", port=9577, group="finance", critical=True, health_path="/health/json"),

    # Bot services
    ServiceDef("newsflashh", "NewsFlashh", port=None, group="bot", critical=True),
    # Dashboard Hub - no health endpoint, just systemd check
    ServiceDef("dashboard-hub", "Hub", port=8700, group="infra", critical=True, health_path="/"),
    ServiceDef("lets-discover", "Lets Discover", port=None, group="app", critical=False),

    # Supporting services
    ServiceDef("compactlite-handler", "CompactLite", port=None, group="core", critical=False),
    ServiceDef("camofox-browser", "Camofox", port=None, group="infra", critical=False),

    # Voice / STT (non-systemd — npm native module loaded by telepi)
    ServiceDef("sherpa-onnx", "Sherpa-ONNX", port=None, group="bot", critical=False,
               process_pattern="sherpa-onnx", health_check="process"),
]


def check_service_health(svc: ServiceDef) -> dict:
    """Check a single service's status. Returns status dict."""
    systemd_active = False
    health_status = "unknown"
    latency_ms = None

    if svc.health_check == "process":
        # Non-systemd: check via process grep
        try:
            result = subprocess.run(
                ["pgrep", "-f", svc.process_pattern],
                capture_output=True,
                text=True,
                timeout=3,
            )
            systemd_active = bool(result.stdout.strip())
            health_status = "ok" if systemd_active else "unreachable"
        except Exception:
            systemd_active = False
            health_status = "unreachable"
    elif svc.health_check == "http":
        # HTTP health check without systemd
        try:
            url = svc.url or f"http://127.0.0.1:{svc.port}{svc.health_path}"
            start = __import__("time").time()
            r = httpx.get(url, timeout=2.0)
            latency_ms = round((__import__("time").time() - start) * 1000, 1)
            health_status = "ok" if r.is_success else "unreachable"
            systemd_active = True  # treat as running if HTTP responds
        except Exception:
            health_status = "unreachable"
    else:
        # Default: systemd + optional HTTP health
        try:
            result = subprocess.run(
                ["systemctl", "--user", "is-active", svc.unit],
                capture_output=True,
                text=True,
                timeout=3,
            )
            systemd_active = result.stdout.strip() == "active"
        except Exception:
            systemd_active = False

        health_status = "ok" if systemd_active else "unknown"
        if svc.port and svc.name != "llm-manager" and svc.health_path:
            try:
                url = svc.url or f"http://127.0.0.1:{svc.port}{svc.health_path}"
                start = __import__("time").time()
                r = httpx.get(url, timeout=2.0)
                latency_ms = round((__import__("time").time() - start) * 1000, 1)
                health_status = "ok" if r.is_success else "unreachable"
            except Exception:
                health_status = "unreachable"

    # Determine overall status
    if systemd_active and health_status == "ok":
        status = "green"
        status_text = "✅ Active"
    elif systemd_active and health_status == "unreachable":
        status = "yellow"
        status_text = "🟡 Active (unreachable)"
    elif not systemd_active:
        status = "red"
        status_text = "🔴 Inactive"
    else:
        status = "red"
        status_text = "🔴 Unknown"

    return {
        "name": svc.name,
        "label": svc.label,
        "port": svc.port,
        "systemd_active": systemd_active,
        "health_status": health_status,
        "latency_ms": latency_ms,
        "status": status,
        "status_text": status_text,
        "group": svc.group,
        "critical": svc.critical,
        "unit": svc.unit,
        "health_check": svc.health_check,
    }


def get_all_p0_status() -> dict:
    """Return status for all P0 services."""
    results = []
    for svc in P0_SERVICES:
        results.append(check_service_health(svc))

    total = len(results)
    active = sum(1 for r in results if r["status"] == "green")
    degraded = sum(1 for r in results if r["status"] in ("yellow", "red"))

    return {
        "total": total,
        "active": active,
        "degraded": degraded,
        "ok_pct": round(active / max(total, 1) * 100),
        "services": results,
    }


def start_service(name: str) -> dict:
    """Start a service via systemd."""
    try:
        result = subprocess.run(
            ["systemctl", "--user", "start", f"{name}.service"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            return {"success": True, "message": f"Started {name}"}
        return {"success": False, "error": result.stderr.strip() or "Start failed"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def stop_service(name: str) -> dict:
    """Stop a service via systemd."""
    try:
        result = subprocess.run(
            ["systemctl", "--user", "stop", f"{name}.service"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            return {"success": True, "message": f"Stopped {name}"}
        return {"success": False, "error": result.stderr.strip() or "Stop failed"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def restart_service(name: str) -> dict:
    """Restart a service via systemd."""
    try:
        result = subprocess.run(
            ["systemctl", "--user", "restart", f"{name}.service"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            return {"success": True, "message": f"Restarted {name}"}
        return {"success": False, "error": result.stderr.strip() or "Restart failed"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_systemd_logs(name: str, lines: int = 30) -> list[str]:
    """Get recent systemd logs for a service."""
    try:
        result = subprocess.run(
            ["journalctl", "--user", "-u", f"{name}.service", "-n", str(lines), "--no-pager"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            return result.stdout.strip().split("\n")
        return [f"Error: {result.stderr.strip() or 'Unknown'}"]
    except Exception as e:
        return [f"Exception: {e}"]