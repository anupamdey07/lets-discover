"""Process manager — start, stop, and monitor LLM server processes.

Key design decisions:
  - All model stdout/stderr goes to FILES, not pipes. Prevents pipe-lock.
  - Auto-restart thread monitors health every 15s for models with auto_restart=True.
  - Logs are readable from disk at any time via /api/logs/{name}.
  - PID tracking via JSON file for crash recovery across dashboard restarts.
"""

from __future__ import annotations

import json
import os
import shlex
import signal
import subprocess
import threading
import time
from pathlib import Path
from typing import Optional

import httpx
import psutil

from .config import (
    HOME,
    LLAMA_BIN,
    LOG_DIR,
    MODEL_MAP,
    MODEL_MAP as MODELS,
    PID_FILE,
    STATE_DIR,
    VLLM_BIN,
    VLLM_PYTHON,
    VLLM_SCRIPTS,
    ModelDef,
    ModelParam,
)

# ── auto-restart state ──
_restart_thread: threading.Thread | None = None
_restart_stop = threading.Event()
_restart_counts: dict[str, int] = {}  # name -> consecutive failures


def _child_preexec():
    """Run in the child before exec: new session + die-with-parent.

    setsid() detaches the child from the manager's process group. PR_SET_PDEATHSIG
    makes the kernel SIGKILL the child the instant the manager process dies — so
    a manager kill (-9 / OOM) can never leave an orphaned GPU-holding subprocess.
    This is the sustainable fix for the "manager dies, model keeps the GPU" trap.
    """
    os.setsid()
    try:
        import ctypes
        libc = ctypes.CDLL("libc.so.6", use_errno=True)
        PR_SET_PDEATHSIG = 1
        libc.prctl.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_long,
                               ctypes.c_long, ctypes.c_long]
        libc.prctl(PR_SET_PDEATHSIG, signal.SIGKILL, 0, 0, 0)
    except Exception:
        pass  # best-effort; setsid already done


# ── helpers ──


def _load_pids() -> dict[str, int]:
    """Load tracked PIDs from state file."""
    try:
        with open(PID_FILE) as f:
            data = json.load(f)
            return {k: v for k, v in data.items() if k in MODEL_MAP}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_pids(pids: dict[str, int]):
    Path(PID_FILE).parent.mkdir(parents=True, exist_ok=True)
    with open(PID_FILE, "w") as f:
        json.dump(pids, f, indent=2)


def _pid_alive(pid: int) -> bool:
    """Check if a PID is alive and matches our expected process."""
    try:
        proc = psutil.Process(pid)
        return proc.is_running() and proc.status() != psutil.STATUS_ZOMBIE
    except psutil.NoSuchProcess:
        return False


def _model_path_matches(model_path: str, cmdline: list[str]) -> bool:
    """Match a configured model path against process arguments.

    llama.cpp Docker commands may omit the trailing slash from a directory
    model path, while the configured path may include it.
    """
    if not model_path:
        return False
    target = os.path.normpath(model_path)
    return any(os.path.normpath(arg) == target for arg in cmdline)


def _find_running_pids() -> dict[str, int]:
    """Scan system for known LLM processes and return {name: pid}."""
    found: dict[str, int] = {}
    for proc in psutil.process_iter(["pid", "cmdline", "name"]):
        try:
            cmdline = proc.info.get("cmdline") or []
            cmd_str = " ".join(cmdline)
            name = proc.info.get("name", "")

            # Detect vLLM processes
            if "vllm" in name.lower() or any("vllm" in c for c in cmdline):
                for model_name, model_def in MODELS.items():
                    port_match = str(model_def.port) in cmd_str
                    path_match = _model_path_matches(model_def.model_path, cmdline)
                    if port_match or path_match:
                        found[model_name] = proc.info["pid"]

            # Detect llama-server processes
            if "llama-server" in name:
                for model_name, model_def in MODELS.items():
                    if str(model_def.port) in cmd_str or _model_path_matches(model_def.model_path, cmdline):
                        if model_name not in found:
                            found[model_name] = proc.info["pid"]

            # Detect ds4-server processes
            if "ds4-server" in name:
                for model_name, model_def in MODELS.items():
                    if str(model_def.port) in cmd_str or _model_path_matches(model_def.model_path, cmdline):
                        if model_name not in found:
                            found[model_name] = proc.info["pid"]

            # Detect by port binding
            for conn in proc.connections(kind="tcp"):
                if conn.laddr.port in {m.port for m in MODELS.values()}:
                    for model_name, model_def in MODELS.items():
                        if conn.laddr.port == model_def.port:
                            # Only set if not already found (avoid overwrite by empty-path models)
                            if model_name not in found:
                                found[model_name] = proc.info["pid"]
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return found


# ── params persistence ──

PARAMS_FILE = os.path.join(STATE_DIR, "params.json")


