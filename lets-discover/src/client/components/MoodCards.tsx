// MoodCards — 3 tappable mood cards below the input on the FIRST turn.
// Each card fills the input with a full starter prompt — user just hits send.
// This replaces "what are you in the mood to discover today?" with a more
// gamified, narrative entry that builds the back-face personality faster.

interface MoodCardsProps {
  onPick: (prompt: string) => void
  visible: boolean
}

const MOOD_CARDS = [
  {
    emoji: '🌙',
    label: 'Slow night',
    prompt: "I'm in the mood for a slow, atmospheric night — somewhere with a view, good conversation, and nowhere to be.",
    gradient: 'linear-gradient(135deg, #2c3e5a 0%, #4a6088 100%)',
  },
  {
    emoji: '⚡',
    label: 'Full send',
    prompt: "I want to do something I haven't done before. Surprise me — energy is high, give me the most alive thing happening this week.",
    gradient: 'linear-gradient(135deg, #d480a8 0%, #c05878 100%)',
  },
  {
    emoji: '🧭',
    label: 'Wander',
    prompt: "I want to wander. Give me 2-3 spots within walking distance that feel like a small adventure.",
    gradient: 'linear-gradient(135deg, #6a9a78 0%, #487a5a 100%)',
  },
] as const

export function MoodCards({ onPick, visible }: MoodCardsProps) {
  if (!visible) return null
  return (
    <div className="mood-cards">
      <div className="mc-label">Pick a mood to start →</div>
      <div className="mc-row">
        {MOOD_CARDS.map((card) => (
          <button
            key={card.label}
            className="mc-card"
            style={{ background: card.gradient }}
            onClick={() => onPick(card.prompt)}
            type="button"
          >
            <span className="mc-emoji">{card.emoji}</span>
            <span className="mc-label-text">{card.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
