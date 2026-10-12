import type { ReflectionRequest, ReflectionResult } from './types'

export interface AiProvider {
  readonly name: string
  generate(input: {
    system: string
    user: string
    temperature?: number
    maxTokens?: number
  }): Promise<string>
}

export class ProviderError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'ProviderError'
  }
}

/**
 * Groq chat-completions provider. The API key is read from the server
 * environment only — it must never be exposed with a NEXT_PUBLIC_ prefix.
 */
export class GroqProvider implements AiProvider {
  readonly name = 'groq'

  constructor(
    private readonly apiKey: string,
    private readonly model = process.env.GROQ_MODEL || 'openai/gpt-oss-20b'
  ) {}

  async generate(input: {
    system: string
    user: string
    temperature?: number
    maxTokens?: number
  }): Promise<string> {
    let response: Response
    try {
      response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          temperature: input.temperature ?? 0.55,
          max_completion_tokens: input.maxTokens ?? 900,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: input.system },
            { role: 'user', content: input.user },
          ],
        }),
        signal: AbortSignal.timeout(45_000),
      })
    } catch {
      throw new ProviderError('The reflection service could not be reached.', 504)
    }
    if (!response.status) {
      throw new ProviderError('The reflection service could not be reached.', 504)
    }
    if (!response.ok) {
      if (process.env.MIRAAI_DEBUG === '1') {
        const detail = await response.text().catch(() => '')
        console.warn(`[miraai] provider HTTP ${response.status}:`, detail.slice(0, 500))
      }
      throw new ProviderError(
        response.status === 429
          ? 'The reflection service is busy right now. Please try again in a moment.'
          : 'The reflection service is unavailable right now.',
        502
      )
    }
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const content = data.choices?.[0]?.message?.content
    if (!content) throw new ProviderError('The reflection service returned an empty response.', 502)
    return content
  }
}

/** Server-side factory. Throws when no provider is configured. */
export function getProvider(): AiProvider {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new ProviderError('AI reflections are not configured yet.', 503)
  return new GroqProvider(key)
}

export type { ReflectionRequest, ReflectionResult }
