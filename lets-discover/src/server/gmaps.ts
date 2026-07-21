import { getDb } from './db.js'

interface GmapsPlace {
  name: string
  rating?: number
  reviewCount?: number
  category?: string
  priceLevel?: string
  address?: string
  url?: string
}

interface GmapsFavorites {
  id: string
  gmaps_link: string
  list_name: string | null
  places: string // JSON array
  place_count: number
  last_scraped: string | null
}

/**
 * Fetch a Google Maps shared list and extract place data.
 *
 * Google shared list links (goo.gl or maps.app.goo.gl) redirect to maps.google.com
 * with the list data embedded in the initial HTML as a JSON blob in script tags.
 * We follow the redirect, fetch the page, and parse out place entries.
 */
export async function scrapeGmapsList(link: string): Promise<{
  listName: string
  places: GmapsPlace[]
  rawUrl: string
}> {
  // Resolve the goo.gl shortlink to the real maps URL
  const resolvedUrl = await resolveRedirect(link)
  
  // Fetch the page
  const response = await fetch(resolvedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(15000),
  })

  const html = await response.text()

  // Try to extract place data from Google Maps embedded JSON
  const places = extractPlacesFromHtml(html)
  
  // Try to extract list name
  const listName = extractListName(html)

  return {
    listName: listName || 'Favorites',
    places,
    rawUrl: resolvedUrl,
  }
}

/**
 * Resolve goo.gl / maps.app.goo.gl shortlinks to the real Google Maps URL.
 */
async function resolveRedirect(link: string): Promise<string> {
  const response = await fetch(link, {
    method: 'HEAD',
    redirect: 'manual',
    signal: AbortSignal.timeout(10000),
  })

  // Follow redirect chain manually
  let url = link
  let resp = response
  let redirects = 0
  while ((resp.status === 301 || resp.status === 302 || resp.status === 303 || resp.status === 307 || resp.status === 308) && redirects < 5) {
    const location = resp.headers.get('location')
    if (!location) break
    url = new URL(location, url).href
    resp = await fetch(url, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
    })
    redirects++
  }

  return url
}

/**
 * Parse place data from Google Maps HTML.
 *
 * Google Maps embeds place data in several ways:
 * 1. In the page text content (visible in the accessibility tree as button text)
 * 2. In JSON blobs inside <script> tags (nonce-protected)
 * 3. In data-* attributes on HTML elements
 *
 * We use regex to extract structured data from the HTML text content,
 * then also try to find JSON blobs for more detail.
 */
