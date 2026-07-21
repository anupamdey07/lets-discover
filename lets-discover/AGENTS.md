# Lets Discover 🔍

Always-learning city companion — chat-first discovery engine that builds your persona through conversation, then surfaces events, food, and places that match. Local LLM, adaptive UI (pink ↔ blue), daily SearXNG search pipeline.

## Trajectory
Key checkpoints: 2026-07 — Chat-first persona engine with daily pipeline | Next: city data expansion

## Paths
- Specs: `~/projects/docs/specs/`
- Plans: `~/projects/docs/plans/`
- Backlog: `~/projects/docs/backlog.md`

## Tech Stack
| Layer | Choice |
|-------|--------|
| Frontend | React 19 + Vite 6 + Express server |
| Backend | Express 4 + better-sqlite3 |
| DB | SQLite (persona, chat history, discovered places) |
| LLM | llama.cpp :8040 (Gemma-4 E2B) for persona extraction |
| Search | SearXNG :8888 for events/places |

## Running
```bash
npm run dev          # Vite dev + Express server on :3001
npm run pipeline     # Run daily search pipeline
systemctl --user status lets-discover.service lets-discover-pipeline.service
```

## Working Rules
- Commit before reporting done
- Evidence: file paths, line numbers, errors
- Test on running service