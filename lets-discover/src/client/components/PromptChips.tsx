// PromptChips — 3 tappable question chips below the input for LATER turns.
// The set rotates based on the persona so the 2nd question feels like the
// app is "listening" to the first answer. Each chip fills the input; the
// user can adjust before sending.

import { useMemo } from 'react'
import type { Persona } from '../../shared/types'

interface PromptChipsProps {
  persona: Persona | null
  onPick: (prompt: string) => void
  visible: boolean
}

interface Chip {
  emoji: string
  label: string
  prompt: string
}

const GENERIC_CHIPS: Chip[] = [
  { emoji: '🍸', label: 'Hidden bar?', prompt: 'Where is the best hidden cocktail bar in this city right now?' },
  { emoji: '🚶', label: 'Walk this afternoon', prompt: 'Where should I walk this afternoon? I have 2-3 hours free.' },
  { emoji: '🤝', label: 'New hobby group', prompt: 'Help me find a hobby group or meetup I could realistically join this week.' },
]

const VIBE_CHIPS: Record<string, Chip[]> = {
  clubber: [
    { emoji: '🎧', label: 'DJ tonight', prompt: "Who's DJing tonight that I shouldn't miss?" },
    { emoji: '🌃', label: 'After-hours', prompt: "Where does the night actually start after the clubs close?" },
    { emoji: '🔊', label: 'New sound', prompt: "I want to hear a sound I haven't heard before. Where?" },
  ],
  chill: [
    { emoji: '☕', label: 'Quiet café', prompt: 'A café where I can sit for 3 hours with a book and not feel weird?' },
    { emoji: '🌳', label: 'Park reset', prompt: "Where do you go when the city's too much?" },
    { emoji: '📖', label: 'Late bookstore', prompt: 'A bookstore open late, ideally with somewhere to sit and read.' },
  ],
  active: [
    { emoji: '🧗', label: 'Climb today', prompt: 'Best bouldering gym within 30 min of me that has open hours now?' },
    { emoji: '🏃', label: 'Run route', prompt: "A 5K loop that doesn't suck, with a coffee stop at the end." },
    { emoji: '🚴', label: 'Bike + beer', prompt: 'A bike ride that ends at a beer garden, please.' },
  ],
  curious: [
    { emoji: '🏛️', label: 'Small museum', prompt: "A small museum I haven't been to that rewards 90 minutes." },
    { emoji: '🎷', label: 'Live anything', prompt: "What's playing live tonight that isn't the obvious venue?" },
    { emoji: '🗣️', label: 'Talk to strangers', prompt: "Where do interesting conversations actually happen in this city?" },
  ],
}

// Build a contextual chip set from a persona. Falls back to generic.
function buildChips(persona: Persona | null): Chip[] {
  if (!persona) return GENERIC_CHIPS

  const vibeChips = persona.vibe && VIBE_CHIPS[persona.vibe] ? VIBE_CHIPS[persona.vibe] : []

  // Pull a question that hooks an interest if we have one
  if (persona.interests.length > 0) {
    const top = persona.interests[0]
    vibeChips.push({
      emoji: '✨',
      label: `More ${top}`,
      prompt: `Show me more things around "${top}" — different from what you already suggested.`,
    })
  }
  if (persona.hobbies.length > 0) {
    const top = persona.hobbies[0]
    vibeChips.push({
      emoji: '🛠️',
      label: `${top} community`,
      prompt: `Where do people who love ${top} actually hang out here?`,
    })
  }
  if (persona.city) {
    vibeChips.push({
      emoji: '🗺️',
      label: 'Neighborhood I avoid',
      prompt: `Pick a neighborhood in ${persona.city} I probably avoid and convince me to spend an afternoon there.`,
    })
  }

  // Take 3 — prioritize vibe-specific
  return vibeChips.slice(0, 3)
}

export function PromptChips({ persona, onPick, visible }: PromptChipsProps) {
  const chips = useMemo(() => buildChips(persona), [persona])
  if (!visible) return null
  return (
    <div className="prompt-chips">
      <div className="pc-label">Or try one of these →</div>
      <div className="pc-row">
        {chips.map((chip, i) => (
          <button
            key={`${chip.label}-${i}`}
            className="pc-chip"
            onClick={() => onPick(chip.prompt)}
            type="button"
          >
            <span className="pc-emoji">{chip.emoji}</span>
            <span className="pc-label-text">{chip.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
