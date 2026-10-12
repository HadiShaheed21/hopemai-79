import { NextResponse } from 'next/server'
import { createSupabaseServerClient, isSupabaseConfigured } from '../../../../lib/supabase/server'
import { createJourneyService, buildJourneyInput, JourneyError } from '../../../../lib/journey'

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Persistence is not configured yet. Add your Supabase keys to .env.local.' }, { status: 503 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const { email, password } = body as { email?: unknown; password?: unknown }
  if (typeof email !== 'string' || !email.includes('@')) {
    return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 })
  }
  if (typeof password !== 'string' || password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 })
  }

  const supabase = createSupabaseServerClient()
  const { data: { session }, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    const message = error.message.replace(/^User not found: /, '')
    return NextResponse.json({ error: message }, { status: 401 })
  }

  const customerId = session?.user?.id
  if (!customerId) {
    return NextResponse.json({ error: 'Something went wrong signing you in.' }, { status: 401 })
  }

  // Return the customer's existing journey — or boot it on first sign-in.
  // Never overwrite an in-progress journey when a customer logs back in.
  const journeyService = createJourneyService(supabase)
  let journey
  try {
    journey = await journeyService.getJourney(customerId)
    if (!journey) {
      journey = await journeyService.createJourney(
        buildJourneyInput({
          customer_id: customerId,
          name: (session.user.user_metadata?.name as string | undefined) || '',
          email,
        })
      )
    }
  } catch (e) {
    if (e instanceof JourneyError) return NextResponse.json({ error: e.message }, { status: e.status })
    return NextResponse.json({ error: 'Could not start your journey.' }, { status: 500 })
  }

  return NextResponse.json({ session, journey })
}
