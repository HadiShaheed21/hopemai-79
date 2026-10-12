/*
 * MIRAAI reflection-engine OFFLINE test suite.
 * Deterministic: no Groq, no Supabase, no network, no production data.
 * Run via: npm test  (compiles with tsc, then node --test).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SPECS, detectLanguage, buildSystemPrompt, NOT_ENOUGH } from '../lib/ai/prompts'
import { validateAiResponse, fallbackResult } from '../lib/ai/validate'
import { containsCrisisLanguage, safetyResult } from '../lib/ai/safety'
import { sanitizeRequest, InputError } from '../lib/ai/service'
import { getProvider, ProviderError } from '../lib/ai/provider'
import type { ReflectionRequest } from '../lib/ai/types'

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
