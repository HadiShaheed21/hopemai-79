import { createClient } from '@supabase/supabase-js'
import type { Database } from './database'

/**
 * PRIVILEGED server-only Supabase client (service-role key).
 *
 * This key BYPASSES Row Level Security, so it must only ever be used in
 * server-side route handlers / helpers — never imported by client components,
 * never prefixed with NEXT_PUBLIC_, and never returned to the browser.
 *
 * Its only purpose in MIRAAI is to write a customer's `entitlements` row after
 * a Razorpay payment has been verified. The client cannot do this because the
 * `entitlements` table has SELECT-only RLS (no write policies).
 */
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error(
      'Supabase admin client is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (server-only) in .env.local.'
    )
  }
  return createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function isSupabaseAdminConfigured(): boolean {
  return Boolean(
    (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL) &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}
