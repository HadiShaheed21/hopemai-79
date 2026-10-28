'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Download, Sparkles } from 'lucide-react'
import { fetchJourney, fetchSession, saveJourney, signIn, signUp, signOut } from '../lib/journey-client'
import type { Journey } from '../lib/journey.types'

type Block = { key: string; label: string; value: string | string[] }
type AiResult = { outputType: string; title: string; blocks: Block[]; reflection: string; reminder: string; safetyFlag: boolean; degraded?: boolean }
type Entry = { day: number; title: string; choice: string; response: string; reflection: string; reminder: string; date: string; fields?: Record<string, string>; card?: Block[] }

type DayField = { key: string; label: string; placeholder: string; type?: 'text' | 'list' }
type ChipGroup = { key: string; label: string; options: string[] }
type DayDef = {
  theme: string
  title: string
  intro: string
  question: string
  choices?: string[]
  multi?: boolean
  extraChips?: ChipGroup[]
  noticeOptions?: string[]
  fields?: DayField[]
  prompt?: string
  completion: string
}

const DAYS: DayDef[] = [
  {
    theme: 'NOTICE',
    title: 'My First Reset',
    intro: 'You do not have to solve anything today. We just start with what is here.',
    question: 'What feels closest right now?',
    multi: true,
    choices: ['Too much going on', 'Something is bothering me', 'Something happened', 'It\u2019s about someone', 'I feel disconnected', 'My mind won\u2019t slow down', 'I actually feel okay', 'I don\u2019t know'],
    extraChips: [{ key: 'spaceFor', label: 'If you could make a little space for one thing, what would it be?', options: ['Clarity', 'Calm', 'Focus', 'Rest', 'Confidence', 'Letting something go', 'Just some space', 'I don\u2019t know'] }],
    fields: [{ key: 'takingSpace', label: 'What is taking up the most space?', placeholder: 'A few words is enough.', type: 'text' }],
    prompt: 'Anything else on your mind today? (optional)',
    completion: 'You made a little space.',
  },
  {
    theme: 'UNDERSTAND',
    title: 'My Feeling Map',
    intro: 'One moment can carry a lot. Let\u2019s look at it gently \u2014 what happened, what you felt, and what your mind said about it.',
    question: 'Choose a moment that feels close.',
    choices: ['Someone didn\u2019t reply', 'I made a mistake', 'I saw something upsetting', 'I have too much to finish', 'Something someone said stayed with me'],
    fields: [
      { key: 'situation', label: 'What happened?', placeholder: 'In a sentence or two.', type: 'text' },
      { key: 'feeling', label: 'What feeling showed up?', placeholder: 'One or two words is fine.', type: 'text' },
      { key: 'thought', label: 'What did your mind tell you about it?', placeholder: 'The meaning you gave it.', type: 'text' },
    ],
    completion: 'You mapped a feeling.',
  },
  {
    theme: 'SEPARATE',
    title: 'My Space of Control',
    intro: 'Not everything on your mind is yours to carry or solve right now. Let\u2019s sort what is here.',
    question: 'Sort what is on your mind.',
    fields: [
      { key: 'canActOn', label: 'I can act on this', placeholder: 'One thing per line.', type: 'list' },
      { key: 'outsideMyControl', label: 'Outside my control', placeholder: 'One thing per line.', type: 'list' },
      { key: 'notNow', label: 'Not now', placeholder: 'One thing per line.', type: 'list' },
    ],
    completion: 'You sorted what is in your hands.',
  },
  {
    theme: 'CHOOSE',
    title: 'My Next Small Move',
    intro: 'From reflection to one realistic step. Small counts.',
    question: 'What would help most right now?',
    choices: ['Focus on one thing', 'Permission to rest', 'Get some energy', 'Connect with someone', 'Make my space easier', 'Feel a little calmer'],
    fields: [{ key: 'situation', label: 'What is happening right now?', placeholder: 'e.g. I have an assignment tomorrow and haven\u2019t started.', type: 'text' }],
    prompt: 'Your own idea for a move (optional)',
    completion: 'You chose one small move.',
  },
  {
    theme: 'PAUSE',
    title: 'My Pause Moment',
    intro: 'A short break from automatic mental activity. Nothing needs to change.',
    question: 'Choose a gentle pause.',
    choices: ['Look around', 'Try a breathing pause', 'Skip for now'],
    noticeOptions: ['A little calmer', 'More aware', 'No real change', 'Distracted', 'I preferred another activity', 'Not sure'],
    completion: 'You gave yourself a pause.',
  },
  {
    theme: 'RESPOND DIFFERENTLY',
    title: 'My Kinder Reminder',
    intro: 'A chance to answer yourself the way you would answer someone you care about.',
    question: 'Choose what this is about, if you would like.',
    choices: ['I made a mistake', 'I didn\u2019t finish what I planned', 'I compared myself', 'I said something I regret', 'I feel behind'],
    fields: [
      { key: 'situation', label: 'What happened?', placeholder: 'In your own words.', type: 'text' },
      { key: 'selfTalk', label: 'What did you say to yourself?', placeholder: 'The first thing your mind said.', type: 'text' },
      { key: 'myOwnWords', label: 'If a friend you cared about had the same thing happen, what would you say to them?', placeholder: 'Your own kind words.', type: 'text' },
    ],
    completion: 'You found a kinder word.',
  },
  {
    theme: 'INTEGRATE',
    title: 'My MIRAAI Reset Report',
    intro: 'Let\u2019s bring your week together into something you can keep.',
    question: 'What do you want to carry forward?',
    choices: ['I can take one thing at a time', 'I do not have to control everything', 'I can pause before responding', 'I can give myself more time'],
    prompt: 'Add your own reminder (optional)',
    completion: 'You brought your week together.',
  },
]

