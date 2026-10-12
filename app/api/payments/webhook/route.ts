import { NextResponse } from 'next/server'
import { isSupabaseConfigured } from '../../../../lib/supabase/server'
import { verifyWebhookSignature, fetchOrder, getPricePaise, getCurrency } from '../../../../lib/payments/razorpay'
import { grantEntitlement } from '../../../../lib/payments/entitlement'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Razorpay webhook — the AUTHORITATIVE access grant (no browser involved).
 *
 * - Verifies the webhook signature over the RAW request body.
 * - Maps the paid order to its owner via order.notes.customer_id (there is no
 *   user session in a webhook).
 * - Confirms amount + currency, then grants access. Idempotent: duplicate or
 *   out-of-order events are safe (grant is monotonic, keyed by customer).
 */
export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Persistence is not configured yet.' }, { status: 503 })
  }

  const signature = request.headers.get('x-razorpay-signature')
  const rawBody = await request.text()

  if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
    console.warn('[miraai] webhook received but RAZORPAY_WEBHOOK_SECRET is not set')
    return NextResponse.json({ error: 'Webhook not configured.' }, { status: 503 })
  }
  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 })
  }

  let event: { event?: string; payload?: Record<string, { entity?: Record<string, unknown> }> }
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid payload.' }, { status: 400 })
  }

  const type = event.event ?? ''
  const paymentEntity = event.payload?.payment?.entity
  const orderEntity = event.payload?.order?.entity

  // Only act on confirmed captures / paid orders.
  const relevant =
    type === 'payment.captured' ||
    type === 'payment.authorized' ||
    type === 'order.paid'
  if (!relevant) {
    return NextResponse.json({ ok: true, ignored: type })
  }

  const orderId = String(paymentEntity?.order_id ?? orderEntity?.id ?? '')
  const paymentId = String(paymentEntity?.id ?? '')
  if (!orderId) {
    return NextResponse.json({ ok: true, ignored: 'no order id' })
  }

  try {
    // Ownership + amount come from the order (signed payload is authentic, but
    // we still fetch the order to read notes.customer_id for the owner).
    const order = await fetchOrder(orderId)
    const customerId = order?.notes?.customer_id
    if (!customerId) {
      return NextResponse.json({ ok: true, ignored: 'order has no owner' })
    }
    const amountPaise = Number(orderEntity?.amount_paid ?? orderEntity?.amount ?? order.amount ?? 0)
    const currency = String(order.currency ?? getCurrency())
    if (amountPaise !== getPricePaise() || currency !== getCurrency()) {
      return NextResponse.json({ ok: true, ignored: 'amount/currency mismatch' })
    }

    await grantEntitlement({
      customerId,
      orderId,
      paymentId: paymentId || orderId,
      amountPaise,
      currency,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.warn('[miraai] webhook processing failed:', e instanceof Error ? e.message : e)
    // 500 so Razorpay retries later; grant is idempotent so a retry is safe.
    return NextResponse.json({ error: 'Processing failed.' }, { status: 500 })
  }
}
