# Plan: Separate Lead and Worker Session Locks

**Date:** July 22, 2026  
**Task:** cubemate-lock-separation  
**Goal:** Allow lead and worker sessions to coexist by giving each role its own lock file.

---

## Problem

Cubemate has TWO lock mechanisms that both write to `state/.lock`:
1. **`cm-lock.sh`** (bash) — used by `cm-session-start.sh` for the primary lead session
2. **`session-lock.ts`** (TS extension) — used by worker sessions via agent profiles

Both resolve to the same `state/.lock` file, so a lead session and a worker session cannot coexist — the second one gets refused.

## Root Cause

- `cm-spawn.sh` sets `CM_HOME`, `CM_STATE_OVERRIDE`, etc. for spawned workers, but never set `FM_WORKER_LOCK` or `FM_LEAD_LOCK`
- `cm-lock.sh` always used `state/.lock` regardless of role
- `session-lock.ts` supported three lock paths via env vars, but those env vars were never set

## Solution

Set the appropriate lock env var at spawn time so each role gets its own lock file:

1. **Primary lead session:** uses default `state/.lock` (launched by harness directly, calls `cm-lock.sh acquire`)
2. **Worker spawns (ship/scout):** set `FM_WORKER_LOCK=1` → uses `state/worker.lock`
3. **Secondmate spawns (lead-type):** set `FM_LEAD_LOCK=1` → uses `state/lead.lock`

## Implementation

### File 1: `cubemate/bin/cm-spawn.sh` — env injection (commit 26c0208)

Ship/scout spawns get `FM_WORKER_LOCK=1`; secondmate spawns get `FM_LEAD_LOCK=1`.

### File 2: `cubemate/bin/cm-lock.sh` — lock path selection (commit 10957a0)

Added env var check to select lock file:
```bash
if [ "${FM_LEAD_LOCK:-}" = "1" ]; then
  LOCK="$STATE/lead.lock"
elif [ "${FM_WORKER_LOCK:-}" = "1" ]; then
  LOCK="$STATE/worker.lock"
else
  LOCK="$STATE/.lock"
fi
```

### File 3: `~/.pi/extensions/session-lock.ts` — already correct

Already reads `FM_LEAD_LOCK` and `FM_WORKER_LOCK` env vars. No changes needed.

## Lock File Mapping

| Session | Lock file | Coexists with |
|---------|-----------|---------------|
| Primary lead | `state/.lock` | Workers (`worker.lock`), secondmates (`lead.lock`) |
| Worker (ship/scout) | `state/worker.lock` | Primary lead, secondmates |
| Secondmate (lead-type) | `state/lead.lock` | Primary lead, workers |
| Two primary leads | Both `state/.lock` | ❌ Correctly refused |

## Verification

1. Start lead session → claims `state/.lock` via `cm-lock.sh`
2. Spawn worker → claims `state/worker.lock` via `session-lock.ts` (should succeed)
3. Both sessions active simultaneously → no lock conflicts
4. Worker finishes → releases `state/worker.lock`
5. Lead finishes → releases `state/.lock`
6. Start second lead session → claims `state/.lock` (correctly refused if first lead active)

## Risk Assessment

- **Low risk:** Only changes lock file paths, not lock logic
- **Backward compatible:** Existing sessions without env vars still use `state/.lock`
- **No data loss:** Lock files are transient, stale detection handles dead PIDs
- **One primary lead rule preserved:** Two primary leads still correctly conflict on `state/.lock`

## Artifact Convention

All task artifacts follow the taskbus pattern:
- **Briefs, reports, signals** → `cubemate/data/<task-id>/` (e.g., `cubemate/data/cubemate-lock-separation/brief.md`)
- **Implementation plans and specs** → `projects/docs/plans/` and `projects/docs/specs/`
- This ensures all leads and workers are traceable through the taskbus, regardless of which home spawned them.