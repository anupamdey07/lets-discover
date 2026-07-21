import { useEffect } from 'react'
import { PersonaSection } from './PersonaSection'
import { useSwipeUp } from '../hooks/useSwipeUp'
import type { Persona } from '../../shared/types'

interface PersonaSheetProps {
  persona: Persona
  onUpdate: (goals: {
    shortTerm: string[]
    longTerm: string[]
    hobbies: string[]
  }) => void
  onExpandChange?: (expanded: boolean) => void
}

/**
 * Bottom-anchored sheet that "peeks" a slim handle + one-line summary and
 * swipes up to reveal the full mined persona / goals / hobbies.
 *
 * The sheet floats over the back-face discovery content. Only the handle
 * strip is visible by default — everything else is tucked below the fold
 * and springs into view on swipe-up (or a tap on the handle).
 */
export function PersonaSheet({ persona, onUpdate, onExpandChange }: PersonaSheetProps) {
  const sheet = useSwipeUp({ peekHeight: 40, openRatio: 0.35 })

  // Notify parent when expanded/collapsed changes
  useEffect(() => {
    onExpandChange?.(!sheet.collapsed)
  }, [sheet.collapsed])

  const summary = persona.summary
  const traitCount =
    persona.interests.length +
    persona.hobbies.length +
    persona.shortTermGoals.length +
    persona.longTermGoals.length

  return (
    <div
      className={`persona-sheet ${sheet.collapsed ? 'ps-peek' : 'ps-open'}`}
      style={{
        height: sheet.openHeight,
        transform: `translateY(${Math.round(sheet.translateY)}px)`,
      }}
    >
      {/* Drag handle — minimal, just grip + compact label */}
      <div
        className="ps-handle"
        onMouseDown={(e) => { e.preventDefault(); sheet.onPointerDown(e.clientY) }}
        onTouchStart={(e) => sheet.onTouchPointerDown(e.touches[0].clientY)}
      >
        <div className="ps-grip" />
        <div className="ps-teaser">
          <span className="ps-teaser-label">🎯 Me</span>
          {sheet.collapsed ? (
            <span className="ps-teaser-summary">
              {summary
                ? summary.length > 50
                  ? summary.slice(0, 48) + '…'
                  : summary
                : traitCount > 0
                  ? `${traitCount} traits`
                  : 'chat to build profile'}
            </span>
          ) : (
            <span
              className="ps-collapse"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); sheet.close() }}
            >
              ∧
            </span>
          )}
        </div>
      </div>

      {/* Full content — only interactive when open */}
      <div
        className="ps-content"
        style={{ pointerEvents: sheet.collapsed ? 'none' : 'auto' }}
      >
        <PersonaSection persona={persona} onUpdate={onUpdate} />
      </div>
    </div>
  )
}
