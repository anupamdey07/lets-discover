# Design Spec: Dual vLLM Serving on DGX Spark GB10

**Date:** 2026-07-28  
**Status:** Approved  
**Models:** Qwen3.6-35B-A3B-FP8 + Qwen3.5-27B-FP8  
**Hardware:** 1× NVIDIA GB10 Blackwell (128 GB unified memory, 273 GB/s)

## 1. Container Architecture

Two containers from the same image, differentiated by model mount + command args:

```
vllm/vllm-openai:vllm-arm64-cu13-0.25.1-7a33ba9
├── vllm-qwen      → /models = Qwen3.6-35B-A3B-FP8
└── vllm-qwen27b   → /models = Qwen3.5-27B-FP8
```

Each has:
- **Entrypoint**: `/opt/entrypoint.sh` — starts proxy in bg, runs `vllm serve` in fg
- **Proxy**: injected via bind mount, listens on unique port, forwards to `localhost:8000`
- **NVIDIA runtime**: shares same GPU via unified memory

## 2. vLLM Flags (from reference config)

Reference config used `Qwen3.6-27B-FP8` as basis. Key flags adopted:

| Flag | Purpose |
|---|---|
| `--quantization fp8` | FP8 weight loading |
| `--kv-cache-dtype fp8` | FP8 KV cache (2× density vs fp16) |
| `--enable-chunked-prefill` | Essential for long-context agentic use |
| `--enable-auto-tool-choice` | Required for pi/telepi tool calling |
| `--tool-call-parser qwen3_coder` | Qwen3 coder-optimized XML parser |
| `--reasoning-parser qwen3` | Properly parse thinking blocks |
| `--trust-remote-code` | Needed for Qwen3.5 custom architecture |
| `--default-chat-template-kwargs {"enable_thinking": true}` | Thinking ON by default (proxy disables for no-think port) |
| `--language-model-only` | Skip vision encoder (27B only, saves ~5 GB) |
| `--generation-config vllm` | Not a real vLLM flag — omitted |

## 3. Proxy Design

Lightweight FastAPI proxy per container:
- Injects `chat_template_kwargs: {enable_thinking: False}` into each request
- Adjusts sampling params (temp 0.7, top_p 0.8) for non-thinking output
- Strips residual thinking artifacts from responses
- No GPU memory consumption

Two proxy scripts, identical logic, different `model_name` and `PORT`:

| Container | Proxy Port | Upstream Port | Model Name |
|---|---|---|---|
| 35B | 8137 | 8000 | qwen35a3b-fp8 |
| 27B | 8135 | 8000 | qwen35-27b-fp8 |

## 4. Memory Allocation

```
gpu_util_total = util_35 + util_27 = 0.43 + 0.35 = 0.78
buffer = 1.0 - 0.78 = 0.22 (26.6 GiB)
```

KV cache per-token (FP8):
- 35B: 40 layers × 2 (K+V) × 2 heads × 256 dim × 1 B = 40 KB/tok
- 27B: 64 layers × 2 (K+V) × 4 heads × 256 dim × 1 B = 128 KB/tok

## 5. MTP / Speculative Decoding

Both models have 1 MTP layer. Reference enables `--speculative-config {"method":"mtp","num_speculative_tokens":3}`.

**Decision**: Defer. Dual-model MTP adds significant memory bandwidth overhead on 273 GB/s ceiling. Enable only if single-model throughput is insufficient and dual-model stability is confirmed.

## 6. Deployment

```bash
# Stop existing
docker compose -f /home/deepmind/ai-stack/vllm/docker-compose.yml down

# Start both
docker compose -f /home/deepmind/ai-stack/vllm/docker-compose.yml up -d

# Verify
curl http://localhost:8136/v1/models
curl http://localhost:8134/v1/models
```

## 7. Files

| File | Purpose |
|---|---|
| `ai-stack/vllm/docker-compose.yml` | Service definitions for both containers |
| `ai-stack/vllm/entrypoint.sh` | Shared entrypoint (proxy bg + vLLM fg) |
| `ai-stack/vllm/serve-qwen-nothink-proxy.py` | Proxy for 35B (port 8137) |
| `ai-stack/vllm/serve-qwen27b-nothink-proxy.py` | Proxy for 27B (port 8135) |
| `ai-stack/vllm/logs/` | Logs dir for both containers |

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| OOM on container startup | Reduce the other model's util; weights are non-negotiable |
| Bandwidth bottleneck at 273 GB/s | Accept slower per-token speed; consider sequential loading via router if latency-critical |
| GPU memory fragmentation | Use `--gpu-memory-utilization` conservative (0.75 total); increase gradually |
| Proxy port conflict | Unique ports per container (8137/8135) |