def _load_params() -> dict:
    """Load saved params from JSON file."""
    try:
        with open(PARAMS_FILE) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_params(data: dict):
    """Save params dict to JSON file."""
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(PARAMS_FILE, "w") as f:
        json.dump(data, f, indent=2)


def save_model_params(name: str, params: dict[str, str]):
    """Save params for a model — overwrites old values for that model."""
    data = _load_params()
    data[name] = params
    _save_params(data)


def get_model_params(name: str) -> dict:
    """Get saved params for a model."""
    return _load_params().get(name, {})


# ── public API ──


def get_all_status() -> list[dict]:
    """Return status for all configured models.

    Returns a list of dicts with keys:
        name, label, port, engine, group, memory_gb, running, pid,
        healthy, healthy_latency_ms, cmd, auto_restart, restarts

    Resilience: a malformed model definition (e.g. a string in param_schema)
    skips just that model instead of crashing the entire endpoint.
    """
    tracked = _load_pids()
    scanned = _find_running_pids()
    docker_scanned = _find_docker_vllm()

    # Merge: scanned PIDs override tracked
    pids = dict(tracked)
    pids.update(scanned)

    results = []
    for model_name, model_def in MODELS.items():
        try:
            pid = pids.get(model_name)
            running = pid is not None and _pid_alive(pid)
            if not running and pid is not None:
                del pids[model_name]
                pid = None

            health = False
            latency = None
            docker_prom_port = None
            docker_container = ""
            docker_image = ""
            docker_status = ""

            if model_def.engine == "docker":
                # Docker models: discover via docker ps, health check via HTTP
                if model_name in docker_scanned:
                    d = docker_scanned[model_name]
                    running = True
                    pid = None  # no host PID for Docker
                    # Use the model's own port (host-facing) for health check
                    # The mapped_port is the container port, but host port = model_def.port
                    health_port = model_def.port  # 8136 on host -> maps to 8000 in container
                    # Prometheus metrics are on the proxy port or the serve port
                    # 35B: proxy on 8137, 27B: proxy on 8135
                    docker_prom_port = None
                    for prom_candidate in (8137, 8135, model_def.port):
                        if prom_candidate in d.get("ports", {}):
                            docker_prom_port = prom_candidate
                            break
                    if docker_prom_port is None:
                        docker_prom_port = model_def.port
                    health, latency = _check_health_http(f"http://127.0.0.1:{health_port}{model_def.health_path}")
                    docker_container = d.get("container_id", "")
                    docker_image = d.get("image", "")
                    docker_status = d.get("status", "")
                else:
                    running = False
                    docker_container = ""
                    docker_image = ""
                    docker_status = ""
            elif running and pid:
                health, latency = _check_health(model_def)

            # Build param_schema defensively — skip any entry that isn't a ModelParam
            schema = None
            if model_def.param_schema:
                schema = []
                for p in model_def.param_schema:
                    try:
                        schema.append({
                            "name": p.name,
                            "flag": p.flag,
                            "type": p.type,
                            "value": p.value,
                            "readonly": p.readonly,
                        })
                    except AttributeError:
                        print(f"  ⚠️ get_all_status: skipping invalid param_schema entry ({type(p).__name__}) in model '{model_name}'")

            results.append(
                {
                    "name": model_name,
                    "label": model_def.label,
                    "port": model_def.port,
                    "engine": model_def.engine,
                    "group": model_def.group,
                    "memory_gb": model_def.memory_gb,
                    "running": running,
                    "pid": pid,
                    "healthy": health,
                    "healthy_latency_ms": latency,
                    "auto_restart": model_def.auto_restart,
                    "restarts": _restart_counts.get(model_name, 0),
                    "log_file": _log_path(model_name),
                    "cmd": _make_cmd(model_def),
                    "param_schema": schema,
                    "docker_prometheus_port": docker_prom_port,
                    "metrics_port": model_def.metrics_port,
                    "docker_container": docker_container,
                    "docker_image": docker_image,
                    "docker_status": docker_status,
                }
            )
        except Exception as e:
            print(f"  ❌ get_all_status: skipping model '{model_name}' due to error: {e}")

    _save_pids({n: p for n, p in pids.items() if _pid_alive(p)})

    # Merge metrics from sidecar for running vLLM models
    _merge_metrics(results)

    return results


