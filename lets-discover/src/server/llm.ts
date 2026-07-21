const LLM_URL = process.env.LLM_URL || 'http://localhost:8040'
const LLM_MODEL = process.env.LLM_MODEL || 'gemma-4-e2b'

const SYSTEM_PROMPT = `You are a warm, knowledgeable city companion. You help people discover places, events, and things to do.

Guidelines:
- Keep replies to 1-3 short, natural sentences.
- When given search results in the context (prefixed with "Here are live search results"), use them to answer the user's question directly — mention names and locations.
- When given suggestions (prefixed with "Suggest:"), weave them into your reply naturally.
- If you don't have info to answer a question, say so briefly and offer to help with something else.
- Be warm, conversational, and specific. Avoid generic suggestions.`

export interface LlmResponse {
  text: string
}

export async function chat(
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[],
  options?: { temperature?: number; maxTokens?: number; context?: string }
): Promise<LlmResponse> {
  // Ensure system prompt is first
  const hasSystem = messages[0]?.role === 'system'
  const fullMessages = hasSystem
    ? messages
    : [{ role: 'system' as const, content: SYSTEM_PROMPT }, ...messages]

  // Inject discovery context as a second developer message when provided
  if (options?.context) {
    fullMessages.splice(1, 0, { role: 'system' as const, content: options.context })
  }

  const body = {
    model: LLM_MODEL,
    messages: fullMessages.map((m) => ({
      role: m.role === 'system' ? 'developer' : m.role,
      content: m.content,
    })),
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.maxTokens ?? 512,
    stream: false,
  }

  const res = await fetch(`${LLM_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`LLM error ${res.status}: ${err}`)
  }

  const data = await res.json()
  return { text: data.choices?.[0]?.message?.content || '' }
}

export async function extractPersonaFromChat(
  messages: { role: string; content: string }[]
): Promise<{
  city?: string
  vibe?: string
  interests: string[]
  shortTermGoals: string[]
  longTermGoals: string[]
  hobbies: string[]
  summary?: string
  colorProfile?: { hue: 'pink' | 'blue'; intensity: 'soft' | 'medium' | 'vibrant' }
  shortTermBullets: string[]
  longTermBullets: string[]
  hobbyBullets: string[]
}> {
  const chatHistory = messages
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n')

  const extractionPrompt = `Based on the following conversation, extract the user's persona as JSON only (no markdown, no explanation):

{
  "city": "city name or null if unknown",
  "vibe": "clubber | chill | active | curious | unknown",
  "interests": ["interest1", "interest2"],
  "shortTermGoals": ["raw goal token 1", "raw goal token 2"],
  "longTermGoals": ["raw goal token 1"],
  "hobbies": ["raw hobby token 1"],
  "summary": "one sentence summary of who this person is",
  "colorProfile": {
    "hue": "pink or blue",
    "intensity": "soft, medium, or vibrant"
  },
  "shortTermBullets": ["emoji + brief 1st person bullet, mention neighborhoods or specifics if known"],
  "longTermBullets": ["emoji + brief 1st person bullet"],
  "hobbyBullets": ["emoji + brief 1st person bullet about the hobby"]
}

Bullet rules:
- Each bullet STARTS with one emoji, then a space, then the sentence.
- Use 1st person, natural language. Be specific: mention neighborhoods, times, venues if the user said them.
- Examples:
  shortTermBullets: ["🧗 Find a bouldering spot near Prenzlauer Berg", "🍜 Try the ramen place everyone's talking about in Mitte"]
  longTermBullets: ["🇩🇪 Reach conversational German by Christmas", "🏠 Find a long-term flat with a balcony"]
  hobbyBullets: ["🧗 Climbing 3× a week at the local hall", "🎷 Catching live jazz whenever there's a gig"]
- If nothing is known yet, use empty arrays []. Do NOT invent.

Conversation:
${chatHistory}

JSON:`

  try {
    const res = await fetch(`${LLM_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [{ role: 'user', content: extractionPrompt }],
        temperature: 0.1,
        max_tokens: 512,
        stream: false,
      }),
    })

    if (!res.ok) return defaultPersona()

    const data = await res.json()
    const text = data.choices?.[0]?.message?.content || ''
    // Try to parse JSON from response (handle markdown wrapping)
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return { ...defaultPersona(), ...JSON.parse(jsonMatch[0]) }
    }
    return defaultPersona()
  } catch {
    return defaultPersona()
  }
}

function defaultPersona() {
  return {
    city: undefined,
    vibe: 'unknown',
    interests: [],
    shortTermGoals: [],
    longTermGoals: [],
    hobbies: [],
    summary: undefined,
    colorProfile: { hue: 'blue' as const, intensity: 'soft' as const },
    shortTermBullets: [],
    longTermBullets: [],
    hobbyBullets: [],
  }
}
