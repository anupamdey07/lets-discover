import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { getDb, getCumulativeDiscoveries, cleanupExpiredDiscoveries } from './db.js'
import { chat, extractPersonaFromChat } from './llm.js'
import {
  createSession,
  getSession,
  saveMessage,
  getMessages,
  getPersona,
  refreshPersona,
  updatePersonaGoals,
} from './persona.js'
import { getActivities, backgroundSearch, searchByTheme, getActivitiesByTheme, quickPicks, getTopPicks, getSwimlane, getTrending, getCuisines, quickPicksFromDiscoveries, searchEvents, runWarmStart, extractIntent, setLastIntent, getLastIntent } from './search.js'
import { scrapeGmapsList, getGmapsFavorites, saveGmapsLink, updateGmapsPlaces, removeGmapsFavorites } from './gmaps.js'
import type { QuickPick } from './search.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = parseInt(process.env.PORT || '3001')

const app = express()
app.use(express.json())

// ─── API Routes ──────────────────────────────────────────────────

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Create new session — also kicks off warm-start content seed (fire-and-forget)
app.post('/api/session', (_req, res) => {
  const id = createSession()
  // Seed generic Berlin content so the back face has something on first flip.
  // Runs in background, doesn't block the response.
  runWarmStart('Berlin').catch((err) =>
    console.error('[warm-start] failed:', err)
  )
  res.json({ sessionId: id })
})

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { sessionId, message } = req.body
    if (!message) {
      return res.status(400).json({ error: 'message is required' })
    }

    // Ensure session exists (survives server restarts, stale localStorage)
    let sid = sessionId
    if (!sid || !getSession(sid)) {
      sid = createSession()
    }

    // Save user message
    saveMessage(sid, 'user', message)

    // Get conversation history
    const history = getMessages(sid)
    const llmMessages = history.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }))

    // ── Discovery context: match cuisine + neighborhoods from chat ──
    const msgLower = message.toLowerCase()

    // Gather full chat text for neighborhood detection
    const fullChatText = history.map(m => m.content).join(' ').toLowerCase() + ' ' + msgLower

    // Berlin neighborhoods to detect
    const hoods = ['moabit', 'kreuzberg', 'neukölln', 'mitte', 'prenzlauer berg', 'friedrichshain',
      'schöneberg', 'wedding', 'charlottenburg', 'wilmersdorf', 'tempelhof', 'treptow',
      'lichtenberg', 'marzahn', 'spandau', 'steglitz', 'pankow', 'reinickendorf',
      'tiergarten', 'f-hain', 'köpenick', 'halensee', 'grunewald']
    const foundHoods = hoods.filter(h => fullChatText.includes(h))

    // Find cuisine mentioned
    const cuisines = ['italian', 'pizza', 'sushi', 'burger', 'vegan', 'coffee', 'cafe',
      'brunch', 'bar', 'german', 'turkish', 'french', 'japanese', 'thai', 'vietnamese',
      'korean', 'mexican', 'indian', 'bakery', 'wine', 'beer', 'breakfast', 'ramen',
      'döner', 'kebab', 'curry', 'falafel', 'seafood', 'steak']
    const cuisineMatch = cuisines.find(k => fullChatText.includes(k))

    // Query gmap_scraper places by location
    let locationPicks: any[] = []
    if (foundHoods.length > 0) {
      const db = getDb()
      const placeholders = foundHoods.map(() => 'description LIKE ?').join(' OR ')
      locationPicks = db.prepare(`
        SELECT * FROM discoveries
        WHERE source = 'gmap_scraper'
        AND (${placeholders})
        AND (expires_at IS NULL OR expires_at > datetime('now'))
        ORDER BY trending_score DESC, rating DESC
        LIMIT 5
      `).all(...foundHoods.map(h => `%${h}%`)) as any[]
    }

    const personaPicks = getTopPicks(sid, 5)
    let topPicks: any[] = personaPicks

    // Prefer location-matched if available; narrow by cuisine if both present
    if (locationPicks.length > 0) {
      topPicks = locationPicks.map((r: any) => ({
        title: r.title, cuisine: r.cuisine, rating: r.rating,
        reviewCount: r.review_count || 0, why: `📍 ${foundHoods.join(', ')}`
      }))
      // If cuisine also mentioned, filter location results by cuisine
      if (cuisineMatch) {
        const hoodCuisine = topPicks.filter(p =>
          (p.cuisine || '').toLowerCase().includes(cuisineMatch) ||
          (p.title || '').toLowerCase().includes(cuisineMatch)
        )
        if (hoodCuisine.length > 0) {
          topPicks = hoodCuisine
        } else {
          // Fall back to cuisine from persona picks (any hood)
          const cuisinePicks = personaPicks.filter(p =>
            (p.cuisine || '').toLowerCase().includes(cuisineMatch) ||
            (p.title || '').toLowerCase().includes(cuisineMatch)
          )
          if (cuisinePicks.length > 0) topPicks = cuisinePicks
        }
      }
    } else if (cuisineMatch) {
      const matching = personaPicks.filter(p =>
        (p.cuisine || '').toLowerCase().includes(cuisineMatch) ||
        (p.title || '').toLowerCase().includes(cuisineMatch) ||
        (p.tags || []).some((t: string) => t.toLowerCase().includes(cuisineMatch))
      )
      if (matching.length >= 2) topPicks = matching
    }

    // ── Live search: detect search intent in user message and run SearXNG ──
    const searchPatterns = [
      /(?:search|find|look\s*(?:for|up)|discover|explore|show\s*me|where\s*(?:can|do|to)|recommend|suggest|tell\s*me\s*(?:about|more)|what\s*(?:is|are|about)|how\s*(?:about|is|do))(.*)/i,
      /(.+?)(?:nearby|around|close\s*by|in\s*\w+)/i,
    ]

    let liveSearchResults: string | null = null
    let searchedQuery: string | null = null

    for (const pattern of searchPatterns) {
      const m = msgLower.match(pattern)
      if (m) {
        const query = m[1]?.trim() || message
        if (query.length > 3 && query.length < 120) {
          try {
            const events = await searchEvents(query, 6)
            if (events.length > 0) {
              liveSearchResults = events.map(e =>
                `• ${e.title}${e.description ? ' — ' + e.description.slice(0, 100) : ''}`
              ).join('\n')
              searchedQuery = query
            }
          } catch {}
        }
        break
      }
    }

    topPicks = topPicks.slice(0, 2)

    // Combine discovery context with live search results
    const contextParts: string[] = []
    if (topPicks.length > 0) {
      contextParts.push(`Suggest: ${topPicks.map(p => `${p.title} — ${p.cuisine || 'local'}, ${p.rating || '?'}★`).join(' | ')}`)
    }
    if (liveSearchResults) {
      contextParts.push(`Here are live search results for "${searchedQuery}":\n${liveSearchResults}`)
    }
    const discoveryContext = contextParts.join('\n\n')

    // Get LLM response — inject discovery context as a system hint
    const { text: reply } = await chat(llmMessages, { context: discoveryContext, maxTokens: 256 })

    // Save assistant response
    saveMessage(sid, 'assistant', reply)

    // Persist last-chitchat intent (cuisines + hoods) so the next search ranks
    // matches that match the user's recent focus.
    setLastIntent(sid, extractIntent(message))

    // Try to refresh persona (async, don't block response)
    refreshPersona(sid).then((persona) => {
      if (persona && (persona.interests.length > 0 || persona.hobbies.length > 0)) {
        // Fire background search based on what we know so far
        backgroundSearch(sid, persona).catch(() => {})
      }
    }).catch(() => {})

    res.json({ sessionId: sid, reply })
  } catch (err: any) {
    console.error('[chat] Error:', err)
    res.status(500).json({ error: 'Failed to get response from LLM' })
  }
})

