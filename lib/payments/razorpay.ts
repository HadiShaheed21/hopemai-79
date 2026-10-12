/**
 * SERVER-ONLY Razorpay helpers.
 *
 * This module reads Razorpay secrets from the server environment and MUST NOT
 * be imported by any client component. It is only used inside `app/api/**`
 * route handlers.
 *
 * - Orders are created here for a FIXED price (MIRAAI_PRICE_PAISE, default 7900
 *   = ₹79). The browser never supplies an amount.
 * - Payment signatures are verified with Razorpay's official HMAC-SHA256 method
 *   (implemented with node:crypto so it is deterministic and unit-testable;
 *   this is byte-for-byte the same algorithm Razorpay documents and its SDK uses
 *   internally). Webhook signatures use the same method.
 * - No card data ever touches this code — Razorpay Checkout handles card entry.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import Razorpay from 'razorpay'

export function isRazorpayConfigured(): boolean {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)
}

/** Single source of truth for the price. ₹79 = 7900 paise. */
export function getPricePaise(): number {
  const n = Number(process.env.MIRAAI_PRICE_PAISE)
  return Number.isInteger(n) && n > 0 ? n : 7900
}

export function getCurrency(): string {
  return 'INR'
}

let instance: InstanceType<typeof Razorpay> | null = null
function getRazorpay(): InstanceType<typeof Razorpay> {
  const keyId = process.env.RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET
  if (!keyId || !keySecret) {
    throw new Error('Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (server-only).')
  }
  if (!instance) instance = new Razorpay({ key_id: keyId, key_secret: keySecret })
  return instance
}

/** Constant-time comparison of two hex strings. */
function safeEqualHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const bufA = Buffer.from(a, 'hex')
  const bufB = Buffer.from(b, 'hex')
  if (bufA.length === 0 || bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/** Create a Razorpay order for the fixed MIRAAI price, tagged with the customer. */
export async function createOrder(args: { customerId: string; receipt: string }): Promise<{ id: string; amount: number; currency: string }> {
  const order = await getRazorpay().orders.create({
    amount: getPricePaise(),
    currency: getCurrency(),
    receipt: args.receipt.slice(0, 40),
    notes: { customer_id: args.customerId, product: 'miraai_7day' },
    payment_capture: 1,
  }) as unknown as { id: string; amount: number; currency: string }
  return order
}

/**
 * Verify a Razorpay Checkout callback signature.
 * Official method: HMAC_SHA256(order_id + "|" + payment_id, key_secret) === signature.
 */
export function verifyCheckoutSignature(args: { orderId: string; paymentId: string; signature: string }): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET
  if (!secret) return false
  if (!args.orderId || !args.paymentId || !args.signature) return false
  const expected = createHmac('sha256', secret).update(`${args.orderId}|${args.paymentId}`).digest('hex')
  return safeEqualHex(expected, args.signature)
}

/** Verify a Razorpay webhook signature: HMAC_SHA256(raw_body, webhook_secret) === signature. */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret || !signature) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  return safeEqualHex(expected, signature)
}

export interface FetchedPayment {
  id: string
  order_id: string
  amount: number
  currency: string
  status: string
}

/** Fetch a payment from Razorpay to independently confirm amount/currency/status. */
export async function fetchPayment(paymentId: string): Promise<FetchedPayment> {
  const p = await getRazorpay().payments.fetch(paymentId) as unknown as FetchedPayment
  return p
}

export interface FetchedOrder {
  id: string
  amount: number
  currency: string
  status: string
  notes: Record<string, string>
}

/**
 * Fetch an order from Razorpay. Used server-side to confirm ORDER OWNERSHIP:
 * the order's `notes.customer_id` must match the signed-in customer, which
 * prevents one customer from replaying another customer's valid
 * (order, payment, signature) triple to unlock their own account.
 */
export async function fetchOrder(orderId: string): Promise<FetchedOrder> {
  const o = await getRazorpay().orders.fetch(orderId) as unknown as FetchedOrder
  return o
}

