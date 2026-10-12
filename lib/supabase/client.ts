import { createBrowserClient } from '@supabase/ssr'

/**
 * Browser-safe Supabase client.
 *
 * Only the anon key (NEXT_PUBLIC_SUPABASE_ANON_KEY) is used here. The
 * service-role key is NEVER exposed to the client — all data access goes
 * through server-side route handlers.
 */
export function createSupabaseBrowserClient() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not configured.')
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is not configured.')
  }
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
}