function extractPlacesFromHtml(html: string): GmapsPlace[] {
  const places: GmapsPlace[] = []
  const seen = new Set<string>()

  // Pattern 1: Extract from button/link text with rating + category patterns
  // Examples:
  // "ELSE 4,1 Sterne 789 Rezensionen 20–30 € Nachtclub"
  // "Kiessee 4,4 Sterne 74 Rezensionen See"
  // "Kolapata Restaurant 4,9 Sterne 540 Rezensionen 10–15 € Restaurant"
  
  // Match: "Name X,X Sterne XXX Rezensionen [price] Category"
  const placePattern = /([A-Za-z\u00C0-\u024F\u0400-\u04FF\u0600-\u06FF][A-Za-z\u00C0-\u024F\u0400-\u04FF\u0600-\u06FF\s.'\-&,]{1,60}?)\s+(\d[,\.]\d)\s+Sterne\s+([\d\.]+)\s+Rezensionen(?:\s+([\d–\s€$]+))?\s+([A-Za-z\u00C0-\u024F\u0400-\u04FF\u0600-\u06FF\s\-/]+?)(?:\s*$|[\s,<])/g

  let match
  while ((match = placePattern.exec(html)) !== null) {
    const name = match[1].trim()
    if (name.length < 2 || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    
    places.push({
      name,
      rating: parseFloat(match[2].replace(',', '.')),
      reviewCount: parseInt(match[3].replace(/\./g, '')),
      priceLevel: match[4]?.trim() || undefined,
      category: match[5]?.trim() || undefined,
    })
  }

  // Pattern 2: Simple place names (from headings, list items without ratings)
  // These appear as bare names like "Curaçao", "Tegel"
  // Extract from heading text or standalone button text
  const namePattern = />([A-Z][A-Za-z\u00C0-\u024F\s.'\-]{2,60}?)<\/[a-z]+/g
  while ((match = namePattern.exec(html)) !== null) {
    const name = match[1].trim()
    // Filter out common non-place strings
    if (name.length < 3) continue
    if (seen.has(name.toLowerCase())) continue
    if (/^(Favoriten|Gespeichert|Menü|Suchen|Schließen|Teilen|Optionen|Zurück|Anmelden)$/i.test(name)) continue
    if (/^\d/.test(name)) continue
    
    seen.add(name.toLowerCase())
    places.push({ name })
  }

  // Deduplicate by name (keep the richer entry if duplicate)
  const unique = new Map<string, GmapsPlace>()
  for (const p of places) {
    const key = p.name.toLowerCase()
    const existing = unique.get(key)
    if (!existing || (p.rating !== undefined && existing.rating === undefined)) {
      unique.set(key, p)
    }
  }

  return Array.from(unique.values()).slice(0, 1000) // cap at 1000 places
}

/**
 * Extract the list name from the page heading.
 */
function extractListName(html: string): string | null {
  // Look for heading text like "Favoriten" or "Onu·833 Orte·Freigegebene Liste"
  const headingMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/)
  if (headingMatch) return headingMatch[1].trim()

  // Try aria-label on the main heading
  const ariaMatch = html.match(/heading[^>]*>([^<]+)</)
  if (ariaMatch) return ariaMatch[1].trim()

  return null
}

// ─── DB accessors ─────────────────────────────────────────────────

export function getGmapsFavorites(): GmapsFavorites | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM gmaps_favorites ORDER BY created_at DESC LIMIT 1').get() as any
  if (!row) return null
  return {
    id: row.id,
    gmaps_link: row.gmaps_link,
    list_name: row.list_name,
    places: row.places,
    place_count: row.place_count,
    last_scraped: row.last_scraped,
  }
}

export function saveGmapsLink(link: string): GmapsFavorites {
  const db = getDb()
  const existing = getGmapsFavorites()
  
  if (existing) {
    db.prepare(`UPDATE gmaps_favorites SET gmaps_link = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(link, existing.id)
    return { ...existing, gmaps_link: link }
  }

  const result = db.prepare(
    `INSERT INTO gmaps_favorites (gmaps_link) VALUES (?)`
  ).run(link)
  const id = String(result.lastInsertRowid)

  return {
    id,
    gmaps_link: link,
    list_name: null,
    places: '[]',
    place_count: 0,
    last_scraped: null,
  }
}

export function updateGmapsPlaces(
  id: string,
  places: GmapsPlace[],
  listName: string
): void {
  const db = getDb()
  db.prepare(`
    UPDATE gmaps_favorites
    SET places = ?, place_count = ?, list_name = ?,
        last_scraped = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(JSON.stringify(places), places.length, listName, id)

  // Also upsert into discoveries table for the discovery pipeline
  const insert = db.prepare(`
    INSERT INTO discoveries (
      id, item_type, title, description, source, category, cuisine,
      rating, review_count, price_level, is_recurring, trending_score, match_score
    ) VALUES (
      ?, 'place', ?, ?, 'gmap_scraper', ?, ?,
      ?, ?, 1, 1, 0, 0
    )
    ON CONFLICT(id) DO UPDATE SET
      rating = COALESCE(?, discoveries.rating),
      review_count = COALESCE(?, discoveries.review_count),
      updated_at = datetime('now')
  `)

  const tx = db.transaction(() => {
    for (const place of places) {
      const placeId = `gm_${Buffer.from(place.name).toString('base64url').slice(0, 32)}`
      const category = place.category || null
      const cuisine = place.category || null
      
      try {
        insert.run(
          placeId, place.name,
          `${place.name} — ${place.category || 'Place'} in your favorites list`,
          category, cuisine,
          place.rating || null, place.reviewCount || null,
          place.priceLevel ? parseInt(place.priceLevel.replace(/[^\d]/g, '')) || null : null,
          place.rating || null, place.reviewCount || null
        )
      } catch {
        // Skip duplicates silently
      }
    }
  })

  tx()
}

export function removeGmapsFavorites(): void {
  const db = getDb()
  db.prepare('DELETE FROM gmaps_favorites').run()
  // Also remove gmap_scraper discoveries
  db.prepare("DELETE FROM discoveries WHERE source = 'gmap_scraper'").run()
}
