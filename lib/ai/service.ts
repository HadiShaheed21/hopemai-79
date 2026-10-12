import { getProvider, ProviderError } from './provider'
import { SPECS, buildSystemPrompt, buildUserPrompt, detectLanguage } from './prompts'
import { collectUserText, containsCrisisLanguage, safetyResult } from './safety'
import type { HistoryItem, ReflectionRequest, ReflectionResult } from './types'
import { fallbackResult, validateAiResponse } from './validate'

export class InputError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
    this.name = 'InputError'
  }
}

const cap = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

/** Normalize + bound everything the client sends before it reaches prompts. */
export function sanitizeRequest(raw: unknown): ReflectionRequest {
  if (!raw || typeof raw !== 'object') throw new InputError('Invalid request.')
  const body = raw as Record<string, unknown>
  const day = Number(body.day)
  if (!Number.isInteger(day) || day < 1 || day > 7) {
    throw new InputError('Choose a day between 1 and 7.')
  }
  const fields: Record<string, string> = {}
  if (body.fields && typeof body.fields === 'object' && !Array.isArray(body.fields)) {
    for (const [key, value] of Object.entries(body.fields as Record<string, unknown>)) {
      const text = cap(value, 1200)
      if (text) fields[cap(key, 60)] = text
    }
  }
  const choices = Array.isArray(body.choices)
    ? body.choices.map(v => cap(v, 120)).filter(Boolean).slice(0, 12)
    : []
  const history: HistoryItem[] = Array.isArray(body.history)
    ? body.history.slice(0, 7).map(item => {
        const entry = (item ?? {}) as Record<string, unknown>
        const entryFields: Record<string, string> = {}
        if (entry.fields && typeof entry.fields === 'object') {
          for (const [k, v] of Object.entries(entry.fields as Record<string, unknown>)) {
            const text = cap(v, 600)
            if (text) entryFields[cap(k, 60)] = text
          }
        }
        return {
          day: Number(entry.day) || 0,
          title: cap(entry.title, 80),
          choice: cap(entry.choice, 400),
          response: cap(entry.response, 900),
          fields: entryFields,
          reflection: cap(entry.reflection, 900),
          reminder: cap(entry.reminder, 400),
          date: cap(entry.date, 40),
        }
      })
    : []

  const request: ReflectionRequest = {
    day,
    activity: cap(body.activity, 80),
    choice: cap(body.choice, 400),
    choices,
    response: cap(body.response, 1400),
    fields,
    history,
  }

  const hasContent = Boolean(
    request.choice ||
      request.response ||
      request.choices?.length ||
      Object.keys(request.fields ?? {}).length ||
      (day === 7 && request.history?.length)
  )
  if (!hasContent) {
    throw new InputError('Add or select something before creating a reflection.')
  }
  return request
}

/**
 * The full pipeline:
 * input -> validation -> safety check -> day-specific prompt -> model
 *       -> response validation -> safe retry -> controlled fallback.
 */
export async function generateReflection(
  request: ReflectionRequest,
  onRetryPrompt?: (attempt: number) => void
): Promise<ReflectionResult> {
  // Safety first: stop the normal flow if the person expresses immediate danger.
  if (containsCrisisLanguage(collectUserText(request))) {
    return safetyResult(detectLanguage(`${request.response ?? ''} ${request.choice ?? ''}`))
  }

  const spec = SPECS[request.day]
  if (!spec) throw new InputError('Choose a day between 1 and 7.')

  const language = detectLanguage(
    [request.response, request.choice, ...(request.choices ?? []), ...Object.values(request.fields ?? {})]
      .filter(Boolean)
      .join(' ')
  )
  const system = buildSystemPrompt(spec, language)
  const user = buildUserPrompt(request, spec)
  const provider = getProvider()

  // gpt-oss is a reasoning model: it spends hidden tokens "thinking" before it
  // emits JSON. The Day 7 report is long (nine grounded sections + journey
  // digest), so it needs a much larger completion budget than the short daily
  // cards — otherwise the model exhausts the budget mid-reason and returns
  // empty JSON (HTTP 400 json_validate_failed). Days 1-6 get modest headroom.
  const maxTokens = request.day === 7 ? 3600 : 1400

  const attempts = 2
  for (let attempt = 1; attempt <= attempts; attempt++) {
    onRetryPrompt?.(attempt)
    let raw: string
    try {
      raw = await provider.generate({
        system,
        user:
          attempt === 1
            ? user
            : `${user}\n\nYour previous reply was incomplete or off-shape. Return ONLY the exact JSON object requested, with every field filled from the data above.`,
        temperature: attempt === 1 ? 0.55 : 0.3,
        maxTokens,
      })
    } catch (error) {
      if (error instanceof ProviderError) throw error
      throw new ProviderError('Could not create your reflection right now.', 500)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      continue // invalid JSON -> retry
    }
    if (parsed && typeof parsed === 'object' && (parsed as Record<string, unknown>).safetyFlag === true) {
      return safetyResult(language)
    }
    const valid = validateAiResponse(request.day, parsed, request, language)
    if (valid) return valid
    if (process.env.MIRAAI_DEBUG === '1') {
      console.warn(`[miraai] day ${request.day} attempt ${attempt} failed validation. Raw:`, raw.slice(0, 1200))
    }
  }
  // Controlled fallback: restate the customer's own words in the day's card
  // shape. Never crashes, never invents.
  return fallbackResult(request, language)
}
