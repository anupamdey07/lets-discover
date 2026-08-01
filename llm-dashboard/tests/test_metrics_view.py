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
