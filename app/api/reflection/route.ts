import { NextResponse } from 'next/server'
import { InputError, generateReflection, sanitizeRequest } from '../../../lib/ai/service'
import { ProviderError } from '../../../lib/ai/provider'
import { createSupabaseServerClient, isSupabaseConfigured } from '../../../lib/supabase/server'
import { createJourneyService, JourneyError, type SaveDayArgs, type DayInput } from '../../../lib/journey'
import { isEntitled } from '../../../lib/payments/entitlement'
import { isRazorpayConfigured } from '../../../lib/payments/razorpay'
import type { ReflectionRequest } from '../../../lib/ai/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function buildDayInput(request: ReflectionRequest): DayInput {
  return {
    day: request.day,
    activity: request.activity ?? '',
    choice: request.choice ?? '',
    choices: request.choices ?? [],
    response: request.response ?? '',
    fields: request.fields ?? {},
    language: 'en',
    savedAt: new Date().toISOString(),
  }
}

export async function POST(request: Request) {
  // When Supabase is configured, the reflection is tied to the signed-in
  // customer and saved to their journey. Without Supabase configured, the AI
  // engine still runs — there is simply nowhere to persist yet.
  let supabase: ReturnType<typeof createSupabaseServerClient> | null = null
  let customerId: string | null = null
  if (isSupabaseConfigured()) {
    supabase = createSupabaseServerClient()
    const { data: { session } = {} } = await supabase.auth.getSession()
    customerId = session?.user?.id ?? null
    if (!customerId) {
      return NextResponse.json({ error: 'Sign in to continue your reflection.' }, { status: 401 })
    }
    // Server-side access gate: when payments are enforced, only a customer with
    // a verified entitlement may generate a reflection. Hiding the UI is not the
    // only defense — this is the real enforcement. Off by default so existing
    // behavior and tests are unchanged until PAYMENTS_ENFORCE=1.
    if (process.env.PAYMENTS_ENFORCE === '1' && isRazorpayConfigured()) {
      const entitled = await isEntitled(customerId)
      if (!entitled) {
        return NextResponse.json(
          { error: 'Unlock MIRAAI to begin your seven-day journey.' },
          { status: 402 }
        )
      }
    }
  } else {
    console.warn('[miraai] Supabase not configured — this reflection will not be persisted.')
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  try {
    const sanitized = sanitizeRequest(body)
    const result = await generateReflection(sanitized)

    // Persist the day's input + AI output to the customer's journey.
    // If saving fails, the reflection is still returned — persistence here is
    // a safety net; the explicit "Save this card" PATCH is the primary write.
    try {
      if (supabase && customerId) {
        const journeyService = createJourneyService(supabase)
        const input: DayInput = {
          day: sanitized.day,
          activity: sanitized.activity ?? '',
          choice: sanitized.choice ?? '',
          choices: sanitized.choices ?? [],
          response: sanitized.response ?? '',
          fields: sanitized.fields ?? {},
          language: result.language ?? 'en',
          savedAt: new Date().toISOString(),
        }
        await journeyService.saveDay({
          customer_id: customerId,
          day: sanitized.day,
          input,
          aiOutput: result,
        })
      }
    } catch (saveError) {
      console.warn('[miraai] journey save failed:', saveError)
    }

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof InputError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof ProviderError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json(
      { error: 'Could not create your reflection right now. Please try again.' },
      { status: 500 }
    )
  }
}

