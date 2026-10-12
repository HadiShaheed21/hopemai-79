import { NextResponse } from 'next/server'
import { createSupabaseServerClient, isSupabaseConfigured } from '../../../../lib/supabase/server'
import {
  verifyCheckoutSignature,
  fetchPayment,
  fetchOrder,
  getPricePaise,
  getCurrency,
  isRazorpayConfigured,
} from '../../../../lib/payments/razorpay'
import { grantEntitlement } from '../../../../lib/payments/entitlement'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Verify a Razorpay Checkout callback and grant access.
 *
 * The browser success callback is NEVER treated as proof. This route:
 *   1. requires an authenticated customer,
 *   2. verifies the Razorpay signature (HMAC-SHA256),
 *   3. confirms ORDER OWNERSHIP (order.notes.customer_id === this customer),
 *   4. independently fetches the payment and confirms amount, currency and a
 *      captured/authorized status,
 *   5. only then grants the entitlement (idempotent).
 */
export async function POST(request: Request) {
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
    return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const { orderId, paymentId, signature } = (body ?? {}) as {
    orderId?: unknown; paymentId?: unknown; signature?: unknown
  }
  if (typeof orderId !== 'string' || typeof paymentId !== 'string' || typeof signature !== 'string') {
    return NextResponse.json({ error: 'Missing payment details.' }, { status: 400 })
  }

  // 2. Signature must be valid, else the callback is forged/replayed.
  if (!verifyCheckoutSignature({ orderId, paymentId, signature })) {
    return NextResponse.json({ error: 'Payment verification failed.' }, { status: 400 })
  }

  try {
    // 3. Order ownership: this order must belong to the signed-in customer.
    const order = await fetchOrder(orderId)
    if (!order || order.notes?.customer_id !== customerId) {
      return NextResponse.json({ error: 'This payment does not belong to your account.' }, { status: 403 })
    }

    // 4. Independently confirm the payment amount, currency and status.
    const payment = await fetchPayment(paymentId)
    const okAmount = payment.amount === getPricePaise()
    const okCurrency = payment.currency === getCurrency()
    const okStatus = payment.status === 'captured' || payment.status === 'authorized'
    const okOrder = payment.order_id === orderId
    if (!okAmount || !okCurrency || !okStatus || !okOrder) {
      return NextResponse.json({ error: 'Payment could not be confirmed.' }, { status: 402 })
    }

    // 5. Grant access (idempotent — safe to call again for the same payment).
    const entitlement = await grantEntitlement({
      customerId,
      orderId,
      paymentId,
      amountPaise: payment.amount,
      currency: payment.currency,
    })
    return NextResponse.json({ entitled: entitlement.active === true })
  } catch (e) {
    console.warn('[miraai] verify failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Could not verify your payment. Please try again.' }, { status: 502 })
  }
}
