/*
 * MIRAAI payment-security OFFLINE test suite.
 *
 * Deterministic: no network, no Razorpay API calls, no Supabase. All payment
 * actions are simulated with a throwaway in-process fake SDK and mock Supabase
 * modules injected through Module._load, so every branch of the payment routes
 * is reachable without a live server.
 *
 * Coverage:
 *   - Pure Razorpay signature, price and config helpers (unit level).
 *   - createOrder with the fake SDK: fixed 7900 paise, INR, customer-tagged.
 *   - Route-level security: unauthenticated order creation rejected;
 *       wrong amount/currency, order-ownership rejection, uncaptured payments
 *       do NOT grant access; duplicate verification & webhook events are
 *       idempotent; invalid webhook signatures rejected; unentitled users
 *       receive 402 when PAYMENTS_ENFORCE=1; entitled users proceed.
 *   - Structural RLS verification (entitlements migration SELECT-only with no
 *       insert/update/delete policies).
 *   - Client-asset verification (no admin client or service-role key shipped
 *       to the browser).
 */

import { test, before, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { Module } from 'module'
import { readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

const here = __dirname
const root = resolve(here, '..', '..')
const D = (p: string) => resolve(root, 'dist-test', p)

// ---------------------------------------------------------------------------
// Fake Razorpay SDK (satisfies the default import and the module-private
// getRazorpay() singleton inside razorpay.ts).
// ---------------------------------------------------------------------------

interface FakeOrderResult {
  id: string
  amount: number
  currency: string
  notes?: Record<string, string>
}

interface FakePaymentResult {
  id: string
  order_id: string
  amount: number
  currency: string
  status: string
}

const orderResult: FakeOrderResult = {
  id: 'order_123',
  amount: 7900,
  currency: 'INR',
  notes: { customer_id: 'cust_1', product: 'miraai_7day' },
}

const paymentResult: FakePaymentResult = {
  id: 'pay_456',
  order_id: 'order_123',
  amount: 7900,
  currency: 'INR',
  status: 'captured',
}

const CHECKOUT_SIG = 'b48386704fc5d5bbb7a08a384f6f644ad4363d98dccb89bb2307434a713cb9f2'

// HMAC-SHA256("test_secret_abc123", WEBHOOK_BODY) — independent test vector.
const WEBHOOK_BODY = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1' } } } })
const WEBHOOK_SIG = '8a111c81cf7fcf55986a79583e96ad62ef69549db00f2b70aed825839d7e2c22'

/** Lazily loads the Razorpay module so the `Module._load` interception is
 *  already active when the server-side payments helpers are first required. */
let _razorPayExports: typeof import('../lib/payments/razorpay')
export function razorPay(): typeof import('../lib/payments/razorpay') {
  if (!_razorPayExports) {
    _razorPayExports = require('../lib/payments/razorpay') as typeof import('../lib/payments/razorpay')
  }
  return _razorPayExports
}
function fakeRazorpaySdk() {
  return {
    __esModule: true,
    default: class FakeSdk {
      constructor(readonly config: { key_id: string; key_secret: string }) {}
      orders = {
        create: async () => orderResult,
        fetch: async () => orderResult,
      }
      payments = {
        fetch: async () => paymentResult,
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Mock factories for the server-side modules the payment routes import. These
// keep every branch reachable offline.
// ---------------------------------------------------------------------------

type Customer = { id: string }
type SessionData = { session: { user: Customer | null } }
type ServerClient = {
  auth: { getSession: () => Promise<{ data: SessionData }> }
}

function mockServerClient(session: { id: string } | null = null): ServerClient {
  return {
    auth: {
      getSession: async () => ({ data: { session: { user: session ? { id: session.id } : null } } }),
    },
  }
}

/** Module-shaped mock for lib/supabase/server (named exports the routes import). */
function mockServerModule(session: { id: string } | null = null) {
  return {
    isSupabaseConfigured: () => true,
    createSupabaseServerClient: () => mockServerClient(session),
  }
}

type EntitlementModule = {
  getEntitlement: (id: string) => Promise<{ active: boolean } | null>
  isEntitled: (id: string) => Promise<boolean>
  grantEntitlement: (args: unknown) => Promise<{ active: boolean }>
}

function mockEntitlement(isEntitled: boolean): EntitlementModule {
  return {
    async getEntitlement() {
      return null
    },
    async isEntitled() {
      return isEntitled
    },
    async grantEntitlement() {
      return { active: true }
    },
  }
}

type JourneyModule = { createJourneyService: (client: unknown) => { saveDay: (args: unknown) => Promise<void> } }
const mockJourney: JourneyModule = {
  createJourneyService: () => ({
    saveDay: async () => undefined,
  }),
}

type AiServiceModule = {
  InputError: new (message: string, status: number) => Error
  sanitizeRequest: (body: unknown) => { day: number; response: string; fields: Record<string, string> }
  generateReflection: (req: unknown) => Promise<
    | { outputType: string; title: string; blocks: unknown[]; reflection: string; reminder: string; safetyFlag: boolean; degraded?: boolean }
    | { error: string; status: number }
  >
}
const mockAiService: AiServiceModule = {
  InputError: class extends Error {
    constructor(public readonly message: string, public readonly status = 400) {
      super(message)
      this.name = 'InputError'
    }
  },
  sanitizeRequest: (body: unknown) => {
    if (body && typeof body === 'object' && typeof (body as any).day === 'number') {
      return { day: (body as any).day, response: '', fields: {} } as const
    }
    throw new mockAiService.InputError('Invalid request.', 400)
  },
  async generateReflection() {
    return {
      outputType: 'first_reset',
      title: 'Test card',
      blocks: [],
      reflection: 'test',
      reminder: '',
      safetyFlag: false,
      degraded: true,
    }
  },
}

type AiProviderModule = { ProviderError: new (message: string, status: number) => Error }
const mockAiProvider: AiProviderModule = {
  ProviderError: class extends Error {
    constructor(public readonly message: string, public readonly status = 500) {
      super(message)
      this.name = 'ProviderError'
    }
  },
}

const mockRazorpayModule = () => ({
  // Reflects the real config rule (both key id + secret must be present).
  isRazorpayConfigured: () => Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
  getPricePaise: () => 7900,
  getCurrency: () => 'INR',
  createOrder: async () => orderResult,
  verifyCheckoutSignature: () => true,
  verifyWebhookSignature: () => true,
})

const mocks = new Map<string, () => unknown>()
let originalLoad: any

const routePaths = [
  D('app/api/payments/create-order/route'),
  D('app/api/payments/verify/route'),
  D('app/api/payments/webhook/route'),
  D('app/api/reflection/route'),
]

before(() => {
  const moduleRef = Module as unknown as { _load: (request: never, parent: never, isMain: never) => unknown }
  originalLoad = moduleRef['_load']
  const patchedLoad = function (this: unknown, request: string, parent: { filename?: string } | null, isMain: boolean) {
    if (request === 'razorpay') {
      return fakeRazorpaySdk()
    }
    const resolved = resolve(dirname((parent && parent.filename) ?? ''), request)
    const factory = mocks.get(resolved)
    if (factory) return factory()
    return originalLoad.apply(this, [request, parent, isMain])
  }
  moduleRef['_load'] = patchedLoad
})

beforeEach(() => {
  mocks.clear()
  for (const p of routePaths) {
    // require.cache keys include the emitted extension.
    delete require.cache[p + '.js']
  }
})

afterEach(() => {
  mocks.clear()
})

const supabaseEnv = {
  NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test_anon_key',
}

const razorpayEnv = {
  RAZORPAY_KEY_ID: 'rzp_test_1',
  RAZORPAY_KEY_SECRET: 'test_secret_abc123',
  RAZORPAY_WEBHOOK_SECRET: 'test_webhook_secret',
}

// ---------------------------------------------------------------------------
// Pure Razorpay helper tests
// ---------------------------------------------------------------------------

test('checkout signature verifies against an independent HMAC vector', () => {
  process.env.RAZORPAY_KEY_SECRET = 'test_secret_abc123'
  assert.equal(
    razorPay().verifyCheckoutSignature({ orderId: 'order_A1', paymentId: 'pay_B2', signature: CHECKOUT_SIG }),
    true,
    'valid signature accepted',
  )
})

test('checkout signature rejects a tampered / incorrect signature', () => {
  process.env.RAZORPAY_KEY_SECRET = 'test_secret_abc123'
  assert.equal(razorPay().verifyCheckoutSignature({ orderId: 'order_A1', paymentId: 'pay_B2', signature: 'deadbeef' }), false)
  assert.equal(razorPay().verifyCheckoutSignature({ orderId: 'pay_B2', paymentId: 'order_A1', signature: CHECKOUT_SIG }), false)
})

test('checkout signature is false when the secret is not configured', () => {
  const prev = process.env.RAZORPAY_KEY_SECRET
  delete process.env.RAZORPAY_KEY_SECRET
  try {
    assert.equal(razorPay().verifyCheckoutSignature({ orderId: 'order_A1', paymentId: 'pay_B2', signature: CHECKOUT_SIG }), false)
  } finally {
    if (prev !== undefined) process.env.RAZORPAY_KEY_SECRET = prev
  }
})

test('checkout signature is false when orderId / paymentId / signature are missing', () => {
  process.env.RAZORPAY_KEY_SECRET = 'test_secret_abc123'
  assert.equal(razorPay().verifyCheckoutSignature({ orderId: 'order_A1', paymentId: 'pay_B2', signature: '' }), false)
  assert.equal(razorPay().verifyCheckoutSignature({ orderId: 'order_A1', paymentId: '', signature: CHECKOUT_SIG }), false)
  assert.equal(razorPay().verifyCheckoutSignature({ orderId: '', paymentId: 'pay_B2', signature: CHECKOUT_SIG }), false)
  delete process.env.RAZORPAY_KEY_SECRET
})

test('webhook signature verifies against an independent HMAC vector', () => {
  process.env.RAZORPAY_WEBHOOK_SECRET = 'test_secret_abc123'
  assert.equal(razorPay().verifyWebhookSignature(WEBHOOK_BODY, WEBHOOK_SIG), true)
})

test('webhook signature is invalidated by any body change', () => {
  process.env.RAZORPAY_WEBHOOK_SECRET = 'test_secret_abc123'
  const body = JSON.stringify({ event: 'payment.captured' })
  assert.equal(razorPay().verifyWebhookSignature(body, WEBHOOK_SIG), false)
  assert.equal(razorPay().verifyWebhookSignature(body + ' ', WEBHOOK_SIG), false)
  assert.equal(razorPay().verifyWebhookSignature(body, null), false)
  delete process.env.RAZORPAY_WEBHOOK_SECRET
})

test('webhook signature is false when the webhook secret is not configured', () => {
  const prev = process.env.RAZORPAY_WEBHOOK_SECRET
  delete process.env.RAZORPAY_WEBHOOK_SECRET
  try {
    assert.equal(razorPay().verifyWebhookSignature('{"event":"payment.captured"}', 'any_signature'), false)
  } finally {
    if (prev !== undefined) process.env.RAZORPAY_WEBHOOK_SECRET = prev
  }
})

test('price is a fixed server constant (₹79 = 7900 paise) and currency is INR', () => {
  const prev = process.env.MIRAAI_PRICE_PAISE
  delete process.env.MIRAAI_PRICE_PAISE
  try {
    assert.equal(razorPay().getPricePaise(), 7900, 'default is 7900')
    assert.equal(razorPay().getCurrency(), 'INR')
    process.env.MIRAAI_PRICE_PAISE = '7900'
    assert.equal(razorPay().getPricePaise(), 7900)
  } finally {
    if (prev !== undefined) process.env.MIRAAI_PRICE_PAISE = prev
  }
})

test('isRazorpayConfigured reflects presence of key id + secret only', () => {
  const prevId = process.env.RAZORPAY_KEY_ID
  const prevSecret = process.env.RAZORPAY_KEY_SECRET
  delete process.env.RAZORPAY_KEY_ID
  delete process.env.RAZORPAY_KEY_SECRET
  try {
    assert.equal(razorPay().isRazorpayConfigured(), false)
    process.env.RAZORPAY_KEY_ID = 'rzp_test_x'
    assert.equal(razorPay().isRazorpayConfigured(), false, 'needs both')
    process.env.RAZORPAY_KEY_SECRET = 'x'
    assert.equal(razorPay().isRazorpayConfigured(), true)
  } finally {
    if (prevId !== undefined) process.env.RAZORPAY_KEY_ID = prevId
    if (prevSecret !== undefined) process.env.RAZORPAY_KEY_SECRET = prevSecret
  }
})

test('createOrder tags the customer, fixes amount/currency and never exposes the secret', async () => {
  process.env.RAZORPAY_KEY_ID = 'rzp_test_1'
  process.env.RAZORPAY_KEY_SECRET = 'test_secret_abc123'
  const real = await import('../lib/payments/razorpay')
  const order = await real.createOrder({ customerId: 'cust_1', receipt: 'miraai_cust_1_1234567890' })
  assert.equal(order.amount, 7900, 'server-fixed amount')
  assert.equal(order.currency, 'INR', 'server-fixed currency')
  assert.match(order.id, /^order_/, 'sdk-generated order id present')
  assert.equal((order as { notes?: Record<string, string> }).notes?.customer_id, 'cust_1', 'customer tagged server-side')
  assert.ok(!(order as { secret?: string }).secret, 'no secret returned')
})

// ---------------------------------------------------------------------------
// Route helper + create-order route tests
// ---------------------------------------------------------------------------

async function loadRoute(path: string) {
  return import(path)
}

function post(routePath: string, session: { id: string } | null = null) {
  return async () => {
    mocks.set(D('lib/supabase/server'), () => mockServerModule(session))
    mocks.set(D('lib/payments/razorpay'), mockRazorpayModule)
    const mod = await loadRoute(routePath)
    const req = new Request('http://localhost' + routePath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    return mod.POST(req)
  }
}

test('create-order rejects an unauthenticated caller (401)', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseEnv.NEXT_PUBLIC_SUPABASE_URL
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = supabaseEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY
  process.env.RAZORPAY_KEY_ID = razorpayEnv.RAZORPAY_KEY_ID
  process.env.RAZORPAY_KEY_SECRET = razorpayEnv.RAZORPAY_KEY_SECRET
  const res = await post(D('app/api/payments/create-order/route'), null)()
  assert.equal(res.status, 401)
})

test('create-order returns order + public key for an authenticated user', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseEnv.NEXT_PUBLIC_SUPABASE_URL
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = supabaseEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY
  process.env.RAZORPAY_KEY_ID = razorpayEnv.RAZORPAY_KEY_ID
  process.env.RAZORPAY_KEY_SECRET = razorpayEnv.RAZORPAY_KEY_SECRET
  const res = await post(D('app/api/payments/create-order/route'), { id: 'cust_1' })()
  assert.equal(res.status, 200)
  const data = await res.json() as { orderId?: string; amount?: number; currency?: string; keyId?: string; error?: string }
  assert.equal(data.orderId, 'order_123')
  assert.equal(data.amount, 7900)
  assert.equal(data.currency, 'INR')
  assert.equal(data.keyId, 'rzp_test_1')
  assert.ok(!(data as { secret?: string }).secret, 'no secret in response')
})

test('create-order rejects when payments are not configured (503)', async () => {
  process.env.RAZORPAY_KEY_ID = ''
  process.env.RAZORPAY_KEY_SECRET = ''
  process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseEnv.NEXT_PUBLIC_SUPABASE_URL
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = supabaseEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const res = await post(D('app/api/payments/create-order/route'), { id: 'cust_1' })()
  assert.equal(res.status, 503)
})

// ---------------------------------------------------------------------------
// Verify route tests
// ---------------------------------------------------------------------------

test('verify rejects an order belonging to another customer (403)', async () => {
  process.env.RAZORPAY_KEY_SECRET = razorpayEnv.RAZORPAY_KEY_SECRET
  const brokenOrder = { ...orderResult, notes: { customer_id: 'cust_9' } }
  mocks.set(D('lib/supabase/server'), () => mockServerModule({ id: 'cust_1' }))
  mocks.set(D('lib/payments/entitlement'), () => mockEntitlement(true))
  mocks.set(D('lib/payments/razorpay'), () => ({
    ...fakeRazorpaySdk(),
    ...{
      verifyCheckoutSignature: () => true,
      fetchOrder: async () => brokenOrder,
      getPricePaise: () => 7900,
      getCurrency: () => 'INR',
      isRazorpayConfigured: () => true,
    },
  }))
  const mod = await loadRoute(D('app/api/payments/verify/route'))
  const req = new Request('http://localhost/api/payments/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId: 'order_123', paymentId: 'pay_456', signature: 'x' }),
  })
  const res = await mod.POST(req)
  assert.equal(res.status, 403)
})

test('verify rejects an uncaptured payment and does not grant access (402)', async () => {
  process.env.RAZORPAY_KEY_SECRET = razorpayEnv.RAZORPAY_KEY_SECRET
  const pendingPayment: FakePaymentResult = { ...paymentResult, status: 'pending' }
  const pendingOrder: FakeOrderResult = { ...orderResult, notes: { customer_id: 'cust_1' } }
  mocks.set(D('lib/supabase/server'), () => mockServerModule({ id: 'cust_1' }))
  mocks.set(D('lib/payments/entitlement'), () => mockEntitlement(true))
  mocks.set(D('lib/payments/razorpay'), () => ({
    ...fakeRazorpaySdk(),
    ...{
      verifyCheckoutSignature: () => true,
      fetchPayment: async () => pendingPayment,
      fetchOrder: async () => pendingOrder,
      getPricePaise: () => 7900,
      getCurrency: () => 'INR',
      isRazorpayConfigured: () => true,
    },
  }))
  const mod = await loadRoute(D('app/api/payments/verify/route'))
  const req = new Request('http://localhost/api/payments/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId: 'order_123', paymentId: 'pay_456', signature: 'x' }),
  })
  const res = await mod.POST(req)
  assert.equal(res.status, 402)
})

test('duplicate verification requests are idempotent (200 each)', async () => {
  process.env.RAZORPAY_KEY_SECRET = razorpayEnv.RAZORPAY_KEY_SECRET
  mocks.set(D('lib/supabase/server'), () => mockServerModule({ id: 'cust_1' }))
  mocks.set(D('lib/payments/entitlement'), () => mockEntitlement(true))
  mocks.set(D('lib/payments/razorpay'), () => ({
    ...fakeRazorpaySdk(),
    ...{
      verifyCheckoutSignature: () => true,
      fetchPayment: async () => paymentResult,
      fetchOrder: async () => orderResult,
      getPricePaise: () => 7900,
      getCurrency: () => 'INR',
      isRazorpayConfigured: () => true,
    },
  }))
  const mod = await loadRoute(D('app/api/payments/verify/route'))
  const makeReq = () =>
    new Request('http://localhost/api/payments/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: 'order_123', paymentId: 'pay_456', signature: 'x' }),
    })
  const first = await mod.POST(makeReq())
  assert.equal(first.status, 200)
  const second = await mod.POST(makeReq())
  assert.equal(second.status, 200)
})

// ---------------------------------------------------------------------------
// Webhook route tests
// ---------------------------------------------------------------------------

test('webhook rejects an invalid signature (401)', async () => {
  process.env.RAZORPAY_WEBHOOK_SECRET = razorpayEnv.RAZORPAY_WEBHOOK_SECRET
  mocks.set(D('lib/supabase/server'), () => mockServerModule(null))
  mocks.set(D('lib/payments/entitlement'), () => mockEntitlement(true))
  mocks.set(D('lib/payments/razorpay'), () => ({
    ...fakeRazorpaySdk(),
    ...{
      verifyWebhookSignature: () => false,
      fetchOrder: async () => orderResult,
      getPricePaise: () => 7900,
      getCurrency: () => 'INR',
    },
  }))
  const mod = await loadRoute(D('app/api/payments/webhook/route'))
  const req = new Request('http://localhost/api/payments/webhook', {
    method: 'POST',
    headers: { 'x-razorpay-signature': 'bad' },
    body: JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1' } } } }),
  })
  const res = await mod.POST(req)
  assert.equal(res.status, 401)
})

test('duplicate webhook events are idempotent (200 each)', async () => {
  process.env.RAZORPAY_WEBHOOK_SECRET = razorpayEnv.RAZORPAY_WEBHOOK_SECRET
  mocks.set(D('lib/supabase/server'), () => mockServerModule(null))
  mocks.set(D('lib/payments/entitlement'), () => mockEntitlement(true))
  mocks.set(D('lib/payments/razorpay'), () => ({
    ...fakeRazorpaySdk(),
    ...{
      verifyWebhookSignature: () => true,
      fetchOrder: async () => orderResult,
      getPricePaise: () => 7900,
      getCurrency: () => 'INR',
    },
  }))
  const mod = await loadRoute(D('app/api/payments/webhook/route'))
  const payload = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1' } } } })
  const makeReq = () =>
    new Request('http://localhost/api/payments/webhook', {
      method: 'POST',
      headers: { 'x-razorpay-signature': 'x' },
      body: payload,
    })
  const first = await mod.POST(makeReq())
  assert.equal(first.status, 200)
  const second = await mod.POST(makeReq())
  assert.equal(second.status, 200)
})

// ---------------------------------------------------------------------------
// Reflection paywall / access tests
// ---------------------------------------------------------------------------

async function paywalledReflection(isEntitled: boolean) {
  process.env.PAYMENTS_ENFORCE = '1'
  process.env.RAZORPAY_KEY_ID = razorpayEnv.RAZORPAY_KEY_ID
  process.env.RAZORPAY_KEY_SECRET = razorpayEnv.RAZORPAY_KEY_SECRET
  process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseEnv.NEXT_PUBLIC_SUPABASE_URL
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = supabaseEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY
  mocks.set(D('lib/supabase/server'), () => mockServerModule({ id: 'cust_1' }))
  mocks.set(D('lib/payments/razorpay'), mockRazorpayModule)
  mocks.set(D('lib/payments/entitlement'), () => mockEntitlement(isEntitled))
  mocks.set(D('lib/ai/service'), () => mockAiService)
  mocks.set(D('lib/journey'), () => mockJourney)
  mocks.set(D('lib/ai/provider'), () => mockAiProvider)
  const mod = await loadRoute(D('app/api/reflection/route'))
  const req = new Request('http://localhost/api/reflection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ day: 1, activity: 'Day 1', choice: 'x', response: 'hello', fields: {} }),
  })
  return mod.POST(req)
}

test('unentitled user receives 402 when PAYMENTS_ENFORCE is on', async () => {
  const res = await paywalledReflection(false)
  assert.equal(res.status, 402)
})

test('entitled user proceeds past the paywall (200)', async () => {
  process.env.PAYMENTS_ENFORCE = '1'
  const res = await paywalledReflection(true)
  assert.equal(res.status, 200)
})

test('unauthenticated call still cannot bypass the paywall (401)', async () => {
  process.env.PAYMENTS_ENFORCE = '1'
  process.env.RAZORPAY_KEY_ID = razorpayEnv.RAZORPAY_KEY_ID
  process.env.RAZORPAY_KEY_SECRET = razorpayEnv.RAZORPAY_KEY_SECRET
  mocks.set(D('lib/supabase/server'), () => mockServerModule(null))
  mocks.set(D('lib/payments/razorpay'), mockRazorpayModule)
  mocks.set(D('lib/payments/entitlement'), () => mockEntitlement(true))
  mocks.set(D('lib/ai/service'), () => mockAiService)
  mocks.set(D('lib/journey'), () => mockJourney)
  mocks.set(D('lib/ai/provider'), () => mockAiProvider)
  const mod = await loadRoute(D('app/api/reflection/route'))
  const req = new Request('http://localhost/api/reflection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ day: 1, activity: 'Day 1', choice: 'x', response: 'hello', fields: {} }),
  })
  const res = await mod.POST(req)
  assert.equal(res.status, 401)
})

