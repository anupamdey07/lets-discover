import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { PersonaSheet } from './components/PersonaSheet'
import { DiscoveryPanel } from './components/DiscoveryPanel'
import { ThemeSelector } from './components/ThemeSelector'
import { QuickPicks } from './components/QuickPicks'
import { TopPicks } from './components/TopPicks'
import { CityTiles } from './components/CityTiles'
import { FrontFace } from './components/FrontFace'
import { GmapsSettings } from './components/GmapsSettings'
import { useSwipeFlip } from './hooks/useSwipeFlip'
import type { Message, Persona, Activity } from '../shared/types'

// ─── Types ───────────────────────────────────────────────────────

interface AppState {
  sessionId: string | null
  messages: Message[]
  persona: Persona | null
  activities: Activity[]
  themeActivities: Activity[]
  activeTheme: string | null
  loading: boolean
  activitiesLoading: boolean
  themeLoading: boolean
  quickPicks: any[]
  quickPicksLoading: boolean
  flipped: boolean
}

function loadSession(): string | null {
  return localStorage.getItem('ld_session_id')
}

function saveSession(id: string) {
  localStorage.setItem('ld_session_id', id)
}

// ─── App ─────────────────────────────────────────────────────────

export default function App() {
  const [state, setState] = useState<AppState>({
    sessionId: loadSession(),
    messages: [],
    persona: null,
    activities: [],
    themeActivities: [],
    activeTheme: null,
    loading: false,
    activitiesLoading: false,
    themeLoading: false,
    quickPicks: [],
    quickPicksLoading: false,
    flipped: false,
  })

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fetch on session load
  useEffect(() => {
    if (!state.sessionId) return
    fetchPersona(state.sessionId)
    fetchActivities(state.sessionId)
    fetchMessages(state.sessionId)
    fetchQuickPicks(state.sessionId)
  }, [state.sessionId])

  // Cleanup poll timer
  useEffect(() => {
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current)
    }
  }, [])

  // ─── API calls ───────────────────────────────────────────────

  async function fetchPersona(sid: string) {
    try {
      const res = await fetch(`/api/persona/${sid}`)
      const data = await res.json()
      setState((s) => ({ ...s, persona: data.persona }))
    } catch {}
  }

  async function fetchActivities(sid: string) {
    setState((s) => ({ ...s, activitiesLoading: true }))
    try {
      const res = await fetch(`/api/activities/${sid}`)
      const data = await res.json()
      setState((s) => ({
        ...s,
        activities: data.activities || [],
        activitiesLoading: false,
      }))
    } catch {
      setState((s) => ({ ...s, activitiesLoading: false }))
    }
  }

  // Poll for new activities after a chat message
  const pollActivities = useCallback((sid: string) => {
    let attempts = 0
    const poll = () => {
      if (attempts > 10) return
      attempts++
      pollTimer.current = setTimeout(async () => {
        try {
          const res = await fetch(`/api/activities/${sid}`)
          const data = await res.json()
          const acts: Activity[] = data.activities || []
          setState((s) => ({ ...s, activities: acts }))
          if (acts.length === 0) poll()
        } catch {
          poll()
        }
      }, 1000)
    }
    setState((s) => ({ ...s, activitiesLoading: true, activities: [] }))
    poll()
  }, [])

  async function fetchMessages(sid: string) {
    try {
      const res = await fetch(`/api/messages/${sid}`)
      const data = await res.json()
      setState((s) => ({ ...s, messages: data.messages || [] }))
    } catch {}
  }

  async function fetchQuickPicks(sid: string) {
    setState((s) => ({ ...s, quickPicksLoading: true }))
    try {
      const res = await fetch(`/api/quick-picks/${sid}`)
      const data = await res.json()
      setState((s) => ({ ...s, quickPicks: data.picks || [], quickPicksLoading: false }))
    } catch {
      setState((s) => ({ ...s, quickPicksLoading: false }))
    }
  }

  // ─── Chat send ──────────────────────────────────────────────

  const handleSend = useCallback(async (text: string) => {
    setState((s) => ({ ...s, loading: true }))

    const tempUser: Message = {
      id: 'temp-' + Date.now(),
      sessionId: state.sessionId || '',
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    }
    setState((s) => ({ ...s, messages: [...s.messages, tempUser] }))

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: state.sessionId, message: text }),
      })
      const data = await res.json()

      if (!state.sessionId) saveSession(data.sessionId)

      setState((s) => ({ ...s, sessionId: data.sessionId, loading: false }))

      fetchMessages(data.sessionId)
      setTimeout(() => fetchPersona(data.sessionId), 500)
      pollActivities(data.sessionId)
      setTimeout(() => fetchQuickPicks(data.sessionId), 2000)
    } catch {
      setState((s) => ({ ...s, loading: false }))
    }
  }, [state.sessionId, pollActivities])

  // ─── Clear chat ────────────────────────────────────────────

  const handleClear = useCallback(async () => {
    try {
      // Create a fresh session — persona persists via DB fallback
      const res = await fetch('/api/session', { method: 'POST' })
      const { sessionId: newId } = await res.json()
      saveSession(newId)
      setState((s) => ({
        ...s,
        sessionId: newId,
        messages: [],
        activities: [],
        themeActivities: [],
        quickPicks: [],
        loading: false,
      }))
      // Re-fetch persona (will fall back to latest across sessions)
      setTimeout(() => fetchPersona(newId), 300)
      setTimeout(() => fetchQuickPicks(newId), 800)
    } catch {
      // Quiet
    }
  }, [])

  // ─── Theme selection ─────────────────────────────────────────

  const handleThemeSelect = useCallback(async (theme: string | null) => {
    if (!state.sessionId) return

    setState((s) => ({ ...s, activeTheme: theme, themeLoading: true }))

    if (theme === null) {
      // Show general activities
      try {
        const res = await fetch(`/api/activities/${state.sessionId}`)
        const data = await res.json()
        setState((s) => ({
          ...s,
          themeActivities: data.activities || [],
          themeLoading: false,
        }))
      } catch {
        setState((s) => ({ ...s, themeLoading: false }))
      }
      return
    }

    // First check cache
    try {
      const cacheRes = await fetch(`/api/activities/${state.sessionId}/theme/${theme}`)
      const cacheData = await cacheRes.json()
      if (cacheData.activities.length > 0) {
        setState((s) => ({
          ...s,
          themeActivities: cacheData.activities,
          themeLoading: false,
        }))
        return
      }
    } catch {}

    // No cache — trigger fresh search
    try {
      const res = await fetch('/api/explore-theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: state.sessionId, theme }),
      })
      const data = await res.json()
      setState((s) => ({
        ...s,
        themeActivities: data.activities || [],
        themeLoading: false,
      }))
    } catch {
      setState((s) => ({ ...s, themeLoading: false }))
    }
  }, [state.sessionId])

  // ─── Goals update ─────────────────────────────────────────────

  const handleGoalsUpdate = async (goals: {
    shortTerm: string[]
    longTerm: string[]
    hobbies: string[]
  }) => {
    if (!state.sessionId) return
    try {
      const res = await fetch(`/api/persona/${state.sessionId}/goals`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(goals),
      })
      const data = await res.json()
      setState((s) => ({ ...s, persona: data.persona }))
    } catch {}
  }

  // ─── Which activities to show in the discovery panel ─────────

  const displayActivities =
    state.activeTheme !== null
      ? state.themeActivities
      : state.activities

  const displayLoading =
    state.activeTheme !== null ? state.themeLoading : state.activitiesLoading

  // Back-face ready: has content or returning user with existing persona
  const backFaceReady =
    displayActivities.length > 0 || state.quickPicks.length > 0 || !!state.persona
  const backFaceBuilding =
    state.messages.length > 0 && !backFaceReady &&
    (state.activitiesLoading || state.quickPicksLoading)

  // ─── Back-face gate (anticipation arc) ─────────────────────────
  // 4 visual stages that the user sees through as they chat:
  //   0 messages → 'locked'    (back face silhouette, "Chat to start discovering")
  //   1 message  → 'shimmer'   (z-flicker, "Personality forming…")
  //   2 messages → 'forming'   (partial preview blurred, "Almost there…")
  //   3+ msgs    → 'unlocked'  (real content revealed, but still evolving)
  const messageCount = state.messages.length
  const backFaceGate: 'locked' | 'shimmer' | 'forming' | 'unlocked' =
    messageCount === 0 ? 'locked' :
    messageCount === 1 ? 'shimmer' :
    messageCount === 2 ? 'forming' :
    'unlocked'

  // ─── Render ──────────────────────────────────────────────────

  // Compute theme and ambient mood from persona
  const colorProfile = state.persona?.colorProfile || { hue: 'blue' as const, intensity: 'soft' as const }
  const theme = `${colorProfile.intensity}-${colorProfile.hue}`

  // Stable ambient particles — generated once so they don't jump on every render.
  const particles = useMemo(
    () =>
      Array.from({ length: 20 }, () => ({
        left: `${Math.random() * 100}%`,
        delay: `${Math.random() * 10}s`,
        duration: `${6 + Math.random() * 10}s`,
        size: `${2 + Math.random() * 6}px`,
      })),
    []
  )

  // Weather mood updates every minute so it stays current if the app is left open.
  const [weatherMood, setWeatherMood] = useState<'warm' | 'clear' | 'cloudy' | 'calm'>(() => {
    const hour = new Date().getHours()
    if (hour >= 6 && hour < 10) return 'warm'
    if (hour >= 10 && hour < 16) return 'clear'
    if (hour >= 16 && hour < 20) return 'cloudy'
    return 'calm'
  })

  // Track persona sheet expanded state for CityTiles
  const [personaSheetOpen, setPersonaSheetOpen] = useState(false)
  const [gmapsSettingsOpen, setGmapsSettingsOpen] = useState(false)

  useEffect(() => {
    const updateMood = () => {
      const hour = new Date().getHours()
      let mood: 'warm' | 'clear' | 'cloudy' | 'calm' = 'calm'
      if (hour >= 6 && hour < 10) mood = 'warm'
      else if (hour >= 10 && hour < 16) mood = 'clear'
      else if (hour >= 16 && hour < 20) mood = 'cloudy'
      setWeatherMood(mood)
    }
    updateMood()
    const id = setInterval(updateMood, 60_000)
    return () => clearInterval(id)
  }, [])

  // Flip handler
  const handleFlip = useCallback(() => {
    setState((s) => ({ ...s, flipped: !s.flipped }))
  }, [])

  // Swipe gesture for flip — single instance drives both faces so the
  // velocity-aware spring + finger-follow work in either direction.
  const {
    transform: flipTransform,
    dragging,
    angle: flipAngle,
    velocity: flipVelocity,
    onMouseDown: onSwipeMouseDown,
    onTouchStart: onSwipeTouchStart,
  } = useSwipeFlip(handleFlip, state.flipped)

  return (
    <div className="flip-container">
      <div
        className={`flip-card ${dragging ? 'flip-dragging' : ''}`}
        style={{
          transform: flipTransform,
          '--flip-angle': `${flipAngle}deg`,
          '--flip-velocity': `${Math.min(Math.abs(flipVelocity) / 800, 4)}`,
        } as React.CSSProperties}
      >
        {/* Cuboid edge shadow — darkens the receding face during rotation */}
        <div className="flip-edge-shadow" />
        <div
          className={`flip-front ${state.flipped ? 'flip-hidden' : ''}`}
          onMouseDown={(e) => {
            if (state.flipped) return
            // Allow text selection / clicks inside chat bubbles, links, inputs, etc.
            const t = e.target as HTMLElement
            if (t.closest('.front-bubble, a, input, button, textarea, select, .front-edge')) return
            e.preventDefault()
            onSwipeMouseDown(e.clientX, false)
          }}
          onTouchStart={(e) => {
            if (state.flipped) return
            onSwipeTouchStart(e.touches[0].clientX, false)
          }}
        >
          {/* Edge swipe handle — mirrors .back-edge so the front face also
              has a dedicated strip that yields horizontal gestures to JS.
              Without this, every horizontal swipe across the chat would be
              interpreted as a flip, which is the "too sensitive" bug. */}
          <div
            className="front-edge"
            onMouseDown={(e) => {
              if (state.flipped) return
              e.preventDefault()
              onSwipeMouseDown(e.clientX, true)
            }}
            onTouchStart={(e) => {
              if (state.flipped) return
              e.preventDefault()
              onSwipeTouchStart(e.touches[0].clientX, true)
            }}
          />
          <FrontFace
            onFlip={handleFlip}
            onSend={handleSend}
            onClear={handleClear}
            messages={state.messages}
            loading={state.loading}
            theme={theme}
            personaCity={state.persona?.city}
            persona={state.persona}
            backFaceReady={backFaceReady}
            backFaceBuilding={backFaceBuilding}
            backFaceGate={backFaceGate}
          />
        </div>

        {/* ── Back Face: Pure Discovery (no chat) ── */}
        <div className={`flip-back ${state.flipped ? 'flip-visible' : ''} bf-gate-${backFaceGate}`}>
          {/* Edge swipe handle — dedicated strip with touch-action:none so the
              browser yields the gesture to JS reliably (no scroll/zoom racing). */}
          <div
            className="back-edge"
            onMouseDown={(e) => {
              if (!state.flipped) return
              e.preventDefault()
              onSwipeMouseDown(e.clientX, true)
            }}
            onTouchStart={(e) => {
              if (!state.flipped) return
              e.preventDefault()
              onSwipeTouchStart(e.touches[0].clientX, true)
            }}
          />
          <div className="app" data-theme={theme}>
            {/* Edge swipe hint for back face */}
            <div className="back-swipe-hint">
              <span className="swipe-arrow">‹</span>
            </div>
            <header className="app-header">
              <button className="back-to-front-btn" onClick={handleFlip} aria-label="Back to chat">
                ← Chat
              </button>
              <span className="app-logo">🔍</span>
              <span className="app-title">Lets Discover</span>
              <span className="app-badge">always learning</span>
              <button className="gs-gear-btn" onClick={() => setGmapsSettingsOpen(true)} aria-label="Settings">
                ⚙
              </button>
            </header>

            {/* Discovery panels only — no Chat */}
            <div className="top-discovery">
              <DiscoveryPanel
                activities={displayActivities}
                loading={displayLoading}
                theme={state.activeTheme}
              />
            </div>

            <ThemeSelector
              activeTheme={state.activeTheme}
              onSelect={handleThemeSelect}
              loading={state.themeLoading}
            />

            <QuickPicks
              picks={state.quickPicks}
              loading={state.quickPicksLoading}
            />

            {/* Top picks from your saved discoveries — matched to your persona */}
            <TopPicks
              sessionId={state.sessionId || ''}
              compact
            />

            {/* City tiles — inside the scroll, below TopPicks. Fades when persona drawer opens */}
            {state.persona && (
              <CityTiles
                sessionId={state.sessionId || ''}
                personaSheetOpen={personaSheetOpen}
              />
            )}
          </div>

          {/* Persona sheet floats over the back face */}
          {state.persona && (
            <PersonaSheet
              persona={state.persona}
              onUpdate={handleGoalsUpdate}
              onExpandChange={setPersonaSheetOpen}
            />
          )}

          {/* Google Maps Settings overlay */}
          {gmapsSettingsOpen && (
            <GmapsSettings onClose={() => setGmapsSettingsOpen(false)} />
          )}
        </div>
      </div>

      {/* Ambient backgrounds — fixed behind the card so the front face stays
          transparent and the back face covers them with its solid surface. */}
      <div className="ambient-bg">
        <div className={`weather-bg weather-${weatherMood}`}>
          <div className="weather-gradient" />
          <div className="sun-rays">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="sun-ray" style={{
                transform: `rotate(${i * 45}deg)`,
                animationDelay: `${i * 0.5}s`,
              }} />
            ))}
          </div>
        </div>
        <div className="fluid-bg">
          <div className="blob blob-1" />
          <div className="blob blob-2" />
          <div className="blob blob-3" />
        </div>
        <div className="particles">
          {particles.map((p, i) => (
            <div
              key={i}
              className="particle"
              style={{
                left: p.left,
                animationDelay: p.delay,
                animationDuration: p.duration,
                width: p.size,
                height: p.size,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
