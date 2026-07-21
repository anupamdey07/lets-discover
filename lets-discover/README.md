# 🔍 Lets Discover

> *Your always-learning city companion — a living, breathing discovery engine that adapts as you do.*

---

## 🌟 The Vision

Imagine landing in a new city — Berlin, Tokyo, Barcelona. You open one app. Type *"hey, just landed"*. And that's it. No dashboards, no settings, no onboarding wizard.

**Lets Discover** is not a guidebook. Not an events calendar. It's a **friend by your side** — one who listens, learns who you are, and quietly shapes the city around you.

You chat naturally. It builds your persona — your vibe, interests, goals, what makes you tick. Not through forms, but through warm back-and-forth conversation with a local LLM (Gemma-4-E2B, right on your machine).

Every interaction deepens the persona. Background SearXNG searches pull events, food spots, and places that match what it knows so far. And the app's **entire color scheme** shifts between pink and blue tones based on your personality.

> *It doesn't tell you what's happening. It figures out who you are — and shows you the city that fits.*

---

## 🧠 Core Philosophy

| Principle | Description |
|-----------|-------------|
| **Chat-first, UI-second** | The interface is born from conversation. Every widget, swimlane, and tracker emerges adaptively — not pre-built. |
| **Always learning, never asking** | Learns continuously from natural conversation. Doesn't nag. Listens, observes, quietly refines your persona day after day. |
| **Persona-driven** | Your vibe, interests, goals, and phase of life shape everything. The same city, completely different lens for different people. |
| **Daily refresh rhythm** | Content is *thoughtful* not real-time. Pipeline runs once a day: persona → search → fresh sections. Like a morning briefing. |
| **Adaptive identity** | The UI color scheme (pink ↔ blue, soft ↔ vibrant) shifts to reflect your personality. The app mirrors you. |
| **Local-first, private-by-default** | Everything on your device. Only LLM (local or remote) reaches out. |

---

## 📱 Dual-Face UI

The app has two faces connected by a smooth 3D card flip:

### Side A — Fluid Discovery 🌊

The initial face. Minimal, peaceful, playful:
- **Fluid blob background** — 3 animated blobs with 70px blur, 15s cycle
- **Floating particles** — 20 bubbles rising with varied timing (stable, no re-roll on render)
- **Pill-shaped input** — "Type anything..." with a round submit button
- **Text selection** preserved in chat bubbles, links, and inputs
- **Scroll-aware** — auto-scroll only when near the bottom; overscroll contained
- **Adaptive colors** — Blobs match the pink/blue persona theme

### Side B — Full Interface 🗺️

All the data-rich panels:
- **Discovery Panel** (26vh, themed horizontal cards)
- **Theme Selector** (Adventure/Culture/Food/Nightlife)
- **Quick Picks** (3-4 curated dishes + events from SearXNG)
- **🌟 Top Picks** — persona-matched restaurants with ratings, reviews, cuisine badges, price levels, and match explanations ("Matches your interests: jazz, vegan")
- **PersonaSheet** — peeks a slim handle at the bottom, swipes up to reveal mined persona, goals, and hobbies

### Component hierarchy

```
App.tsx
├── FlipContainer
│   ├── FrontFace (Side A)       ← Fluid discovery + chat bubbles
│   └── Back Face
│       ├── Header
│       ├── DiscoveryPanel         ← 26vh, themed horizontal cards
│       ├── ThemeSelector          ← Adventure/Culture/Food/Nightlife
│       ├── QuickPicks             ← Dishes + events strip
│       ├── TopPicks               ← 🌟 Persona-matched restaurant picks
│       └── PersonaSheet           ← Goals & hobbies drawer (peek + swipe up)
```

### Gesture: Drag to flip ⟷

| Direction | From | Action |
|-----------|------|--------|
| ← Swipe left | Front face (full area, excluding interactive elements) | Flips to back face |
| → Swipe right | Back face (left 40px edge) | Flips to front face |

**How it feels:**
- Card follows your finger 1:1 during drag
- **Exponential resistance** — further you drag, harder it gets
- **Threshold**: 80px to commit; release before → snaps back with bounce
- **Spring animation**: cubic-bezier(0.34, 1.56, 0.64, 1) — playful over-shoot
- **No transition during drag** — instant response to finger movement

### Design decisions

| Choice | Why |
|--------|-----|
| Drag over button | More tactile, playful, screen-native |
| Edge-only on back | Avoids conflicts with chat scrolling |
| Resistance curve | Prevents accidental flips on long scrolls |
| Spring snap | Feels alive, premium, Bumble-like |
| No visual flipper on back | Minimal — just a subtle ‹ arrow hint |
| Scoped preventDefault | Text selection works in bubbles/links, blocked on background |
| Stable particles | useMemo prevents re-rolling on every render |