// Get persona
app.get('/api/persona/:sessionId', (req, res) => {
  const persona = getPersona(req.params.sessionId)
  res.json({
    persona,
    hasEnoughData: persona !== null && persona.interests.length > 0,
  })
})

// Update persona goals/hobbies
app.patch('/api/persona/:sessionId/goals', (req, res) => {
  const { shortTerm, longTerm, hobbies } = req.body
  const persona = updatePersonaGoals(req.params.sessionId, {
    shortTerm,
    longTerm,
    hobbies,
  })
  res.json({ persona })
})

// Get activities for session
app.get('/api/activities/:sessionId', (req, res) => {
  const activities = getActivities(req.params.sessionId)
  res.json({ activities, generatedAt: new Date().toISOString() })
})

// Explore by theme — searches and returns theme-specific results
app.post('/api/explore-theme', async (req, res) => {
  try {
    const { sessionId, theme } = req.body
    if (!sessionId || !theme) {
      return res.status(400).json({ error: 'sessionId and theme required' })
    }

    // Get persona for city context
    const persona = getPersona(sessionId)
    const city = persona?.city || 'Berlin'

    // Search for this theme
    const activities = await searchByTheme(sessionId, city, theme)
    res.json({ activities, theme, city, generatedAt: new Date().toISOString() })
  } catch (err: any) {
    console.error('[explore-theme] Error:', err)
    res.status(500).json({ error: 'Failed to search theme' })
  }
})

