import { useState, useRef, useEffect, useCallback } from 'react'

interface BackSearchProps {
  onResults: (results: any[]) => void
  loading: boolean
  setLoading: (v: boolean) => void
}

export function BackSearch({ onResults, loading, setLoading }: BackSearchProps) {
  const [query, setQuery] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const debouncedSearch = useCallback((q: string) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!q.trim()) {
      onResults([])
      return
    }
    timerRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`)
        const data = await res.json()
        onResults(data.results || [])
      } catch {
        onResults([])
      } finally {
        setLoading(false)
      }
    }, 300)
  }, [onResults, setLoading])

  return (
    <div className="back-search">
      <form
        className="back-search-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (timerRef.current) clearTimeout(timerRef.current)
          debouncedSearch(query)
        }}
      >
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            debouncedSearch(e.target.value)
          }}
          placeholder="Search discoveries…"
          autoComplete="off"
        />
        {query && (
          <button type="button" className="back-search-clear" onClick={() => {
            setQuery('')
            onResults([])
          }}>
            ✕
          </button>
        )}
      </form>
    </div>
  )
}