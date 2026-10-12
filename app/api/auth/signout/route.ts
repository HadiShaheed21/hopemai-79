import { NextResponse } from 'next/server'
import { createSupabaseServerClient, isSupabaseConfigured } from '../../../../lib/supabase/server'

export async function POST() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Persistence is not configured yet.' }, { status: 503 })
  }

  const supabase = createSupabaseServerClient()
  const { error } = await supabase.auth.signOut()
  if (error) return NextResponse.json({ error: 'Could not sign you out.' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