// Get activities by theme (cached)
app.get('/api/activities/:sessionId/theme/:theme', (req, res) => {
  const activities = getActivitiesByTheme(req.params.sessionId, req.params.theme)
  res.json({ activities, theme: req.params.theme, generatedAt: new Date().toISOString() })
})

// Quick picks — dishes + this week events based on persona
app.get('/api/quick-picks/:sessionId', async (req, res) => {
  try {
    const persona = getPersona(req.params.sessionId)
    if (!persona || (!persona.interests.length && !persona.hobbies.length)) {
      return res.json({ picks: [] })
    }

    const picks: QuickPick[] = await quickPicks(persona)
    res.json({ picks, generatedAt: new Date().toISOString() })
  } catch (err: any) {
    console.error('[quick-picks] Error:', err)
    res.json({ picks: [] })
  }
})

// Cumulative discoveries — full curated list
app.get('/api/discoveries', (req, res) => {
  const types = req.query.types ? (req.query.types as string).split(',') : undefined
  const limit = parseInt(req.query.limit as string) || 50
  const offset = parseInt(req.query.offset as string) || 0
  const tag = req.query.tag as string

  const discoveries = getCumulativeDiscoveries({ types, limit, offset, tag })
  const total = getDb().prepare('SELECT COUNT(*) as count FROM discoveries').get() as any

  res.json({
    discoveries,
    total: total.count,
    limit,
    offset,
  })
})

// Cleanup expired events (admin)
app.post('/api/discoveries/cleanup', (_req, res) => {
  const removed = cleanupExpiredDiscoveries()
  res.json({ removed })
})

// Get chat history
app.get('/api/messages/:sessionId', (req, res) => {
  const messages = getMessages(req.params.sessionId)
  res.json({ messages })
})

// Top picks — curated from discoveries, matched to persona
app.get('/api/top-picks/:sessionId', (req, res) => {
  try {
    const picks = getTopPicks(req.params.sessionId, 5)
    res.json({ picks, generatedAt: new Date().toISOString() })
  } catch (err: any) {
    console.error('[top-picks] Error:', err)
    res.json({ picks: [] })
  }
})

// Swimlane — horizontal category/cuisine lane
app.get('/api/swimlane/:sessionId/:lane', (req, res) => {
  try {
    const items = getSwimlane(req.params.sessionId, req.params.lane, 15)
    res.json({ items, lane: req.params.lane, generatedAt: new Date().toISOString() })
  } catch (err: any) {
    console.error('[swimlane] Error:', err)
    res.json({ items: [], lane: req.params.lane })
  }
})

// Trending — top trending places
app.get('/api/trending/:sessionId', (req, res) => {
  try {
    const items = getTrending(req.params.sessionId, 12)
    res.json({ items, generatedAt: new Date().toISOString() })
  } catch (err: any) {
    console.error('[trending] Error:', err)
    res.json({ items: [] })
  }
})

// Cuisines — available cuisine categories
app.get('/api/cuisines', (_req, res) => {
  const cuisines = getCuisines(12)
  res.json({ cuisines })
})

// Quick picks from discoveries (Google Maps data)
app.get('/api/discovery-picks/:sessionId', (_req, res) => {
  try {
    quickPicksFromDiscoveries(_req.params.sessionId, 6).then(picks => {
      res.json({ picks, generatedAt: new Date().toISOString() })
    }).catch(() => res.json({ picks: [] }))
  } catch {
    res.json({ picks: [] })
  }
})

// ─── Google Maps Favorites ────────────────────────────────────────