const LOADING_MESSAGES = ['Reading what you shared\u2026', 'Putting your reflection together\u2026', 'Creating your personal card\u2026']

function journeyToEntries(journey: Journey): Entry[] {
  const out: Entry[] = []
  for (let d = 1; d <= 7; d++) {
    const source = journey as unknown as Record<string, unknown>
    const resp = source[`day_${d}_responses`] as { choice?: string; response?: string; choices?: string[]; fields?: Record<string, string>; savedAt?: string } | undefined
    const card = (d === 7 ? journey.day_7_report : source[`day_${d}_ai_output`]) as AiResult | undefined
    const hasResponse = !!(resp && (resp.choice || resp.response || (resp.choices && resp.choices.length > 0) || Object.keys(resp.fields || {}).length > 0))
    const hasCard = !!(card && ((card.blocks && card.blocks.length > 0) || card.reflection))
    if (!hasResponse && !hasCard) continue
    const parsed = resp?.savedAt ? new Date(resp.savedAt) : new Date()
    const when = Number.isNaN(parsed.getTime()) ? new Date() : parsed
    out.push({ day: d, title: DAYS[d - 1]?.title || '', choice: resp?.choice || '', response: resp?.response || '', fields: resp?.fields || {}, card: card?.blocks || [], reflection: card?.reflection || '', reminder: card?.reminder || '', date: when.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }) })
  }
  return out
}

function Button({ children, onClick, disabled = false, soft = false }: { children: React.ReactNode; onClick: () => void | Promise<void>; disabled?: boolean; soft?: boolean }) {
  return <button disabled={disabled} onClick={() => void Promise.resolve(onClick()).catch(() => undefined)} className={'button press ' + (soft ? 'button-soft ' : '') + 'inline-flex items-center gap-1.5'}>{children}</button>
}
function Frame({ children, overlay }: { children: React.ReactNode; overlay?: React.ReactNode }) {
  return <main className="app-bg"><div className="shell">{children}{overlay}</div></main>
}
function Logo() { return <div className="font-semibold tracking-[.16em] text-xs">HOPEMO AI</div> }
function ChipRow({ options, selected, multi, onToggle }: { options: string[]; selected: string[]; multi: boolean; onToggle: (v: string) => void }) {
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {options.map(item => {
        const on = selected.includes(item)
        const cls = 'glass press rounded-3xl p-4 text-left border transition ' + (on ? 'bg-[#dceff9] border-[#75b6da] scale-[1.01]' : 'border-transparent')
        return <button key={item} onClick={() => onToggle(item)} className={cls}><span className="serif text-lg">{item}</span></button>
      })}
    </div>
  )
}
function ProgressBar({ day }: { day: number }) {
  return <div className="text-center"><p className="text-xs text-[#376d8d]">Day {day} of 7</p><div className="w-28 h-1.5 rounded-full bg-white/60 mt-2 mx-auto"><div className="h-full rounded-full bg-[#4d92bd] transition-all" style={{ width: `${(day / 7) * 100}%` }} /></div></div>
}


function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="report-section">
      <h2 className="section-heading">{title}</h2>
      <div className="report-body">{children}</div>
    </section>
  )
}

