import { useState } from 'react'
import type { Persona } from '../../shared/types'

interface PersonaSectionProps {
  persona: Persona
  onUpdate: (goals: {
    shortTerm: string[]
    longTerm: string[]
    hobbies: string[]
  }) => void
}

/** Split "🧗 Explore climbing in Prenzlauer Berg" → { emoji: "🧗", text: "Explore climbing in Prenzlauer Berg" } */
function splitBullet(bullet: string): { emoji: string; text: string } {
  const match = bullet.match(/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F?)\s?(.*)/u)
  if (match) return { emoji: match[1], text: match[2] || bullet }
  return { emoji: '✨', text: bullet }
}

export function PersonaSection({ persona, onUpdate }: PersonaSectionProps) {
  const [editing, setEditing] = useState(false)
  const [shortTerm, setShortTerm] = useState(persona.shortTermGoals.join(', '))
  const [longTerm, setLongTerm] = useState(persona.longTermGoals.join(', '))
  const [hobbies, setHobbies] = useState(persona.hobbies.join(', '))

  function handleSave() {
    onUpdate({
      shortTerm: shortTerm.split(',').map(s => s.trim()).filter(Boolean),
      longTerm: longTerm.split(',').map(s => s.trim()).filter(Boolean),
      hobbies: hobbies.split(',').map(s => s.trim()).filter(Boolean),
    })
    setEditing(false)
  }

  function handleCancel() {
    setShortTerm(persona.shortTermGoals.join(', '))
    setLongTerm(persona.longTermGoals.join(', '))
    setHobbies(persona.hobbies.join(', '))
    setEditing(false)
  }

  const summaryLine = [
    persona.city ? `📍 ${persona.city}` : null,
    persona.vibe && persona.vibe !== 'unknown' ? persona.vibe : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className="section persona-section">
      <div className="section-header">
        <span className="section-title">🎯 About me</span>
        <button className="section-action" onClick={() => setEditing(!editing)}>
          {editing ? 'Cancel' : 'Edit'}
        </button>
      </div>

      <div className="persona-body">
        {editing ? (
          <div className="persona-editor">
            <label>
              Short-term goals (comma separated)
              <input
                type="text"
                value={shortTerm}
                onChange={e => setShortTerm(e.target.value)}
                placeholder="visit climbing gym, find jazz clubs..."
              />
            </label>
            <label>
              Long-term goals
              <input
                type="text"
                value={longTerm}
                onChange={e => setLongTerm(e.target.value)}
                placeholder="B2 German, find an apartment..."
              />
            </label>
            <label>
              Hobbies & interests
              <input
                type="text"
                value={hobbies}
                onChange={e => setHobbies(e.target.value)}
                placeholder="climbing, jazz, photography..."
              />
            </label>
            <button className="persona-save-btn" onClick={handleSave}>Save</button>
          </div>
        ) : (
          <div className="persona-display">
            {summaryLine && (
              <div className="pf-summary">{summaryLine}</div>
            )}

            {persona.shortTermBullets.length > 0 && (
              <div className="pf-block">
                <div className="pf-block-title">📋 Short-term</div>
                <ul className="pf-bullets">
                  {persona.shortTermBullets.map((b, i) => {
                    const { emoji, text } = splitBullet(b)
                    return (
                      <li key={i}><span className="pf-emoji">{emoji}</span> {text}</li>
                    )
                  })}
                </ul>
                <div className="pf-tags">
                  {persona.shortTermGoals.map((t, i) => (
                    <span key={i} className="pf-tag">{t}</span>
                  ))}
                </div>
              </div>
            )}

            {persona.longTermBullets.length > 0 && (
              <div className="pf-block">
                <div className="pf-block-title">🎯 Long-term</div>
                <ul className="pf-bullets">
                  {persona.longTermBullets.map((b, i) => {
                    const { emoji, text } = splitBullet(b)
                    return (
                      <li key={i}><span className="pf-emoji">{emoji}</span> {text}</li>
                    )
                  })}
                </ul>
                <div className="pf-tags">
                  {persona.longTermGoals.map((t, i) => (
                    <span key={i} className="pf-tag">{t}</span>
                  ))}
                </div>
              </div>
            )}

            {persona.hobbyBullets.length > 0 && (
              <div className="pf-block">
                <div className="pf-block-title">💝 Hobbies</div>
                <ul className="pf-bullets">
                  {persona.hobbyBullets.map((b, i) => {
                    const { emoji, text } = splitBullet(b)
                    return (
                      <li key={i}><span className="pf-emoji">{emoji}</span> {text}</li>
                    )
                  })}
                </ul>
                <div className="pf-tags">
                  {persona.hobbies.map((t, i) => (
                    <span key={i} className="pf-tag">{t}</span>
                  ))}
                </div>
              </div>
            )}

            {persona.shortTermBullets.length === 0 &&
              persona.longTermBullets.length === 0 &&
              persona.hobbyBullets.length === 0 && (
                <div className="persona-empty">
                  Chat with me and I'll start building your profile!
                </div>
              )}
          </div>
        )}
      </div>
    </div>
  )
}
