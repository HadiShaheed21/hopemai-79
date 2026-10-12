import type { ReflectionRequest, ReflectionResult } from './types'

const CRISIS =
  /\b(suicide|kill myself|end my life|want to die|(?:don'?t|do(?:es)? not) want to (?:live|be alive)|no reason to live|self[- ]?harm|hurt myself|harm myself|cut myself|kill someone|hurt someone)\b/i

/** Flatten every piece of user-provided text into one string for safety scanning. */
export function collectUserText(request: ReflectionRequest): string {
  const parts: string[] = [request.choice ?? '', request.response ?? '', request.activity ?? '']
  for (const value of Object.values(request.fields ?? {})) parts.push(value ?? '')
  for (const choice of request.choices ?? []) parts.push(choice)
  for (const item of request.history ?? []) {
    parts.push(item.choice ?? '', item.response ?? '', item.reflection ?? '', item.reminder ?? '')
    for (const value of Object.values(item.fields ?? {})) parts.push(value ?? '')
  }
  return parts.filter(Boolean).join(' \n ')
}

export function containsCrisisLanguage(text: string): boolean {
  return CRISIS.test(text)
}

/**
 * Non-diagnostic safety response. MIRAAI is not a medical or crisis service:
 * if someone expresses immediate danger we stop the reflection flow and
 * encourage immediate human / emergency support.
 */
export function safetyResult(language: string): ReflectionResult {
  return {
    outputType: 'safety_pause',
    title: 'Pause here for support',
    blocks: [],
    reflection:
      language === 'ml'
        ? 'നിങ്ങൾ ഇത് ഒറ്റയ്ക്ക് നേരിടേണ്ടതില്ല. ഉടൻ വിശ്വസിക്കാവുന്ന ആരെയെങ്കിലും വിളിക്കുക; സ്വയം ഉപദ്രവിക്കാൻ സാധ്യതയുണ്ടെങ്കിൽ ഉടൻ പ്രാദേശിക അത്യാഹിത സേവനത്തെയോ ക്രൈസിസ് സപ്പോർട്ടിനെയോ ബന്ധപ്പെടുക.'
        : 'You do not have to handle this alone. Please contact someone you trust who can stay with you, and contact local emergency or crisis support now if you may act on these thoughts.',
    reminder: '',
    safetyFlag: true,
    language
  }
}
