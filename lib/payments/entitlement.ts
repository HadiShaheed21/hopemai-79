/**
 * SERVER-ONLY entitlement helpers.
 *
 * Reads and writes the `entitlements` table using the service-role (admin)
 * client, which bypasses RLS. This is the ONLY place access is granted, and it
 * runs exclusively after a Razorpay payment has been verified. The browser can
 * never write here (the table has SELECT-only RLS).
 */
import { createSupabaseAdminClient } from '../supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, EntitlementInsert, EntitlementRow, EntitlementUpdate } from '../supabase/database'

/**
 * Why the local builder types? The client is typed with our hand-written
 * `Database` surface, and supabase-js cannot bind `.from('entitlements')`
 * against it the way `lib/journey.ts` hits the same wall for `journeys`.
 * Like `fromJourneys()` there, we cast once through `unknown` into a minimal
 * structural interface and keep every table touch inside this file. Runtime
 * behavior is unchanged — the casts only satisfy the type checker.
 */
type SingleResult<T> = { data: T | null; error: { code: string; message: string } | null }
type EntitlementQueryBuilder = {
  select(columns?: string): EntitlementQueryBuilder
  insert(values: EntitlementInsert): EntitlementQueryBuilder
  update(values: EntitlementUpdate): EntitlementQueryBuilder
  eq(column: string, value: string | boolean | number): EntitlementQueryBuilder
  maybeSingle(): Promise<SingleResult<EntitlementRow>>
  single(): Promise<SingleResult<EntitlementRow>>
}

function fromEntitlements(client: SupabaseClient<Database>): EntitlementQueryBuilder {
  return client.from('entitlements') as unknown as EntitlementQueryBuilder
}

/** Read a customer's entitlement (server-side, via service role). */
export async function getEntitlement(customerId: string): Promise<EntitlementRow | null> {
  const admin = createSupabaseAdminClient()
  const { data, error } = await fromEntitlements(admin)
    .select('*')
    .eq('customer_id', customerId)
    .maybeSingle()
  if (error) throw new Error('Could not read entitlement.')
  return data ?? null
}

/** Whether the customer currently has access. */
export async function isEntitled(customerId: string): Promise<boolean> {
  const row = await getEntitlement(customerId)
  return row?.active === true
}

export interface GrantArgs {
  customerId: string
  orderId: string
  paymentId: string
  amountPaise: number
  currency: string
}

/**
 * Grant access for a VERIFIED payment. Idempotent and monotonic:
 *  - keyed by customer_id (primary key), so a customer has at most one row;
 *  - only ever sets active=true / status='paid' — it never revokes access, so
 *    duplicate callbacks, webhook replays, or out-of-order events are safe.
 */
export async function grantEntitlement(args: GrantArgs): Promise<EntitlementRow> {
  const admin = createSupabaseAdminClient()
  const now = new Date().toISOString()
  const paid: Pick<EntitlementRow, 'active' | 'status' | 'razorpay_order_id' | 'razorpay_payment_id' | 'amount_paise' | 'currency' | 'paid_at'> = {
    active: true,
    status: 'paid',
    razorpay_order_id: args.orderId,
    razorpay_payment_id: args.paymentId,
    amount_paise: args.amountPaise,
    currency: args.currency,
    paid_at: now,
  }

  // If already entitled, do not overwrite the original payment record.
  const existing = await getEntitlement(args.customerId)
  if (existing?.active === true) return existing

  if (existing) {
    // Row exists but is not active -> switch it on (monotonic; never revokes).
    const { data, error } = await fromEntitlements(admin)
      .update(paid)
      .eq('customer_id', args.customerId)
      .select('*')
      .single()
    if (error || !data) throw new Error('Could not grant access.')
    return data as EntitlementRow
  }

  const { data, error } = await fromEntitlements(admin)
    .insert({ customer_id: args.customerId, ...paid })
    .select('*')
    .single()
  if (error || !data) throw new Error('Could not grant access.')
  return data as EntitlementRow
}