def start_model(name: str, edited_params: dict[str, str] | None = None, force: bool = False) -> dict:
    """Start a model and return status. Logs go to FILE (not pipe).

    Args:
        name: Model name to start
        edited_params: Optional dict of param_name → value for overrides
        force: If True, skip memory warning check
    """
    model = MODELS.get(name)
    if not model:
        return {"success": False, "error": f"Unknown model: {name}"}

    # Check if already running
    statuses = get_all_status()
    for s in statuses:
        if s["name"] == name and s["running"]:
            return {"success": False, "error": "Already running"}

    # For vLLM group, check no other vLLM is running
    if model.group == "vllm":
        for s in statuses:
            if s["group"] == "vllm" and s["running"]:
                return {
                    "success": False,
                    "error": f"Another vLLM model ('{s['name']}') is already running. Stop it first.",
                }

    # Check memory availability
    mem_avail_gb = _mem_available_gb()
    # Use the model's declared memory_gb + 10 GB headroom for vLLM overhead.
    # This is more accurate than the old hardcoded 109 GB floor, which failed
    # when Xorg/display used ~300 MB leaving only ~107 GB.
    min_required = model.memory_gb + 10
    if mem_avail_gb < min_required and not force:
        # Return a warning instead of hard-block — caller can prompt user
        return {
            "success": False,
            "error": f"Only {mem_avail_gb:.0f} GB available, need ~{min_required:.0f} GB for {model.label}",
            "memory_warning": True,
            "mem_available_gb": round(mem_avail_gb, 1),
            "mem_required_gb": round(min_required, 1),
            "model_label": model.label,
        }

    cmd = _make_cmd_with_params(model, edited_params)
    log_file = _log_path(name)

    try:
        with open(log_file, "a") as lf:
            # Write a start marker
            lf.write(f"\n{'='*60}\n")
            lf.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Starting {model.label}\n")
            lf.write(f"  Command: {' '.join(cmd)}\n")
            lf.write(f"{'='*60}\n\n")
            lf.flush()

            proc = subprocess.Popen(
                cmd,
                stdout=lf,
                stderr=subprocess.STDOUT,
                preexec_fn=_child_preexec,
                env=_make_env(model),
            )

        pids = _load_pids()
        pids[name] = proc.pid
        _save_pids(pids)
        _restart_counts[name] = 0  # reset failure counter

        # Persist the params actually used for this run
        if edited_params:
            save_model_params(name, edited_params)

        return {"success": True, "pid": proc.pid, "cmd": " ".join(cmd)}
    except FileNotFoundError as e:
        return {"success": False, "error": f"Binary not found: {e}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def stop_model(name: str, timeout: int = 30) -> dict:
    """Stop a model gracefully, then force kill if needed.

    Returns stop result + dependency warnings for models that depend on it.
    """
    model = MODEL_MAP.get(name)

    # Build dependency warnings
    dep_warnings = []
    if model:
        if model.port == 8136:
            dep_warnings.append({
                "service": "qwen-nothink proxy (:8137)",
                "impact": "Heartbeat, TelePi, and pi-agent reasoning will lose their LLM",
            })
        elif model.port == 8135:
            dep_warnings.append({
                "service": "qwen35-27b-nothink proxy (:8138)",
                "impact": "Any service using the 27B non-thinking proxy will lose its LLM",
            })
        elif model.port == 8040:
            dep_warnings.append({
                "service": "NewsFlashh summarizer",
                "impact": "Heartbeat will lose its summarizer model",
            })
        elif model.port == 8042:
            dep_warnings.append({
                "service": "Mistral-24B tool-calling",
                "impact": "Tool-calling specialist will be unavailable",
            })

    pids = _load_pids()
    pid = pids.get(name)
    if not pid:
        for s in get_all_status():
            if s["name"] == name and s["pid"]:
                pid = s["pid"]
                break
    if not pid:
        return {"success": False, "error": "Not running"}

    # Log the stop to the model's log file
    log_file = _log_path(name)
    try:
        with open(log_file, "a") as lf:
            lf.write(f"\n[{time.strftime('%Y-%m-%d %H:%M:%S')}] Stopping {name} (PID {pid})\n")
    except OSError:
        pass

    try:
        proc = psutil.Process(pid)
        proc.terminate()  # SIGTERM
        try:
            proc.wait(timeout=timeout)
        except psutil.TimeoutExpired:
            proc.kill()  # SIGKILL
            try:
                proc.wait(timeout=5)
            except psutil.TimeoutExpired:
                pass
    except psutil.NoSuchProcess:
        pass

    pids.pop(name, None)
    _save_pids(pids)

    result = {"success": True}
    if dep_warnings:
        result["dep_warnings"] = dep_warnings
    return result


def stop_all_models(timeout: int = 30) -> list[dict]:
    """Stop all running models. Returns list of results."""
    results = []
    for s in get_all_status():
        if s["running"]:
            results.append({"name": s["name"], **stop_model(s["name"], timeout=timeout)})
    return results


def get_logs(name: str, lines: int = 100) -> list[str]:
    """Tail recent log lines from the model's log file."""
    log_file = _log_path(name)
    if not os.path.exists(log_file):
        return ["(no log file yet)"]

    try:
        with open(log_file) as f:
            all_lines = f.readlines()
        tail = all_lines[-lines:]
        return [l.rstrip("\n") for l in tail]
    except OSError as e:
        return [f"(error reading log: {e})"]


def get_system_stats() -> dict:
    """Return CPU, RAM, GPU stats."""
    import psutil as pu

    stats = {
        "cpu_percent": pu.cpu_percent(interval=0.5),
        "cpu_count": pu.cpu_count(),
        "memory": {
            "total_gb": pu.virtual_memory().total / (1024**3),
            "available_gb": pu.virtual_memory().available / (1024**3),
            "percent": pu.virtual_memory().percent,
        },
        "swap": {
            "total_gb": pu.swap_memory().total / (1024**3),
            "used_gb": pu.swap_memory().used / (1024**3),
            "percent": pu.swap_memory().percent,
        },
        "load_avg": pu.getloadavg(),
        "boot_time": pu.boot_time(),
    }

    # GPU stats via pynvml
    try:
        from pynvml import (
            NVML_TEMPERATURE_GPU,
            nvmlDeviceGetHandleByIndex,
            nvmlDeviceGetName,
            nvmlDeviceGetPowerUsage,
            nvmlDeviceGetTemperature,
            nvmlDeviceGetUtilizationRates,
            nvmlInit,
            nvmlShutdown,
        )

        nvmlInit()
        handle = nvmlDeviceGetHandleByIndex(0)
        util = nvmlDeviceGetUtilizationRates(handle)
        temp = nvmlDeviceGetTemperature(handle, NVML_TEMPERATURE_GPU)
        power = nvmlDeviceGetPowerUsage(handle)
        name = nvmlDeviceGetName(handle)
        nvmlShutdown()

        gpu_data = {
            "name": name.decode() if isinstance(name, bytes) else name,
            "utilization": {"gpu_percent": util.gpu, "memory_percent": util.memory},
            "temperature_c": temp,
            "power_w": power / 1000.0,
        }

        mem_avail = pu.virtual_memory().available / (1024**3)
        mem_total = pu.virtual_memory().total / (1024**3)
        gpu_data["memory"] = {
            "total_gb": round(mem_total, 1),
            "used_gb": round(mem_total - mem_avail, 1),
            "free_gb": round(mem_avail, 1),
        }
        stats["gpu"] = gpu_data
    except Exception:
        stats["gpu"] = {"error": "NVIDIA driver not accessible"}

    return stats


# ── hot-reload config ──


def reload_config() -> dict:
    """Hot-reload model definitions from config.py without restarting the manager.

    Re-imports config.py via importlib.reload, then updates the in-memory
    MODELS dict in-place so all existing references (process_manager, web
    handlers) see the new definitions immediately.

    Running models are NOT affected — their PIDs persist in pids.json
    and are discovered on the next get_all_status() call.

    Returns a diff summary: added/removed model names.
    """
    import importlib
    from . import config as _cfg

    old_names = set(MODELS.keys())

    # Attempt reload — if config.py has a syntax error, abort without
    # touching the in-memory dict so the manager stays functional.
    try:
        importlib.reload(_cfg)
    except Exception as e:
        return {"success": False, "error": f"Config reload failed: {e}"}

    # Validate the reloaded module has what we expect
    if not hasattr(_cfg, "MODEL_MAP") or not isinstance(_cfg.MODEL_MAP, dict):
        return {"success": False, "error": "Reloaded config has no MODEL_MAP dict"}

    # Update in-place so all holders of the dict reference see new data
    MODELS.clear()
    MODELS.update(_cfg.MODEL_MAP)

    new_names = set(MODELS.keys())
    added = new_names - old_names
    removed = old_names - new_names

    # Warn about running models that were removed from config
    pids = _load_pids()
    orphaned = [n for n in removed if n in pids and _pid_alive(pids[n])]

    result = {
        "success": True,
        "total": len(MODELS),
        "added": sorted(added),
        "removed": sorted(removed),
    }
    if orphaned:
        result["warning"] = f"Running models removed from config: {orphaned}. Stop them manually."
    return result


# ── auto-restart loop ──


def start_auto_restart(interval: float = 15.0):
    """Start the background auto-restart loop in a daemon thread."""
    global _restart_thread
    if _restart_thread and _restart_thread.is_alive():
        return  # already running

    _restart_stop.clear()
    _restart_thread = threading.Thread(
        target=_auto_restart_loop,
        args=(interval,),
        daemon=True,
        name="auto-restart",
    )
    _restart_thread.start()


def stop_auto_restart():
    """Signal the auto-restart loop to stop."""
    _restart_stop.set()


def _auto_restart_loop(interval: float):
    """Background loop: check health of auto_restart models, restart if dead."""
    while not _restart_stop.is_set():
        try:
            statuses = get_all_status()
            for s in statuses:
                if not s["auto_restart"]:
                    continue
                name = s["name"]
                running = s["running"]
                healthy = s.get("healthy", False)

                if running and not healthy:
                    # Model is running but unresponsive — count failure
                    _restart_counts[name] = _restart_counts.get(name, 0) + 1
                    if _restart_counts[name] >= 3:
                        # 3 consecutive failures: restart
                        _log_restart_action(name, "unhealthy, restarting")
                        stop_model(name, timeout=10)
                        time.sleep(2)
                        start_model(name)
                        _restart_counts[name] = 0
                    else:
                        _log_restart_action(
                            name, f"unhealthy ({_restart_counts[name]}/3 failures)"
                        )

                elif not running:
                    # Process is dead — restart immediately
                    _restart_counts[name] = _restart_counts.get(name, 0) + 1
                    if _restart_counts[name] <= 5:  # max 5 restarts before giving up
                        _log_restart_action(name, f"crashed, restarting (attempt {_restart_counts[name]})")
                        start_model(name)
                    else:
                        _log_restart_action(name, f"crashed {_restart_counts[name]} times, giving up")
                else:
                    # Healthy — reset counter
                    _restart_counts[name] = 0

        except Exception:
            pass  # don't let the loop die

        _restart_stop.wait(interval)


def _log_restart_action(name: str, message: str):
    """Log an auto-restart event to the model's log file."""
    log_file = _log_path(name)
    try:
        with open(log_file, "a") as lf:
            lf.write(f"\n[{time.strftime('%Y-%m-%d %H:%M:%S')}] [auto-restart] {message}\n")
    except OSError:
        pass


# ── Docker vLLM discovery ──


def _find_docker_vllm() -> dict:
    """Scan Docker for vLLM containers and return model info.

    Returns dict keyed by model name with keys:
        docker: True, container_id, container_name, status, ports, image
    """
    found: dict = {}
    try:
        # Use image name pattern match — ancestor filter doesn't work with tagged images
        result = subprocess.run(
            ["docker", "ps", "--filter", "ancestor=vllm/vllm-openai",
             "--format", "{{.ID}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"],
            capture_output=True, text=True, timeout=10
        )
        # If ancestor filter returns nothing, try broader image name match
        if not result.stdout.strip():
            result = subprocess.run(
                ["docker", "ps", "--filter", "label=org.opencontainers.image.source=",  # broad match
                 "--format", "{{.ID}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"],
                capture_output=True, text=True, timeout=10
            )
        # If still nothing, list all containers and filter by image name substring
        if not result.stdout.strip():
            result = subprocess.run(
                ["docker", "ps", "--format", "{{.ID}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"],
                capture_output=True, text=True, timeout=10
            )

        if result.returncode != 0 or not result.stdout.strip():
            return found

        for line in result.stdout.strip().split("\n"):
            if not line.strip():
                continue
            parts = line.split("\t")
            if len(parts) < 4:
                continue
            container_id, image, status, ports = parts[0], parts[1], parts[2], parts[3]

            # Only process vLLM containers
            if "vllm" not in image.lower():
                continue

            # Parse port mappings — look for 8136 or 8000 mapping
            host_ports = {}
            for mapping in ports.split(","):
                mapping = mapping.strip()
                if "->" in mapping:
                    # Format: 127.0.0.1:8137->8137/tcp or 127.0.0.1:8136->8000/tcp
                    host_part, container_part = mapping.split("->")
                    host_port = host_part.split(":")[-1]
                    container_port = container_part.split("/")[0]
                    try:
                        host_ports[int(host_port)] = int(container_port)
                    except ValueError:
                        pass

            # Map to our model name
            model_name = None
            mapped_port = None
            if 8136 in host_ports or 8000 in host_ports:
                model_name = "docker-vllm-qwen"
                mapped_port = host_ports.get(8136, host_ports.get(8000, 8136))
            elif 8134 in host_ports:
                # Qwen3.5-27B-FP8 — secondary dense model
                model_name = "docker-vllm-qwen27b"
                mapped_port = host_ports.get(8134, 8000)
            elif 8132 in host_ports:
                # Qwen3.6-27B-Fable-Fusion-FP8 — dense MTP model
                model_name = "docker-vllm-qwen27b-fable"
                mapped_port = host_ports.get(8132, 8000)
            elif 8137 in host_ports:
                # The non-thinking proxy — also part of docker-vllm-qwen
                model_name = "docker-vllm-qwen"
                mapped_port = 8137

            if model_name:
                found[model_name] = {
                    "docker": True,
                    "container_id": container_id[:12],
                    "container_name": container_id,
                    "status": status,
                    "image": image,
                    "ports": host_ports,
                    "mapped_port": mapped_port,
                }
    except (subprocess.TimeoutExpired, FileNotFoundError, Exception):
        pass
    return found


# ── Prometheus metrics scraping ──


def _fetch_vllm_prometheus_metrics(port: int) -> dict:
    """Scrape Prometheus metrics from a vLLM instance at the given port.

    Returns dict with keys: kv_cache_pct, cache_hit_pct, requests_running,
    requests_waiting, generation_tokens, prompt_tokens, request_success_total,
    prefix_cache_queries, prefix_cache_hits, engine_sleep_state,
    process_rss_mb, cache_hit_rate, tok_per_sec (approx).
    """
    metrics: dict = {}
    try:
        r = httpx.get(f"http://127.0.0.1:{port}/metrics", timeout=2)
        if r.status_code != 200:
            return metrics

        for line in r.text.split("\n"):
            line = line.strip()
            if not line or line.startswith("#"):
                continue

            # Parse metric lines
            if line.startswith("vllm:kv_cache_usage_perc"):
                # vllm:kv_cache_usage_perc{engine="0",model_name="..."} 0.0
                try:
                    val = float(line.split("{")[-1].split("}")[-1])
                    metrics["kv_cache_pct"] = round(val * 100, 1)
                except (ValueError, IndexError):
                    pass

            elif line.startswith("vllm:num_requests_running"):
                try:
                    val = float(line.split("{")[-1].split("}")[-1])
                    metrics["requests_running"] = int(val)
                except (ValueError, IndexError):
                    pass

            elif line.startswith("vllm:num_requests_waiting"):
                try:
                    val = float(line.split("{")[-1].split("}")[-1])
                    metrics["requests_waiting"] = int(val)
                except (ValueError, IndexError):
                    pass

            elif line.startswith("vllm:prefix_cache_queries_total"):
                try:
                    val = float(line.split("{")[-1].split("}")[-1])
                    metrics["prefix_cache_queries"] = val
                except (ValueError, IndexError):
                    pass

            elif line.startswith("vllm:prefix_cache_hits_total"):
                try:
                    val = float(line.split("{")[-1].split("}")[-1])
                    metrics["prefix_cache_hits"] = val
                except (ValueError, IndexError):
                    pass

            elif line.startswith("vllm:generation_tokens_total"):
                try:
                    val = float(line.split("{")[-1].split("}")[-1])
                    metrics["generation_tokens"] = int(val)
                except (ValueError, IndexError):
                    pass

            elif line.startswith("vllm:prompt_tokens_total"):
                try:
                    val = float(line.split("{")[-1].split("}")[-1])
                    metrics["prompt_tokens"] = int(val)
                except (ValueError, IndexError):
                    pass

            elif "vllm:request_success_total" in line:
                # Has labels: vllm:request_success_total{engine="0",finished_reason="stop",model_name="..."} 4709.0
                try:
                    val = float(line.split("}")[-1].strip())
                    if "finished_reason=\"stop\"" in line:
                        metrics["request_success_stop"] = int(val)
                    elif "finished_reason=\"length\"" in line:
                        metrics["request_success_length"] = int(val)
                    elif "finished_reason=\"error\"" in line:
                        metrics["request_success_error"] = int(val)
                except (ValueError, IndexError):
                    pass

            elif "vllm:engine_sleep_state" in line and line.startswith("vllm:engine_sleep_state"):
                try:
                    # Format: vllm:engine_sleep_state{engine="0",model_name="...",sleep_state="awake"} 1.0
                    val = float(line.split("}")[-1].strip())
                    if val > 0:
                        state_match = "unknown"
                        if 'sleep_state="' in line:
                            state_match = line.split('sleep_state="')[1].split('"')[0]
                        metrics["engine_sleep_state"] = state_match
                except (ValueError, IndexError):
                    pass

            elif line.startswith("process_resident_memory_bytes"):
                try:
                    # Top-level metric without labels: "process_resident_memory_bytes 2.68e+09"
                    val = float(line.split()[-1])
                    metrics["process_rss_mb"] = round(val / (1024 * 1024), 1)
                except (ValueError, IndexError):
                    pass

    except Exception:
        pass

    # Compute derived metrics
    queries = metrics.get("prefix_cache_queries", 0)
    hits = metrics.get("prefix_cache_hits", 0)
    if queries > 0:
        metrics["cache_hit_rate"] = round((hits / queries) * 100, 1)
    else:
        metrics["cache_hit_rate"] = 0.0

    return metrics


# ── metrics merging (from sidecar :8766 + Prometheus) ──


def _fetch_metrics() -> list[dict]:
    """Fetch metrics data from the sidecar :8766.

    Returns list of dicts with keys: name, toks_per_sec, requests_running,
    kv_cache_pct, cache_hit_pct. Empty list on error.
    """
    try:
        r = httpx.get("http://127.0.0.1:8766/metrics/status", timeout=3)
        if r.status_code == 200:
            return r.json()
    except Exception:
        pass
    return []


def _merge_metrics(results: list[dict]):
    """Merge metrics data from sidecar and Prometheus into model results.

    For each running vLLM model, adds:
        toks_per_sec, requests_running, cache_hit_pct, kv_cache_pct
    For Docker vLLM models, adds Prometheus-sourced metrics:
        kv_cache_pct, cache_hit_rate, requests_running, requests_waiting,
        generation_tokens, prompt_tokens, engine_sleep_state, process_rss_mb
    """
    # First: sidecar metrics for host vLLM models
    sidecar_metrics = _fetch_metrics()
    if sidecar_metrics:
        by_name = {m["name"]: m for m in sidecar_metrics}
        for r in results:
            if r.get("engine") == "vllm" and r.get("running") and r["name"] in by_name:
                m = by_name[r["name"]]
                r["toks_per_sec"] = m.get("toks_per_sec", 0)
                r["requests_running"] = m.get("requests_running", 0)
                r["cache_hit_pct"] = m.get("cache_hit_pct", 0)
                r["kv_cache_pct"] = m.get("kv_cache_pct", 0)
                r["metrics_state"] = m.get("state", "")

    # Second: Prometheus metrics for Docker vLLM models (skip if health check failed)
    docker_info = _find_docker_vllm()
    for r in results:
        if r.get("engine") == "docker" and r.get("running") and r.get("healthy"):
            port = r.get("docker_prometheus_port", 8137)
            prom_metrics = _fetch_vllm_prometheus_metrics(port)
            if prom_metrics:
                r["kv_cache_pct"] = prom_metrics.get("kv_cache_pct", 0)
                r["cache_hit_pct"] = prom_metrics.get("cache_hit_rate", 0)
                r["requests_running"] = prom_metrics.get("requests_running", 0)
                r["requests_waiting"] = prom_metrics.get("requests_waiting", 0)
                r["generation_tokens"] = prom_metrics.get("generation_tokens", 0)
                r["prompt_tokens"] = prom_metrics.get("prompt_tokens", 0)
                r["engine_sleep_state"] = prom_metrics.get("engine_sleep_state", "unknown")
                r["process_rss_mb"] = prom_metrics.get("process_rss_mb", 0)
                r["request_success_stop"] = prom_metrics.get("request_success_stop", 0)
                r["request_success_length"] = prom_metrics.get("request_success_length", 0)
                r["request_success_error"] = prom_metrics.get("request_success_error", 0)
                r["metrics_state"] = "docker-prometheus"


# ── internal helpers ──


def _log_path(name: str) -> str:
    """Get the log file path for a model."""
    return os.path.join(LOG_DIR, f"{name}.log")


def _make_cmd(model: ModelDef) -> list[str]:
    """Build the command list for a model."""
    if model.engine == "vllm":
        return [
            VLLM_BIN,
            "serve",
            model.model_path,
            "--host",
            "0.0.0.0",
            "--port",
            str(model.port),
        ] + model.extra_args
    elif model.engine == "proxy":
        # Route to the correct proxy script based on model name
        proxy_map = {
            "qwen-nothink": "serve-qwen-nothink-proxy.py",
            "qwen35-27b-nothink": "serve-qwen35-27b-nothink-proxy.py",
            "qwen-dup-8138": "serve-qwen-dup-proxy.py",
        }
        script = proxy_map.get(model.name, "serve-qwen-nothink-proxy.py")
        return [VLLM_PYTHON, f"{VLLM_SCRIPTS}/{script}"]
    elif model.engine == "ds4":
        return [
            f"{HOME}/ds4/ds4-server",
            "-m",
            model.model_path,
            "--host",
            "0.0.0.0",
            "--port",
            str(model.port),
        ] + model.extra_args
    else:
        return [
            LLAMA_BIN,
            "--port",
            str(model.port),
            "--host",
            "0.0.0.0",
            "-m",
            model.model_path,
            "--no-kv-offload",
            "-ngl",
            "99",
            "-c",
            "32768",
            "--temp",
            "0.7",
        ] + model.extra_args


def _make_env(model: ModelDef) -> dict:
    """Build environment for the subprocess."""
    env = os.environ.copy()
    if model.engine == "vllm":
        venv = f"{VLLM_SCRIPTS}/.venv/bin"
        env["PATH"] = f"{venv}:/usr/local/cuda/bin:{env.get('PATH', '')}"
        env["CUDA_HOME"] = "/usr/local/cuda"
        env["TRITON_PTXAS_PATH"] = "/usr/local/cuda/bin/ptxas"
        env["VLLM_USE_DEEP_GEMM"] = "0"
        # Allow max_model_len > max_position_embeddings for models that use
        # sliding_window or rope_theta scaling (e.g. Qwen2.5-Coder 128K ctx)
        env["VLLM_ALLOW_LONG_MAX_MODEL_LEN"] = "1"
    elif model.engine == "proxy":
        venv = f"{VLLM_SCRIPTS}/.venv/bin"
        env["PATH"] = f"{venv}:{env.get('PATH', '')}"
    return env


def _mem_available_gb() -> float:
    """Get available system memory in GB."""
    return psutil.virtual_memory().available / (1024**3)


def _check_health(model: ModelDef) -> tuple[bool, Optional[float]]:
    """Ping the model's health endpoint. Returns (healthy, latency_ms)."""
    url = f"http://127.0.0.1:{model.port}{model.health_path}"
    try:
        start = time.time()
        r = httpx.get(url, timeout=2)
        elapsed = (time.time() - start) * 1000
        return r.is_success, round(elapsed, 1)
    except Exception:
        return False, None


def _check_health_http(url: str) -> tuple[bool, Optional[float]]:
    """Ping a URL directly (for Docker models without host PIDs). Returns (healthy, latency_ms)."""
    try:
        start = time.time()
        r = httpx.get(url, timeout=2)
        elapsed = (time.time() - start) * 1000
        return r.is_success, round(elapsed, 1)
    except Exception:
        return False, None


def _parse_extra_args(extra_args: list[str], param_schema: list[ModelParam]) -> dict[str, str]:
    """Parse extra_args into a dict of param_name → value.

    Example: ["--max-model-len", "262144", "--quantization", "fp8"]
    → {"Max Model Length": "262144", "Quantization": "fp8"}
    """
    result = {}
    if not param_schema:
        return result

    # Build flag → param_name mapping
    flag_to_param = {p.flag: p for p in param_schema}

    # Parse args
    i = 0
    while i < len(extra_args):
        arg = extra_args[i]
        if arg in flag_to_param:
            param = flag_to_param[arg]
            # Get next arg as value (if exists and not another flag)
            if i + 1 < len(extra_args) and not extra_args[i + 1].startswith("--"):
                result[param.name] = extra_args[i + 1]
                i += 2
            else:
                # Flag without value (e.g., --enable-prefix-caching)
                result[param.name] = "true"
                i += 1
        else:
            i += 1

    return result


def _build_extra_args(param_schema: list[ModelParam]) -> list[str]:
    """Build extra_args list from param_schema.

    Bool params (value="true") emit just the flag (e.g. --enable-auto-tool-choice).
    Other params emit flag + value (e.g. --max-model-len 262144).
    Bool params with value="false" are omitted entirely.
    """
    result = []
    for param in param_schema:
        if param.type == "bool":
            if param.value and param.value.lower() == "true":
                result.append(param.flag)
            # false → omit the flag entirely
        else:
            result.append(param.flag)
            if param.value:
                result.append(param.value)
    return result


def _make_cmd_with_params(model: ModelDef, edited_params: dict[str, str] | None = None) -> list[str]:
    """Build command list for a model, optionally with edited parameters.

    If edited_params provided, merge with param_schema and rebuild args.
    """
    if edited_params and model.param_schema:
        # Merge edited params with param_schema
        updated_schema = []
        for param in model.param_schema:
            if param.name in edited_params and not param.readonly:
                # Create new param with edited value
                updated_schema.append(
                    ModelParam(
                        name=param.name,
                        flag=param.flag,
                        type=param.type,
                        value=edited_params[param.name],
                        readonly=param.readonly
                    )
                )
            else:
                updated_schema.append(param)
        # Rebuild extra_args from updated schema
        extra_args = _build_extra_args(updated_schema)
    elif model.param_schema:
        # Use default params from schema
        extra_args = _build_extra_args(model.param_schema)
    else:
        # Fallback to original extra_args
        extra_args = model.extra_args

    # Build final command
    if model.engine == "vllm":
        return [
            VLLM_BIN,
            "serve",
            model.model_path,
            "--host",
            "0.0.0.0",
            "--port",
            str(model.port),
        ] + extra_args
    elif model.engine == "proxy":
        # Route to the correct proxy script based on model name
        proxy_map = {
            "qwen-nothink": "serve-qwen-nothink-proxy.py",
            "qwen35-27b-nothink": "serve-qwen35-27b-nothink-proxy.py",
            "qwen-dup-8138": "serve-qwen-dup-proxy.py",
        }
        script = proxy_map.get(model.name, "serve-qwen-nothink-proxy.py")
        return [VLLM_PYTHON, f"{VLLM_SCRIPTS}/{script}"]
    elif model.engine == "ds4":
        return [
            f"{HOME}/ds4/ds4-server",
            "-m",
            model.model_path,
            "--host",
            "0.0.0.0",
            "--port",
            str(model.port),
        ] + extra_args
    else:
        return [
            LLAMA_BIN,
            "--port",
            str(model.port),
            "--host",
            "0.0.0.0",
            "-m",
            model.model_path,
            "--no-kv-offload",
            "-ngl",
            "99",
            "-c",
            "32768",
            "--temp",
            "0.7",
        ] + extra_args
