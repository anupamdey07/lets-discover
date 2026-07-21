import { getDb, cleanupExpiredDiscoveries } from './db.js'
import { getPersona, refreshPersona } from './persona.js'
import { searchEvents, saveActivities, clearOldActivities } from './search.js'
import type { Activity } from '../shared/types.js'

const INTEREST_SEARCHES: Record<string, string[]> = {
  clubber: [
    'Berlin techno clubs events tonight',
    'Berlin nightlife parties',
    'Berlin electronic music festival',
  ],
  chill: [
    'Berlin cozy cafés concerts',
    'Berlin art exhibitions',
    'Berlin parks events',
    'Berlin weekend markets',
  ],
  active: [
    'Berlin climbing bouldering events',
    'Berlin running groups',
    'Berlin outdoor adventure',
    'Berlin sports meetups',
  ],
  curious: [
    'Berlin tech meetups',
    'Berlin workshops learning',
    'Berlin startup events',
    'Berlin cultural festivals',
  ],
}

async function runForSession(sessionId: string) {
  console.log(`[pipeline] Processing session ${sessionId.slice(0, 8)}...`)

  // 1. Refresh persona from chat history
  const persona = await refreshPersona(sessionId)
  if (!persona) {
    console.log(`[pipeline] No persona for session ${sessionId.slice(0, 8)}, skipping`)
    return
  }

  // 2. Build search queries from persona
  const queries: string[] = []
  const vibe = persona.vibe || 'curious'
  const vibeQueries = INTEREST_SEARCHES[vibe] || INTEREST_SEARCHES.curious
  queries.push(...vibeQueries)

  // Add interest-specific queries
  for (const interest of persona.interests) {
    queries.push(`Berlin ${interest} events`)
  }
  for (const hobby of persona.hobbies) {
    queries.push(`Berlin ${hobby} activities groups`)
  }

  // 3. Search for events (de-duplicate by URL)
  const seenUrls = new Set<string>()
  const allActivities: Activity[] = []

  for (const query of queries) {
    if (allActivities.length >= 30) break

    console.log(`[pipeline] Searching: "${query}"`)
    const results = await searchEvents(query)

    for (const activity of results) {
      if (!seenUrls.has(activity.url || '')) {
        seenUrls.add(activity.url || '')
        allActivities.push(activity)
      }
    }

    // Rate limit: 2s between searches
    await new Promise((r) => setTimeout(r, 2000))
  }

  // 4. Save to DB
  if (allActivities.length > 0) {
    clearOldActivities(sessionId)
    const saved = saveActivities(sessionId, allActivities)
    console.log(
      `[pipeline] Saved ${saved} new activities for ${sessionId.slice(0, 8)}`
    )
  } else {
    console.log(`[pipeline] No new activities for ${sessionId.slice(0, 8)}`)
  }
}

export async function runDailyPipeline() {
  console.log('[pipeline] Starting daily refresh...')

  // Clean up expired events
  const expired = cleanupExpiredDiscoveries()
  console.log(`[pipeline] Cleaned up ${expired} expired events`)

  const db = getDb()

  const sessions = db.prepare('SELECT id FROM sessions').all() as { id: string }[]
  console.log(`[pipeline] Found ${sessions.length} sessions`)

  for (const session of sessions) {
    try {
      await runForSession(session.id)
    } catch (err) {
      console.error(`[pipeline] Error for session ${session.id.slice(0, 8)}:`, err)
    }
  }

  console.log('[pipeline] Daily refresh complete')
}

// Run directly if called from CLI
const isMain = process.argv[1]?.endsWith('pipeline.ts') || process.argv[1]?.endsWith('pipeline.js')
if (isMain) {
  runDailyPipeline()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
