import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.resolve(__dirname, '../../data/lets-discover.db')

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    initSchema()
    migrate()
  }
  return db
}

function initSchema() {
  db!.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS personas (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE,
      city TEXT,
      vibe TEXT DEFAULT 'unknown',
      interests TEXT DEFAULT '[]',
      short_term_goals TEXT DEFAULT '[]',
      long_term_goals TEXT DEFAULT '[]',
      hobbies TEXT DEFAULT '[]',
      summary TEXT,
      color_profile TEXT DEFAULT '{"hue":"blue","intensity":"soft"}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    -- Old activities table (kept for backward compat, migrations below)
    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      url TEXT,
      date TEXT,
      source TEXT NOT NULL DEFAULT 'searxng',
      category TEXT,
      matched_interest TEXT,
      theme TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    -- New discoveries table — cumulative, with lifecycle management
    CREATE TABLE IF NOT EXISTS discoveries (
      id TEXT PRIMARY KEY,
      item_type TEXT NOT NULL CHECK(item_type IN ('event', 'food', 'place', 'dish')),
      title TEXT NOT NULL,
      description TEXT,
      url TEXT,
      date TEXT,
      source TEXT NOT NULL DEFAULT 'searxng',
      category TEXT,
      tags TEXT DEFAULT '[]',
      is_recurring INTEGER DEFAULT 0,
      expires_at TEXT,
      verified INTEGER DEFAULT 1,
      popularity INTEGER DEFAULT 0,
      shared_by TEXT,
      session_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      rating REAL,
      review_count INTEGER DEFAULT 0,
      price_level INTEGER,
      cuisine TEXT,
      photo_url TEXT,
      hours TEXT,
      phone TEXT,
      is_open INTEGER,
      trending_score REAL DEFAULT 0,
      match_score REAL DEFAULT 0
    );

    -- Index for fast cumulative queries
    CREATE INDEX IF NOT EXISTS idx_discoveries_type ON discoveries(item_type);
    CREATE INDEX IF NOT EXISTS idx_discoveries_expires ON discoveries(expires_at);
    CREATE INDEX IF NOT EXISTS idx_discoveries_popular ON discoveries(popularity DESC);
    CREATE INDEX IF NOT EXISTS idx_discoveries_tags ON discoveries(tags);
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_personas_session ON personas(session_id);
    CREATE INDEX IF NOT EXISTS idx_activities_session ON activities(session_id);
  `)
}

function migrate() {
  // Add color_profile to personas
  try { db!.exec("ALTER TABLE personas ADD COLUMN color_profile TEXT DEFAULT '{\"hue\":\"blue\",\"intensity\":\"soft\"}'") } catch {}

  // Add theme to activities (legacy)
  try { db!.exec('ALTER TABLE activities ADD COLUMN theme TEXT') } catch {}

  // Add is_recurring to discoveries
  try { db!.exec('ALTER TABLE discoveries ADD COLUMN is_recurring INTEGER DEFAULT 0') } catch {}
  try { db!.exec('ALTER TABLE discoveries ADD COLUMN shared_by TEXT') } catch {}
  try { db!.exec('ALTER TABLE discoveries ADD COLUMN session_id TEXT') } catch {}

  // Persona bullet summaries
  try { db!.exec("ALTER TABLE personas ADD COLUMN short_term_bullets TEXT DEFAULT '[]'") } catch {}
  try { db!.exec("ALTER TABLE personas ADD COLUMN long_term_bullets TEXT DEFAULT '[]'") } catch {}
  try { db!.exec("ALTER TABLE personas ADD COLUMN hobby_bullets TEXT DEFAULT '[]'") } catch {}

  // Richer place metadata (Google Maps / enriched data)
  try { db!.exec('ALTER TABLE discoveries ADD COLUMN rating REAL') } catch {}
  try { db!.exec('ALTER TABLE discoveries ADD COLUMN review_count INTEGER DEFAULT 0') } catch {}
  try { db!.exec('ALTER TABLE discoveries ADD COLUMN price_level INTEGER') } catch {}
  try { db!.exec('ALTER TABLE discoveries ADD COLUMN cuisine TEXT') } catch {}
  try { db!.exec('ALTER TABLE discoveries ADD COLUMN photo_url TEXT') } catch {}
  try { db!.exec('ALTER TABLE discoveries ADD COLUMN hours TEXT') } catch {}
  try { db!.exec('ALTER TABLE discoveries ADD COLUMN phone TEXT') } catch {}
  try { db!.exec('ALTER TABLE discoveries ADD COLUMN is_open INTEGER') } catch {}
  try { db!.exec('ALTER TABLE discoveries ADD COLUMN trending_score REAL DEFAULT 0') } catch {}
  try { db!.exec('ALTER TABLE discoveries ADD COLUMN match_score REAL DEFAULT 0') } catch {}
  // Relevance scoring columns (Jul 7 2026)
  try { db!.exec('ALTER TABLE discoveries ADD COLUMN source_quality REAL DEFAULT 0.4') } catch {}
  try { db!.exec('ALTER TABLE discoveries ADD COLUMN freshness_score REAL DEFAULT 0') } catch {}
  try { db!.exec('ALTER TABLE discoveries ADD COLUMN is_warmstart INTEGER DEFAULT 0') } catch {}

  // Last-intent memory on sessions (for next-search boost)
  try { db!.exec("ALTER TABLE sessions ADD COLUMN last_intent TEXT DEFAULT '{\"cuisines\":[],\"hoods\":[]}'") } catch {}
  try { db!.exec('CREATE INDEX IF NOT EXISTS idx_discoveries_rating ON discoveries(rating DESC)') } catch {}
  try { db!.exec('CREATE INDEX IF NOT EXISTS idx_discoveries_cuisine ON discoveries(cuisine)') } catch {}
  try { db!.exec('CREATE INDEX IF NOT EXISTS idx_discoveries_trending ON discoveries(trending_score DESC)') } catch {}
  try { db!.exec('CREATE INDEX IF NOT EXISTS idx_discoveries_match ON discoveries(match_score DESC)') } catch {}

  // Google Maps favorites list
  try {
    db!.exec(`
      CREATE TABLE IF NOT EXISTS gmaps_favorites (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        gmaps_link TEXT NOT NULL,
        list_name TEXT,
        places TEXT DEFAULT '[]',
        place_count INTEGER DEFAULT 0,
        last_scraped TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
  } catch {}
  try { db!.exec('ALTER TABLE gmaps_favorites ADD COLUMN list_name TEXT') } catch {}
  try { db!.exec('ALTER TABLE gmaps_favorites ADD COLUMN place_count INTEGER DEFAULT 0') } catch {}
}

export function closeDb() {
  if (db) {
    db.close()
    db = null
  }
}

// ─── Discovery lifecycle helpers ──────────────────────────────────

export function computeExpiresAt(itemType: string, date?: string, isRecurring?: boolean): string | null {
  // Food / places: never expire
  if (itemType === 'food' || itemType === 'place' || itemType === 'dish') return null
  // Recurring events: keep forever
  if (isRecurring) return null
  // One-time events: expire in 63 days
  const d = new Date()
  d.setDate(d.getDate() + 63)
  return d.toISOString()
}

export function cleanupExpiredDiscoveries(): number {
  const db = getDb()
  const result = db.prepare(
    `DELETE FROM discoveries
     WHERE expires_at IS NOT NULL
     AND expires_at < datetime('now')`
  ).run()
  return result.changes
}

export function getCumulativeDiscoveries(
  options: {
    types?: string[]
    limit?: number
    offset?: number
    category?: string
    tag?: string
    minPopularity?: number
  } = {}
): any[] {
  const db = getDb()
  const conditions: string[] = ['1=1']
  const params: any[] = []

  if (options.types?.length) {
    conditions.push(`item_type IN (${options.types.map(() => '?').join(',')})`)
    params.push(...options.types)
  }
  if (options.category) {
    conditions.push('category = ?')
    params.push(options.category)
  }
  if (options.tag) {
    conditions.push("tags LIKE ?")
    params.push(`%${options.tag}%`)
  }

  const limit = options.limit || 50
  const offset = options.offset || 0

  const rows = db.prepare(
    `SELECT * FROM discoveries
     WHERE ${conditions.join(' AND ')}
     AND (expires_at IS NULL OR expires_at > datetime('now'))
     ORDER BY popularity DESC, created_at DESC
     LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as any[]

  return rows
}
