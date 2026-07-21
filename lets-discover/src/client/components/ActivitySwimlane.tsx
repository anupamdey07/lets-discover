import type { Activity } from '../../shared/types'

interface ActivitySwimlaneProps {
  activities: Activity[]
  loading?: boolean
}

const SOURCE_LABELS: Record<string, string> = {
  searxng: '🔍',
  luma: '⭐',
  raus: '🎷',
  eventim: '🎫',
  handpicked: '✋',
}

const CATEGORY_ICONS: Record<string, string> = {
  nightlife: '🌙',
  music: '🎵',
  sports: '⚽',
  tech: '💻',
  art: '🎨',
  food: '🍜',
  wellness: '🧘',
  learning: '📚',
  networking: '🤝',
  general: '✨',
}

export function ActivitySwimlane({ activities, loading }: ActivitySwimlaneProps) {
  if (loading && activities.length === 0) {
    return (
      <div className="swimlane-compact">
        <div className="swimlane-top-bar">
          <span className="swimlane-top-label">🔍 discovering...</span>
        </div>
        <div className="swimlane-track">
          {[1, 2, 3].map((i) => (
            <div key={i} className="swimlane-skeleton" />
          ))}
        </div>
      </div>
    )
  }

  if (activities.length === 0) return null

  return (
    <div className="swimlane-compact">
      <div className="swimlane-top-bar">
        <span className="swimlane-top-label">
          🎵 discovering {activities.length > 0 ? `${activities.length} things` : ''}
        </span>
        <span className="swimlane-top-hint">scroll →</span>
      </div>
      <div className="swimlane-track">
        {activities.slice(0, 15).map((activity) => (
          <a
            key={activity.id}
            href={activity.url || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="swimlane-card"
          >
            <span className="swimlane-card-icon">
              {CATEGORY_ICONS[activity.category || 'general'] || '✨'}
            </span>
            <span className="swimlane-card-text">{activity.title}</span>
            <span className="swimlane-card-source">
              {activity.source === 'searxng' ? '' : SOURCE_LABELS[activity.source] || ''}
            </span>
          </a>
        ))}
      </div>
    </div>
  )
}
