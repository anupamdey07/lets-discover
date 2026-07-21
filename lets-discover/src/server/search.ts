import { getDb, computeExpiresAt } from './db.js'
import { getPersona } from './persona.js'
import type { Activity } from '../shared/types.js'
import type { Persona } from '../shared/types.js'

const SEARXNG_URL = process.env.SEARXNG_URL || 'http://localhost:8888'

interface SearxngResult {
  title: string
  url: string
  content?: string
  publishedDate?: string
  engine?: string
}

// ─── String similarity (Levenshtein-based) for title dedup ───────
function similarity(a: string, b: string): number {
  if (a === b) return 1
  const al = a.length, bl = b.length
  if (al === 0 || bl === 0) return 0
  if (Math.abs(al - bl) > Math.min(al, bl) * 0.5) return 0  // length diff too big
  // Bounded Levenshtein — early exit if distance > threshold
  const maxDist = Math.floor(Math.min(al, bl) * 0.4)
  const row: number[] = Array(bl + 1)
  for (let j = 0; j <= bl; j++) row[j] = j
  for (let i = 1; i <= al; i++) {
    let prev = i - 1
    row[0] = i
    let rowMin = i
    for (let j = 1; j <= bl; j++) {
      const tmp = row[j]
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost)
      prev = tmp
      if (row[j] < rowMin) rowMin = row[j]
    }
    if (rowMin > maxDist) return 0
  }
  return 1 - row[bl] / Math.max(al, bl)
}

function titlesAreSimilar(a: string, b: string): boolean {
  return similarity(a.toLowerCase(), b.toLowerCase()) >= 0.8
}

// ─── Tokenization + persona-matching (reused at ingest & query) ──
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-zäöüß0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2)
}

function getPersonaTokens(p: Persona): Set<string> {
  const t = new Set<string>()
  p.interests.forEach((i) => tokenize(i).forEach((x) => t.add(x)))
  p.hobbies.forEach((h) => tokenize(h).forEach((x) => t.add(x)))
  p.shortTermGoals.forEach((g) => tokenize(g).forEach((x) => t.add(x)))
  p.longTermGoals.forEach((g) => tokenize(g).forEach((x) => t.add(x)))
  if (p.vibe && p.vibe !== 'unknown') t.add(p.vibe.toLowerCase())
  if (p.city) tokenize(p.city).forEach((x) => t.add(x))
  return t
}

export interface ScoredItem {
  // Input fields
  title: string
  description?: string
  url?: string
  date?: string
  source: string
  category?: string
  cuisine?: string
  tags?: string[]
  // Computed
  matchScore: number
  freshnessScore: number
  sourceQuality: number
  intentBoost: number
  totalScore: number
}

/**
 * Score a single candidate against a persona + last-chat intent.
 * Called at ingest time (so scores are persisted) and as a building block
 * for the relevance benchmark.
 */
export function scoreCandidate(
  cand: {
    title: string
    description?: string
    date?: string
    source: string
    category?: string
    cuisine?: string
    tags?: string[]
  },
  opts: { persona?: Persona | null; lastIntent?: { cuisines: string[]; hoods: string[] } } = {}
): ScoredItem {
  const { persona, lastIntent } = opts

  // ── Source quality ──
  const SOURCE_QUALITY: Record<string, number> = {
    gmap_scraper: 0.9,
    handpicked: 0.85,
    luma: 0.7,
    raus: 0.7,
    eventim: 0.65,
    searxng: 0.3,
  }
  const sourceQuality = SOURCE_QUALITY[cand.source] ?? 0.4

  // ── Freshness ──
  let freshnessScore = 0
  if (cand.date) {
    const d = new Date(cand.date)
    if (!isNaN(d.getTime())) {
      const days = (d.getTime() - Date.now()) / 86_400_000
      if (days < 0) freshnessScore = -10          // already past
      else if (days < 3) freshnessScore = 30      // happening soon
      else if (days < 14) freshnessScore = 25
      else if (days < 60) freshnessScore = 10
      else freshnessScore = 0
    }
  }

  // ── Match against persona tokens ──
  let matchScore = 0
  let intentBoost = 0
  const text = [cand.title, cand.description, cand.category, cand.cuisine, (cand.tags || []).join(' ')]
    .filter(Boolean)
    .join(' ')
  const tokens = tokenize(text)

  if (persona) {
    const personaTokens = getPersonaTokens(persona)
    const matchedTokens = new Set(tokens.filter((t) => personaTokens.has(t)))
    matchScore = matchedTokens.size * 15

    // Vibe bonuses
    const vibe = persona.vibe
    if (vibe === 'clubber' && /club|bar|nightlife|music|dj|techno/.test(text)) matchScore += 20
    if (vibe === 'chill' && /cafe|park|cozy|relax|lounge/.test(text)) matchScore += 20
    if (vibe === 'active' && /sport|climb|hike|bike|outdoor|run/.test(text)) matchScore += 20
    if (vibe === 'curious' && /museum|art|gallery|tour|culture|festival/.test(text)) matchScore += 20
  }

  // ── Last-intent boost (session-level, ephemeral) ──
  if (lastIntent) {
    const tl = text.toLowerCase()
    for (const c of lastIntent.cuisines) {
      if (c.length > 2 && tl.includes(c)) intentBoost += 18
    }
    for (const h of lastIntent.hoods) {
      if (h.length > 2 && tl.includes(h)) intentBoost += 12
    }
  }

  const totalScore =
    Math.round((matchScore + freshnessScore + sourceQuality * 30 + intentBoost) * 100) / 100

  return {
    title: cand.title,
    description: cand.description,
    date: cand.date,
    source: cand.source,
    category: cand.category,
    cuisine: cand.cuisine,
    tags: cand.tags,
    matchScore: Math.round(matchScore * 100) / 100,
    freshnessScore: Math.round(freshnessScore * 100) / 100,
    sourceQuality,
    intentBoost: Math.round(intentBoost * 100) / 100,
    totalScore,
  }
}

