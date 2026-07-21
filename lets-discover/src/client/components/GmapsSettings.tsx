import { useState, useEffect } from 'react'

interface GmapsPlace {
  name: string
  rating?: number
  reviewCount?: number
  category?: string
  priceLevel?: string
}

interface GmapsSettingsProps {
  /** Close handler */
  onClose: () => void
}

type TabState = 'settings' | 'preview' | 'search'

export function GmapsSettings({ onClose }: GmapsSettingsProps) {
  const [link, setLink] = useState('')
  const [saved, setSaved] = useState(false)
  const [configured, setConfigured] = useState(false)
  const [listName, setListName] = useState<string | null>(null)
  const [placeCount, setPlaceCount] = useState(0)
  const [lastScraped, setLastScraped] = useState<string | null>(null)
  const [scraping, setScraping] = useState(false)
  const [places, setPlaces] = useState<GmapsPlace[]>([])
  const [scrapeError, setScrapeError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabState>('settings')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<GmapsPlace[]>([])
  const [searching, setSearching] = useState(false)

  // Load current config on mount
  useEffect(() => {
    fetch('/api/gmaps')
      .then(r => r.json())
      .then(data => {
        if (data.configured) {
          setConfigured(true)
          setLink(data.gmapsLink || '')
          setListName(data.listName)
          setPlaceCount(data.placeCount)
          setLastScraped(data.lastScraped)
        }
      })
      .catch(() => {})
  }, [])

  // Save the link
  async function handleSave() {
    if (!link.trim()) return
    setScrapeError(null)
    try {
      const res = await fetch('/api/gmaps/link', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link: link.trim() }),
      })
      const data = await res.json()
      if (data.success) {
        setSaved(true)
        setConfigured(true)
        setTimeout(() => setSaved(false), 2000)
      } else {
        setScrapeError(data.error || 'Failed to save')
      }
    } catch {
      setScrapeError('Failed to save link')
    }
  }

  // Trigger scrape
  async function handleScrape() {
    setScraping(true)
    setScrapeError(null)
    try {
      const res = await fetch('/api/gmaps/scrape-full', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      if (data.success) {
        setPlaces(data.places || [])
        setPlaceCount(data.placeCount)
        setListName(data.listName)
        setLastScraped(new Date().toISOString())
        setTab('preview')
      } else {
        setScrapeError(data.error || 'Scrape failed')
      }
    } catch {
      setScrapeError('Scrape failed — Google may have blocked the request')
    }
    setScraping(false)
  }

  // Search saved places
  async function handleSearch() {
    if (!searchQuery.trim()) return
    setSearching(true)
    try {
      const res = await fetch('/api/gmaps/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery.trim() }),
      })
      const data = await res.json()
      setSearchResults(data.results || [])
    } catch {
      setSearchResults([])
    }
    setSearching(false)
  }

  // Remove config
  async function handleRemove() {
    try {
      await fetch('/api/gmaps', { method: 'DELETE' })
      setConfigured(false)
      setLink('')
      setPlaces([])
      setSearchResults([])
      setPlaceCount(0)
      setListName(null)
      setLastScraped(null)
      setTab('settings')
    } catch {}
  }

  return (
    <div className="gmaps-settings-overlay" onClick={onClose}>
      <div className="gmaps-settings-panel" onClick={e => e.stopPropagation()}>
        <div className="gs-header">
          <span className="gs-title">🗺️ My Saved Places</span>
          <button className="gs-close" onClick={onClose}>✕</button>
        </div>

        {/* Tab bar */}
        <div className="gs-tabs">
          <button
            className={`gs-tab ${tab === 'settings' ? 'gs-tab-active' : ''}`}
            onClick={() => setTab('settings')}
          >
            ⚙️ Settings
          </button>
          <button
            className={`gs-tab ${tab === 'preview' ? 'gs-tab-active' : ''}`}
            onClick={() => setTab('preview')}
            disabled={!configured}
          >
            📋 Preview
          </button>
          <button
            className={`gs-tab ${tab === 'search' ? 'gs-tab-active' : ''}`}
            onClick={() => setTab('search')}
            disabled={!configured || placeCount === 0}
          >
            🔍 Search
          </button>
        </div>

        <div className="gs-body">
          {/* ── Settings tab ── */}
          {tab === 'settings' && (
            <div className="gs-section">
              <p className="gs-hint">
                Paste a shared Google Maps list link below. The app will scrape your favorite places nightly and add them to your discovery pipeline.
              </p>

              <label className="gs-label">Google Maps list link</label>
              <input
                className="gs-input"
                type="text"
                value={link}
                onChange={e => setLink(e.target.value)}
                placeholder="https://maps.app.goo.gl/..."
              />

              <div className="gs-actions">
                <button
                  className="gs-btn gs-btn-primary"
                  onClick={handleSave}
                  disabled={!link.trim()}
                >
                  {saved ? '✓ Saved!' : 'Save Link'}
                </button>

                {configured && (
                  <>
                    <button
                      className="gs-btn gs-btn-accent"
                      onClick={handleScrape}
                      disabled={scraping}
                    >
                      {scraping ? '⏳ Scraping...' : '🔄 Scrape Now'}
                    </button>
                    <button
                      className="gs-btn gs-btn-danger"
                      onClick={handleRemove}
                    >
                      Remove
                    </button>
                  </>
                )}
              </div>

              {scrapeError && (
                <div className="gs-error">{scrapeError}</div>
              )}

              {configured && (
                <div className="gs-status">
                  {listName && <div>📌 <strong>List:</strong> {listName}</div>}
                  {placeCount > 0 && <div>📍 <strong>Places:</strong> {placeCount}</div>}
                  {lastScraped && (
                    <div>🕐 <strong>Last scraped:</strong> {new Date(lastScraped).toLocaleString()}</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Preview tab ── */}
          {tab === 'preview' && (
            <div className="gs-section">
              {places.length === 0 ? (
                <p className="gs-hint">No places loaded yet. Go to Settings and scrape your list.</p>
              ) : (
                <>
                  <div className="gs-count">{places.length} places</div>
                  <div className="gs-place-list">
                    {places.map((p, i) => (
                      <div key={i} className="gs-place-item">
                        <div className="gsp-name">{p.name}</div>
                        <div className="gsp-meta">
                          {p.category && <span className="gsp-cat">{p.category}</span>}
                          {p.rating && <span className="gsp-rating">★ {p.rating}</span>}
                          {p.reviewCount && <span className="gsp-reviews">({p.reviewCount})</span>}
                          {p.priceLevel && <span className="gsp-price">{p.priceLevel}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Search tab ── */}
          {tab === 'search' && (
            <div className="gs-section">
              <div className="gs-search-row">
                <input
                  className="gs-input gs-search-input"
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  placeholder="Search your saved places..."
                />
                <button
                  className="gs-btn gs-btn-primary"
                  onClick={handleSearch}
                  disabled={!searchQuery.trim() || searching}
                >
                  {searching ? '...' : 'Search'}
                </button>
              </div>

              {searchResults.length > 0 && (
                <div className="gs-place-list">
                  {searchResults.map((p, i) => (
                    <div key={i} className="gs-place-item">
                      <div className="gsp-name">{p.name}</div>
                      <div className="gsp-meta">
                        {p.category && <span className="gsp-cat">{p.category}</span>}
                        {p.rating && <span className="gsp-rating">★ {p.rating}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {searchQuery && !searching && searchResults.length === 0 && (
                <p className="gs-hint">No matches found</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
