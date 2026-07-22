# Pi Sessions Observability — Design

**Date:** 2026-07-23
**Project:** LLM Dashboard (`~/projects/llm-dashboard/`)
**Status:** Approved

## Goal

Replace the bloated `pi_observability.html` page with a minimal, fast session viewer:
1. Directory tiles (clickable, dynamic on refresh)
2. Session list (ID, timestamp, cwd, entry count — clickable)
3. Parsed session view (grouped by type, one-line briefs, expand on click)

Remove: memory stats, skills/extensions grid, compaction history, summarize button, resume commands, modals, auto-refresh, toast notifications.

## Architecture

### Single Page

One HTML file embedded in FastAPI. No external dependencies. No JS framework.

### 3 API Endpoints (server-side parsing)

| Endpoint | Method | Returns |
|---|---|---|
| `/api/sessions/directories` | GET | `["dir1", "dir2", ...]` |
| `/api/sessions/list?dir=<name>` | GET | `[{name, id, timestamp, cwd, entryCount}]` |
| `/api/sessions/parse?file=<path>` | GET | `{ "user": [{brief, full}], "assistant": [...], "toolCall": [...], "thinking": [...], "custom": [...], "compaction": [...] }` |

### Session JSONL Format

Each `.jsonl` file contains one JSON object per line. Entry types:

| Type | Structure |
|---|---|
| `session` | `{type, version, id, timestamp, cwd}` |
| `message` | `{type, id, parentId, timestamp, message: {role: user\|assistant, content: [{type, text\|thinking\|toolCall...}]}}` |
| `custom` | `{type, customType, data, id, parentId, timestamp}` |
| `compaction` | `{type, tokensBefore, summary, timestamp}` |

Entry types in a session file: `session`, `message`, `toolCall`, `thinking`, `text`, `custom`, `compaction`.

`message` entries have `role: "user"` or `role: "assistant"`. Assistant messages contain `toolCall` and `thinking` blocks in their `content` array.

### Grouping Logic (server-side)

The `/parse` endpoint reads the JSONL file and groups entries:

- **user**: All `message` entries where `role == "user"`
- **assistant**: All `message` entries where `role == "assistant"`
- **toolCall**: All entries where `type == "toolCall"`
- **thinking**: All entries where `type == "thinking"`
- **custom**: All entries where `type == "custom"`
- **compaction**: All entries where `type == "compaction"`

Each entry becomes a one-line brief (first meaningful text, truncated to ~120 chars) plus the full content.

## UI — 3 Views

### View 1: Directory Tiles

- Grid of clickable tiles
- Each tile: directory name (readable), session count
- Refresh button fetches fresh list from `/api/sessions/directories`
- Clicking a tile navigates to View 2

### View 2: Session List

- Shown when a directory is selected
- Each session: row with session ID (short), timestamp, cwd, entry count
- Clicking a row navigates to View 3

### View 3: Parsed Session

- Grouped by entry type with colored badges
- Group header: emoji + type name + count (e.g., `📝 User Messages (5)`)
- One-line brief per entry: first meaningful text, truncated with `...`
- Clicking a brief expands inline (accordion) to show full content
- Back button returns to session list

## Styling

- Dark theme: `#0d1117` background, `#161b22` surfaces, `#58a6ff` accent
- Minimal CSS — no framework, no external fonts
- Color-coded type badges: user=blue, assistant=green, toolCall=orange, thinking=purple, custom=cyan, compaction=red
- Accordion expand/collapse with smooth CSS transition
- Responsive grid for directory tiles

## File Changes

| File | Action |
|---|---|
| `dashboard/pi_observability.html` | Delete |
| `dashboard/pi_sessions.html` | Create |
| `dashboard/web.py` | Replace `/api/observability/*` routes with new `/api/sessions/*` routes |
| `dashboard/web.py` | Update `/pi-observability` route to serve `pi_sessions.html` |

## What's Removed

- Memory stats section (facts, BM25 docs, compacted sessions, tokens)
- Skills & Extensions grid
- Compaction history table
- Summarize current session button
- Resume command copy button
- Session detail modal
- Auto-refresh interval
- Toast notifications
- All existing `/api/observability/*` endpoints