export default function Home() {
  const [screen, setScreen] = useState<'landing' | 'home' | 'day' | 'result' | 'report' | 'safety'>('landing')
  const [name, setName] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [day, setDay] = useState(1)
  const [step, setStep] = useState(0)
  const [choices, setChoices] = useState<string[]>([])
  const [response, setResponse] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState('')
  const [chosenOption, setChosenOption] = useState('')
  const [ai, setAi] = useState<AiResult | null>(null)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState(LOADING_MESSAGES[0])
  const [error, setError] = useState('')
  const [sessionEmail, setSessionEmail] = useState<string | null>(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authName, setAuthName] = useState('')
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [payment, setPayment] = useState<{ loaded: boolean; entitled: boolean; configured: boolean; enforce: boolean }>({ loaded: false, entitled: false, configured: false, enforce: false })
  const [payLoading, setPayLoading] = useState(false)
  const [payError, setPayError] = useState('')

  useEffect(() => {
    let cancelled = false
    const restoreLocal = () => { try { const raw = localStorage.getItem('emotion-reset-v2'); if (raw) { const stored = JSON.parse(raw) as { name?: string; entries?: Entry[] }; setName(stored.name || ''); setEntries(Array.isArray(stored.entries) ? stored.entries.slice(0, 7) : []); setScreen('home') } } catch { localStorage.removeItem('emotion-reset-v2') } }
    ;(async () => {
      try {
        const session = await fetchSession()
        if (cancelled) return
        if (session.authenticated) setSessionEmail(session.email)
        // Payment/entitlement status (non-fatal if it fails).
        try {
          const st = await fetch('/api/payments/status')
          if (st.ok) {
            const s = await st.json() as { entitled?: boolean; configured?: boolean; enforce?: boolean }
            if (!cancelled) setPayment({ loaded: true, entitled: !!s.entitled, configured: !!s.configured, enforce: !!s.enforce })
          }
        } catch { /* ignore — payments are additive */ }
        const { journey } = await fetchJourney()
        if (cancelled) return
        if (journey) {
          const restored = journeyToEntries(journey)
          setName(journey.name || '')
          setEntries(restored)
          if (restored.length > 0 || journey.name) setScreen('home')
        } else { restoreLocal() }
      } catch { if (!cancelled) restoreLocal() }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!loading) { setLoadingMsg(LOADING_MESSAGES[0]); return }
    let i = 0
    const id = setInterval(() => { i = (i + 1) % LOADING_MESSAGES.length; setLoadingMsg(LOADING_MESSAGES[i]) }, 1800)
    return () => clearInterval(id)
  }, [loading])

  const persist = (updated: Entry[]) => { setEntries(updated); try { localStorage.setItem('emotion-reset-v2', JSON.stringify({ name, entries: updated })) } catch { /* ignore */ } }
  const nextDay = Math.min(entries.length + 1, 7)
  const current = DAYS[day - 1]

  const startDay = (value: number) => {
    setDay(value); setStep(0); setChoices([]); setResponse(''); setFields({}); setNotice(''); setChosenOption(''); setAi(null); setSaved(false); setError(''); setScreen('day')
  }
  const toggleChoice = (item: string) => {
    if (current.multi) setChoices(c => c.includes(item) ? c.filter(x => x !== item) : [...c, item])
    else setChoices(c => c.includes(item) ? [] : [item])
  }
  const hasInput = choices.length > 0 || response.trim().length > 0 || notice.trim().length > 0 || chosenOption.trim().length > 0 || Object.values(fields).some(v => v.trim().length > 0)
  const combinedChoice = [choices.join(' \u00b7 '), notice, chosenOption].filter(Boolean).join(' \u00b7 ')

  const needsPayment = payment.enforce && !payment.entitled

  const loadRazorpayScript = () => new Promise<void>((resolve, reject) => {
    if (typeof window !== 'undefined' && (window as unknown as { Razorpay?: unknown }).Razorpay) return resolve()
    const s = document.createElement('script')
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Could not load the secure checkout.'))
    document.body.appendChild(s)
  })

  const handleUnlock = async () => {
    if (!sessionEmail) { setAuthError('Sign in to unlock MIRAAI.'); openAuth('signin'); return }
    setPayLoading(true); setPayError('')
    try {
      const res = await fetch('/api/payments/create-order', { method: 'POST' })
      const data = await res.json() as { orderId?: string; amount?: number; currency?: string; keyId?: string; name?: string; description?: string; error?: string }
      if (!res.ok || !data.orderId) throw new Error(data.error || 'Could not start checkout.')
      await loadRazorpayScript()
      const Rz = (window as unknown as { Razorpay: new (o: unknown) => { open: () => void; on: (e: string, cb: () => void) => void } }).Razorpay
      const rzp = new Rz({
        key: data.keyId,
        order_id: data.orderId,
        amount: data.amount,
        currency: data.currency,
        name: data.name || 'MIRAAI',
        description: data.description || 'Your 7-day reflection journey',
        handler: async (resp: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          // The browser callback is NOT proof of payment — verify server-side.
          try {
            const vres = await fetch('/api/payments/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: resp.razorpay_order_id, paymentId: resp.razorpay_payment_id, signature: resp.razorpay_signature }) })
            const vdata = await vres.json() as { entitled?: boolean; error?: string }
            if (vres.ok && vdata.entitled) { setPayment(p => ({ ...p, entitled: true })); setPayError(''); setPayLoading(false) }
            else { setPayError(vdata.error || 'We could not confirm your payment.'); setPayLoading(false) }
          } catch { setPayError('Could not confirm your payment. Please try again.'); setPayLoading(false) }
        },
        modal: { ondismiss: () => setPayLoading(false) },
        theme: { color: '#183d59' },
      })
      rzp.on('payment.failed', () => { setPayError('That payment did not go through. You have not been charged — please try again.'); setPayLoading(false) })
      rzp.open()
    } catch (e) { setPayError(e instanceof Error ? e.message : 'Checkout could not start.'); setPayLoading(false) }
  }

  const generate = async () => {
    if (!hasInput) { setError('Choose an option or add your own words first.'); return }
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/reflection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        day, activity: `${current.theme}: ${current.title}`, choice: combinedChoice, choices, response, fields, history: entries,
      }) })
      const data = await res.json() as AiResult & { error?: string }
      if (!res.ok) {
        if (res.status === 401) { setAuthError(data.error || 'Sign in to continue your journey.'); setAuthOpen(true) }
        if (res.status === 402) { setPayError(data.error || 'Unlock MIRAAI to continue your journey.'); setScreen('home') }
        throw new Error(data.error || 'The reflection service is unavailable right now.')
      }
      if (data.safetyFlag) { setScreen('safety'); return }
      setAi(data); setSaved(false); setScreen('result')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create your reflection. Please try again.') } finally { setLoading(false) }
  }

  const saveReflection = async () => {
    if (!ai) return
    const entry: Entry = {
      day, title: current.title, choice: combinedChoice, response, fields, card: ai.blocks, reflection: ai.reflection,
      reminder: ai.reminder || response || choices[0] || '',
      date: new Date().toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
    }
    const updated = [...entries.filter(x => x.day !== day), entry].sort((a, b) => a.day - b.day)
    persist(updated); setSaved(true)
    try {
      await saveJourney({
        day, name,
        input: { day, activity: `${current.theme}: ${current.title}`, choice: combinedChoice, choices, response, fields, savedAt: new Date().toISOString() },
        aiOutput: { outputType: ai.outputType, title: ai.title, blocks: ai.blocks, reflection: ai.reflection, reminder: ai.reminder || '', safetyFlag: ai.safetyFlag },
      })
      setError('')
    } catch (e) {
      const status = (e as { status?: number }).status
      if (status === 401) { setAuthError('Sign in to save your journey across sessions.'); setAuthOpen(true) }
      else { setError('Saved on this device only \u2014 your journey store could not be reached right now.') }
    }
  }


  const report = useMemo(() => [...entries].sort((a, b) => a.day - b.day), [entries])
  // Reset-report content (Day 7), presented as the premium PDF document.
  const resetEntry = report.find((e) => e.day === 7)
  const resetCard = resetEntry?.card ?? []
  const byKey = (key: string): string => {
    const v = resetCard.find((b) => b.key === key)?.value
    return Array.isArray(v) ? v.join(' ') : (v ?? '')
  }
  const paragraph = (value: string) => String(value).replace(/\\s+/g, ' ').trim()
  const reset = paragraph(byKey('myResetInOneSentence'))
  const landscape = paragraph(byKey('whatINoticed'))
  const mind = paragraph(byKey('whatMyMindWasDoing'))
  const brought = paragraph(byKey('whatIBroughtWithMe'))
  const tried = paragraph(byKey('whatITried'))
  const noticedFrom = paragraph(byKey('whatINoticedFromTrying'))
  const hands = paragraph(byKey('whatWasInMyHands'))
  const ownWords = paragraph(byKey('myOwnWords'))
  const carry = paragraph(byKey('whatIWantToCarryForward'))

  const openAuth = (mode: 'signin' | 'signup') => { setAuthMode(mode); setAuthError(''); setAuthOpen(true) }

  const handleAuth = async () => {
    if (authLoading) return
    setAuthLoading(true); setAuthError('')
    try {
      const payload = { email: authEmail.trim(), password: authPassword, ...(authMode === 'signup' ? { name: authName.trim() } : {}) }
      const result = authMode === 'signin' ? await signIn(payload) : await signUp(payload)
      setSessionEmail(result.session?.user?.email || authEmail.trim())
      if (result.journey) {
        const restored = journeyToEntries(result.journey)
        setName(result.journey.name || authName.trim() || name)
        setEntries(restored)
        setScreen('home')
      }
      setAuthOpen(false); setAuthPassword('')
    } catch (e) { setAuthError(e instanceof Error ? e.message : 'Could not continue just now.') } finally { setAuthLoading(false) }
  }

  const handleSignOut = async () => {
    try { await signOut() } catch { /* drop local state even if the call fails */ }
    setSessionEmail(null); setEntries([]); setName('')
    try { localStorage.removeItem('emotion-reset-v2') } catch { /* ignore */ }
    setScreen('landing')
  }

  const authButton = sessionEmail
    ? <button onClick={() => void handleSignOut()} className="text-sm underline underline-offset-4">Sign out</button>
    : <button onClick={() => openAuth('signin')} className="text-sm underline underline-offset-4">Sign in</button>

  const authOverlay = authOpen ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={authMode === 'signin' ? 'Sign in' : 'Create your account'}>
      <div className="absolute inset-0 bg-[#183d59]/45 backdrop-blur-sm" onClick={() => setAuthOpen(false)} />
      <div className="glass rounded-3xl p-7 w-full max-w-md relative">
        <p className="eyebrow">{authMode === 'signin' ? 'Welcome back' : 'Create your space'}</p>
        <h2 className="serif text-3xl mt-2">{authMode === 'signin' ? 'Sign in' : 'Start saving'}</h2>
        <p className="text-sm text-[#4d6e82] mt-2">Your seven-day journey is saved privately to your account, so you can pick up right where you left off.</p>
        {authMode === 'signup' && <label className="block mt-5"><span className="text-xs tracking-wide text-[#376d8d]">Name</span><input value={authName} onChange={e => setAuthName(e.target.value)} className="glass w-full rounded-2xl p-3 mt-1 outline-none" placeholder="What should we call you?" autoComplete="name" /></label>}
        <label className="block mt-4"><span className="text-xs tracking-wide text-[#376d8d]">Email</span><input type="email" value={authEmail} onChange={e => setAuthEmail(e.target.value)} className="glass w-full rounded-2xl p-3 mt-1 outline-none" placeholder="you@example.com" autoComplete="email" /></label>
        <label className="block mt-4"><span className="text-xs tracking-wide text-[#376d8d]">Password</span><input type="password" value={authPassword} onChange={e => setAuthPassword(e.target.value)} className="glass w-full rounded-2xl p-3 mt-1 outline-none" placeholder="At least 6 characters" autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'} /></label>
        {authError && <p className="text-sm text-[#8a3d45] mt-4">{authError}</p>}
        <div className="flex flex-wrap gap-3 mt-6">
          <Button disabled={authLoading} onClick={handleAuth}>{authMode === 'signin' ? 'Sign in' : 'Create account'}</Button>
          <Button soft onClick={() => { setAuthMode(m => m === 'signin' ? 'signup' : 'signin'); setAuthError('') }}>{authMode === 'signin' ? 'I need an account' : 'I already have one'}</Button>
          <Button soft onClick={() => setAuthOpen(false)}>Not now</Button>
        </div>
      </div>
    </div>
  ) : null

  if (screen === 'landing') return <Frame overlay={authOverlay}>
    <nav className="flex justify-between items-center"><Logo /><span className="text-sm text-[#4d6e82]">7 gentle days</span>{authButton}</nav>
    <section className="grid lg:grid-cols-2 items-center gap-12 min-h-[82vh]">
      <div>
        <p className="eyebrow mt-10">MIRAAI by HOPEMO AI</p>
        <h1 className="serif text-6xl sm:text-7xl mt-5">A quiet<br />space for<br />your week.</h1>
        <p className="text-xl text-[#4d6e82] mt-7 max-w-xl">For the everyday ups and downs \u2014 when things feel emotionally out of balance.</p>
        <p className="text-[#4d6e82] mt-3 max-w-lg">Seven short days to notice what you are carrying, understand it, separate what is in your hands, and keep one or two things that are useful. No scores. No pressure. One small moment at a time.</p>
        <ul className="flex flex-wrap gap-2 mt-7 text-xs">
          {DAYS.map(d => <li key={d.theme} className="glass rounded-full px-3.5 py-1.5 text-[#376d8d]">{d.theme}</li>)}
        </ul>
        <div className="mt-9"><Button onClick={() => setScreen('home')}>Start my reset <ArrowRight size={16} className="inline ml-1" /></Button></div>
      </div>
      <div className="relative flex justify-center">
        <div className="orb w-72 h-72 sm:w-96 sm:h-96 rounded-[42%]" />
        <div className="absolute glass rounded-2xl p-4 top-6 right-0 text-sm">notice what is here</div>
        <div className="absolute glass rounded-2xl p-4 bottom-8 left-0 text-sm">keep what is useful</div>
      </div>
    </section>
  </Frame>

  if (screen === 'home') return <Frame overlay={authOverlay}>
    <header className="flex justify-between items-center"><Logo /><button onClick={() => setScreen('report')} className="text-sm underline underline-offset-4">Your week</button>{authButton}</header>
    <div className="max-w-3xl mt-16">
      <p className="eyebrow">Your space</p>
      <h1 className="serif text-5xl mt-4">{name ? `Welcome back${name ? ', ' + name.split(' ')[0] : ''}.` : 'Make a little space.'}</h1>
      <p className="text-[#4d6e82] mt-4">{entries.length ? `Day ${nextDay} is ready whenever you are. No catching up, no pressure.` : 'Start whenever you are ready. One small day at a time.'}</p>
      {entries.length === 7 && <p className="text-[#376d8d] mt-3">You have completed all seven days. Your full report is waiting in \u201cYour week\u201d.</p>}
      <section className="mt-9 rounded-[2rem] bg-[#183d59] text-white p-7 sm:p-9 relative overflow-hidden">
        <div className="absolute -right-14 -top-16 w-48 h-48 rounded-full bg-[#83c1e5]/60 blur-2xl" />
        <div className="relative">
          <p className="text-xs tracking-[.16em] text-[#b9ddf0]">DAY {nextDay} OF 7 \u00b7 {DAYS[nextDay - 1].theme}</p>
          <h2 className="serif text-3xl mt-3">{DAYS[nextDay - 1].title}</h2>
          <p className="mt-3 text-white/75 max-w-lg">{DAYS[nextDay - 1].intro}</p>
          <div className="mt-7"><Button soft disabled={payLoading} onClick={() => needsPayment ? void handleUnlock() : startDay(nextDay)}>{needsPayment ? (payLoading ? 'Opening checkout…' : 'Unlock MIRAAI · ₹79') : (entries.length ? 'Continue Day ' + nextDay : 'Begin Day ' + nextDay)} <ArrowRight size={16} className="inline ml-1" /></Button></div>
          {needsPayment && <p className="text-sm text-white/70 mt-3 max-w-lg">One-time ₹79 for the full seven-day journey — your reflections, saved privately to your account.</p>}
          {needsPayment && payError && <p className="text-sm text-[#ffd9d9] mt-2">{payError}</p>}
        </div>
      </section>
      <div className="mt-6 glass rounded-3xl p-6">
        <div className="flex justify-between items-center">
          <div>
            <p className="serif text-2xl">{entries.length} of 7 days saved</p>
            <p className="text-sm text-[#4d6e82] mt-1">{sessionEmail ? 'Saved privately to your account.' : 'Saved on this device. Sign in to keep it across devices.'}</p>
          </div>
          <div className="flex gap-1">{DAYS.map((_, i) => <i key={i} className={'w-2.5 h-2.5 rounded-full ' + (i < entries.length ? 'bg-[#4d92bd]' : 'bg-[#d8ebf5]')} />)}</div>
        </div>
      </div>
      {entries.length > 0 && <div className="mt-8">
        <p className="eyebrow mb-4">Your days</p>
        <div className="grid sm:grid-cols-2 gap-3">{entries.map(x => <button key={x.day} onClick={() => startDay(x.day)} className="glass press rounded-2xl text-left p-5"><span className="text-xs text-[#376d8d]">DAY {x.day} \u00b7 {DAYS[x.day - 1].theme}</span><p className="serif text-xl mt-2">{x.title}</p><p className="text-sm text-[#4d6e82] mt-2">View or update this day</p></button>)}</div>
      </div>}
    </div>
  </Frame>

  if (screen === 'day') return <Frame overlay={authOverlay}>
    <div className="flex justify-between items-center mb-12">
      <button onClick={() => setScreen('home')} className="w-10 h-10 glass rounded-full flex items-center justify-center" aria-label="Back"><ArrowLeft size={18} /></button>
      <ProgressBar day={day} />
      <div className="w-10" />
    </div>
    <div className="max-w-2xl mx-auto">
      <p className="eyebrow">Day {day} \u00b7 {current.theme}</p>
      {step === 0 ? <>
        <h1 className="serif text-5xl mt-4">{current.title}</h1>
        <p className="text-[#4d6e82] mt-5 max-w-xl text-lg leading-relaxed">{current.intro}</p>
        <div className="mt-8"><Button onClick={() => setStep(1)}>Begin <ArrowRight size={16} className="inline ml-1" /></Button></div>
      </> : <>
        <h1 className="serif text-4xl sm:text-5xl mt-4">{current.question}</h1>
        <p className="text-[#4d6e82] mt-4">Choose what feels closest, or add your own words below.</p>
        {current.choices && current.choices.length > 0 && <div className="mt-8"><ChipRow options={current.choices} selected={choices} multi={!!current.multi} onToggle={toggleChoice} /></div>}
        {(current.extraChips ?? []).map(cg => <div key={cg.key} className="mt-8">
          <p className="text-sm text-[#376d8d] mb-3">{cg.label}</p>
          <ChipRow options={cg.options} selected={notice ? [notice] : []} multi={false} onToggle={v => setNotice(n => n === v ? '' : v)} />
        </div>)}
        {current.noticeOptions && current.noticeOptions.length > 0 && <div className="mt-8">
          <p className="text-sm text-[#376d8d] mb-3">After your pause \u2014 what did you notice?</p>
          <ChipRow options={current.noticeOptions} selected={notice ? [notice] : []} multi={false} onToggle={v => setNotice(n => n === v ? '' : v)} />
        </div>}

        {(current.fields ?? []).map(f => <div key={f.key} className="mt-6">
          <label className="block"><span className="text-sm text-[#376d8d]">{f.label}</span>
            <textarea value={fields[f.key] ?? ''} onChange={e => setFields(v => ({ ...v, [f.key]: e.target.value }))} placeholder={f.placeholder} rows={f.type === 'list' ? 3 : 2} className="glass w-full resize-none rounded-3xl p-5 outline-none mt-2" />
          </label>
        </div>)}
        {day === 4 && ai && ai.blocks.some(b => b.key === 'options') && <div className="mt-6">
          <p className="text-sm text-[#376d8d] mb-3">Which small move would you like to choose?</p>
          <div className="grid gap-3">{(() => { const opts = ai.blocks.find(b => b.key === 'options'); const arr = Array.isArray(opts?.value) ? opts!.value : []; return arr.map((o, i) => <button key={i} onClick={() => setChosenOption(c => c === o ? '' : o)} className={'glass press rounded-3xl p-4 text-left border transition ' + (chosenOption === o ? 'bg-[#dceff9] border-[#75b6da] scale-[1.01]' : 'border-transparent')}><span className="serif text-lg">{o}</span></button>) })()}</div>
        </div>}
        {current.prompt && <textarea value={response} onChange={e => setResponse(e.target.value)} placeholder={current.prompt} className="glass w-full h-28 resize-none rounded-3xl p-6 outline-none mt-6" />}
        <p className="text-xs text-[#4d6e82] mt-3">Optional. Your words are saved to your journey.</p>
        {loading && <div className="mt-5 glass rounded-2xl p-5 flex items-center gap-3" role="status" aria-live="polite"><span className="w-2 h-2 rounded-full bg-[#4d92bd] animate-pulse" /><span className="text-sm text-[#376d8d]">{loadingMsg}</span></div>}
        {error && !loading && <div className="mt-5 rounded-2xl bg-white/65 p-4 text-sm text-[#8a3d45]">{error}</div>}
        <div className="flex flex-wrap gap-3 mt-8">
          <Button soft onClick={() => setScreen('home')}>Not now</Button>
          <Button disabled={loading || !hasInput} onClick={generate}>{loading ? 'Creating\u2026' : 'Create my reflection'}{!loading && <Sparkles size={16} className="inline ml-1" />}</Button>
        </div>
      </>}
    </div>
  </Frame>

  if (screen === 'result') return <Frame overlay={authOverlay}>
    <div className="max-w-xl mx-auto py-12">
      <p className="eyebrow text-center">{saved ? `Day ${day} complete` : `Day ${day} \u00b7 ${current.theme}`}</p>
      <h1 className="serif text-5xl text-center mt-4">{ai?.title || current.title}</h1>
      {saved && <p className="text-center text-[#4d6e82] mt-4 text-lg">{current.completion}</p>}
      <div className="glass rounded-[2rem] p-7 mt-9">
        {(ai?.blocks ?? []).map(b => <div key={b.key} className="mt-5 first:mt-0">
          <p className="text-xs tracking-wide text-[#376d8d]">{b.label}</p>
          {Array.isArray(b.value) ? <ul className="mt-2 space-y-1.5">{b.value.map((v, i) => <li key={i} className="text-[#183d59] leading-relaxed">\u00b7 {v}</li>)}</ul> : <p className="text-[#183d59] leading-relaxed mt-1.5">{b.value}</p>}
        </div>)}
        {ai?.degraded && <p className="text-xs text-[#8a3d45] mt-5">We could not reach the full reflection right now, so this card is built only from your own words. You can regenerate to try again.</p>}
        <p className="text-xs text-[#4d6e82] mt-5">Built only from what you chose to share.</p>
      </div>
      {loading && <div className="mt-5 glass rounded-2xl p-5 flex items-center gap-3" role="status" aria-live="polite"><span className="w-2 h-2 rounded-full bg-[#4d92bd] animate-pulse" /><span className="text-sm text-[#376d8d]">{loadingMsg}</span></div>}
      {error && !loading && <div className="mt-5 rounded-2xl bg-white/65 p-4 text-sm text-[#8a3d45]">{error}</div>}
      <div className="flex flex-wrap gap-3 mt-7">{saved
        ? <><Button soft onClick={() => startDay(day)}>Edit this day</Button><Button onClick={() => { if (day === 7) { setScreen('report') } else { setScreen('home') } }}>{day === 7 ? 'See my report' : 'Continue to Day ' + Math.min(day + 1, 7)} <ArrowRight size={16} className="inline ml-1" /></Button></>
        : <><Button disabled={loading} onClick={saveReflection}><Check size={16} className="inline mr-1" />Save this card</Button><Button soft disabled={loading} onClick={generate}>Regenerate <Sparkles size={16} className="inline ml-1" /></Button><Button soft onClick={() => setScreen('home')}>Not now</Button></>}</div>
    </div>
  </Frame>

  if (screen === 'safety') return <Frame overlay={authOverlay}>
    <div className="max-w-xl mx-auto min-h-[80vh] flex items-center">
      <div className="glass rounded-[2rem] p-8">
        <p className="eyebrow">Pause here for support</p>
        <h1 className="serif text-4xl mt-4">You do not have to handle this alone.</h1>
        <p className="text-[#4d6e82] leading-relaxed mt-5">Please reach out to someone you trust who can stay with you, and contact local emergency or crisis support now if you may act on these thoughts. MIRAAI is not a substitute for that support.</p>
        <div className="mt-8"><Button onClick={() => setScreen('home')}>Return to my space</Button></div>
      </div>
    </div>
  </Frame>

  if (screen === 'report') return <Frame overlay={authOverlay}>
    <div className="max-w-2xl mx-auto py-6">
      <button onClick={() => setScreen('home')} className="w-10 h-10 glass rounded-full flex items-center justify-center"><ArrowLeft size={18} /></button>
      <p className="eyebrow mt-10">MIRAAI by HOPEMO AI \u00b7 Your 7-Day Reset</p>
      <h1 className="serif text-5xl mt-4">My MIRAAI Reset Report</h1>
      <p className="text-[#4d6e82] mt-4 leading-relaxed">A personal reflection drawn from your seven-day journey — written from what you actually shared, not a summary of what you already knew.</p>
      <div className="mt-8 report-doc">
        <p className="eyebrow mb-3">What\u2019s inside</p>
        <ol className="list-inside list-decimal text-sm text-[#376d8d] space-y-1">
          <li>Priority summary</li>
          <li>The emotional landscape</li>
          <li>Patterns across seven days</li>
          <li>What made things harder</li>
          <li>Strengths, needs and resources</li>
          <li>Changes across the seven days</li>
          <li>What could help going forward</li>
          <li>Closing reflection</li>
        </ol>
        <div className="mt-6 report-priority-summary">
          <p className="report-eyebrow">Priority summary</p>
          <ul className="report-body space-y-2">
            <li><strong>Main themes:</strong> {landscape}</li>
            <li><strong>Most significant recurring pattern:</strong> {mind}</li>
            <li><strong>Most useful area to explore next:</strong> {hands}</li>
            <li><strong>One practical starting point:</strong> {carry}</li>
          </ul>
        </div>
        <div className="mt-8 grid gap-8 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <p className="serif text-5xl mt-1 leading-[1.15]">{reset}</p>
            <p className="text-[#4d6e82] mt-3 leading-relaxed">This report is written in the third person, from the whole of your seven-day journey, and is grounded only in what you chose to share.</p>
          </div>
        </div>
        <div className="mt-8 space-y-7">
          <Section title="The emotional landscape">{landscape}</Section>
          <Section title="What my mind was doing">{mind}</Section>
          <Section title="Patterns across seven days">
            {brought}
            <p className="mt-3 text-[#183d59] leading-relaxed">{tried}</p>
            <p className="mt-3 text-[#183d59] leading-relaxed">{noticedFrom}</p>
          </Section>
          <Section title="What became clearer">
            {carry}
          </Section>
          <Section title="Strengths, needs and resources">
            <p className="text-[#183d59] leading-relaxed">{hands}</p>
            <p className="mt-3 text-[#183d59] leading-relaxed">{ownWords}</p>
          </Section>
          <Section title="Changes across the seven days">
          <p className="text-[#183d59] leading-relaxed">{mind}</p>
          <p className="mt-3 text-[#183d59] leading-relaxed">{carry}</p>
          <p className="mt-3 text-[#183d59] leading-relaxed">{reset}</p>
        </Section>
        <Section title="What could help going forward">
          <p className="text-[#183d59] leading-relaxed">{carry}</p>
          <p className="mt-3 text-[#183d59] leading-relaxed report-body-text--question">What is the smallest next step you feel ready to take this week?</p>
        </Section>
          <Section title="My reset in one sentence">
            <p className="text-[#183d59] leading-relaxed">{reset}</p>
          </Section>
        </div>
        <div className="mt-10 border-t border-[#e2e8f0] pt-8">
          <p className="serif text-2xl text-[#18334b]">Thank you for giving this week your attention.</p>
          <p className="text-[#4d6e82] mt-3 leading-relaxed">This reflection is a record of your own words and choices. It is not a diagnosis, and it is not a substitute for professional support when you need it. If anything you read felt heavy, or if you want to talk it through, reach out to someone you trust.</p>
        </div>
      </div>
      {report.length ? <div className="mt-9 grid gap-4">
        {report.map(entry => entry.day === 7 ? null : <article key={entry.day} className="glass rounded-3xl p-7">
          <p className="eyebrow">Day {entry.day} \u00b7 {entry.title}</p>
          {entry.card && entry.card.length ? <div className="mt-3">{entry.card.map(b => <div key={b.key} className="mt-3.5"><p className="text-xs tracking-wide text-[#376d8d]">{b.label}</p>{Array.isArray(b.value) ? <ul className="mt-1 space-y-1">{b.value.map((v, i) => <li key={i} className="text-[#183d59] leading-relaxed">\u00b7 {v}</li>)}</ul> : <p className="text-[#183d59] leading-relaxed mt-1">{b.value}</p>}</div>)}</div>
            : <><p className="serif text-2xl mt-3">{entry.choice || 'Your own words'}</p><p className="text-[#4d6e82] leading-relaxed mt-3">{entry.reflection}</p></>}
          {entry.reminder && <p className="text-sm mt-5 pt-4 border-t border-white/70">{entry.reminder}</p>}
        </article>)}
      </div> : <div className="glass rounded-3xl p-7 mt-8">Your saved reflections will appear here as you complete each day.</div>}
      <div className="mt-7 no-print">{report.length > 0 && <Button soft onClick={() => window.print()}><Download size={16} className="inline mr-1" />Download this report</Button>}</div>
    </div>
  </Frame>
}
