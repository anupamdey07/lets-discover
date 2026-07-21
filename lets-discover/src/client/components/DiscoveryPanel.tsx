import type { Activity } from '../../shared/types'

interface DiscoveryPanelProps {
  activities: Activity[]
  loading?: boolean
  theme: string | null
}

const CATEGORY_ICONS: Record<string, string> = {
  adventure: '🏔️',
  culture: '🎨',
  food: '🍜',
  nightlife: '🌙',
  music: '🎵',
  sports: '⚽',
  tech: '💻',
  art: '🎨',
  wellness: '🧘',
  learning: '📚',
  networking: '🤝',
  general: '✨',
}

function formatTitle(title: string): string {
  // Clean up titles - remove source prefixes, clean HTML
  return title
    .replace(/^[|]\s*/, '')
    .replace(/\s*\|.*$/, '')
    .replace(/ - visitBerlin.*$/, '')
    .replace(/ \| Berlin\.de.*$/, '')
    .replace(/<[^>]*>/g, '')
    .trim()
}

function extractType(title: string, desc: string): string {
  const t = (title + ' ' + desc).toLowerCase()
  if (t.includes('climb') || t.includes('boulder') || t.includes('gym')) return '🧗 Climbing'
  if (t.includes('cafe') || t.includes('café') || t.includes('brunch')) return '☕ Cafe'
  if (t.includes('restaurant') || t.includes('kitchen') || t.includes('eatery')) return '🍽️ Restaurant'
  if (t.includes('museum') || t.includes('gallery') || t.includes('exhibition')) return '🏛️ Museum'
  if (t.includes('concert') || t.includes('live') || t.includes('gig')) return '🎤 Concert'
  if (t.includes('club') || t.includes('bar') || t.includes('pub')) return '🍸 Bar'
  if (t.includes('festival') || t.includes('fair') || t.includes('market')) return '🎪 Festival'
  if (t.includes('park') || t.includes('garden') || t.includes('trail')) return '🌳 Park'
  if (t.includes('tour') || t.includes('walk') || t.includes('guide')) return '🚶 Tour'
  if (t.includes('workshop') || t.includes('class') || t.includes('course')) return '📖 Workshop'
  if (t.includes('theater') || t.includes('theatre') || t.includes('show')) return '🎭 Theater'
  return '📍 Place'
}

export function DiscoveryPanel({ activities, loading, theme }: DiscoveryPanelProps) {
  const themeLabel = theme || 'discoveries'
  const icon = theme ? (CATEGORY_ICONS[theme] || '✨') : '🎵'

  return (
    <div className="discovery-panel">
      <div className="discovery-header">
        <span className="discovery-label">{icon} {themeLabel}</span>
        <span className="discovery-count">
          {activities.length > 0 ? `${activities.length} places` : ''}
          <span className="discovery-hint"> scroll →</span>
        </span>
      </div>

      <div className="discovery-track">
        {loading && activities.length === 0 ? (
          <>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="discovery-skeleton" />
            ))}
          </>
        ) : activities.length === 0 ? (
          <div className="discovery-empty">
            {theme
              ? `Tap search to explore ${theme}`
              : 'Chat to discover places ✨'}
          </div>
        ) : (
          activities.slice(0, 20).map((activity) => (
            <a
              key={activity.id}
              href={activity.url || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="discovery-card"
            >
              <div className="dc-type">
                {extractType(activity.title, activity.description || '')}
              </div>
              <div className="dc-title">
                {formatTitle(activity.title)}
              </div>
              {activity.description && (
                <div className="dc-desc">
                  {activity.description.slice(0, 100)}
                  {activity.description.length > 100 ? '...' : ''}
                </div>
              )}
              {activity.date && (
                <div className="dc-date">📅 {activity.date.slice(0, 10)}</div>
              )}
            </a>
          ))
        )}
      </div>
    </div>
  )
}
