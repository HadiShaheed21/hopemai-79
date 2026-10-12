export type BlockValue = string | string[]

export interface ReflectionBlock {
  key: string
  label: string
  value: BlockValue
}

export interface ReflectionResult {
  outputType: string
  title: string
  blocks: ReflectionBlock[]
  reflection: string
  reminder: string
  safetyFlag: boolean
  degraded?: boolean
  language?: string
}

export interface HistoryItem {
  day: number
  title?: string
  choice?: string
  response?: string
  fields?: Record<string, string>
  reflection?: string
  reminder?: string
  date?: string
}

export interface ReflectionRequest {
  day: number
  activity?: string
  choice?: string
  choices?: string[]
  response?: string
  fields?: Record<string, string>
  history?: HistoryItem[]
}

export interface DayField {
  key: string
  label: string
}

export interface DaySpec {
  outputType: string
  title: string
  fields: DayField[]
  /** Keys whose value may (or must) be a list. */
  listKeys: string[]
  /** Exact number of items required for list keys, when enforced (Day 4 options: max 3). */
  maxItems?: Record<string, number>
  instruction: string
}
