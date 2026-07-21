/**
 * Seed script — adds sample rich discovery data for UI testing.
 * Run: npx tsx src/server/seed-sample-places.ts
 */
import { getDb } from './db.js'

const samplePlaces = [
  {
    title: 'Barra Berlin',
    desc: 'Restaurant · Prenzlauer Berg',
    url: 'https://www.google.com/maps?q=Barra+Berlin',
    category: 'food',
    cuisine: 'italian',
    rating: 4.7,
    review_count: 230,
    price_level: 3,
    tags: ['restaurant', 'italian', 'pasta', 'wine', 'fine dining'],
    is_open: 1,
  },
  {
    title: 'Kanaan',
    desc: 'Vegan hummus & falafel · Prenzlauer Berg',
    url: 'https://www.google.com/maps?q=Kanaan+Berlin',
    category: 'food',
    cuisine: 'vegan',
    rating: 4.8,
    review_count: 890,
    price_level: 1,
    tags: ['vegan', 'vegetarian', 'hummus', 'falafel', 'healthy', 'casual'],
    is_open: 1,
  },
  {
    title: 'Five Elephant',
    desc: 'Specialty coffee & cheesecake · Kreuzberg',
    url: 'https://www.google.com/maps?q=Five+Elephant+Berlin',
    category: 'food',
    cuisine: 'coffee',
    rating: 4.5,
    review_count: 1240,
    price_level: 2,
    tags: ['coffee', 'cafe', 'cheesecake', 'brunch', 'bakery', 'third wave'],
    is_open: 1,
  },
  {
    title: 'Nobelhart & Schmutzig',
    desc: 'Michelin-starred regional cuisine · Kreuzberg',
    url: 'https://www.google.com/maps?q=Nobelhart+Schmutzig',
    category: 'food',
    cuisine: 'german',
    rating: 4.6,
    review_count: 450,
    price_level: 4,
    tags: ['fine dining', 'german', 'michelin', 'regional', 'wine'],
    is_open: 1,
  },
  {
    title: 'Markthalle Neun',
    desc: 'Historical market hall · Kreuzberg',
    url: 'https://www.google.com/maps?q=Markthalle+Neun',
    category: 'food',
    cuisine: 'market',
    rating: 4.5,
    review_count: 3500,
    price_level: 1,
    tags: ['market', 'street food', 'local', 'thursday', 'artisan'],
    is_open: 1,
  },
  {
    title: 'Tadshikische Teestube',
    desc: 'Tajik tea salon · Mitte',
    url: 'https://www.google.com/maps?q=Tadshikische+Teestube',
    category: 'food',
    cuisine: 'tea',
    rating: 4.7,
    review_count: 820,
    price_level: 2,
    tags: ['tea', 'unique', 'hidden gem', 'cozy', 'cultural'],
    is_open: 1,
  },
  {
    title: 'Burgermeister',
    desc: 'Iconic burger under the U1 tracks · Kreuzberg',
    url: 'https://www.google.com/maps?q=Burgermeister+Berlin',
    category: 'food',
    cuisine: 'burger',
    rating: 4.4,
    review_count: 5600,
    price_level: 1,
    tags: ['burger', 'fast food', 'iconic', 'casual', 'late night'],
    is_open: 1,
  },
  {
    title: 'Lucky Leek',
    desc: 'Award-winning vegan fine dining · Prenzlauer Berg',
    url: 'https://www.google.com/maps?q=Lucky+Leek+Berlin',
    category: 'food',
    cuisine: 'vegan',
    rating: 4.6,
    review_count: 380,
    price_level: 3,
    tags: ['vegan', 'fine dining', 'award-winning', 'tasting menu'],
    is_open: 1,
  },
  {
    title: 'Börek & Bier',
    desc: 'Turkish börek & craft beer · Neukölln',
    url: 'https://www.google.com/maps?q=Borek+Bier+Berlin',
    category: 'food',
    cuisine: 'turkish',
    rating: 4.3,
    review_count: 210,
    price_level: 1,
    tags: ['turkish', 'beer', 'casual', 'street food', 'börek'],
    is_open: 1,
  },
  {
    title: 'Ora Restaurant',
    desc: 'Seasonal tasting menu in a former pharmacy · Kreuzberg',
    url: 'https://www.google.com/maps?q=Ora+Restaurant+Berlin',
    category: 'food',
    cuisine: 'french',
    rating: 4.8,
    review_count: 180,
    price_level: 4,
    tags: ['fine dining', 'seasonal', 'french', 'tasting menu', 'intimate'],
    is_open: 1,
  },
]

function seed() {
  const db = getDb()

  const existingTitles = new Set(
    db.prepare("SELECT LOWER(SUBSTR(title, 1, 50)) as t FROM discoveries").all().map((r: any) => r.t)
  )

  const insert = db.prepare(`
    INSERT OR IGNORE INTO discoveries
      (id, item_type, title, description, url, date, source, category, tags,
       is_recurring, expires_at, verified, popularity, shared_by, updated_at,
       rating, review_count, price_level, cuisine, is_open, trending_score)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 1, ?, 'google_maps', datetime('now'),
            ?, ?, ?, ?, ?, ?)
  `)

  let imported = 0
  const tx = db.transaction(() => {
    for (const p of samplePlaces) {
      const titleKey = p.title.toLowerCase().slice(0, 50)
      if (existingTitles.has(titleKey)) continue
      existingTitles.add(titleKey)

      const id = crypto.randomUUID()
      const trendingScore = Math.round(
        (p.rating * Math.log10(p.review_count + 1) * 10) * 100
      ) / 100
      const popularity = Math.min(100, Math.round(p.rating * 20 + p.review_count / 10))

      insert.run(
        id, 'food', p.title, p.desc, p.url, null,
        'google_maps', p.category, JSON.stringify(p.tags),
        popularity,
        p.rating, p.review_count, p.price_level,
        p.cuisine, p.is_open, trendingScore
      )
      imported++
    }
  })

  tx()
  console.log(`✅ Seeded ${imported} sample places (skipped ${samplePlaces.length - imported} duplicates)`)
}

if (process.argv[1]?.includes('seed-sample-places')) {
  seed()
}

export { seed }