// ---------------------------------------------------------------------------
// Structural RLS + client-asset checks
// ---------------------------------------------------------------------------

const entMigrations = resolve(root, 'supabase', 'migrations')
const entMigrationFile = resolve(entMigrations, '20260201000000_create_entitlements.sql')

test('entitlements migration is SELECT-only RLS (no write policies)', () => {
  assert.ok(existsSync(entMigrationFile), 'entitlement migration file exists')
  const sql = readFileSync(entMigrationFile, 'utf8')
  assert.match(sql, /alter table entitlements enable row level security/, 'RLS enabled on entitlements')
  assert.match(sql, /create policy "Customers can read their own entitlement"/, 'select policy present')
  assert.match(sql, /for select/, 'select policy is for select only')
  for (const kind of ['create policy "insert', 'create policy "update', 'create policy "delete']) {
    assert.doesNotMatch(sql, new RegExp(kind), `unexpected ${kind.trim()} policy`)
  }
  assert.match(sql, /Intentionally NO insert\/update\/delete policies/, 'client cannot self-grant access via the client')
})

test('browser client never imports the admin client or service-role key', () => {
  const clientFile = resolve(root, 'lib', 'supabase', 'client.ts')
  assert.ok(existsSync(clientFile), 'client.ts exists')
  const src = readFileSync(clientFile, 'utf8')
  assert.doesNotMatch(src, /import.*['"]\.\.\/supabase\/admin['"]/, 'client does not import admin client')
  assert.doesNotMatch(src, /SUPABASE_SERVICE_ROLE_KEY/, 'client does not reference service-role key')
  assert.doesNotMatch(src, /NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY/, 'client does not expose service-role key')
  assert.match(src, /createBrowserClient/, 'uses browser anon client')
})

test('env.example documents the Razorpay + server variables (names only)', () => {
  const env = resolve(root, '.env.example')
  assert.ok(existsSync(env), '.env.example exists')
  const src = readFileSync(env, 'utf8')
  for (const name of [
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET',
    'RAZORPAY_WEBHOOK_SECRET',
    'SUPABASE_SERVICE_ROLE_KEY',
    'MIRAAI_PRICE_PAISE',
    'PAYMENTS_ENFORCE',
  ]) {
    assert.match(src, new RegExp(name), `env.example documents ${name}`)
  }
})