export async function searchEvents(
  query: string,
  maxResults = 12
): Promise<Activity[]> {
  try {
    const params = new URLSearchParams({
      q: query,
      format: 'json',
      language: 'en',
      categories: 'general,news',
      pageno: '1',
    })

    const res = await fetch(`${SEARXNG_URL}/search?${params}`, {
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) return []

    const data = (await res.json()) as { results: SearxngResult[] }
    const results = data.results?.slice(0, maxResults) || []

    return results.map((r) => ({
      id: crypto.randomUUID(),
      title: r.title?.replace(/<[^>]*>/g, '') || 'Unknown Event',
      description: r.content?.replace(/<[^>]*>/g, '').slice(0, 200) || '',
      url: r.url || '',
      date: r.publishedDate || undefined,
      source: 'searxng' as const,
      category: guessCategory(query, r),
      matchedInterest: query.split(' ').slice(-1)[0],
    }))
  } catch {
    return []
  }
}

function guessCategory(searchQuery: string, result: SearxngResult): string {
  const q = searchQuery.toLowerCase()
  const t = (result.title + ' ' + (result.content || '')).toLowerCase()

  if (q.includes('techno') || q.includes('club') || q.includes('dj')) return 'nightlife'
  if (q.includes('jazz') || q.includes('concert') || q.includes('live music')) return 'music'
  if (q.includes('climb') || q.includes('boulder') || q.includes('sport')) return 'sports'
  if (q.includes('tech') || q.includes('ai') || q.includes('startup')) return 'tech'
  if (q.includes('art') || q.includes('gallery') || q.includes('museum')) return 'art'
  if (q.includes('food') || q.includes('cook') || q.includes('restaurant')) return 'food'
  if (q.includes('yoga') || q.includes('run') || q.includes('fitness')) return 'wellness'
  if (q.includes('meetup') || q.includes('network')) return 'networking'
  if (t.includes('workshop') || t.includes('course') || t.includes('class')) return 'learning'

  return 'general'
}

export function saveActivities(
  sessionId: string,
  activities: Activity[]
): number {
  const db = getDb()
  let saved = 0

  const insert = db.prepare(
    `INSERT OR IGNORE INTO activities
      (id, session_id, title, description, url, date, source, category, matched_interest)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  const tx = db.transaction(() => {
    for (const a of activities) {
      const result = insert.run(
        a.id,
        sessionId,
        a.title,
        a.description || null,
        a.url || null,
        a.date || null,
        a.source,
        a.category || null,
        a.matchedInterest || null
      )
      if (result.changes > 0) saved++
    }
  })

  tx()
  return saved
}

export function getActivities(sessionId: string): Activity[] {
  const db = getDb()
  const rows = db
    .prepare(
      'SELECT * FROM activities WHERE session_id = ? ORDER BY created_at DESC'
    )
    .all(sessionId) as any[]

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    url: r.url,
    date: r.date,
    source: r.source,
    category: r.category,
    matchedInterest: r.matched_interest,
  }))
}

export function clearOldActivities(sessionId: string, keepDays = 7) {
  const db = getDb()
  db.prepare(
    `DELETE FROM activities WHERE session_id = ? AND created_at < datetime('now', '-' || ? || ' days')`
  ).run(sessionId, keepDays)
}

// ─── Background search (lightweight, runs after each chat message) ───

export async function backgroundSearch(
  sessionId: string,
  persona: {
    city?: string
    vibe?: string
    interests: string[]
    hobbies: string[]
  }
): Promise<number> {
  const queries: string[] = []
  const city = persona.city || 'Berlin'

  // Always: general city discovery
  if (queries.length < 2) {
    queries.push(`${city} things to do today events`)
  }

  // Interests → events & food & POIs
  for (const interest of persona.interests.slice(0, 2)) {
    queries.push(`${city} ${interest} events activities`)
    queries.push(`${city} best ${interest} places`)
  }

  // Hobbies
  for (const hobby of persona.hobbies.slice(0, 2)) {
    queries.push(`${city} ${hobby} clubs groups`)
  }

  // Vibe-based
  if (persona.vibe && persona.vibe !== 'unknown') {
    const vibeQueries: Record<string, string[]> = {
      clubber: [`${city} nightlife parties clubs`, `${city} electronic music`],
      chill: [`${city} cozy cafés hidden gems`, `${city} parks relaxation`],
      active: [`${city} outdoor activities sports`, `${city} hiking biking`],
      curious: [`${city} cultural attractions museums`, `${city} unique experiences`],
    }
    const vq = vibeQueries[persona.vibe]
    if (vq) queries.push(...vq)
  }

  // Food is always fun
  queries.push(`${city} best food recommendations`)

  // Limit to 6 queries for responsiveness
  const activeQueries = queries.slice(0, 6)
  const seenUrls = new Set<string>()
  const allActivities: Activity[] = []

  for (const query of activeQueries) {
    if (allActivities.length >= 20) break

    const results = await searchEvents(query, 6)
    for (const activity of results) {
      if (!seenUrls.has(activity.url || '')) {
        seenUrls.add(activity.url || '')
        allActivities.push(activity)
      }
    }

    // 1.5s gap between searches
    await new Promise((r) => setTimeout(r, 1500))
  }

  if (allActivities.length > 0) {
    // Keep activities fresh — clear old ones from this session
    const db = getDb()
    db.prepare('DELETE FROM activities WHERE session_id = ? AND theme IS NULL').run(sessionId)
    saveActivities(sessionId, allActivities)

    // Also save to cumulative discoveries table (scored by persona)
    saveToDiscoveries(
      allActivities.map((a) => ({
        title: a.title,
        description: a.description,
        url: a.url,
        date: a.date,
        source: a.source,
        category: a.category,
        itemType: a.category === 'food' ? 'food' : 'place',
        tags: a.matchedInterest ? [a.matchedInterest] : [],
        sessionId,
      })),
      { persona: getPersona(sessionId) }
    )
  }
  return allActivities.length
}

// ─── Theme-based discovery search ─────────────────────────────────
// Each theme gets specific queries to find real places, events, cafes, festivals

const THEME_QUERIES: Record<string, string[]> = {
  adventure: [
    'climbing gyms bouldering parks',
    'hiking trails outdoor sports',
    'adventure activities weekend',
    'bike rental running groups parks',
  ],
  culture: [
    'museums galleries art exhibitions',
    'concerts live music theater performances',
    'cultural festivals events this month',
    'historic landmarks architecture tours',
  ],
  food: [
    'best cafes brunch spots',
    'restaurants food guide must eat',
    'food markets street food festivals',
    'hidden gem restaurants local cuisine',
  ],
  nightlife: [
    'clubs nightlife bars cocktail',
    'live music venues dj parties',
    'late night bars speakeasy rooftop',
    'electronic music techno clubs',
  ],
}

export async function searchByTheme(
  sessionId: string,
  city: string,
  theme: string
): Promise<Activity[]> {
  const queries = THEME_QUERIES[theme]
  if (!queries) return []

  const seenUrls = new Set<string>()
  const allActivities: Activity[] = []

  for (const q of queries) {
    if (allActivities.length >= 15) break

    const results = await searchEvents(`${city} ${q}`, 8)
    for (const activity of results) {
      if (!seenUrls.has(activity.url || '')) {
        seenUrls.add(activity.url || '')
        activity.category = theme
        allActivities.push(activity)
      }
    }

    await new Promise((r) => setTimeout(r, 1500))
  }

  // Save to DB with theme tag
  if (allActivities.length > 0) {
    const db = getDb()
    // Clear old activities for this theme
    db.prepare('DELETE FROM activities WHERE session_id = ? AND theme = ?').run(sessionId, theme)

    const insert = db.prepare(
      `INSERT OR IGNORE INTO activities
        (id, session_id, title, description, url, date, source, category, matched_interest, theme)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )

    const tx = db.transaction(() => {
      for (const a of allActivities) {
        insert.run(
          a.id, sessionId, a.title, a.description || null,
          a.url || null, a.date || null, a.source,
          a.category || null, a.matchedInterest || null,
          theme
        )
      }
    })
    tx()

    // Also save to cumulative discoveries (scored by persona)
    const typeMap: Record<string, 'event' | 'food' | 'place'> = {
      adventure: 'place', culture: 'event', food: 'food', nightlife: 'event',
    }
    saveToDiscoveries(
      allActivities.map((a) => ({
        title: a.title,
        description: a.description,
        url: a.url,
        date: a.date,
        source: a.source,
        category: a.category,
        itemType: typeMap[theme] || 'place',
        tags: [theme],
        sessionId,
      })),
      { persona: getPersona(sessionId) }
    )
  }

  return allActivities
}

