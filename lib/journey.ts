import { type SupabaseClient, type PostgrestResponse } from '@supabase/supabase-js'
import type { Database, JourneyRow } from './supabase/database'
import type { BlockValue } from './ai/types'
import type {
  DayInput,
  ReflectionCard,
  Journey,
  JourneyInput,
  JourneyPatch,
  SaveDayArgs,
} from './journey.types'

function isJourneyError(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error
}

export class JourneyError extends Error {
  constructor(public message: string, public readonly status = 500) {
    super(message)
    this.name = 'JourneyError'
  }
}

/** Keys valid for the `day_N_responses` / `day_N_ai_output` columns. */
type DayN = 1 | 2 | 3 | 4 | 5 | 6 | 7
type ResponsesKey = `day_${DayN}_responses`
type OutputsKey = `day_${1 | 2 | 3 | 4 | 5 | 6}_ai_output`

function nextDayNumber(completed: readonly number[]): number {
  const set = new Set(completed)
  for (let n = 1; n <= 7; n += 1) if (!set.has(n)) return n
  return 7
}

/** Placeholder (not-yet-answered) day input used when booting a journey row. */
export function emptyDayInput(day = 0): DayInput {
  return {
    day,
    activity: '',
    choice: '',
    choices: [],
    response: '',
    fields: {},
    savedAt: new Date().toISOString(),
  }
}

/** Placeholder (not-yet-generated) reflection card used when booting a journey row. */
export function emptyReflectionCard(): ReflectionCard {
  return {
    outputType: 'reset_report',
    title: 'My 7-Day Reset Report',
    blocks: [],
    reflection: '',
    reminder: '',
    safetyFlag: false,
  }
}

/** Full insert payload for a brand-new journey row (every required column). */
export function buildJourneyInput(args: {
  customer_id: string
  name: string
  email: string | null
  journey_start_date?: string
}): JourneyInput {
  const { customer_id, name, email, journey_start_date = new Date().toISOString().slice(0, 10) } = args
  return {
    customer_id,
    name,
    email,
    journey_start_date,
    current_day: 1,
    completed_days: [],
    day_1_responses: emptyDayInput(1),
    day_1_ai_output: emptyReflectionCard(),
    day_2_responses: emptyDayInput(2),
    day_2_ai_output: emptyReflectionCard(),
    day_3_responses: emptyDayInput(3),
    day_3_ai_output: emptyReflectionCard(),
    day_4_responses: emptyDayInput(4),
    day_4_ai_output: emptyReflectionCard(),
    day_5_responses: emptyDayInput(5),
    day_5_ai_output: emptyReflectionCard(),
    day_6_responses: emptyDayInput(6),
    day_6_ai_output: emptyReflectionCard(),
    day_7_responses: emptyDayInput(7),
    day_7_report: emptyReflectionCard(),
  }
}

function sanitizeDayInput(input: unknown): DayInput {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new JourneyError('Invalid day input.', 400)
  }
  const raw = input as Record<string, unknown>
  const fields = raw.fields && typeof raw.fields === 'object' && !Array.isArray(raw.fields)
    ? raw.fields
    : {}
  const fieldsText: Record<string, string> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed.length > 0) fieldsText[key.slice(0, 60)] = trimmed.slice(0, 1200)
  }
  const choices = Array.isArray(raw.choices)
    ? raw.choices.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean).slice(0, 12)
    : []
  return {
    day: Math.min(Math.max(Number(raw.day) || 1, 1), 7),
    activity: typeof raw.activity === 'string' ? raw.activity.slice(0, 80) : '',
    choice: typeof raw.choice === 'string' ? raw.choice.slice(0, 400) : '',
    choices,
    response: typeof raw.response === 'string' ? raw.response.slice(0, 1400) : '',
    fields: fieldsText,
    language: typeof raw.language === 'string' ? raw.language.slice(0, 8) : undefined,
    savedAt: new Date().toISOString(),
  }
}

export function sanitizeReflectionCard(output: unknown): ReflectionCard {
  if (output === null || typeof output !== 'object' || Array.isArray(output)) {
    throw new JourneyError('Invalid AI output.', 400)
  }
  const raw = output as Record<string, unknown>
  const blocks = Array.isArray(raw.blocks)
    ? (raw.blocks as Array<{ key?: unknown; label?: unknown; value?: unknown }>)
        .filter((b) => b && typeof b.key === 'string')
        .map((b) => ({ key: b.key as string, label: (typeof b.label === 'string' ? b.label : b.key) as string, value: b.value as BlockValue }))
    : []
  return {
    outputType: typeof raw.outputType === 'string' ? raw.outputType.slice(0, 80) : '',
    title: typeof raw.title === 'string' ? raw.title.slice(0, 160) : '',
    blocks,
    reflection: typeof raw.reflection === 'string' ? raw.reflection.slice(0, 2000) : '',
    reminder: typeof raw.reminder === 'string' ? raw.reminder.slice(0, 900) : '',
    safetyFlag: raw.safetyFlag === true,
    degraded: raw.degraded === true,
    language: typeof raw.language === 'string' ? raw.language.slice(0, 8) : undefined,
  }
}

