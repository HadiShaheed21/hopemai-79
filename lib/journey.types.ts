import type { ReflectionBlock } from './ai/types'

/**
 * Shared domain types for the customer journey.
 *
 * These are the types stored in Supabase and returned to the browser.
 * They are NOT tied to the AI prompt types, so the AI layer can evolve
 * independently.
 */

/** One field value sent to (and returned from) the AI for a given day. */
export interface DayInput {
  day: number
  activity: string
  choice: string
  choices: string[]
  response: string
  fields: Record<string, string>
  language?: string
  savedAt: string
}

/** The AI's rendered reflection card for a day. */
export interface ReflectionCard {
  outputType: string
  title: string
  blocks: ReflectionBlock[]
  reflection: string
  reminder: string
  safetyFlag: boolean
  degraded?: boolean
  language?: string
}

export interface Entry {
  day: number
  title: string
  choice: string
  response: string
  fields: Record<string, string>
  card: ReflectionBlock[]
  reflection: string
  reminder: string
  date: string
}

export interface Journey {
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

/** Complete fields required to create a brand-new journey row. */
export interface JourneyInput {
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
}

/** Partial update (PATCH / JOIN operations). */
export interface JourneyPatch extends Partial<JourneyInput> {}

/** Inputs for `saveDay`. */
export interface SaveDayArgs {
  /** Customer the journey belongs to (auth.uid()). */
  customer_id: string
  /** Profile fields, only supplied when the journey is first created. */
  name?: string
  email?: string | null
  journey_start_date?: string
  day: number
  input: DayInput
  aiOutput: ReflectionCard
  /** Extra day-N columns, e.g. `day_7_report` for Day 7. */
  extra?: Record<string, unknown>
}

export interface JourneyErrorPayload {
  error: string
  status: number
}
