import { useState, useEffect } from 'react'

interface TopPickItem {
  id: string
  title: string
  description?: string
  url?: string
  itemType: string
  category?: string
  rating?: number
  reviewCount?: number
  priceLevel?: number
  cuisine?: string
  tags: string[]
  trendingScore: number
  matchScore: number
  why: string
}

interface TopPicksProps {
  sessionId: string
  compact?: boolean
}

function RatingStars({ rating }: { rating: number }) {
  const full = Math.round(rating)
  return (
    <span className="tp-stars" aria-label={`${rating} stars`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={`tp-star ${i < full ? 'tp-star-fill' : ''}`}>
          ★
        </span>
      ))}
      <span className="tp-rating-num">{rating.toFixed(1)}</span>
    </span>
  )
}

function PriceLevel({ level }: { level: number }) {
  const filled = Math.min(4, Math.max(1, level))
  return (
    <span className="tp-price">
      {'€'.repeat(filled)}
      <span className="tp-price-dim">€</span>
    </span>
  )
}

export function TopPicks({ sessionId, compact }: TopPicksProps) {
  const [picks, setPicks] = useState<TopPickItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function fetchPicks() {
      setLoading(true)
      try {
        const res = await fetch(`/api/top-picks/${sessionId}`)
        const data = await res.json()
        if (!cancelled) setPicks(data.picks || [])
      } catch {
        if (!cancelled) setPicks([])
      }
      if (!cancelled) setLoading(false)
    }
    if (sessionId) fetchPicks()
    return () => { cancelled = true }
  }, [sessionId])

  if (!sessionId) return null
  if (!loading && picks.length === 0) return null

  return (
    <div className={`top-picks ${compact ? 'tp-compact' : ''}`}>
      <div className="tp-header">
        <span className="tp-label">🌟 Top Picks</span>
        <span className="tp-hint">Matched for you</span>
      </div>

      {loading ? (
        <div className="tp-track">
          {[1, 2, 3].map(i => <div key={i} className="tp-card-skeleton" />)}
        </div>
      ) : (
        <div className="tp-track">
          {picks.slice(0, compact ? 3 : 5).map(pick => (
            <a
              key={pick.id}
              href={pick.url || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="tp-card"
            >
              <div className="tp-card-top">
                <span className="tp-cuisine">
                  {pick.cuisine || pick.itemType}
                </span>
                {pick.rating && pick.rating > 0 && (
                  <RatingStars rating={pick.rating} />
                )}
              </div>
              <div className="tp-title">{pick.title.slice(0, 60)}</div>

              <div className="tp-card-bottom">
                <span className="tp-why">{pick.why}</span>
                <div className="tp-meta">
                  {pick.reviewCount && pick.reviewCount > 0 && (
                    <span className="tp-reviews">{pick.reviewCount} reviews</span>
                  )}
                  {pick.priceLevel && pick.priceLevel > 0 && (
                    <PriceLevel level={pick.priceLevel} />
                  )}
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
