"""LLM Dashboard — model definitions and configuration."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Optional

HOME = os.environ["HOME"]
LLAMA_BIN = f"{HOME}/src/llama.cpp/build/bin/llama-server"
VLLM_VENV = f"{HOME}/ai-stack/vllm/.venv/bin"
VLLM_BIN = f"{VLLM_VENV}/vllm"
VLLM_PYTHON = f"{VLLM_VENV}/python"
VLLM_SCRIPTS = f"{HOME}/ai-stack/vllm"

# Paths to models
AI_MODELS = f"{HOME}/ai-models"
HF_ORIG = f"{AI_MODELS}/hf-orig"
MODELS_DIR = f"{HOME}/models"
HF_CACHE = f"{AI_MODELS}/hf-cache"

# Log directory (files, not pipes!)
LOG_DIR = f"{HOME}/.local/share/llm-dashboard/logs"


@dataclass
class ModelParam:
    """A single editable parameter for a model."""

    name: str  # Display name
    flag: str  # CLI flag (e.g., --max-model-len)
    type: str  # "int", "float", "string", "bool"
    value: str  # Current value (string for JSON serialization)
    readonly: bool = False  # If True, show but disable editing


@dataclass
class ModelDef:
    """Definition of a model that can be managed."""

    name: str
    label: str
    engine: str  # "vllm" | "llama" | "proxy" | "docker"
    port: int
    model_path: str
    group: str  # "vllm" | "llama" — vllm models share GPU, only one at a time
    memory_gb: float  # estimated GPU memory cost
    health_path: str = "/health"
    extra_args: list[str] = field(default_factory=list)
    default: bool = False
    notes: str = ""
    param_schema: list[ModelParam] | None = None
    auto_restart: bool = False  # restart on crash
    metrics_port: int | None = None  # Prometheus endpoint host port, if different from API port


MODELS: list[ModelDef] = [
    # ── llama.cpp GGUF — Gemma 4 E2B (summarizer) ──
    ModelDef(
        name="gemma4-e2b",
        label="Gemma-4-E2B (summarizer)",
        engine="llama",
        port=8040,
        model_path=f"{AI_MODELS}/gemma-4-e2b/gemma-4-E2B-it-Q4_K_M.gguf",
        group="llama",
        memory_gb=4,
        health_path="/health",
        notes="Newsflashh summarizer. 38 t/s. Fast.",
        extra_args=["--jinja"],
        default=True,
        auto_restart=False,
    ),
    # ── Docker vLLM — primary production model (Docker-managed, read-only visibility) ──
    ModelDef(
        name="docker-vllm-qwen",
        label="Docker: Qwen3.6-35B-A3B-FP8 (primary)",
        engine="docker",
        port=8136,
        model_path="",
        group="vllm",
        memory_gb=95,
        health_path="/health",
        notes="Primary production model. Served by Docker container vllm-qwen (:8136 serve, :8137 proxy). Read-only — Docker manages lifecycle. Prometheus metrics via :8137/metrics.",
        extra_args=[],
        default=False,
        auto_restart=False,  # Docker manages restart
    ),
    # ── Docker vLLM — secondary dense model (Docker-managed, read-only visibility) ──
    ModelDef(
        name="docker-vllm-qwen27b",
        label="Docker: Qwen3.5-27B-FP8 (dense)",
        engine="docker",
        port=8134,
        model_path="",
        group="vllm",
        memory_gb=60,
        health_path="/health",
        notes="Secondary dense model. Served by Docker container vllm-qwen27b (:8134 serve, :8135 proxy). Read-only — Docker manages lifecycle. Prometheus metrics via :8135/metrics.",
        extra_args=[],
        default=False,
        auto_restart=False,  # Docker manages restart
    ),
    # ── Docker vLLM — Qwen3.6-27B-Fable-Fusion-FP8 (Dense MTP) ──
    ModelDef(
        name="docker-vllm-qwen27b-fable",
        label="Docker: Qwen3.6-27B-Fable-Fusion-FP8 (MTP)",
        engine="docker",
        port=8132,
        model_path="",
        group="vllm",
        memory_gb=70,
        health_path="/health",
        notes="Fable-Fusion dense model with MTP speculative decoding. Served by Docker container vllm-qwen27b-fable (:8132 serve, :8133 proxy). Read-only — Docker manages lifecycle. Prometheus metrics via :8133/metrics.",
        extra_args=[],
        default=False,
        auto_restart=False,  # Docker manages restart
    ),
    # ── llama.cpp GGUF — Qwen3.5-9B-The-Defiant-Fable ──
    ModelDef(
        name="llama-defiant-fable",
        label="Qwen3.5-9B Defiant Fable (GGUF)",
        engine="llama",
        port=8130,
        model_path=f"{AI_MODELS}/Qwen3.5-9B-The-Defiant-Fable-GGUF/Qwen3.5-9B-The-Defiant-Fable-Uncnr-Heretic-NEO-MAX-IQ4_NL.gguf",
        group="llama",
        memory_gb=8,
        health_path="/health",
        notes="Uncensored creative model. Flash-attn, q8 KV. ~6.2 GB IQ4_NL.\n\n`tmux new -s defiant ~/ai-stack/llama-cpp/serve-defiant-fable.sh`\n`tmux attach -t defiant`\n`tmux kill-session -t defiant`",
        extra_args=[],
        default=False,
        auto_restart=False,
    ),
    # ── Docker llama.cpp — DeepSeek-V4-Flash UD-IQ3_XXS ──
    ModelDef(
        name="deepseekv4-q3xxs",
        label="DeepSeek-V4-Flash UD-IQ3_XXS",
        engine="docker",
        port=8081,
        model_path="/home/deepmind/ai-models/DeepSeek-V4-Flash-0731-GGUF-v2/UD-IQ3_XXS",
        group="llama",
        memory_gb=100,
        health_path="/health",
        notes="Docker-managed llama.cpp server from ai-stack/llama.cpp/deepseekv4-Q3XXS. Metrics and API are exposed on :8081.",
        extra_args=[],
        default=False,
        auto_restart=False,
        metrics_port=8081,
    ),
]


# Map model name -> ModelDef
MODEL_MAP = {m.name: m for m in MODELS}

# Process state directory
STATE_DIR = f"{HOME}/.local/share/llm-dashboard"
PID_FILE = f"{STATE_DIR}/pids.json"
os.makedirs(STATE_DIR, exist_ok=True)
os.makedirs(LOG_DIR, exist_ok=True)
