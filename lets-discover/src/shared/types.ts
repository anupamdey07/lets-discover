// ─── Persona ─────────────────────────────────────────────────────

export interface Persona {
  id: string
  sessionId: string
  city?: string
  vibe?: 'clubber' | 'chill' | 'active' | 'curious' | 'unknown'
  interests: string[]
  shortTermGoals: string[]
  longTermGoals: string[]
  hobbies: string[]
  summary?: string
  colorProfile?: {
    hue: 'pink' | 'blue'
    intensity: 'soft' | 'medium' | 'vibrant'
  }
  shortTermBullets: string[]
  longTermBullets: string[]
  hobbyBullets: string[]
  createdAt: string
  updatedAt: string
}

// ─── Messages ────────────────────────────────────────────────────

export interface Message {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

// ─── Events / Activities ─────────────────────────────────────────

export interface Activity {
  id: string
  title: string
  description?: string
  url?: string
  date?: string
  source: 'searxng' | 'luma' | 'raus' | 'eventim' | 'handpicked'
  category?: string
  matchedInterest?: string
}

// ─── API Types ───────────────────────────────────────────────────

export interface ChatRequest {
  sessionId?: string
  message: string
}

export interface ChatResponse {
  sessionId: string
  reply: string
}

export interface PersonaResponse {
  persona: Persona | null
  hasEnoughData: boolean
}

export interface ActivityResponse {
  activities: Activity[]
  generatedAt: string
}

// ─── Session ─────────────────────────────────────────────────────

export interface Session {
  id: string
  createdAt: string
  updatedAt: string
}
