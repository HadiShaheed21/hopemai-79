import { NextResponse } from 'next/server'
import { createSupabaseServerClient, isSupabaseConfigured } from '../../../lib/supabase/server'
import { createJourneyService, JourneyError } from '../../../lib/journey'
import type { DayInput, ReflectionCard } from '../../../lib/journey.types'
import type { ReflectionBlock, BlockValue } from '../../../lib/ai/types'

export async function GET() {
  // Unauthenticated or unconfigured → no journey to return (never leaks anything).
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ journey: null })
  }

  const supabase = createSupabaseServerClient()
  const { data: { session } = {} } = await supabase.auth.getSession()
  const customerId = session?.user?.id
  if (!customerId) {
    return NextResponse.json({ journey: null })
  }

  const journeyService = createJourneyService(supabase)
  let journey: import('../../../lib/journey.types').Journey | null = null
  try {
    journey = await journeyService.getJourney(customerId)
  } catch (error) {
    if (error instanceof JourneyError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Could not load your journey.' }, { status: 500 })
  }

  return NextResponse.json({ journey })
}

export async function PATCH(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Persistence is not configured yet. Add your Supabase keys to .env.local.' }, { status: 503 })
  }

  const supabase = createSupabaseServerClient()
  const { data: { session } = {} } = await supabase.auth.getSession()
  const customerId = session?.user?.id
  if (!customerId) {
    return NextResponse.json({ error: 'You must sign in first.' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const payload = body as {
    day?: number
    input?: Partial<DayInput>
    aiOutput?: Partial<ReflectionCard>
    name?: string
    email?: string | null
  }

  const journeyService = createJourneyService(supabase)

  const day = payload.day
  const input: DayInput | null =
    typeof day === 'number' && Number.isInteger(day) && day >= 1 && day <= 7
      ? {
          day,
          activity: typeof payload.input?.activity === 'string' ? payload.input.activity : '',
          choice: typeof payload.input?.choice === 'string' ? payload.input.choice : '',
          choices: Array.isArray(payload.input?.choices) ? payload.input.choices : [],
          response: typeof payload.input?.response === 'string' ? payload.input.response : '',
          fields: Object.fromEntries(
            Object.entries(payload.input?.fields && typeof payload.input.fields === 'object' && !Array.isArray(payload.input.fields)
              ? (payload.input.fields as Record<string, unknown>)
              : {})
              .map(([k, v]) => [k, typeof v === 'string' ? v : ''])
              .filter(([, v]) => v.length > 0)
          ) as Record<string, string>,
          savedAt: new Date().toISOString(),
        }
      : null

  const aiOutput: ReflectionCard | null =
    input !== null
      ? {
          outputType: typeof payload.aiOutput?.outputType === 'string' ? payload.aiOutput.outputType : '',
          title: typeof payload.aiOutput?.title === 'string' ? payload.aiOutput.title : '',
          blocks: sanitizeReflectionCardBlocks(payload.aiOutput?.blocks),
          reflection: typeof payload.aiOutput?.reflection === 'string' ? payload.aiOutput.reflection : '',
          reminder: typeof payload.aiOutput?.reminder === 'string' ? payload.aiOutput.reminder : '',
          safetyFlag: payload.aiOutput?.safetyFlag === true,
          language: typeof payload.aiOutput?.language === 'string' ? payload.aiOutput.language : undefined,
        }
      : null

  // Normalize one raw block (object or scalar) into the ReflectionBlock shape.
  function sanitizeReflectionCardBlocks(raw: unknown): ReflectionBlock[] {
    if (!Array.isArray(raw)) return []
    return raw.map((b) => {
      if (typeof b !== 'object' || b === null) return { key: '', label: '', value: '' }
      const map = b as Record<string, unknown>
      return {
        key: typeof map.key === 'string' ? map.key : '',
        label: typeof map.label === 'string' ? map.label : '',
        value: map.value as BlockValue,
      }
    })
  }

  // Persist a day's input + AI output, advancing the journey state.
  if (input && aiOutput) {
    try {
      const result = await journeyService.saveDay({
        customer_id: customerId,
        name: payload.name ?? '',
        email: payload.email ?? null,
        journey_start_date: new Date().toISOString().slice(0, 10),
        day: day ?? 1,
        input,
        aiOutput,
      })
      return NextResponse.json({ journey: result })
    } catch (error) {
      if (error instanceof JourneyError) {
        return NextResponse.json({ error: error.message }, { status: error.status })
      }
      return NextResponse.json({ error: 'Could not save your journey.' }, { status: 500 })
    }
  }

  // Only profile fields were provided (no day data).
  if (payload.name !== undefined || payload.email !== undefined) {
    try {
      const result = await journeyService.updateProfile(customerId, {
        name: payload.name,
        email: payload.email,
      })
      return NextResponse.json({ journey: result })
    } catch (error) {
      if (error instanceof JourneyError) {
        return NextResponse.json({ error: error.message }, { status: error.status })
      }
      return NextResponse.json({ error: 'Could not save your journey.' }, { status: 500 })
    }
  }

  return NextResponse.json({ journey: null })
}
