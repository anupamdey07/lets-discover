"""Regression tests for llama.cpp runtime metrics model discovery."""

from pathlib import Path

from dashboard import process_manager as pm
from dashboard import web
from dashboard.config import MODEL_MAP


def test_llama_process_path_discovery_normalizes_directory_slashes(monkeypatch):
    """A DeepSeek command with a trailing slash maps to its configured model."""

    model_path = MODEL_MAP["deepseekv4-q3xxs"].model_path

    class FakeProcess:
        info = {
            "pid": 8081,
            "name": "llama-server",
            "cmdline": ["llama-server", "-m", model_path + "/"],
        }

        def connections(self, kind=None):
            return []

    monkeypatch.setattr(pm.psutil, "process_iter", lambda attrs: [FakeProcess()])

    assert pm._find_running_pids() == {"deepseekv4-q3xxs": 8081}


def test_deepseek_status_is_returned_by_models_api_and_metrics_selector(monkeypatch):
    """The configured identity survives API serialization and UI discovery."""

    deepseek = {
        "name": "deepseekv4-q3xxs",
        "label": "DeepSeek-V4-Flash UD-IQ3_XXS",
        "engine": "docker",
        "group": "llama",
        "metrics_port": 8081,
    }
    captured = {}

    monkeypatch.setattr(web, "get_all_status", lambda: [deepseek])

    import uvicorn

    monkeypatch.setattr(uvicorn, "run", lambda app, **kwargs: captured.setdefault("app", app))
    web.serve_web(port=0)

    from fastapi.testclient import TestClient

    response = TestClient(captured["app"]).get("/api/models")
    assert response.status_code == 200
    assert response.json() == [deepseek]

    index = (Path(web.__file__).parent / "index.html").read_text()
    assert "Object.values(modelsData).filter(m => m.metrics_port)" in index
    assert "${escapeHtml(m.label)} :${m.port}" in index
    assert "renderMetricSamples(samples)" in index


def test_metrics_api_preserves_all_prometheus_samples(monkeypatch):
    """The metrics API keeps labels and repeated metric names for the full table."""

    captured = {}
    prometheus = """# HELP llama_tokens_total Tokens
llama_tokens_total{slot=\"0\"} 12
llama_tokens_total{slot=\"1\"} 7
llama_requests 1
"""

    class FakeResponse:
        status_code = 200
        text = prometheus

    class FakeAsyncClient:
        def __init__(self, timeout):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            return False

        async def get(self, url):
            assert url.endswith(":8081/metrics")
            return FakeResponse()

    monkeypatch.setattr(web, "get_all_status", lambda: [])
    import httpx
    monkeypatch.setattr(httpx, "AsyncClient", FakeAsyncClient)

    import uvicorn
    monkeypatch.setattr(uvicorn, "run", lambda app, **kwargs: captured.setdefault("app", app))
    web.serve_web(port=0)

    from fastapi.testclient import TestClient

    response = TestClient(captured["app"]).get("/api/metrics/deepseekv4-q3xxs")
    assert response.status_code == 200
    assert response.json() == {
        "enabled": True,
        "metrics": {"llama_tokens_total": 7.0, "llama_requests": 1.0},
        "samples": [
            {"name": "llama_tokens_total", "labels": 'slot="0"', "value": 12.0},
            {"name": "llama_tokens_total", "labels": 'slot="1"', "value": 7.0},
            {"name": "llama_requests", "labels": "", "value": 1.0},
        ],
    }
