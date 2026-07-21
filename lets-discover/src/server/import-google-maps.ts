import fs from 'fs'
import path from 'path'
import { getDb, computeExpiresAt } from './db.js'

// ─── Supported Google Takeout / scraper formats ─────────────────
// Format 1: GeoJSON features array (common for Saved Places)
// Format 2: Flat JSON array of place objects
// Format 3: Nested object with "features" / "places" key
// Rich fields supported: rating, review_count, price_level, cuisine,
// photo_url, hours, phone, is_open, labels, coordinates, notes.

interface ImportedPlace {
  title: string
  address?: string
  url?: string
  note?: string
  labels?: string[]
  latitude?: number
  longitude?: number
  published?: string
  rating?: number
  review_count?: number
  price_level?: number
  cuisine?: string
  photo_url?: string
  hours?: string
  phone?: string
  is_open?: boolean
}

const FOOD_KEYWORDS = [
  'restaurant', 'cafe', 'café', 'bistro', 'food', 'eat', 'dining',
  'brunch', 'dinner', 'lunch', 'pizza', 'sushi', 'burger', 'curry', 'noodle',
  'bakery', 'grill', 'kitchen', 'bar', 'pub', 'tavern', 'steak', 'seafood',
  'vegan', 'vegetarian', 'coffee', 'breakfast', 'delivery', 'takeout', 'grocery',
  'market', 'pâtisserie', 'brewery', 'distillery',
  'trattoria', 'ristorante', 'pizzeria', 'taquería', 'ramen', 'deli',
  'grillhaus', 'kneipe', 'biergarten', 'taco', 'imbiss', 'gastronomy',
  'italienisch', 'peruanisch', 'koreanisch', 'jemenitisch', 'mexikanisch',
  'indonesisch', 'arabisch', 'vietnamesisch', 'chinesisch', 'thailändisch',
  'türkisch', 'japanisch', 'ukrainisch', 'libanesisch', 'asiatisch', 'deutsch',
  'frühstück', 'teehaus', 'markt',
]

function inferItemType(labels: string[], title: string, note?: string, cuisine?: string): 'food' | 'place' | 'dish' {
  const t = (title + ' ' + (note || '')).toLowerCase()
  const allLabels = (labels?.join(' ') || '').toLowerCase()
  const c = (cuisine || '').toLowerCase()

  if (FOOD_KEYWORDS.some(k => t.includes(k) || allLabels.includes(k) || c.includes(k))) {
    return 'food'
  }
  return 'place'
}

function normalizePriceLevel(val: any): number | undefined {
  if (val === null || val === undefined) return undefined
  if (typeof val === 'number') return Math.max(1, Math.min(4, Math.round(val)))
  const s = String(val).trim()
  // "$" → 1, "$$" → 2, "$$$" → 3, "$$$$" → 4
  const match = s.match(/^(\$+)$/)?.[1]
  if (match) return match.length
  const num = parseFloat(s)
  if (!Number.isNaN(num)) return Math.max(1, Math.min(4, Math.round(num)))
  return undefined
}

function extractNumber(val: any): number | undefined {
  if (val === null || val === undefined) return undefined
  if (typeof val === 'number') return val
  const s = String(val).replace(/[^0-9.]/g, '')
  const n = parseFloat(s)
  return Number.isNaN(n) ? undefined : n
}

function parseBoolean(val: any): boolean | undefined {
  if (val === true) return true
  if (val === false) return false
  if (typeof val === 'string') return ['true', 'yes', 'open'].includes(val.toLowerCase())
  return undefined
}

function extractCuisine(labels: string[], title: string, note?: string, category?: string): string | undefined {
  const all = [title, note || '', category || '', labels.join(' ')].join(' ').toLowerCase()
  const cuisines = [
    'italian', 'pizza', 'pasta', 'japanese', 'sushi', 'ramen', 'izakaya',
    'korean', 'chinese', 'dim sum', 'thai', 'vietnamese', 'indian', 'turkish',
    'lebanese', 'syrian', 'persian', 'mexican', 'peruvian', 'spanish', 'tapas',
    'french', 'german', 'bavarian', 'austrian', 'american', 'bbq', 'burger',
    'steakhouse', 'seafood', 'vegetarian', 'vegan', 'brunch', 'coffee', 'cafe',
    'bakery', 'dessert', 'ice cream', 'bar', 'pub', 'cocktail', 'brewery',
  ]
  for (const c of cuisines) {
    if (all.includes(c)) return c
  }
  return undefined
}

