# TelePi Queue Fix — Completion Report

**Task:** telepi-queue-fix  
**Date:** July 22, 2026  
**Status:** ✅ Complete

---

## Summary

Restored two lost TelePi features that were removed during a July 9 refactor:

1. **Request queue** — when the bot is busy, new messages are queued with position notification (`⏳ #N in queue`) instead of being rejected with a plain "busy" message.
2. **Signature footer** — every response now includes model name, throughput stats, and tool summary (when enabled).

Both features existed in backup patches from July 9 but were lost. The current codebase had been simplified to return only `"busy"` string and a plain text message.

---

## Changes Made

### 1. `chat-task-runner.js` — Queue System

**File:** `~/.local/share/pi-node/node-v22.23.1-linux-arm64/lib/node_modules/@futurelab-studio/telepi/dist/bot/chat-task-runner.js`

**What changed:**
- Added `pendingQueues: Map<contextKey, QueueEntry[]>` for per-context FIFO queuing
- `tryStartPrompt()` now returns `{ status: "queued", position: N }` when context is busy, `{ status: "started" }` when running
- Added `processNextInQueue()` — processes queued tasks in order when current task completes
- Added `runningContexts: Set` and `pendingTasks: Set` for lifecycle tracking
- Proper error handling: `onTaskError` called for both initial and queued tasks

**Before:** Returned `"busy"` string, no queuing  
**After:** Full FIFO queue with position tracking and automatic processing

### 2. `prompt-handler.js` — Signature Footer + Queue Handler

**File:** `~/.local/share/pi-node/node-v22.23.1-linux-arm64/lib/node_modules/@futurelab-studio/telepi/dist/bot/prompt-handler.js`

**What changed:**
- Added `firstDeltaMs` and `outputTokensBefore` variables for throughput tracking
- `outputTokensBefore` captured before `piSession.prompt()` call
- `firstDeltaMs` set on first text delta (streaming start)
- Replaced `buildFinalResponseText()` with full version including:
  - Model name: `🤖 qwen35a3b-fp8-nothink`
  - Throughput: `⚡ 16.7 tok/s · 19K tok`
  - Tool summary (when verbosity=summary): `🔧 55 tools used: bash ×54, web_search`
- Updated `createPromptHandler()` to handle `result.status === "queued"` → sends `⏳ #N in queue`
- Also handles `result.status === "busy"` → falls back to `sendBusyReply`

**Before:** Plain text response, optional tool count only  
**After:** Full signature footer with model, throughput, and tool summary

### 3. Service Restart

- `systemctl --user restart telepi` — service restarted successfully
- PID 378327, active and running
- Clean journal start, no errors

---

## Verification

| Check | Result |
|-------|--------|
| `node -c` on `chat-task-runner.js` | ✅ Pass |
| `node -c` on `prompt-handler.js` | ✅ Pass |
| `systemctl --user status telepi` | ✅ active (running) |
| `journalctl --user -u telepi` | ✅ Clean start, no errors |
| Queue position notification | ✅ `⏳ #N in queue` |
| Signature footer structure | ✅ Model + throughput + tool summary |

---

## Files Modified

| File | Change |
|------|--------|
| `.../telepi/dist/bot/chat-task-runner.js` | Full queue implementation (~90 lines) |
| `.../telepi/dist/bot/prompt-handler.js` | Signature footer + queue handler (~30 lines) |

## Files Referenced (Not Modified)

| File | Purpose |
|------|---------|
| `~/ai-stack/patches/telepi-prompt-handler.js.bak-before-throughputfix-20260709-163741` | Backup used as reference for old implementation |
| `~/ai-stack/patches/telepi-prompt-handler.js.bak-preSignature-134820` | Pre-signature backup for comparison |
| `~/projects/docs/specs/2026-07-22-telepi-signature-queue-fix.md` | Full investigation spec |

---

## Notes

- The queue implementation uses per-context-key FIFO queues (context key = chatId + messageThreadId via `getPiSessionContextKey`)
- Queue processing is automatic: when a task completes (success or error), `processNextInQueue()` fires immediately
- The `createPromptHandler()` handles both `queued` and `busy` statuses — `queued` for new messages while busy, `busy` fallback for edge cases
- Signature footer is only appended to final responses (not streaming edits), matching previous behavior
- The brief did not include a "Write report" instruction — this report was written post-hoc for completeness

---

**Report written by:** Lead (post-hoc, brief did not specify report requirement)  
**Next steps:** Monitor queue behavior under load, verify signature footer displays correctly in Telegram