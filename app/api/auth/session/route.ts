import { NextResponse } from 'next/server'
import { createSupabaseServerClient, isSupabaseConfigured } from '../../../../lib/supabase/server'

/** Lightweight session probe so the frontend can restore the signed-in customer on load. */
export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ authenticated: false, email: null, configured: false })
  }

  const supabase = createSupabaseServerClient()
  const { data: { session } = {} } = await supabase.auth.getSession()
  return NextResponse.json({
    authenticated: Boolean(session),
    email: session?.user?.email ?? null,
    configured: true,
  })
}