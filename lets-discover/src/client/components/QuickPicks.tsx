interface QuickPick {
  id: string
  type: 'dish' | 'event' | 'place'
  emoji: string
  title: string
  subtitle: string
  url?: string
}

interface QuickPicksProps {
  picks: QuickPick[]
  loading?: boolean
}

export function QuickPicks({ picks, loading }: QuickPicksProps) {
  if (loading) {
    return (
      <div className="quick-picks">
        <div className="qp-header">
          <span className="qp-label">⚡ For you this week</span>
        </div>
        <div className="qp-track">
          {[1, 2, 3].map((i) => (
            <div key={i} className="qp-skeleton" />
          ))}
        </div>
      </div>
    )
  }

  if (picks.length === 0) return null

  return (
    <div className="quick-picks">
      <div className="qp-header">
        <span className="qp-label">⚡ For you this week</span>
        <span className="qp-hint">{picks.length} picks</span>
      </div>
      <div className="qp-track">
        {picks.map((pick) => (
          <a
            key={pick.id}
            href={pick.url || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="qp-card"
          >
            <span className="qp-emoji">{pick.emoji}</span>
            <div className="qp-info">
              <span className="qp-title">{pick.title}</span>
              <span className="qp-subtitle">{pick.subtitle}</span>
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}
