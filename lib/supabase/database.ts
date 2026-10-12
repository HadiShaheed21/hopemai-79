import type { Journey, DayInput, ReflectionCard } from '../journey.types'

/**
 * Supabase "database" type surface. It mirrors only the tables this
 * project touches. Passing this to @supabase/ssr's createServerClient
 * keeps the server client typed without forcing us to declare the whole
 * Postgres schema.
 */
export type Database = {
  public: {
    tables: {
      journeys: {
        Row: JourneyRow
        Insert: JourneyInsert
        Update: JourneyUpdate
      }
      entitlements: {
        Row: EntitlementRow
        Insert: EntitlementInsert
        Update: EntitlementUpdate
      }
    }
  }
}

export const JOURNEY_TABLE = 'journeys'

export const JOURNEY_COLUMNS = [
  'customer_id',
  'name',
  'email',
  'journey_start_date',
  'current_day',
  'completed_days',
  'day_1_responses',
  'day_1_ai_output',
  'day_2_responses',
  'day_2_ai_output',
  'day_3_responses',
  'day_3_ai_output',
  'day_4_responses',
  'day_4_ai_output',
  'day_5_responses',
  'day_5_ai_output',
  'day_6_responses',
  'day_6_ai_output',
  'day_7_responses',
  'day_7_report',
  'created_at',
  'updated_at',
] as const

export interface JourneyRow {
  id: string
  customer_id: string
  name: string
  email: string | null
  journey_start_date: string
  current_day: number
  completed_days: number[]
  day_1_responses: DayInput
  day_1_ai_output: ReflectionCard
  day_2_responses: DayInput
  day_2_ai_output: ReflectionCard
  day_3_responses: DayInput
  day_3_ai_output: ReflectionCard
  day_4_responses: DayInput
  day_4_ai_output: ReflectionCard
  day_5_responses: DayInput
  day_5_ai_output: ReflectionCard
  day_6_responses: DayInput
  day_6_ai_output: ReflectionCard
  day_7_responses: DayInput
  day_7_report: ReflectionCard
  created_at: string
  updated_at: string
}

/**
 * The fields a caller may hand to `insert()` / `update()`.
 * Deliberately excludes `id`, `created_at` and `updated_at` (the DB sets
 * the latter two for us, including via the `updated_at` trigger).
 */
export type JourneyInput = Omit<JourneyRow, 'id' | 'created_at' | 'updated_at'>

export type JourneyInsert = JourneyInput
export type JourneyPatch = Partial<JourneyInput>
export type JourneyUpdate = Partial<JourneyInput>

/** One verified-payment entitlement per customer (see the entitlements migration). */
export interface EntitlementRow {
  customer_id: string
  active: boolean
  status: 'created' | 'paid' | 'failed'
  razorpay_order_id: string | null
  razorpay_payment_id: string | null
  amount_paise: number
  currency: string
  paid_at: string | null
  created_at: string
  updated_at: string
}

export type EntitlementInsert = Omit<EntitlementRow, 'created_at' | 'updated_at'>
export type EntitlementUpdate = Partial<EntitlementInsert>