// Get saved GMaps favorites
app.get('/api/gmaps', (_req, res) => {
  const fav = getGmapsFavorites()
  if (!fav) {
    return res.json({ configured: false })
  }
  res.json({
    configured: true,
    listName: fav.list_name,
    placeCount: fav.place_count,
    lastScraped: fav.last_scraped,
    gmapsLink: fav.gmaps_link,
  })
})

// Get full place list from favorites
app.get('/api/gmaps/places', (_req, res) => {
  const fav = getGmapsFavorites()
  if (!fav) return res.json({ places: [] })
  
  let places = []
  try { places = JSON.parse(fav.places) } catch {}
  res.json({ places, listName: fav.list_name })
})

// Save/update the Google Maps shared link
app.put('/api/gmaps/link', async (req, res) => {
  try {
    const { link } = req.body
    if (!link || typeof link !== 'string') {
      return res.status(400).json({ error: 'link is required' })
    }

    // Validate it looks like a Google Maps link
    if (!link.includes('goo.gl') && !link.includes('google.com/maps') && !link.includes('maps.app.goo.gl')) {
      return res.status(400).json({ error: 'Not a valid Google Maps link. Paste a shared list link from Google Maps.' })
    }

    const saved = saveGmapsLink(link)
    res.json({ success: true, id: saved.id })
  } catch (err: any) {
    console.error('[gmaps] Error saving link:', err)
    res.status(500).json({ error: 'Failed to save link' })
  }
})

// Trigger scraping of the saved GMaps list
app.post('/api/gmaps/scrape', async (req, res) => {
  try {
    const fav = getGmapsFavorites()
    if (!fav) {
      return res.status(400).json({ error: 'No Google Maps link configured. Save a link first.' })
    }

    res.json({ status: 'scraping', message: 'Scraping started...' })

    // Scrape in background
    const result = await scrapeGmapsList(fav.gmaps_link)
    updateGmapsPlaces(fav.id, result.places, result.listName)

    console.log(`[gmaps] Scraped ${result.places.length} places from "${result.listName}"`)
  } catch (err: any) {
    console.error('[gmaps] Scrape error:', err)
  }
})

// Scrape and return results immediately (for settings UI)
app.post('/api/gmaps/scrape-full', async (req, res) => {
  try {
    const fav = getGmapsFavorites()
    if (!fav) {
      return res.status(400).json({ error: 'No Google Maps link configured.' })
    }

    const result = await scrapeGmapsList(fav.gmaps_link)
    updateGmapsPlaces(fav.id, result.places, result.listName)

    res.json({
      success: true,
      listName: result.listName,
      placeCount: result.places.length,
      places: result.places.slice(0, 50), // return first 50 for preview
    })
  } catch (err: any) {
    console.error('[gmaps] Scrape-full error:', err)
    res.status(500).json({ error: 'Failed to scrape. The link may be invalid or Google blocked the request.' })
  }
})

// Remove saved GMaps favorites
app.delete('/api/gmaps', (_req, res) => {
  removeGmapsFavorites()
  res.json({ success: true })
})

// Search GMaps places via LLM
app.post('/api/gmaps/search', async (req, res) => {
  try {
    const { query } = req.body
    if (!query) return res.status(400).json({ error: 'query required' })

    const fav = getGmapsFavorites()
    if (!fav) return res.json({ results: [] })

    let allPlaces: any[] = []
    try { allPlaces = JSON.parse(fav.places) } catch {}

    if (allPlaces.length === 0) return res.json({ results: [] })

    // Simple text match
    const q = query.toLowerCase()
    const results = allPlaces.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.category || '').toLowerCase().includes(q)
    ).slice(0, 20)

    res.json({ results, total: allPlaces.length })
  } catch (err: any) {
    res.status(500).json({ error: 'Search failed' })
  }
})

// ─── Serve Frontend (production) ─────────────────────────────────

const distPath = path.resolve(__dirname, '../../dist')

app.use(express.static(distPath))

// SPA fallback — serve index.html for any non-API route
app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'))
})

// ─── Start ───────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✨ Lets Discover running on http://0.0.0.0:${PORT}`)
  console.log(`   Tailscale: http://100.99.206.118:${PORT}`)
  console.log(`   LLM: ${process.env.LLM_URL || 'http://localhost:8040'}`)
  console.log(`   SearXNG: ${process.env.SEARXNG_URL || 'http://localhost:8888'}`)
})