function parseTakeoutJson(filePath: string): ImportedPlace[] {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const data = JSON.parse(raw)
  const places: ImportedPlace[] = []

  function normalize(item: any): ImportedPlace {
    const props = item.properties || item
    const labels = Array.isArray(props.labels || props.label || props.tags)
      ? props.labels || props.label || props.tags
      : props.labels || props.label || props.tags
        ? [props.labels || props.label || props.tags]
        : []

    const title = props.title || props.name || item['Title'] || item['Name'] || ''
    const note = props.note || props['Note'] || props.notes || props.description || props['Description'] || ''
    const cuisine = props.cuisine || props.category || props['Category'] || extractCuisine(labels, title, note)

    return {
      title,
      address: props.address || props['Address'] || item.address || '',
      url: props.url || props['Google Maps URL'] || props['URL'] || props.link || item.url || '',
      note,
      labels: labels.map((l: any) => String(l)),
      latitude: props.latitude || props.lat || item.geometry?.coordinates?.[1] || item.lat,
      longitude: props.longitude || props.lng || item.geometry?.coordinates?.[0] || item.lng,
      published: props.published || props['Published'] || props.created || props.timestamp || item['Published Date'],
      rating: extractNumber(props.rating || props.score || props.stars || props['Average Rating']),
      review_count: extractNumber(props.review_count || props.reviews || props['Number of Reviews'] || props.reviewCount),
      price_level: normalizePriceLevel(props.price_level || props.price || props['Price Level']),
      cuisine,
      photo_url: props.photo_url || props.image_url || props.photo || props['Photo URL'] || props.image,
      hours: props.hours || props.opening_hours || props['Opening Hours'] || props.openHours,
      phone: props.phone || props['Phone Number'] || props.phoneNumber || props.telephone,
      is_open: parseBoolean(props.is_open || props.open_now || props.openNow || props['Open Now']),
    }
  }

  // Format 1: Direct array of place objects
  if (Array.isArray(data)) {
    for (const item of data) places.push(normalize(item))
    return places
  }

  // Format 2: GeoJSON FeatureCollection
  if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
    for (const feature of data.features) places.push(normalize(feature))
    return places
  }

  // Format 3: Object with nested items
  const items = data.features || data.places || data.items || data.savedPlaces || data['Saved Places'] || data.results || []
  if (Array.isArray(items)) {
    for (const item of items) places.push(normalize(item))
    return places
  }

  console.error('Unknown format. Supported: JSON array, FeatureCollection, or object with features/places/items.')
  return []
}

function computeTrendingScore(place: ImportedPlace): number {
  // Trending score: rating weighted by review count, with a freshness bonus.
  const rating = place.rating || 0
  const reviewCount = place.review_count || 0
  const base = rating > 0 ? rating * Math.log10(reviewCount + 1) * 10 : 0
  // Default score for saved places with no rating: 30
  const defaultScore = (rating === 0 && reviewCount === 0) ? 30 : 0
  return Math.round((base + defaultScore) * 100) / 100
}

function importPlacesToDiscoveries(places: ImportedPlace[]): { imported: number; skipped: number } {
  const db = getDb()
  let imported = 0
  let skipped = 0

  const existingTitles = new Set(
    db.prepare("SELECT LOWER(SUBSTR(title, 1, 50)) as t FROM discoveries").all().map((r: any) => r.t)
  )

  const insert = db.prepare(`
    INSERT OR IGNORE INTO discoveries
      (id, item_type, title, description, url, date, source, category, tags,
       is_recurring, expires_at, verified, popularity, shared_by, updated_at,
       rating, review_count, price_level, cuisine, photo_url, hours, phone, is_open,
       trending_score)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 1, ?, 'google_maps', datetime('now'),
            ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const tx = db.transaction(() => {
    for (const place of places) {
      const title = place.title?.trim()
      if (!title || title.length < 3) {
        skipped++
        continue
      }

      const titleKey = title.toLowerCase().slice(0, 50)
      if (existingTitles.has(titleKey)) {
        skipped++
        continue
      }
      existingTitles.add(titleKey)

      const itemType = inferItemType(place.labels || [], title, place.note, place.cuisine)
      const id = crypto.randomUUID()
      const description = [place.address, place.note].filter(Boolean).join(' — ') || null
      const tags = [...(place.labels || []).map((l: string) => l.toLowerCase()), itemType]
      if (place.cuisine) tags.push(place.cuisine.toLowerCase())
      const url = place.url || (place.latitude && place.longitude
        ? `https://www.google.com/maps?q=${place.latitude},${place.longitude}`
        : null)
      const trendingScore = computeTrendingScore(place)
      const popularity = Math.min(100, Math.round((place.rating || 3) * 20 + (place.review_count || 0) / 10))

      insert.run(
        id, itemType, title, description, url,
        place.published?.slice(0, 10) || null,
        'google_maps', itemType, JSON.stringify([...new Set(tags)]),
        null,
        popularity,
        place.rating || null,
        place.review_count || null,
        place.price_level || null,
        place.cuisine || null,
        place.photo_url || null,
        place.hours || null,
        place.phone || null,
        place.is_open === undefined ? null : place.is_open ? 1 : 0,
        trendingScore
      )
      imported++
    }
  })

  tx()
  return { imported, skipped }
}

// ─── CLI ─────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2)
  const filePath = args[0]

  if (!filePath) {
    console.log(`
Google Maps / Saved Places Importer

Import your saved places (Takeout or scraper JSON) into the discoveries database.

Usage:
  npx tsx src/server/import-google-maps.ts <path-to-json>

Rich fields supported when present in the JSON:
  title, address, url, note, labels, latitude, longitude, rating, review_count,
  price_level, cuisine, photo_url, hours, phone, is_open

Example:
  npx tsx src/server/import-google-maps.ts ~/Downloads/Takeout/Maps/Saved\\ Places.json
`)
    process.exit(1)
  }

  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`)
    process.exit(1)
  }

  console.log(`📂 Reading: ${filePath}`)
  const places = parseTakeoutJson(filePath)
  console.log(`📦 Found ${places.length} places`)

  if (places.length === 0) {
    console.log('No places found. Check the file format.')
    process.exit(1)
  }

  const withRating = places.filter(p => p.rating || p.review_count).length
  console.log(`   ${withRating} places include rating/review data`)

  const { imported, skipped } = importPlacesToDiscoveries(places)
  console.log(`\n✅ Imported: ${imported}`)
  console.log(`⏭️  Skipped: ${skipped} (duplicates or empty names)`)
  console.log(`\n📊 DB now has ${getDb().prepare('SELECT COUNT(*) as c FROM discoveries').get() as any} total discoveries`)
}

if (process.argv[1]?.includes('import-google-maps')) {
  main()
}

export { parseTakeoutJson, importPlacesToDiscoveries }
