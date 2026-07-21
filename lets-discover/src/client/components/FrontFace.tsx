import { useState, useEffect, useRef } from 'react'
import type { Message, Persona } from '../../shared/types'
import { MoodCards } from './MoodCards'
import { PromptChips } from './PromptChips'

interface FrontFaceProps {
  onFlip: () => void
  onSend: (text: string) => Promise<void>
  onClear?: () => void
  messages: Message[]
  loading: boolean
  theme: string
  personaCity?: string
  persona?: Persona | null
  backFaceReady?: boolean
  backFaceBuilding?: boolean
  backFaceGate?: 'locked' | 'shimmer' | 'forming' | 'unlocked'
}

const WELCOME = "What are you in the mood to discover today?"

export function FrontFace({ onFlip, onSend, onClear, messages, loading, theme, persona, backFaceReady, backFaceBuilding, backFaceGate = 'locked' }: FrontFaceProps) {
  const [input, setInput] = useState('')
  const [keyboardActive, setKeyboardActive] = useState(false)
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const [weatherMood] = useState<'clear' | 'cloudy' | 'warm' | 'calm'>(() => {
    const hour = new Date().getHours()
    if (hour >= 6 && hour < 10) return 'warm'
    if (hour >= 10 && hour < 16) return 'clear'
    if (hour >= 16 && hour < 20) return 'cloudy'
    return 'calm'
  })
  const endRef = useRef<HTMLDivElement>(null)
  const chatRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Detect keyboard open/close via visualViewport API
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    const onResize = () => {
      const diff = window.innerHeight - vv.height
      if (diff > 60) {
        setKeyboardHeight(diff)
        setKeyboardActive(true)
      } else {
        setKeyboardHeight(0)
        setKeyboardActive(false)
      }
    }

    vv.addEventListener('resize', onResize)
    onResize()
    return () => vv.removeEventListener('resize', onResize)
  }, [])

  // Scroll to bottom only when the user is already near the bottom,
  // so reading older messages isn't interrupted by new ones.
  useEffect(() => {
    const el = chatRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottom) {
      endRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    await onSend(text)
  }

  // All messages preserved in the DOM. Newest 2 are full; older ones
  // progressively fade and compress, but remain scrollable.
  const hasRecent = messages.length > 0
  const lastIdx = messages.length - 1
  const hasScrollHistory = messages.length > 2

  return (
    <div className={`front-face front-visible ${keyboardActive ? 'kb-open' : ''}`}>
      {/* ── Branding — always visible, shrinks when chatting ── */}
      <div className={`front-branding ${hasRecent ? 'fb-compact' : 'fb-hero'} ${keyboardActive ? 'fb-kb-compact' : ''}`}>
        <div className="fb-logo">🔍</div>
        <div className="fb-title">Lets Discover</div>
        {!hasRecent && (
          <p className="fb-subtitle">{WELCOME}</p>
        )}
        {hasRecent && (
          <p className="fb-subtitle-compact">
            {backFaceGate === 'shimmer' && '✨ personality forming…'}
            {backFaceGate === 'forming' && '🔮 almost there…'}
            {backFaceGate === 'unlocked' && 'your city awaits'}
            {!['shimmer', 'forming', 'unlocked'].includes(backFaceGate) && 'your city awaits'}
          </p>
        )}
      </div>

      {/* ── Chat messages — all preserved, older ones fade progressively ── */}
      {hasRecent && (
        <div className={`front-chat ${keyboardActive ? 'fc-kb-compact' : ''} ${hasScrollHistory ? 'fc-has-history' : ''}`} ref={chatRef}>
          {hasScrollHistory && (
            <div className="fc-history-hint">↑ older messages</div>
          )}
          {messages.map((msg, i) => {
            // Distance from newest message — determines fade level
            const distFromNewest = lastIdx - i
            let fadeClass = ''
            if (distFromNewest >= 4) fadeClass = 'fb-aged'     // 4+ back → barely visible
            else if (distFromNewest >= 2) fadeClass = 'fb-faded' // 2-3 back → soft

            return (
              <div
                key={msg.id}
                className={`front-bubble ${msg.role === 'user' ? 'fb-user' : 'fb-assistant'} ${fadeClass}`}
              >
                {msg.role === 'assistant' && <span className="fb-emoji">🔍</span>}
                <span className="fb-text">{msg.content}</span>
              </div>
            )
          })}

          {loading && (
            <div className="front-bubble fb-assistant">
              <span className="fb-emoji">🔍</span>
              <span className="fb-text">
                <span className="fb-dot-pulse">
                  <span></span><span></span><span></span>
                </span>
              </span>
            </div>
          )}

          <div ref={endRef} />
        </div>
      )}

      {/* ── Input + actions ── */}
      <div className={`front-bottom ${keyboardActive ? 'fb-kb-open' : ''}`}>
        {/* First turn: 3 mood cards. Later turns: 3 rotating prompt chips. */}
        {messages.length === 0 && (
          <MoodCards
            visible={!keyboardActive}
            onPick={(prompt) => {
              setInput(prompt)
              setTimeout(() => inputRef.current?.focus(), 50)
            }}
          />
        )}
        {messages.length > 0 && messages.length < 6 && !keyboardActive && (
          <PromptChips
            persona={persona ?? null}
            visible={true}
            onPick={(prompt) => {
              setInput(prompt)
              setTimeout(() => inputRef.current?.focus(), 50)
            }}
          />
        )}

        <form className="front-input" onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={messages.length === 0 ? "Type anything..." : "Tell me more..."}
            autoComplete="off"
            disabled={loading}
          />
          <button type="submit" disabled={!input.trim() || loading}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
        </form>

        {messages.length >= 2 && (
          <div className="front-actions">
            {onClear && (
              <button className="front-clear-btn" onClick={onClear}>
                clear chat
              </button>
            )}
            {backFaceGate === 'unlocked' && backFaceReady ? (
              <button className="front-explore-btn" onClick={onFlip}>
                <span>Explore discoveries</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            ) : (
              <span className="front-building">
                {backFaceGate === 'shimmer' && '✨ reading your vibe…'}
                {backFaceGate === 'forming' && '🔮 forming your city…'}
                {backFaceGate === 'unlocked' && (backFaceBuilding ? 'Building your city…' : 'Chat more to unlock')}
                {backFaceGate === 'locked' && 'Chat to start'}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