// ─── New: Save to cumulative discoveries table ───────────────────

function saveToDiscoveries(
  items: {
    title: string
    description?: string
    url?: string
    date?: string
    source: string
    category?: string
    cuisine?: string
    itemType: 'event' | 'food' | 'place' | 'dish'
    tags?: string[]
    isRecurring?: boolean
    sessionId?: string
    isWarmStart?: boolean
  }[],
  opts: { persona?: Persona | null; lastIntent?: { cuisines: string[]; hoods: string[] } } = {}
): number {
  const db = getDb()
  let saved = 0

  const insert = db.prepare(`
    INSERT OR IGNORE INTO discoveries
      (id, item_type, title, description, url, date, source, category, tags,
       is_recurring, expires_at, verified, popularity, session_id, updated_at,
       match_score, source_quality, freshness_score, is_warmstart)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, datetime('now'),
            ?, ?, ?, ?)
  `)

  // Dedup check: same URL OR similar title (≥0.8 Levenshtein)
  const existingUrls = new Set(
    db.prepare('SELECT url FROM discoveries WHERE url IS NOT NULL').all().map((r: any) => r.url)
  )
  const existingTitles = db
    .prepare("SELECT LOWER(title) as t FROM discoveries")
    .all()
    .map((r: any) => r.t as string)

  const tx = db.transaction(() => {
    for (const item of items) {
      // Dedup by URL
      if (item.url && existingUrls.has(item.url)) continue
      // Dedup by similar title (Levenshtein ≥ 0.8)
      const itemTitleLower = item.title.toLowerCase()
      const duplicate = existingTitles.find((t) => titlesAreSimilar(t, itemTitleLower))
      if (duplicate) continue

      // Score the candidate using the current persona + last intent
      const scored = scoreCandidate(
        {
          title: item.title,
          description: item.description,
          date: item.date,
          source: item.source,
          category: item.category,
          cuisine: item.cuisine,
          tags: item.tags,
        },
        { persona: opts.persona, lastIntent: opts.lastIntent }
      )

      // Warm-start items expire in 24h so they don't pollute long-term
      let expiresAt = computeExpiresAt(item.itemType, item.date, item.isRecurring)
      if (item.isWarmStart) {
        const d = new Date()
        d.setHours(d.getHours() + 24)
        expiresAt = d.toISOString()
      }

      const id = crypto.randomUUID()

      insert.run(
        id,
        item.itemType,
        item.title,
        item.description || null,
        item.url || null,
        item.date || null,
        item.source,
        item.category || null,
        JSON.stringify(item.tags || []),
        item.isRecurring ? 1 : 0,
        expiresAt,
        item.sessionId || null,
        scored.matchScore,
        scored.sourceQuality,
        scored.freshnessScore,
        item.isWarmStart ? 1 : 0
      )
      existingUrls.add(item.url)
      existingTitles.push(itemTitleLower)
      saved++
    }
  })

  tx()
  return saved
}

