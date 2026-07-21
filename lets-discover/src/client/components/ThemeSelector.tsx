interface ThemeSelectorProps {
  activeTheme: string | null
  onSelect: (theme: string | null) => void
  loading?: boolean
}

const THEMES = [
  { id: 'adventure', label: 'Adventure', icon: '🏔️' },
  { id: 'culture', label: 'Culture', icon: '🎨' },
  { id: 'food', label: 'Food', icon: '🍜' },
  { id: 'nightlife', label: 'Nightlife', icon: '🌙' },
]

export function ThemeSelector({ activeTheme, onSelect, loading }: ThemeSelectorProps) {
  return (
    <div className="theme-selector">
      <div className="theme-track">
        <button
          className={`theme-chip ${activeTheme === null ? 'theme-active' : ''}`}
          onClick={() => onSelect(null)}
        >
          ✨ All
        </button>
        {THEMES.map((theme) => (
          <button
            key={theme.id}
            className={`theme-chip ${activeTheme === theme.id ? 'theme-active' : ''}`}
            onClick={() => onSelect(theme.id)}
            disabled={loading}
          >
            <span className="theme-chip-icon">{theme.icon}</span>
            <span className="theme-chip-label">{theme.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export const THEME_IDS = THEMES.map((t) => t.id)
