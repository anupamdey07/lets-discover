import { getDb } from './db.js'
import { extractPersonaFromChat } from './llm.js'
import type { Persona, Message } from '../shared/types.js'

export function createSession(): string {
  const db = getDb()
  const id = crypto.randomUUID()
  db.prepare('INSERT INTO sessions (id) VALUES (?)').run(id)
  return id
}

export function getSession(id: string): boolean {
  const db = getDb()
  const row = db.prepare('SELECT id FROM sessions WHERE id = ?').get(id)
  return !!row
}

export function saveMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string
): Message {
  const db = getDb()
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()

  db.prepare(
    'INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, sessionId, role, content, createdAt)

  db.prepare(
    "UPDATE sessions SET updated_at = datetime('now') WHERE id = ?"
  ).run(sessionId)

  return { id, sessionId, role, content, createdAt }
}

export function getMessages(sessionId: string): Message[] {
  const db = getDb()
  const rows = db
    .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC')
    .all(sessionId) as any[]

  return rows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    role: r.role as 'user' | 'assistant',
    content: r.content,
    createdAt: r.created_at,
  }))
}

export function getPersona(sessionId: string): Persona | null {
  const db = getDb()
  let row = db.prepare('SELECT * FROM personas WHERE session_id = ?').get(sessionId) as any
  // Fall back to the most recently updated persona across all sessions
  if (!row) {
    row = db.prepare('SELECT * FROM personas ORDER BY updated_at DESC LIMIT 1').get() as any
  }
  if (!row) return null

  return {
    id: row.id,
    sessionId: row.session_id,
    city: row.city,
    vibe: row.vibe,
    interests: JSON.parse(row.interests || '[]'),
    shortTermGoals: JSON.parse(row.short_term_goals || '[]'),
    longTermGoals: JSON.parse(row.long_term_goals || '[]'),
    hobbies: JSON.parse(row.hobbies || '[]'),
    summary: row.summary,
    colorProfile: JSON.parse(row.color_profile || '{"hue":"blue","intensity":"soft"}'),
    shortTermBullets: JSON.parse(row.short_term_bullets || '[]'),
    longTermBullets: JSON.parse(row.long_term_bullets || '[]'),
    hobbyBullets: JSON.parse(row.hobby_bullets || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function refreshPersona(sessionId: string): Promise<Persona | null> {
  const messages = getMessages(sessionId)
  if (messages.length < 3) return getPersona(sessionId)

  const extracted = await extractPersonaFromChat(
    messages.map((m) => ({ role: m.role, content: m.content }))
  )

  const db = getDb()
  const existing = db.prepare('SELECT id FROM personas WHERE session_id = ?').get(sessionId) as any
  const now = new Date().toISOString()
  const colorProfile = JSON.stringify(extracted.colorProfile || { hue: 'blue', intensity: 'soft' })

  if (existing) {
    db.prepare(
      `UPDATE personas SET
        city = ?, vibe = ?, interests = ?, short_term_goals = ?,
        long_term_goals = ?, hobbies = ?, summary = ?,
        color_profile = ?, updated_at = ?,
        short_term_bullets = ?, long_term_bullets = ?, hobby_bullets = ?
      WHERE session_id = ?`
    ).run(
      extracted.city || null,
      extracted.vibe || 'unknown',
      JSON.stringify(extracted.interests),
      JSON.stringify(extracted.shortTermGoals),
      JSON.stringify(extracted.longTermGoals),
      JSON.stringify(extracted.hobbies),
      extracted.summary || null,
      colorProfile,
      now,
      JSON.stringify(extracted.shortTermBullets || []),
      JSON.stringify(extracted.longTermBullets || []),
      JSON.stringify(extracted.hobbyBullets || []),
      sessionId
    )
  } else {
    const id = crypto.randomUUID()
    db.prepare(
      `INSERT INTO personas
        (id, session_id, city, vibe, interests, short_term_goals, long_term_goals, hobbies, summary, color_profile,
         short_term_bullets, long_term_bullets, hobby_bullets,
         created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      sessionId,
      extracted.city || null,
      extracted.vibe || 'unknown',
      JSON.stringify(extracted.interests),
      JSON.stringify(extracted.shortTermGoals),
      JSON.stringify(extracted.longTermGoals),
      JSON.stringify(extracted.hobbies),
      extracted.summary || null,
      colorProfile,
      JSON.stringify(extracted.shortTermBullets || []),
      JSON.stringify(extracted.longTermBullets || []),
      JSON.stringify(extracted.hobbyBullets || []),
      now,
      now
    )
  }

  return getPersona(sessionId)
}

export function updatePersonaGoals(
  sessionId: string,
  goals: { shortTerm?: string[]; longTerm?: string[]; hobbies?: string[] }
): Persona | null {
  const db = getDb()
  const existing = getPersona(sessionId)
  if (!existing) return null

  const shortTerm = goals.shortTerm ?? existing.shortTermGoals
  const longTerm = goals.longTerm ?? existing.longTermGoals
  const hobbies = goals.hobbies ?? existing.hobbies

  db.prepare(
    `UPDATE personas SET
      short_term_goals = ?, long_term_goals = ?, hobbies = ?, updated_at = ?
    WHERE session_id = ?`
  ).run(
    JSON.stringify(shortTerm),
    JSON.stringify(longTerm),
    JSON.stringify(hobbies),
    new Date().toISOString(),
    sessionId
  )

  return getPersona(sessionId)
}
