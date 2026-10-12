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

  const { email, password, name } = body as { email?: unknown; password?: unknown; name?: unknown }
  if (typeof email !== 'string' || !email.includes('@')) {
    return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 })
  }
  if (typeof password !== 'string' || password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 })
  }
  const sanitizedName = typeof name === 'string' ? name.slice(0, 120) : ''

  const supabase = createSupabaseServerClient()
  const { data: { session }, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name: sanitizedName } },
  })

  if (error) {
    const message = error.message.replace(/^User already registered: /, '')
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const customerId = session?.user?.id
  if (!customerId) {
    // Email confirmation is required on this project. The user should
    // verify the address first; we still report the outcome clearly.
    return NextResponse.json(
      { error: 'Check your inbox to confirm your email before continuing.' },
      { status: 401 }
    )
  }

  // Boot the journey row for the newly authenticated customer.
  const journeyService = createJourneyService(supabase)
  let journey
  try {
    journey = await journeyService.createJourney(
      buildJourneyInput({ customer_id: customerId, name: sanitizedName, email })
    )
  } catch (e) {
    if (e instanceof JourneyError) return NextResponse.json({ error: e.message }, { status: e.status })
    return NextResponse.json({ error: 'Could not start your journey.' }, { status: 500 })
  }

  return NextResponse.json({ session, journey })
}