---

## 🎨 Adaptive Color Theme

The app's entire color scheme shifts dynamically based on the user's persona, extracted by the LLM from conversation.

### Palette

| Profile | Background | Surface | Accent | When |
|---------|-----------|---------|--------|------|
| `soft-pink` | `#faf0f5` | `#fdf5f8` | `#e8a0c0` | Creative, gentle, artistic |
| `vibrant-pink` | `#f8e8f0` | `#fcf0f5` | `#d47090` | Passionate, expressive |
| `soft-blue` | `#f0f5fa` | `#fafcfd` | `#90b8e8` | Balanced, curious, calm |
| `medium-blue` | `#e8f0f8` | `#f0f5fc` | `#6088c8` | Analytical, structured, driven |

### How it works

```
LLM extracts colorProfile from chat:
  hue: "pink" | "blue"        ← based on expressed traits
  intensity: "soft" | "medium" | "vibrant"  ← based on energy level
    → data-theme="soft-pink" on .app container
    → all CSS variables (--bg, --accent, --surface...) shift instantly
```

---

## 🧩 Persona System

### What's extracted

| Field | Example | Method |
|-------|---------|--------|
| `city` | "Berlin" | LLM extraction from chat |
| `vibe` | "active" | clubber/chill/active/curious |
| `interests` | ["climbing", "jazz"] | Extracted from conversation |
| `shortTermGoals` | ["Find a climbing buddy"] | Chat + inline editor |
| `longTermGoals` | ["B2 German by December"] | Chat + inline editor |
| `hobbies` | ["climbing", "jazz"] | Extracted + editable |
| `summary` | "Creative professional..." | LLM-generated one-liner |
| `colorProfile` | `{hue:"pink", intensity:"soft"}` | LLM-analyzed from persona |

### Extraction flow

1. User chats → messages saved to SQLite
2. After every chat message, `refreshPersona()` runs async
3. Uses Gemma-4-E2B with a strict JSON extraction prompt
4. If persona already exists, merges new data
5. Triggers background search & quick picks refresh

---

## 🍽️ Top Picks & Matching Engine

Top Picks is the curation layer that matches imported places to the user's persona.

### Matching algorithm (`computeMatchScore`)

1. **Tokenize** persona interests, hobbies, goals, vibe, and city
2. **Tokenize** place title, description, cuisine, category, tags
3. **Overlap match** — each matching token adds 15 points
4. **Vibe bonus** — e.g. `clubber` → +20 for bars/clubs/nightlife
5. **Quality signals** — rating ≥4.5 = +15, reviews >500 = +12
6. **Trending boost** — 0.3× trending_score
7. **Why string** — "Matches your interests: vegan, jazz" or "Highly rated · 4.8★"

### Top Picks Card (in UI)
- Cuisine badge (e.g. ITALIAN)
- Rating stars (★ 4.8)
- Review count
- Price level (€ to €€€€)
- Match reason
- Link to Google Maps

### Swimlanes

The backend supports category/cuisine swimlanes for horizontal carousels:
```typescript
getSwimlane(sessionId, 'italian', 15)  // → top 15 Italian restaurants
getSwimlane(sessionId, 'coffee', 12)   // → top 12 coffee shops
getTrending(sessionId, 12)             // → 12 trending places
```

---

## 🗄️ Cumulative Discoveries Database

### Schema (`discoveries` table)

```sql
CREATE TABLE discoveries (
  id TEXT PRIMARY KEY,
  item_type TEXT NOT NULL CHECK(item_type IN ('event','food','place','dish')),
  title TEXT NOT NULL,
  description TEXT,
  url TEXT,
  date TEXT,
  source TEXT NOT NULL DEFAULT 'searxng',
  category TEXT,
  tags TEXT DEFAULT '[]',
  is_recurring INTEGER DEFAULT 0,
  expires_at TEXT,           -- NULL = forever, date = expiry
  verified INTEGER DEFAULT 1,
  popularity INTEGER DEFAULT 0,
  shared_by TEXT,            -- 'google_maps', 'gmap_scraper', or NULL
  session_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- Rich place metadata
  rating REAL,
  review_count INTEGER DEFAULT 0,
  price_level INTEGER,       -- 1-4 scale
  cuisine TEXT,
  photo_url TEXT,
  hours TEXT,
  phone TEXT,
  is_open INTEGER,
  trending_score REAL DEFAULT 0,
  match_score REAL DEFAULT 0
);
```

### Lifecycle rules

