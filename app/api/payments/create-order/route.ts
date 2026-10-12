import { NextResponse } from 'next/server'
import { createSupabaseServerClient, isSupabaseConfigured } from '../../../../lib/supabase/server'
import { createOrder, getPricePaise, getCurrency, isRazorpayConfigured } from '../../../../lib/payments/razorpay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Create a Razorpay order for the FIXED MIRAAI price (₹79).
 *
 * - Requires an authenticated customer (the order is tagged with their id).
 * - The amount is a server constant; the browser never supplies it.
 * - Returns only the order id, amount, currency and the public Key ID. The
 *   Key SECRET is never sent to the client.
 */
export async function POST() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Persistence is not configured yet.' }, { status: 503 })
  }
  if (!isRazorpayConfigured()) {
    return NextResponse.json({ error: 'Payments are not configured yet.' }, { status: 503 })
  }

  const supabase = createSupabaseServerClient()
  const { data: { session } = {} } = await supabase.auth.getSession()
  const customerId = session?.user?.id
  if (!customerId) {
    return NextResponse.json({ error: 'Sign in to start your MIRAAI journey.' }, { status: 401 })
  }

  try {
    const order = await createOrder({ customerId, receipt: `miraai_${customerId.slice(0, 8)}_${Date.now()}` })
    return NextResponse.json({
      orderId: order.id,
      amount: order.amount ?? getPricePaise(),
      currency: order.currency ?? getCurrency(),
      keyId: process.env.RAZORPAY_KEY_ID,
      name: 'MIRAAI by HOPEMO AI',
      description: 'Your 7-day reflection journey',
    })
  } catch (e) {
    console.warn('[miraai] create-order failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 502 })
  }
}