export function getActivitiesByTheme(sessionId: string, theme: string): Activity[] {
  const db = getDb()
  const rows = db
    .prepare(
      'SELECT * FROM activities WHERE session_id = ? AND theme = ? ORDER BY created_at DESC'
    )
    .all(sessionId, theme) as any[]

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    url: r.url,
    date: r.date,
    source: r.source,
    category: r.category,
    matchedInterest: r.matched_interest,
  }))
}

// ─── Discovery curation: top picks, swimlanes, trending ──────────

export interface RichDiscovery {
  id: string
  itemType: 'event' | 'food' | 'place' | 'dish'
  title: string
  description?: string
  url?: string
  date?: string
  source: string
  category?: string
  tags: string[]
  rating?: number
  reviewCount: number
  priceLevel?: number
  cuisine?: string
  photoUrl?: string
  hours?: string
  phone?: string
  isOpen?: boolean
  trendingScore: number
  matchScore: number
  why: string
}

function rowToRichDiscovery(row: any): RichDiscovery {
  const tags = safeJson(row.tags)
  return {
    id: row.id,
    itemType: row.item_type,
    title: row.title,
    description: row.description || undefined,
    url: row.url || undefined,
    date: row.date || undefined,
    source: row.source,
    category: row.category || undefined,
    tags,
    rating: row.rating || undefined,
    reviewCount: row.review_count || 0,
    priceLevel: row.price_level || undefined,
    cuisine: row.cuisine || undefined,
    photoUrl: row.photo_url || undefined,
    hours: row.hours || undefined,
    phone: row.phone || undefined,
    isOpen: row.is_open === null ? undefined : row.is_open === 1,
    trendingScore: row.trending_score || 0,
    matchScore: row.match_score || 0,
    why: '',
  }
}

