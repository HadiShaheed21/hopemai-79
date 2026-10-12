import { NextResponse } from 'next/server'
import { createSupabaseServerClient, isSupabaseConfigured } from '../../../../lib/supabase/server'
import { getEntitlement } from '../../../../lib/payments/entitlement'
import { isRazorpayConfigured } from '../../../../lib/payments/razorpay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Report the signed-in customer's access status.
 *  - entitled: whether they have a verified, active entitlement.
 *  - configured: whether payments are wired up (Razorpay keys present).
 *  - enforce: whether the paywall is currently switched on.
 * Never returns any secret.
 */
export async function GET() {
  const enforce = process.env.PAYMENTS_ENFORCE === '1'
  const configured = isRazorpayConfigured()

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ entitled: false, configured, enforce })
  }

  const supabase = createSupabaseServerClient()
  const { data: { session } = {} } = await supabase.auth.getSession()
  const customerId = session?.user?.id
  if (!customerId) {
    return NextResponse.json({ entitled: false, configured, enforce })
  }

  try {
    const entitlement = await getEntitlement(customerId)
    return NextResponse.json({ entitled: entitlement?.active === true, configured, enforce })
  } catch {
    return NextResponse.json({ entitled: false, configured, enforce })
  }
}
