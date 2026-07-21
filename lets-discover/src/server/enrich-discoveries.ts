/**
 * Enrich existing gmap_scraper discoveries — parse rating/review_count
 * from description strings like "4.8★ (1891) · €10–20".
 * Run: npx tsx src/server/enrich-discoveries.ts
 */
import { getDb } from './db.js'

function parseRatingFromDesc(desc: string): { rating: number | null; reviewCount: number | null; priceLevel: number | null } {
  if (!desc) return { rating: null, reviewCount: null, priceLevel: null }

  // "4.8★ (1891) · €10–20"
  const ratingMatch = desc.match(/(\d+\.?\d*)\s*★/)
  const reviewMatch = desc.match(/\((\d[\d,]*)\)/)
  const priceMatch = desc.match(/€(\d+)[–-]?(\d+)?/)

  return {
    rating: ratingMatch ? parseFloat(ratingMatch[1]) : null,
    reviewCount: reviewMatch ? parseInt(reviewMatch[1].replace(/,/g, '')) : null,
    priceLevel: priceMatch ? Math.ceil(parseInt(priceMatch[1]) / 20) : null, // rough: €10-20 → level 1, €30-80 → level 2-4
  }
}

function main() {
  const db = getDb()

  const places = db.prepare(`
    SELECT id, description FROM discoveries
    WHERE source = 'gmap_scraper'
    AND (rating IS NULL OR rating = 0)
    AND description LIKE '%★%'
  `).all() as { id: string; description: string }[]

  console.log(`Found ${places.length} gmap_scraper places with ratings in description`)

  let updated = 0
  const update = db.prepare(`
    UPDATE discoveries
    SET rating = ?, review_count = ?, price_level = ?,
        trending_score = ?,
        popularity = ?
    WHERE id = ?
  `)

  const tx = db.transaction(() => {
    for (const place of places) {
      const parsed = parseRatingFromDesc(place.description)
      if (!parsed.rating) continue

      const trendingScore = Math.round(parsed.rating * Math.log10((parsed.reviewCount || 1) + 1) * 10 * 100) / 100
      const popularity = Math.min(100, Math.round(parsed.rating * 20 + (parsed.reviewCount || 0) / 10))

      update.run(
        parsed.rating,
        parsed.reviewCount || null,
        parsed.priceLevel || null,
        trendingScore,
        popularity,
        place.id
      )
      updated++
    }
  })

  tx()
  console.log(`✅ Enriched ${updated} places with parsed ratings/reviews/trending scores`)
}

if (process.argv[1]?.includes('enrich-discoveries')) {
  main()
}

export { parseRatingFromDesc, main as enrich }