| Type | Retention | Source |
|------|-----------|--------|
| 🌭 Dish | Forever | Quick picks / curated |
| 🍜 Food | Forever | SearXNG / Google Maps |
| 📍 Place | Forever | SearXNG / Google Maps |
| 🎪 Event (one-time) | **63 days** then auto-deleted | SearXNG |
| 🔄 Event (recurring) | Forever (tagged `is_recurring=1`) | SearXNG |
| 🏪 Google Maps import | Forever (`shared_by='google_maps'`) | User's lists |

### Cleanup

Daily pipeline (`pipeline.ts`) calls `cleanupExpiredDiscoveries()` which deletes expired events.

---

## 📊 Current Data (360 total, 9 with ratings)

> **Note:** Most entries are from SearXNG (articles, event listings). 9 sample Berlin restaurants with ratings were seeded for UI development. For full restaurant coverage, import your Google Maps data.

### Importing Google Maps data

```bash
# From Google Takeout
npm run import-maps ~/Downloads/Takeout/Maps/Saved\ Places.json

# Rich fields supported: rating, review_count, price_level, cuisine,
# photo_url, hours, phone, is_open, labels, coordinates, notes
```

The importer automatically:
- Detects JSON formats (array, FeatureCollection, nested objects)
- Infers `item_type` (food/place/dish) from title + labels + cuisine
- Computes `trending_score` (`rating × log₁₀(reviews+1) × 10`)
- Computes `popularity` score
- Deduplicates by title and URL
- Extracts cuisine from labels or title keywords

---

## 🛠️ Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| **Frontend** | React 19 + Vite + TypeScript | Component model, fast builds, type safety |
| **Backend** | Node.js + tsx (Express) | Proven pattern |
| **LLM** | Gemma-4-E2B (`:8040` with `--jinja`) | 38 t/s, persona extraction, matching |
| **Search** | SearXNG (`:8888`) | Free, aggregates Google/DDG/Bing/Brave |
| **DB** | better-sqlite3, WAL mode | No daemon, local-first |
| **Host** | DGX GB10 → Tailscale → phone | Local server, no cloud needed |

---

## 🔌 API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/session` | Create new chat session |
| `POST` | `/api/chat` | Send message, get LLM response |
| `GET` | `/api/messages/:sessionId` | Get chat history |
| `GET` | `/api/persona/:sessionId` | Get persona + color profile |
| `PATCH` | `/api/persona/:sessionId/goals` | Update goals/hobbies |
| `GET` | `/api/activities/:sessionId` | Get current activities |
| `POST` | `/api/explore-theme` | Search by theme (adventure/culture/food/nightlife) |
| `GET` | `/api/activities/:sessionId/theme/:theme` | Get cached theme results |
| `GET` | `/api/quick-picks/:sessionId` | Get dishes + events from SearXNG |
| `GET` | `/api/discoveries` | Browse cumulative discoveries (with filters) |
| `POST` | `/api/discoveries/cleanup` | Force expire old events |
| `GET` | `/api/top-picks/:sessionId` | 🌟 Persona-matched restaurant picks |
| `GET` | `/api/swimlane/:sessionId/:lane` | Horizontal swimlane by cuisine/category |
| `GET` | `/api/trending/:sessionId` | Top trending places |
| `GET` | `/api/cuisines` | Available cuisine labels |
| `GET` | `/api/discovery-picks/:sessionId` | Quick picks from discoveries DB |

---

## 🚀 Quick Start

```bash
# Development
npm run dev              # Vite frontend dev server
npm run server           # Backend only (tsx watch)
npm run build            # Build frontend
npm run start            # Build + start production server

# Data
npm run pipeline         # Run daily refresh manually
npm run import-maps ~/path/to/Saved\ Places.json  # Import Google Maps

# Seed sample data for UI development
npx tsx src/server/seed-sample-places.ts

# Services
systemctl --user status lets-discover.service
systemctl --user restart lets-discover.service
journalctl --user -u lets-discover.service -f
systemctl --user status lets-discover-pipeline.timer  # Daily 3am Berlin
```

---

## 🧠 Pi-Agent / Dev Context

### LLM Stack (llama.cpp servers)

| Port | Model | Use |
|------|-------|-----|
| `8040` | Gemma-4-E2B 2B | Persona extraction, quick picks, matching **needs `--jinja`** |
| `8036` | Qwen3.6-35B-A3B | Deep reasoning, thinking ON |
| `8042` | Mistral-24B | Tool calling |
| `8043` | Gemma-12B | General purpose |

### Search Stack
- **SearXNG** (`:8888`) — aggregates Google, DDG, Bing, Brave
- **Camofox** — Firefox-based browser for JS rendering
- **stealth_fetch** — Chromium for anti-bot pages

