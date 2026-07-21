import { useState, useEffect } from 'react'

interface CityTile {
  id: string
  title: string
  cuisine?: string
  rating?: number
  reviewCount: number
  priceLevel?: number
  url?: string
  why: string
  itemType: string
}

interface CityTilesProps {
  sessionId: string
  personaSheetOpen: boolean
}

function StarBadge({ rating }: { rating: number }) {
  return (
    <span className="ct-stars" aria-label={`${rating} stars`}>
      ★ <span className="ct-rating">{rating.toFixed(1)}</span>
    </span>
  )
}

export function CityTiles({ sessionId, personaSheetOpen }: CityTilesProps) {
  const [tiles, setTiles] = useState<CityTile[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function fetchTiles() {
      setLoading(true)
      try {
        const res = await fetch(`/api/top-picks/${sessionId}`)
        const data = await res.json()
        if (!cancelled) setTiles((data.picks || []).slice(0, 4))
      } catch {
        // quiet
      }
      if (!cancelled) setLoading(false)
    }
    if (sessionId) fetchTiles()
    return () => { cancelled = true }
  }, [sessionId])

  if (!sessionId) return null

  const tileCount = loading ? 4 : tiles.length
  if (!loading && tileCount === 0) return null

  // Show by default; fade away when persona sheet is pulled up
  const visible = !personaSheetOpen

  return (
    <div className={`city-tiles ${visible ? 'ct-visible' : 'ct-fading'}`}>
      <div className="ct-header">
        <span className="ct-label">🏙️ Discover your city</span>
        <span className="ct-sub">Powered by your saved places</span>
      </div>

      <div className="ct-track">
        {loading
          ? Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="ct-tile ct-skeleton" />
            ))
          : tiles.map(tile => (
              <a
                key={tile.id}
                href={tile.url || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="ct-tile"
              >
                <div className="ct-tile-top">
                  <span className="ct-cuisine">
                    {tile.cuisine || tile.itemType}
                  </span>
                  {tile.rating && <StarBadge rating={tile.rating} />}
                </div>
                <div className="ct-title">{tile.title.slice(0, 48)}</div>
                <div className="ct-why">{tile.why}</div>
              </a>
            ))}
      </div>
    </div>
  )
}
