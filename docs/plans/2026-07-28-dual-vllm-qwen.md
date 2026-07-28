# Dual vLLM: Qwen3.6-35B-A3B-FP8 + Qwen3.5-27B-FP8 on DGX Spark GB10

**Date:** 2026-07-28  
**Status:** Proposed  
**Goal:** Run two Qwen models simultaneously on a single NVIDIA GB10 (128 GB unified memory) using separate vLLM Docker containers.

## Architecture

Two Docker containers sharing the same GPU via `--gpu-memory-utilization` split:

```
vllm-qwen (35B MoE)         vllm-qwen27b (27B Dense)
  port 8136 (vLLM raw)        port 8134 (vLLM raw)
  port 8137 (proxy no-think)  port 8135 (proxy no-think)
  model: Qwen3.6-35B-A3B-FP8  model: Qwen3.5-27B-FP8
  util: 0.40                  util: 0.35
  ctx: 131072                 ctx: 65536
  seqs: 2                     seqs: 1
```

Each container runs:
1. **vLLM serve** in foreground (PID 1)
2. **Non-thinking proxy** in background (injects `enable_thinking: false`)

## Params

### 35B MoE
```
--port 8000
--served-model-name qwen35a3b-fp8
--quantization fp8
--max-model-len 131072
--kv-cache-dtype fp8
--enable-prefix-caching
--enable-chunked-prefill
--max-num-batched-tokens 4096
--max-num-seqs 2
--gpu-memory-utilization 0.40
--tensor-parallel-size 1
--enable-auto-tool-choice
--tool-call-parser qwen3_coder
--reasoning-parser qwen3
--trust-remote-code
--default-chat-template-kwargs {"enable_thinking": true}
```

### 27B Dense
```
--port 8000
--served-model-name qwen35-27b-fp8
--quantization fp8
--max-model-len 65536
--kv-cache-dtype fp8
--enable-prefix-caching
--enable-chunked-prefill
--max-num-batched-tokens 2048
--max-num-seqs 1
--gpu-memory-utilization 0.35
--tensor-parallel-size 1
--trust-remote-code
--language-model-only
--enable-auto-tool-choice
--tool-call-parser qwen3_coder
--reasoning-parser qwen3
--default-chat-template-kwargs {"enable_thinking": true}
```

## Memory Budget

| Component | 35B @ 0.40 | 27B @ 0.35 |
|---|---|---|
| Budget (GiB) | 48.4 | 42.3 |
| Weights (FP8) | −35.0 | −29.0 |
| CUDA overhead | −3.0 | −2.5 |
| KV cache available | 10.4 | 10.8 |
| KV cache needed | 10.0 (131K×2) | 8.0 (64K×1) |
| **Margin** | **+0.4** | **+2.8** |
| Combined util | 0.75 | |
| Buffer (OS/CPU) | 30.3 GiB (25%) | |

## Port Map

| Service | vLLM | Proxy | Model Name |
|---|---|---|---|
| vllm-qwen (35B) | 8136 | 8137 | qwen35a3b-fp8 |
| vllm-qwen27b (27B) | 8134 | 8135 | qwen35-27b-fp8 |

## MTP / Speculative Decoding

Both models have `mtp_num_hidden_layers: 1` in config, supporting MTP speculative decoding. **Not enabled initially** — adds meaningful overhead on GB10's 273 GB/s bandwidth. Re-evaluate after confirming stable dual-model operation.

## Startup

```bash
docker compose down
docker compose up -d
docker compose logs -f
```

## Tuning

- If either OOMs on startup, reduce the **other** model's util first
- Increase 35B context by bumping its util to 0.42–0.45, drop 27B to 0.30–0.33
- 27B at 0.30 gives ~37K tokens — enough for short agent loops
- Expected throughput: ~50-60% of single-model speed (bandwidth bottleneck)