### Sibling Projects
- `~/projects/newsflash/` — News delivery bot (telegram + systemd)
- `~/news-subscriber-agent/` — Multi-bot news subscriber
- `~/ai-stack/pi-agent/` — Pi extensions, config, memory tools

---

## 🏗️ Architecture Decisions

### Why no real-time streaming?
The "stream" is the **evolving persona across days**, not token-by-token LLM output. Content pre-computes overnight. The UI feels alive because sections appear and refine as the persona matures.

### Why a cumulative DB instead of ephemeral search results?
Each SearXNG call returns different results. A cumulative `discoveries` table preserves and grows the knowledge base. Events expire (63d), but food/places stay forever. Popular results bubble up.

### Why light theme with pink/blue?
Dark themes hide the adaptive color scheme. A light pastel palette makes the pink ↔ blue shifts immediately visible and emotionally resonant.

### Why Google Maps import instead of the Places API?
No API key needed. Works with shared lists, favorites, and any scrape output. Zero ongoing costs.

---

## 🗂️ Project Structure

```
lets-discover/
├── README.md
├── package.json
├── vite.config.ts
├── tsconfig.json
├── index.html                  ← Vite entry
├── data/
│   └── lets-discover.db        ← SQLite (WAL mode)
├── dist/                       ← Built frontend
├── public/
│   └── favicon.svg
├── src/
│   ├── shared/
│   │   └── types.ts            ← Persona, Message, Activity types
│   ├── server/
│   │   ├── index.ts            ← Express server + all API routes
│   │   ├── llm.ts              ← Gemma-4-E2B chat + persona extraction
│   │   ├── persona.ts          ← Persona CRUD
│   │   ├── search.ts           ← SearXNG, TopPicks, swimlanes, trending, matching
│   │   ├── pipeline.ts         ← Daily refresh (systemd timer)
│   │   ├── db.ts               ← SQLite schema + migrations + lifecycle helpers
│   │   ├── import-google-maps.ts ← Google Takeout / scraper JSON importer
│   │   └── seed-sample-places.ts ← Sample restaurant data for UI dev
│   └── client/
│       ├── main.tsx            ← React entry
│       ├── App.tsx             ← Main orchestration + flip container
│       ├── style.css           ← All styles (theme-aware, 16px base)
│       ├── hooks/
│       │   ├── useSwipeFlip.ts ← Drag-to-flip with spring physics
│       │   └── useSwipeUp.ts   ← Bottom sheet with visualViewport keyboard support
│       └── components/
│           ├── FrontFace.tsx       ← Chat face with bubbles + input
│           ├── DiscoveryPanel.tsx  ← Themed horizontal card scroller
│           ├── ThemeSelector.tsx   ← Theme pill bar
│           ├── QuickPicks.tsx      ← Dishes + events strip
│           ├── TopPicks.tsx        ← 🌟 Persona-matched restaurant cards
│           ├── PersonaSheet.tsx    ← Bottom drawer (peek + swipe up)
│           ├── PersonaSection.tsx  ← Goals/hobbies display + editor
│           └── ActivitySwimlane.tsx
```

---

## 📝 Key Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| Jul 6 | Light pink/blue adaptive theme | Let the app mirror the user's personality |
| Jul 6 | 3-zone layout: Discovery + Theme + Chat | Efficient mobile use of vertical space |
| Jul 6 | Cumulative `discoveries` table | Search results are ephemeral; a curated DB grows value |
| Jul 6 | 63-day event expiry | Events are time-sensitive; food/places are evergreen |
| Jul 6 | backgroundSearch after each chat message | Immediate feedback: chat → persona → search → results |
| Jul 6 | Google Maps import via Takeout + scraper JSON | No API key needed; any JSON source supported |
| Jul 7 | UI glitch fixes: scoped preventDefault, stable particles, no autoFocus, scroll-aware chat, visualViewport sheet | Smooth, premium feel on mobile |
| Jul 7 | TopPicks matching engine | Persona token-matching + vibe boosts + quality signals → personalized curation |
| Jul 7 | Typography pass: 16px body, bolder weights, better hierarchy | 1/2pt bigger across all text; easier reading on mobile |
| Jul 7 | Rich discovery schema: rating, reviews, cuisine, price, trending | Google Maps data → premium restaurant cards with stars + match reasons |
| Jul 7 | Removed legacy Chat.tsx | Replaced by FrontFace; removed dead code with autoFocus + aggressive scroll |
| Jul 7 | Local-first, Tailscale deployment | DGX serves to phone; no cloud needed |
