import { NOT_ENOUGH, SPECS } from './prompts'
import type { DaySpec, HistoryItem, ReflectionBlock, ReflectionRequest, ReflectionResult } from './types'

const capText = (value: unknown, max = 600) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''

/**
 * Validate + normalize one AI JSON object for the given day.
 * Returns null when the response cannot be trusted, so the caller can retry.
 */
export function validateAiResponse(
  day: number,
  parsed: unknown,
  request: ReflectionRequest,
  language: string = 'en'
): ReflectionResult | null {
  const spec = SPECS[day]
  if (!spec || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const raw = parsed as Record<string, unknown>

  // The model must confirm which card it produced; a mismatched outputType means
  // it ignored the day instructions.
  const outputType = capText(raw.outputType, 80)
  if (outputType && outputType !== spec.outputType) return null

  const blocks: ReflectionBlock[] = []
  let missing = false
  for (const field of spec.fields) {
    const value = raw[field.key]
    const isList = spec.listKeys.includes(field.key)
    if (isList) {
      const items = Array.isArray(value)
        ? value.map(v => capText(v, 160)).filter(Boolean)
        : capText(value)
          ? [capText(value)]
          : []
      const max = spec.maxItems?.[field.key]
      if (max && items.length > max) items.length = max
      // An empty list is only acceptable for Day 3 categories the user left empty
      // (the prompt tells the model to return []), but never for Day 4 options.
      if (field.key === 'options' && items.length === 0) missing = true
      blocks.push({ key: field.key, label: field.label, value: items })
    } else {
      const text = capText(value, 900)
      if (!text) missing = true
      blocks.push({ key: field.key, label: field.label, value: text })
    }
  }
  if (missing) return null

  const byKey = Object.fromEntries(blocks.map(b => [b.key, b.value]))
  let reflection = typeof byKey.reflection === 'string' ? byKey.reflection : ''
  if (!reflection) {
    // Schemas without a dedicated reflection field (the Day 7 report) use their
    // lead narrative section as the headline reflection.
    const lead = blocks.find(b => typeof b.value === 'string' && b.value.trim())
    reflection = typeof lead?.value === 'string' ? lead.value : ''
  }
  const reminderSource =
    (typeof byKey.carryForward === 'string' && byKey.carryForward) ||
    (typeof byKey.kinderReminder === 'string' && byKey.kinderReminder) ||
    (typeof byKey.myResetInOneSentence === 'string' && byKey.myResetInOneSentence) ||
    (typeof byKey.whatIWantToCarryForward === 'string' && byKey.whatIWantToCarryForward) ||
    (typeof byKey.alternativePerspective === 'string' && byKey.alternativePerspective) ||
    (typeof byKey.myOwnWords === 'string' && byKey.myOwnWords) ||
    request.response?.trim() ||
    request.choice?.trim() ||
    ''
  if (!reflection) return null

  return {
    outputType: spec.outputType,
    title: capText(raw.title, 80) || spec.title,
    blocks,
    reflection,
    reminder: reminderSource,
    safetyFlag: raw.safetyFlag === true,
    language,
  }
}

/**
 * Controlled fallback: never crashes, never invents — it only re-states what the
 * customer actually shared, in the day's card shape. Used when the AI response
 * fails validation twice.
 */
export function fallbackResult(request: ReflectionRequest, language: string = 'en'): ReflectionResult {
  const spec: DaySpec | undefined = SPECS[request.day]
  const shared =
    request.response?.trim() ||
    (request.choices ?? []).join(' · ') ||
    request.choice?.trim() ||
    Object.values(request.fields ?? {}).find(v => v && v.trim()) ||
    ''
  if (!spec) {
    return {
      outputType: 'reflection',
      title: 'Your reflection',
      blocks: [{ key: 'reflection', label: 'Reflection', value: shared || NOT_ENOUGH }],
      reflection: shared || NOT_ENOUGH,
      reminder: shared,
      safetyFlag: false,
      degraded: true,
      language,
    }
  }
  const history = (request.history ?? []).filter(h => h && h.day !== request.day && h.day >= 1 && h.day <= 7)
  const historyJoined = (pick: (h: NonNullable<HistoryItem>) => string | undefined) =>
    history.map(pick).filter((v): v is string => Boolean(v && v.trim())).join(' · ')
  const blocks: ReflectionBlock[] = spec.fields.map(field => {
    if (field.key === 'reflection') {
      return {
        key: field.key,
        label: field.label,
        value: shared
          ? `You shared: "${shared.slice(0, 220)}". That is what this card is holding for now — you can regenerate for a fuller reflection.`
          : NOT_ENOUGH,
      }
    }
    if (spec.listKeys.includes(field.key)) {
      const fromField = request.fields?.[field.key]
      const items = fromField
        ? fromField.split(/[;\n]+/).map(s => s.trim()).filter(Boolean).slice(0, 3)
        : []
      return { key: field.key, label: field.label, value: items }
    }
    // Field-specific sources so a fallback never repeats one answer everywhere.
    let source = request.fields?.[field.key] ?? ''
    if (!source.trim()) {
      if (request.day === 7) {
        const day7Sources: Record<string, string> = {
          whatIBroughtWithMe: historyJoined(h => h.response || h.choice),
          whatINoticed: historyJoined(h => h.reflection),
          whatMyMindWasDoing: historyJoined(h => h.reflection),
          whatWasInMyHands: historyJoined(h => h.fields?.canAct || h.fields?.canActOn || h.fields?.outside || h.fields?.outsideMyControl || h.fields?.notNow),
          whatITried: historyJoined(h => h.response || h.choice),
          whatINoticedFromTrying: historyJoined(h => h.reflection),
          myOwnWords: historyJoined(h => h.reminder),
          whatIWantToCarryForward: request.response?.trim() || historyJoined(h => h.reminder),
          myResetInOneSentence: historyJoined(h => h.reminder),
        }
        source = day7Sources[field.key] ?? ''
      } else if (field.key === 'situation') {
        source = request.response ?? ''
      } else if (field.key === 'myFirstResponse' || field.key === 'selfTalk') {
        source = request.fields?.selfTalk ?? request.fields?.myFirstResponse ?? ''
      } else if (field.key === 'whatIdSayToAFriend' || field.key === 'myOwnWords') {
        source = request.fields?.myOwnWords ?? request.fields?.whatIdSayToAFriend ?? ''
      } else if (field.key === 'whatIBroughtWithMe' || field.key === 'whatINoticed' || field.key === 'whatITried') {
        source = request.response ?? request.choice ?? ''
      }
    }
    return { key: field.key, label: field.label, value: source.trim() || NOT_ENOUGH }
  })
  const reflectionBlock = blocks.find(b => b.key === 'reflection')
  return {
    outputType: spec.outputType,
    title: spec.title,
    blocks,
    reflection: typeof reflectionBlock?.value === 'string' ? reflectionBlock.value : NOT_ENOUGH,
    reminder: shared,
    safetyFlag: false,
    degraded: true,
    language,
  }
}
