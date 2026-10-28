/*
 * MIRAAI reflection-engine OFFLINE test suite.
 * Deterministic: no Groq, no Supabase, no network, no production data.
 * Run via: npm test  (compiles with tsc, then node --test).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SPECS, detectLanguage, buildSystemPrompt, buildUserPrompt, NOT_ENOUGH } from '../lib/ai/prompts'
import { validateAiResponse, fallbackResult, inspectPriorities, trimIncompletePriorities } from '../lib/ai/validate'
import { containsCrisisLanguage, safetyResult } from '../lib/ai/safety'
import { sanitizeRequest, InputError } from '../lib/ai/service'
import { getProvider, ProviderError } from '../lib/ai/provider'
import type { ReflectionRequest, HistoryItem } from '../lib/ai/types'

const arr = (v: unknown) => (Array.isArray(v) ? v as string[] : [])
const txt = (v: unknown) => (typeof v === 'string' ? v : Array.isArray(v) ? v.join(' / ') : '')

const EXPECTED: Record<number, string[]> = {
  1: ['whatINoticed', 'whatIShared', 'whatIWantedSpaceFor', 'reflection', 'carryForward'],
  2: ['situation', 'feeling', 'thought', 'reflection', 'nextQuestion'],
  3: ['canActOn', 'outsideMyControl', 'notNow', 'reflection'],
  4: ['need', 'options', 'chosenOption', 'whyItFits', 'whenToTry', 'reflection'],
  5: ['activity', 'noticed', 'reflection'],
  6: ['situation', 'myFirstResponse', 'whatIdSayToAFriend', 'kinderReminder', 'reflection'],
  7: ['whatIBroughtWithMe', 'whatINoticed', 'whatMyMindWasDoing', 'whatWasInMyHands', 'whatITried', 'whatINoticedFromTrying', 'myOwnWords', 'whatIWantToCarryForward', 'myResetInOneSentence'],
}

const goodDay = (d: number): Record<string, unknown> => ({
  1: { outputType: 'first_reset', whatINoticed: 'Too much going on', whatIShared: 'exams', whatIWantedSpaceFor: 'focus', reflection: 'You mentioned exams.', carryForward: 'I can start with one thing.' },
  2: { outputType: 'feeling_map', situation: 'friend silent', feeling: 'rejected', thought: 'I did something wrong', reflection: 'You noticed a situation and a feeling.', nextQuestion: 'What else could explain it?' },
  3: { outputType: 'space_of_control', canActOn: ['send a message'], outsideMyControl: ['what they think'], notNow: [], reflection: 'You sorted what is in your hands.' },
  4: { outputType: 'next_small_move', need: 'focus', options: ['open the file', 'write one line'], chosenOption: 'not picked yet', whyItFits: 'least resistance', whenToTry: 'tonight', reflection: 'One small step.' },
  5: { outputType: 'pause_moment', activity: 'Breathing Pause', noticed: 'no real change', reflection: 'You noticed no real change.' },
  6: { outputType: 'kinder_reminder', situation: 'messed up', myFirstResponse: 'I always ruin things', whatIdSayToAFriend: 'anyone can slip', kinderReminder: 'you did your best', reflection: 'You were harsher with yourself.' },
  7: { outputType: 'miraai_reset_report', whatIBroughtWithMe: 'exams and a friend', whatINoticed: 'behind and unsure', whatMyMindWasDoing: 'a situation and a meaning', whatWasInMyHands: 'start one task', whatITried: 'a pause', whatINoticedFromTrying: 'no real change', myOwnWords: 'I can take one thing', whatIWantToCarryForward: 'one thing at a time', myResetInOneSentence: 'I noticed one small step helps.' },
}[d] ?? {})
// ---- A. Schemas for all seven days ----
test('Day 1-7 field schemas match the implementation', () => {
  for (let d = 1; d <= 7; d++) {
    assert.deepEqual(SPECS[d].fields.map(f => f.key), EXPECTED[d], `Day ${d} fields`)
  }
})
test('Day 3 has three list categories; Day 4 options is a list capped at 3', () => {
  assert.equal(SPECS[3].listKeys.length, 3)
  assert.ok(SPECS[4].listKeys.includes('options'))
  assert.equal(SPECS[4].maxItems?.options, 3)
})

// ---- B. Valid responses validate for every day ----
test('Well-formed AI output validates for all seven days', () => {
  for (let d = 1; d <= 7; d++) {
    const req: ReflectionRequest = { day: d, choice: 'x', response: 'y', fields: {} }
    assert.ok(validateAiResponse(d, goodDay(d), req), `Day ${d} should validate`)
  }
})
test('Day 7 valid output keeps nine blocks and uses the one-sentence as reminder', () => {
  const r = validateAiResponse(7, goodDay(7), { day: 7, response: '' })!
  assert.equal(r.blocks.length, 9)
  assert.match(r.reminder, /one small step/i)
})

// ---- B2. Language metadata is preserved on normal, fallback and safety paths ----
test('Language metadata is preserved on the normal validation path', () => {
  const en = validateAiResponse(1, goodDay(1), { day: 1, response: '', choice: '', fields: {} }, 'en')
  const ml = validateAiResponse(2, goodDay(2), { day: 2, response: '', choice: '', fields: {} }, 'ml')
  assert.equal(en?.language, 'en')
  assert.equal(ml?.language, 'ml')
})

test('Language metadata is preserved on the fallback path', () => {
  const fbEn = fallbackResult({ day: 1, response: 'x', fields: {} }, 'en')
  const fbMl = fallbackResult({ day: 1, response: 'x', fields: {} }, 'ml')
  assert.equal(fbEn.language, 'en')
  assert.equal(fbMl.language, 'ml')
})

test('Safety path preserves language metadata', () => {
  assert.equal(safetyResult('en').language, 'en')
  assert.equal(safetyResult('ml').language, 'ml')
})

test('Manglish input maps to the existing Malayalam metadata code (ml)', () => {
  assert.equal(detectLanguage('enikku valare kastam aanu'), 'ml')
  assert.equal(detectLanguage('എനിക്ക് വിഷമമാണ്'), 'ml')
})
// ---- C. Invalid / hostile output is rejected (drives retry -> fallback) ----
test('Invalid output is rejected', () => {
  const r1: ReflectionRequest = { day: 1, response: 'x' }
  assert.equal(validateAiResponse(1, { ...goodDay(1), outputType: 'feeling_map' }, r1), null, 'wrong outputType')
  assert.equal(validateAiResponse(1, { ...goodDay(1), reflection: '' }, r1), null, 'empty required string')
  assert.equal(validateAiResponse(1, { outputType: 'first_reset' }, r1), null, 'missing fields')
  assert.equal(validateAiResponse(1, null, r1), null, 'null')
  assert.equal(validateAiResponse(1, [1, 2], r1), null, 'array')
})
test('Day 3 empty lists allowed; Day 4 empty options rejected; >3 options truncated to 3', () => {
  assert.ok(validateAiResponse(3, { outputType: 'space_of_control', canActOn: [], outsideMyControl: [], notNow: [], reflection: 'r' }, { day: 3 }), 'Day 3 empty lists ok')
  assert.equal(validateAiResponse(4, { outputType: 'next_small_move', need: 'n', options: [], chosenOption: 'c', whyItFits: 'w', whenToTry: 't', reflection: 'r' }, { day: 4 }), null, 'Day 4 empty options rejected')
  const capped = validateAiResponse(4, { ...goodDay(4), options: ['a', 'b', 'c', 'd'] }, { day: 4 })!
  assert.equal(arr(capped.blocks.find(b => b.key === 'options')?.value).length, 3, 'Day 4 capped to 3')
})
// ---- D. Fallback: full card shape, degraded, never invents ----
test('Fallback returns a degraded, full-shape card for all seven days', () => {
  for (let d = 1; d <= 7; d++) {
    const req: ReflectionRequest = { day: d, response: 'MY RAW WORDS ' + d, fields: d === 3 ? { canActOn: 'send a message; start task' } : {} }
    const fb = fallbackResult(req)
    assert.equal(fb.degraded, true, `Day ${d} degraded`)
    assert.equal(fb.blocks.length, SPECS[d].fields.length, `Day ${d} full shape`)
    assert.ok(fb.blocks.every(b => typeof b.value === 'string' ? b.value.length > 0 : true), `Day ${d} no empty text`)
  }
})
test('Day 7 fallback fills every section and uses NOT_ENOUGH rather than inventing', () => {
  const fb = fallbackResult({ day: 7, response: '', fields: {}, history: [] })
  assert.equal(fb.blocks.length, 9)
  assert.ok(fb.blocks.some(b => b.value === NOT_ENOUGH), 'uses NOT_ENOUGH for unknown sections')
})

// ---- D2. REGRESSION: Day 6 fallback field mapping (selfTalk / myOwnWords) ----
test('Day 6 fallback maps selfTalk -> myFirstResponse and myOwnWords -> whatIdSayToAFriend', () => {
  const req: ReflectionRequest = {
    day: 6, choice: 'I made a mistake', response: '',
    fields: { situation: 'I messed up at work', selfTalk: 'I always ruin things', myOwnWords: 'Anyone can slip; you did your best' },
  }
  const fb = fallbackResult(req)
  const get = (k: string) => fb.blocks.find(b => b.key === k)?.value
  assert.equal(get('myFirstResponse'), 'I always ruin things', 'myFirstResponse reads fields.selfTalk')
  assert.equal(get('whatIdSayToAFriend'), 'Anyone can slip; you did your best', 'whatIdSayToAFriend reads fields.myOwnWords')
})

// ---- E. Safety ----
test('Crisis language is detected; ordinary language is not', () => {
  assert.ok(containsCrisisLanguage('I do not want to live anymore'))
  assert.ok(containsCrisisLanguage('i want to die'))
  assert.ok(containsCrisisLanguage('thinking about suicide'))
  assert.ok(!containsCrisisLanguage('I am tired and want some quiet'))
  assert.ok(!containsCrisisLanguage('this exam is killing me'))
})
test('safetyResult is a non-diagnostic pause with no card blocks', () => {
  const r = safetyResult('en')
  assert.equal(r.safetyFlag, true)
  assert.equal(r.outputType, 'safety_pause')
  assert.equal(r.blocks.length, 0)
})

// ---- F. Language detection ----
test('Language detection: English, Malayalam script, Manglish', () => {
  assert.equal(detectLanguage('I had a good day'), 'en')
  assert.equal(detectLanguage('എനിക്ക് വിഷമമാണ്'), 'ml')
  assert.equal(detectLanguage('enikku valare kastam aanu'), 'ml')
})

// ---- G. Input validation / bounds ----
test('Input validation: day range and empty content rejected; long inputs bounded', () => {
  assert.throws(() => sanitizeRequest({ day: 9 }), InputError)
  assert.throws(() => sanitizeRequest({ day: 0 }), InputError)
  assert.throws(() => sanitizeRequest({ day: 1 }), InputError)
  const san = sanitizeRequest({ day: 1, response: 'x'.repeat(5000), fields: { a: 'y'.repeat(5000) } })
  assert.ok((san.response ?? '').length <= 1400)
  assert.ok((san.fields?.a ?? '').length <= 1200)
})

// ---- H. System-prompt guardrails present ----
test('System prompt states non-clinical, non-inventing guardrails', () => {
  const sys = buildSystemPrompt(SPECS[1], 'en')
  assert.match(sys, /NOT a therapist/i)
  assert.match(sys, /never diagnose/i)
  assert.match(sys, /never invent/i)
  assert.match(buildSystemPrompt(SPECS[7], 'en'), /ACTUAL six-day journey/i)
})

// ---- I. Provider failure surfaces as ProviderError (offline: no key configured) ----
test('Provider is unavailable without a key -> ProviderError (no crash)', () => {
  const prev = process.env.GROQ_API_KEY
  delete process.env.GROQ_API_KEY
  try {
    assert.throws(() => getProvider(), ProviderError)
  } finally {
    if (prev !== undefined) process.env.GROQ_API_KEY = prev
  }
})

// ---- E. Priority completeness validation (Day 7) ----
const threeCompleteCarry = `I keep juggling everything. A little space would help. What could help going forward Priority 1 - Area to explore: workload | Why it matters: deadlines | Suggested adjustment: schedule | First small step: pick one task | Reflection question: which task feels urgent? Priority 2 - Area to explore: rest | Why it matters: no space | Suggested adjustment: breaks | First small step: 5-min walk | Reflection question: did energy change? Priority 3 - Area to explore: self-compassion | Why it matters: harsh talk | Suggested adjustment: reframe | First small step: write kind sentence | Reflection question: how does it feel?`

test('inspectPriorities: three complete priorities', () => {
  const r = inspectPriorities(threeCompleteCarry)
  assert.equal(r.count, 3)
  assert.equal(r.complete, 3)
  assert.equal(r.incomplete, 0)
  assert.deepEqual(r.missingElements, [])
})

test('inspectPriorities: priority missing Reflection question is detected', () => {
  const text = 'Priority 1 - Area to explore: x | Why it matters: y | Suggested adjustment: z | First small step: a'
  const r = inspectPriorities(text)
  assert.equal(r.count, 1)
  assert.equal(r.complete, 0)
  assert.ok(r.missingElements.includes('Reflection question:'))
})

test('inspectPriorities: priority missing First small step is detected', () => {
  const text = 'Priority 1 - Area to explore: x | Why it matters: y | Suggested adjustment: z | Reflection question: q'
  const r = inspectPriorities(text)
  assert.equal(r.count, 1)
  assert.equal(r.complete, 0)
  assert.ok(r.missingElements.includes('First small step:'))
})

test('inspectPriorities: malformed text with no Priority keyword returns zero', () => {
  const r = inspectPriorities('just a plain summary with no priorities')
  assert.equal(r.count, 0)
  assert.equal(r.complete, 0)
})

test('inspectPriorities: fewer than three complete priorities is allowed', () => {
  const text = 'Priority 1 - Area to explore: x | Why it matters: y | Suggested adjustment: z | First small step: a | Reflection question: q'
  const r = inspectPriorities(text)
  assert.equal(r.count, 1)
  assert.equal(r.complete, 1)
})

test('trimIncompletePriorities: trims a trailing incomplete priority', () => {
  const text = 'Summary. Priority 1 - Area to explore: x | Why it matters: y | Suggested adjustment: z | First small step: a | Reflection question: q Priority 2 - Area to explore: x | Why it matters: y | Suggested adjustment: z'
  const out = trimIncompletePriorities(text)
  assert.ok(out.includes('Priority 1'))
  assert.ok(!out.includes('Priority 2'))
  assert.ok(out.startsWith('Summary.'))
})

test('trimIncompletePriorities: keeps later complete priorities when an earlier one is incomplete', () => {
  const text = 'Summary. Priority 1 - Area to explore: x | Why it matters: y Priority 2 - Area to explore: a | Why it matters: b | Suggested adjustment: c | First small step: d | Reflection question: e'
  const out = trimIncompletePriorities(text)
  assert.ok(out.includes('Priority 2'))
  assert.ok(!out.includes('Priority 1'))
  assert.ok(out.startsWith('Summary.'))
})
test('trimIncompletePriorities: leaves text unchanged when no priorities', () => {
  const text = 'just a plain summary'
  assert.equal(trimIncompletePriorities(text), text)
})


test('Day 7 validation: trims incomplete trailing priority and keeps all nine fields', () => {
  const raw = goodDay(7)
  raw.whatIWantToCarryForward = 'Summary text. Priority 1 - Area to explore: a | Why it matters: b | Suggested adjustment: c | First small step: d | Reflection question: e Priority 2 - Area to explore: f | Why it matters: g | Suggested adjustment: h'
  const r = validateAiResponse(7, raw, { day: 7, response: '' })
  assert.ok(r, 'should validate (one complete priority)')
  assert.equal(r!.blocks.length, 9)
  const carry = r!.blocks.find(b => b.key === 'whatIWantToCarryForward')?.value as string
  assert.ok(carry.includes('Priority 1'))
  assert.ok(!carry.includes('Priority 2'))
})

test('Day 7 validation: rejects when priority block is present but has zero complete priorities', () => {
  const raw = goodDay(7)
  raw.whatIWantToCarryForward = 'Summary. Priority 1 - Area to explore: a | Why it matters: b'
  const r = validateAiResponse(7, raw, { day: 7, response: '' })
  assert.equal(r, null, 'should reject malformed priority block')
})

test('Day 7 validation: accepts field with no priority entries', () => {
  const raw = goodDay(7)
  raw.whatIWantToCarryForward = 'Just a plain summary with no priorities.'
  const r = validateAiResponse(7, raw, { day: 7, response: '' })
  assert.ok(r, 'should validate')
  assert.equal(r!.blocks.length, 9)
})


// ---- B3. Realistic seven-day journey fixture (no live AI) ----
// Representative content exercising recurring concern, trigger, early-vs-late
// difference, strength, unresolved concern, and a thin evidence area.
const realisticDay7 = {
  outputType: 'miraai_reset_report',
  whatIBroughtWithMe: 'Across the week the person returned to competing responsibilities: work deadlines, family expectations, and a recurring worry about letting people down. The first days were mostly about pressure and not having enough space.',
  whatINoticed: 'The person named feeling overwhelmed and stretched, especially when several demands arrived at once. A possible trigger appears to be situations where multiple responsibilities compete for attention. By the later days the language shifted toward wanting clarity and one small next step rather than just more effort.',
  whatMyMindWasDoing: 'Early responses focused on pressure and not knowing where to start. Later responses show the person sorting what is in their hands from what is not. One consistent pattern is that the person postpones their own emotional needs while continuing to manage daily responsibilities. Whether this pattern has actually changed cannot be established from the available responses.',
  whatWasInMyHands: 'The person sorted their own control in Day 3: some things to act on, some outside their control, some not now. They demonstrated a strength in pausing and in naming what they needed. A possible gap is that their stated need for rest did not always match the amount of rest they described taking.',
  whatITried: 'Day 4: a small move toward one manageable task. Day 5: a breathing pause, after which they reported no real change. Day 6: a kinder reminder compared with their first self-talk. A skip was not recorded, but one day was thin.',
  whatINoticedFromTrying: 'Day 5: no real change. The Day 4 move did not clearly change how they felt, but it gave them something concrete to hold. The Day 6 comparison showed they were harsher with themselves than they would have been with a friend.',
  myOwnWords: '"I keep juggling everything and hoping no one notices." "A little space would help."',
  whatIWantToCarryForward: 'One thing at a time. A small protected period for personal needs. Priority 1 - Area to explore: competing responsibilities. Why it matters: the responses repeatedly mention difficulty making time for personal needs while managing several demands at once. Suggested adjustment: identify one responsibility that can be postponed, simplified, or discussed with someone. First small step: choose one task to set aside for a day and notice how it feels. Reflection question: which demand felt most urgent, and which one could wait?',
  myResetInOneSentence: 'This week I noticed that when several things compete for my attention, choosing one small next step gives me something concrete to work with.',
}

test('Realistic seven-day fixture validates and preserves all nine Day 7 fields', () => {
  const req: ReflectionRequest = { day: 7, response: 'x', fields: {}, history: [] }
  const r = validateAiResponse(7, realisticDay7, req)
  assert.ok(r, 'fixture should validate')
  assert.equal(r!.blocks.length, 9, 'nine blocks preserved')
  for (const key of EXPECTED[7]) {
    const block = r!.blocks.find(b => b.key === key)
    assert.ok(block, `field present: ${key}`)
    const v = typeof block!.value === 'string' ? block!.value : JSON.stringify(block!.value)
    assert.ok(v.length > 0, `field non-empty: ${key}`)
  }
  assert.equal(r!.language, 'en')
})

test('Realistic seven-day fixture: buildUserPrompt includes the whole journey as context', () => {
  const history: HistoryItem[] = [
    { day: 1, title: 'My First Reset', choice: 'Too much going on', response: 'exams', fields: { takingSpace: 'focus' } },
    { day: 2, title: 'My Feeling Map', choice: '', response: 'friend silent', fields: { situation: 'they did not reply', feeling: 'rejected', thought: 'I did something wrong' } },
    { day: 3, title: 'My Space of Control', choice: '', response: '', fields: { canActOn: 'send a message; start task', outsideMyControl: 'what they think', notNow: 'reply' } },
    { day: 4, title: 'My Next Small Move', choice: 'not picked yet', response: 'focus', fields: { need: 'focus', options: 'open the file, write one line', chosenOption: 'not picked yet' } },
    { day: 5, title: 'My Pause Moment', choice: 'Breathing Pause', response: 'no real change', fields: { noticed: 'no real change' } },
    { day: 6, title: 'My Kinder Reminder', choice: '', response: 'messed up', fields: { situation: 'messed up', myFirstResponse: 'I always ruin things', whatIdSayToAFriend: 'anyone can slip' } },
  ]
  const prompt = buildUserPrompt({ day: 7, response: 'x', history }, SPECS[7])
  assert.match(prompt, /Journey so far/, 'includes journey digest')
  assert.match(prompt, /Day 1/, 'includes Day 1')
  assert.match(prompt, /Day 6/, 'includes Day 6')
  assert.match(prompt, /Use the journey above as the ONLY source for the report/, 'Day 7 grounding instruction present')
})

test('Realistic seven-day fixture: fallback preserves nine fields and uses NOT_ENOUGH for thin input', () => {
  const fb = fallbackResult({ day: 7, response: '', fields: {}, history: [] })
  assert.equal(fb.blocks.length, 9, 'fallback keeps nine blocks')
  assert.ok(fb.blocks.some(b => b.value === NOT_ENOUGH), 'fallback uses NOT_ENOUGH for thin input')
  assert.equal(fb.language, 'en')
})