export function createJourneyService(client: SupabaseClient<Database>) {
  const table = (process.env.SUPABASE_JOURNEY_TABLE || 'journeys') as 'journeys'

/** Small typed shim over @supabase/supabase-js so the journey table keeps
 *  compile-time shape without forcing us to satisfy the library's generic
 *  PostgREST schema inference. */
interface JourneyQueryBuilder {
  order: (a: string, b?: { ascending: boolean }) => JourneyQueryBuilder
  select: (columns?: string) => JourneyQueryBuilder
  eq: (field: string, value: string | string[]) => JourneyQueryBuilder
  insert: (values: JourneyInput) => JourneyQueryBuilder
  update: (values: Partial<JourneyInput>) => JourneyQueryBuilder
  single: () => Promise<{ data?: JourneyRow; error?: unknown }>
  list: () => Promise<{ data: JourneyRow[]; error?: unknown }>
}

function fromJourneys(client: SupabaseClient<Database>): JourneyQueryBuilder {
  return client.from(table) as unknown as JourneyQueryBuilder
}

  const rowToJourney = (row: JourneyRow): Journey => ({
    id: row.id,
    customer_id: row.customer_id,
    name: row.name,
    email: row.email,
    journey_start_date: row.journey_start_date,
    current_day: row.current_day,
    completed_days: row.completed_days,
    day_1_responses: row.day_1_responses,
    day_1_ai_output: row.day_1_ai_output,
    day_2_responses: row.day_2_responses,
    day_2_ai_output: row.day_2_ai_output,
    day_3_responses: row.day_3_responses,
    day_3_ai_output: row.day_3_ai_output,
    day_4_responses: row.day_4_responses,
    day_4_ai_output: row.day_4_ai_output,
    day_5_responses: row.day_5_responses,
    day_5_ai_output: row.day_5_ai_output,
    day_6_responses: row.day_6_responses,
    day_6_ai_output: row.day_6_ai_output,
    day_7_responses: row.day_7_responses,
    day_7_report: row.day_7_report,
    created_at: row.created_at,
    updated_at: row.updated_at,
  })

  async function listJourneys(customerId: string): Promise<Journey[]> {
    const { data, error } = await fromJourneys(client)
      .select('*')
      .eq('customer_id', customerId)
      .order('journey_start_date', { ascending: false })
      .list()

    if (error && isJourneyError(error) && error.code !== 'PGRST116') {
      throw new JourneyError('Could not load your journey.', 500)
    }
    return (data ?? []).map(rowToJourney)
  }

  async function getJourney(customerId: string): Promise<Journey | null> {
    const { data, error } = await fromJourneys(client)
      .select('*')
      .eq('customer_id', customerId)
      .single()
    if (error && (!isJourneyError(error) || error.code !== 'PGRST116')) throw new JourneyError('Could not load your journey.', 500)
    return data ? rowToJourney(data) : null
  }

  async function createJourney(input: JourneyInput): Promise<Journey> {
    const { data, error } = await fromJourneys(client).insert(input).select('*').single()
    if (error && isJourneyError(error) && error.code !== 'PGRST116') throw new JourneyError('Could not create your journey.', 500)
    return rowToJourney(data!)
  }

  /** Save a day's input + AI output, advancing the journey state. Returns the persisted journey. */
  async function saveDay(args: SaveDayArgs): Promise<Journey> {
    const { day, input, aiOutput, extra, name = '', email = null, journey_start_date = new Date().toISOString().slice(0, 10) } = args
    const safeDay = Math.min(Math.max(day, 1), 7)
    const dayKey: ResponsesKey = `day_${safeDay}_responses` as ResponsesKey
    const aiKey: OutputsKey = `day_${safeDay}_ai_output` as OutputsKey
    const customerId = args.customer_id

    let existing = await getJourney(customerId)

    if (!existing) {
      // First save: boot the journey row for this customer, then fall through
      // to the normal update path so this day's data is persisted too.
      const base = buildJourneyInput({ customer_id: customerId, name, email, journey_start_date })
      const { data, error } = await fromJourneys(client).insert(base).select('*').single()
      if (error || !data) throw new JourneyError('Could not start your journey.', 500)
      existing = rowToJourney(data)
    }

    // Swap in this day's input/output, add it to completed days, advance current_day.
    const completed = Array.from(new Set([...existing.completed_days, safeDay])).sort((a, b) => a - b)
    const updates: Partial<JourneyInput> = {
      [dayKey]: sanitizeDayInput(input),
      completed_days: completed,
      current_day: nextDayNumber(completed),
    }
    // Day 7's output lives in the dedicated `day_7_report` column; days 1–6 in `day_N_ai_output`.
    if (safeDay === 7) updates.day_7_report = sanitizeReflectionCard(aiOutput)
    else updates[aiKey] = sanitizeReflectionCard(aiOutput)

    const extraUpdates = updates as Record<string, unknown>
    for (const [key, value] of Object.entries(extra ?? {})) {
      if (value !== undefined && value !== null) extraUpdates[key] = value
    }

    const { data, error } = await fromJourneys(client)
      .update(updates)
      .eq('customer_id', customerId)
      .select('*')
      .single()
    if (error && (!isJourneyError(error) || error.code !== 'PGRST116')) throw new JourneyError('Could not save your progress.', 500)
    if (!data) throw new JourneyError('Could not save your progress.', 500)
    return rowToJourney(data)
  }

  async function updateProfile(customerId: string, patch: Partial<Pick<JourneyInput, 'name' | 'email'>>): Promise<Journey> {
    const { data, error } = await fromJourneys(client)
      .update({ name: patch.name ?? '', email: patch.email ?? null })
      .eq('customer_id', customerId)
      .select('*')
      .single()
    if (error) throw new JourneyError('Could not save your profile.', 500)
    return rowToJourney(data!)
  }

  return { listJourneys, getJourney, createJourney, saveDay, updateProfile }
}

export type { DayInput, ReflectionCard, Journey, JourneyInput, JourneyPatch, SaveDayArgs } from './journey.types'