function safeJson(val: any): string[] {
  if (!val) return []
  try {
    const parsed = JSON.parse(val)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function computeMatchScore(place: RichDiscovery, persona: Persona): { score: number; why: string } {
  const personaTokens = new Set<string>()
  persona.interests.forEach(i => tokenize(i).forEach(t => personaTokens.add(t)))
  persona.hobbies.forEach(h => tokenize(h).forEach(t => personaTokens.add(t)))
  persona.shortTermGoals.forEach(g => tokenize(g).forEach(t => personaTokens.add(t)))
  persona.longTermGoals.forEach(g => tokenize(g).forEach(t => personaTokens.add(t)))
  if (persona.vibe && persona.vibe !== 'unknown') personaTokens.add(persona.vibe.toLowerCase())
  if (persona.city) tokenize(persona.city).forEach(t => personaTokens.add(t))

  const placeText = [place.title, place.description, place.category, place.cuisine, place.tags.join(' ')].join(' ')
  const placeTokens = tokenize(placeText)
  const matches = placeTokens.filter(t => personaTokens.has(t))
  const uniqueMatches = [...new Set(matches)]

  let score = uniqueMatches.length * 15

  // Vibe-based bonuses
  if (persona.vibe === 'clubber' && ['club', 'bar', 'nightlife', 'music'].some(k => placeText.toLowerCase().includes(k))) score += 20
  if (persona.vibe === 'chill' && ['cafe', 'park', 'cozy', 'relax'].some(k => placeText.toLowerCase().includes(k))) score += 20
  if (persona.vibe === 'active' && ['sport', 'climb', 'hike', 'bike', 'outdoor'].some(k => placeText.toLowerCase().includes(k))) score += 20
  if (persona.vibe === 'curious' && ['museum', 'art', 'gallery', 'tour', 'culture'].some(k => placeText.toLowerCase().includes(k))) score += 20

  // Quality signals
  if (place.rating && place.rating >= 4.5) score += 15
  else if (place.rating && place.rating >= 4.0) score += 8
  if (place.reviewCount > 500) score += 12
  else if (place.reviewCount > 100) score += 6

  // Trending bonus
  score += place.trendingScore * 0.3

  score = Math.round(score * 100) / 100

  let why = ''
  if (uniqueMatches.length > 0) why = `Matches your interests: ${uniqueMatches.slice(0, 3).join(', ')}`
  else if (place.rating && place.rating >= 4.5) why = `Highly rated · ${place.rating}★`
  else if (place.trendingScore > 40) why = 'Trending now'
  else why = 'Popular in the city'

  return { score, why }
}

export function getDiscoveriesForSession(
  sessionId: string,
  options: {
    types?: string[]
    category?: string
    cuisine?: string
    limit?: number
    orderBy?: 'trending' | 'rating' | 'match' | 'newest'
  } = {}
): RichDiscovery[] {
  const db = getDb()
  const persona = getPersona(sessionId)

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
  if (options.cuisine) {
    conditions.push('(cuisine = ? OR tags LIKE ?)')
    params.push(options.cuisine, `%${options.cuisine}%`)
  }

  let orderClause = 'ORDER BY trending_score DESC, created_at DESC'
  if (options.orderBy === 'rating') orderClause = 'ORDER BY rating DESC, review_count DESC'
  if (options.orderBy === 'newest') orderClause = 'ORDER BY created_at DESC'

  const limit = options.limit || 20

  const rows = db.prepare(
    `SELECT * FROM discoveries
     WHERE ${conditions.join(' AND ')}
     AND (expires_at IS NULL OR expires_at > datetime('now'))
     ${orderClause}
     LIMIT ?`
  ).all(...params, limit) as any[]

  return rows.map(rowToRichDiscovery).map(d => {
    if (persona) {
      const { score, why } = computeMatchScore(d, persona)
      return { ...d, matchScore: score, why }
    }
    return d
  })
}

export function getTopPicks(sessionId: string, limit = 5): RichDiscovery[] {
  const db = getDb()
  const persona = getPersona(sessionId)
  const lastIntent = getLastIntent(sessionId)

  // Prefer food/place items with real ratings; fall back to any discovery.
  // Sort by pre-computed match_score (set at ingest) DESC so already-scored
  // items lead; fall back to trending_score for legacy rows.
  const rows = db.prepare(`
    SELECT * FROM discoveries
    WHERE item_type IN ('food', 'place', 'dish')
    AND (expires_at IS NULL OR expires_at > datetime('now'))
    ORDER BY COALESCE(match_score, 0) DESC, trending_score DESC, rating DESC
    LIMIT 100
  `).all() as any[]

  let discoveries = rows.map(rowToRichDiscovery)

  if (persona) {
    discoveries = discoveries
      .map(d => {
        const { score, why } = computeMatchScore(d, persona)
        // Apply intent boost on top of the in-DB match_score
        const intentBonus = computeIntentBoost(d, lastIntent)
        return { ...d, matchScore: score + intentBonus, why }
      })
      .sort((a, b) => b.matchScore - a.matchScore)
  }

  return discoveries.slice(0, limit)
}

// Compute the per-item boost from the user's last chat intent.
// Foods matching the asked cuisine get +18, hoods mentioned get +12.
function computeIntentBoost(d: RichDiscovery, intent: { cuisines: string[]; hoods: string[] }): number {
  if (!intent || (intent.cuisines.length === 0 && intent.hoods.length === 0)) return 0
  const text = [d.title, d.description, d.cuisine, d.tags.join(' ')].join(' ').toLowerCase()
  let boost = 0
  for (const c of intent.cuisines) {
    if (c.length > 2 && text.includes(c)) boost += 18
  }
  for (const h of intent.hoods) {
    if (h.length > 2 && text.includes(h)) boost += 12
  }
  return boost
}

export function getSwimlane(
  sessionId: string,
  lane: string,
  limit = 15
): RichDiscovery[] {
  const db = getDb()
  const persona = getPersona(sessionId)
  const laneLower = lane.toLowerCase()

  const rows = db.prepare(`
    SELECT * FROM discoveries
    WHERE (category = ? OR cuisine = ? OR tags LIKE ?)
    AND (expires_at IS NULL OR expires_at > datetime('now'))
    ORDER BY trending_score DESC, rating DESC, review_count DESC
    LIMIT ?
  `).all(lane, lane, `%${laneLower}%`, limit) as any[]

  return rows.map(rowToRichDiscovery).map(d => {
    if (persona) {
      const { score, why } = computeMatchScore(d, persona)
      return { ...d, matchScore: score, why }
    }
    return d
  })
}

export function getTrending(sessionId: string, limit = 10): RichDiscovery[] {
  return getDiscoveriesForSession(sessionId, {
    types: ['food', 'place', 'dish'],
    orderBy: 'trending',
    limit,
  })
}

export function getCuisines(limit = 12): string[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT cuisine, COUNT(*) as c FROM discoveries
    WHERE cuisine IS NOT NULL AND cuisine != ''
    GROUP BY cuisine
    ORDER BY c DESC
    LIMIT ?
  `).all(limit) as any[]
  return rows.map(r => r.cuisine)
}

export function getCategories(limit = 12): string[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT category, COUNT(*) as c FROM discoveries
    WHERE category IS NOT NULL AND category != ''
      AND category != 'general'
    GROUP BY category
    ORDER BY c DESC
    LIMIT ?
  `).all(limit) as any[]
  return rows.map(r => r.category)
}

export async function quickPicksFromDiscoveries(
  sessionId: string,
  limit = 4
): Promise<QuickPick[]> {
  const picks = getTopPicks(sessionId, limit)
  return picks.map(p => ({
    id: p.id,
    type: p.itemType === 'dish' ? 'dish' : p.itemType === 'food' ? 'dish' : 'place',
    emoji: p.itemType === 'food' || p.itemType === 'dish' ? '🍽️' : '📍',
    title: p.title.slice(0, 55),
    subtitle: p.why || (p.cuisine ? p.cuisine : 'Top pick'),
    url: p.url,
  }))
}


export interface QuickPick {
  id: string
  type: 'dish' | 'event' | 'place'
  emoji: string
  title: string
  subtitle: string
  url?: string
}

export async function quickPicks(
  persona: { city?: string; interests: string[]; hobbies: string[]; vibe?: string }
): Promise<QuickPick[]> {
  const city = persona.city || 'Berlin'
  const picks: QuickPick[] = []
  const seen = new Set<string>()

  // Determine if user has food interests
  const foodKeywords = ['food', 'cooking', 'restaurant', 'cuisine', 'brunch', 'cafe', 'dinner', 'eat', 'dish', 'dishes', 'street food', 'döner', 'curry', 'local']
  const hasFoodInterest = persona.interests.some(i =>
    foodKeywords.some(k => i.toLowerCase().includes(k))
  ) || persona.hobbies.some(h => foodKeywords.some(k => h.toLowerCase().includes(k)))

  // Search 1: Best dishes / iconic food (always try at least once)
  const dishQuery = `${city} must try local dishes food recommendations iconic`
  const dishes = await searchEvents(dishQuery, 6)
  for (const d of dishes) {
    const clean = d.title.replace(/<[^>]*>/g, '').trim()
    // Reject Wikipedia, very short, or "Top N" generic list titles
    if (clean.includes('Wikipedia') || clean.length < 15 || clean.length > 120) continue
    if (seen.has(clean.slice(0, 30))) continue
    seen.add(clean.slice(0, 30))
    picks.push({
      id: d.id,
      type: 'dish',
      emoji: hasFoodInterest ? '🌭' : '🍽️',
      title: clean.slice(0, 55),
      subtitle: 'Must try',
      url: d.url,
    })
    if (picks.length >= 2) break
  }
  await new Promise((r) => setTimeout(r, 1500))

  // Search 2: Events this week matching interests
  const now = new Date()
  const month = now.toLocaleString('en', { month: 'long' })
  const year = now.getFullYear()
  const interestQuery = persona.interests.length > 0
    ? persona.interests.slice(0, 2).join(' ')
    : 'events'
  const eventQuery = `${city} ${interestQuery} events this week ${month} ${year}`
  const events = await searchEvents(eventQuery, 6)
  for (const e of events) {
    const clean = e.title.replace(/<[^>]*>/g, '').trim()
    if (clean.includes('Wikipedia') || clean.length < 10 || clean.length > 120) continue
    if (seen.has(clean.slice(0, 30))) continue
    seen.add(clean.slice(0, 30))
    picks.push({
      id: e.id,
      type: 'event',
      emoji: '🎪',
      title: clean.slice(0, 55),
      subtitle: e.date ? e.date.slice(0, 10) : 'This week',
      url: e.url,
    })
    if (picks.length >= 4) break
  }

  // Search 3: Trending spots if still need picks
  if (picks.length < 3) {
    await new Promise((r) => setTimeout(r, 1500))
    const trendingQuery = `${city} trending popular places`
    const trending = await searchEvents(trendingQuery, 3)
    for (const t of trending) {
      const clean = t.title.replace(/<[^>]*>/g, '').trim()
      if (clean.length > 10 && clean.length < 120 && !seen.has(clean.slice(0, 30))) {
        seen.add(clean.slice(0, 30))
        picks.push({
          id: t.id,
          type: 'place',
          emoji: '📍',
          title: clean.slice(0, 55),
          subtitle: 'Trending',
          url: t.url,
        })
        if (picks.length >= 4) break
      }
    }
  }

  // Save picks to cumulative discoveries
  const discoveriesToSave = picks.map(p => ({
    title: p.title,
    url: p.url,
    source: 'searxng' as const,
    itemType: p.type as 'dish' | 'event' | 'place',
    tags: persona.interests.slice(0, 3),
  }))
  if (discoveriesToSave.length > 0) {
    // The slim persona passed to quickPicks has all the fields scoring needs
    // (interests, hobbies, vibe, city). We assert the full type for the call.
    saveToDiscoveries(discoveriesToSave, { persona: persona as unknown as Persona })
  }

  return picks.slice(0, 4)
}

// ─── Warm start: seed generic-but-curated content for new sessions ──
//
// On first session creation we have no persona. Instead of leaving the back
// face empty, we pre-seed with 5 generic but well-curated Berlin queries so
// the first flip reveals real content (framed as "Starting points").
// Items are tagged is_warmstart=1 and expire in 24h so they don't pollute
// the long-term cumulative catalog.
const WARM_START_QUERIES: { query: string; itemType: 'event' | 'food' | 'place' | 'dish'; category: string }[] = [
  { query: 'Berlin things to do this weekend', itemType: 'event', category: 'general' },
  { query: 'Berlin iconic must-see places', itemType: 'place', category: 'culture' },
  { query: 'Berlin best cafes coffee', itemType: 'food', category: 'food' },
  { query: 'Berlin best restaurants dinner', itemType: 'food', category: 'food' },
  { query: 'Berlin best bars cocktails', itemType: 'place', category: 'nightlife' },
]

export async function runWarmStart(city = 'Berlin'): Promise<number> {
  let total = 0
  for (const { query, itemType, category } of WARM_START_QUERIES) {
    const results = await searchEvents(`${city} ${query}`, 4)
    if (results.length === 0) continue
    const items = results.map((r) => ({
      title: r.title,
      description: r.description,
      url: r.url,
      date: r.date,
      source: 'searxng' as const,
      category,
      itemType,
      tags: ['warmstart'],
      isWarmStart: true,
    }))
    total += saveToDiscoveries(items)
    await new Promise((r) => setTimeout(r, 1200))
  }
  return total
}

// ─── Last-chat-intent extraction + session memory ──
//
// When a user asks "ramen in Kreuzberg" we want any subsequent search to
// rank ramen / Kreuzberg matches higher. We extract this from the latest
// message and store it on the session row.
const HOODS = [
  'moabit', 'kreuzberg', 'neukölln', 'neukoelln', 'mitte', 'prenzlauer berg',
  'friedrichshain', 'schöneberg', 'schoeneberg', 'wedding', 'charlottenburg',
  'wilmersdorf', 'tempelhof', 'treptow', 'lichtenberg', 'marzahn', 'spandau',
  'steglitz', 'pankow', 'reinickendorf', 'tiergarten', 'köpenick', 'koepenick',
  'halensee', 'grunewald', 'kreuzberg', 'f-hain', 'fhain',
]
const CUISINES = [
  'italian', 'pizza', 'sushi', 'ramen', 'burger', 'vegan', 'vegetarian', 'coffee',
  'cafe', 'brunch', 'bar', 'german', 'turkish', 'french', 'japanese', 'thai',
  'vietnamese', 'korean', 'mexican', 'indian', 'bakery', 'wine', 'beer', 'breakfast',
  'döner', 'doener', 'kebab', 'curry', 'falafel', 'seafood', 'steak', 'tapas',
  'ethiopian', 'lebanese', 'chinese', 'dim sum', 'bbq', 'pasta',
]

export function extractIntent(text: string): { cuisines: string[]; hoods: string[] } {
  const t = text.toLowerCase()
  return {
    cuisines: CUISINES.filter((c) => t.includes(c)),
    hoods: HOODS.filter((h) => t.includes(h)),
  }
}

export function getLastIntent(sessionId: string): { cuisines: string[]; hoods: string[] } {
  const db = getDb()
  // Read from session state (column added via migration below)
  try {
    const row = db.prepare('SELECT last_intent FROM sessions WHERE id = ?').get(sessionId) as any
    if (row?.last_intent) {
      try {
        return JSON.parse(row.last_intent)
      } catch {}
    }
  } catch {}
  return { cuisines: [], hoods: [] }
}

export function setLastIntent(sessionId: string, intent: { cuisines: string[]; hoods: string[] }): void {
  const db = getDb()
  try {
    db.prepare('UPDATE sessions SET last_intent = ? WHERE id = ?').run(
      JSON.stringify(intent),
      sessionId
    )
  } catch {}
}
