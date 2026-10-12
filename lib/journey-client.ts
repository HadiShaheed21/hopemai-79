import type { Journey, DayInput, ReflectionCard } from './journey.types'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) },
    ...options,
  })
  const body: unknown = await res.json().catch(() => ({}))
  if (!res.ok) {
    const error = new Error((body as { error?: string }).error || 'Something went wrong.') as Error & { status?: number }
    error.status = res.status
    throw error
  }
  return body as T
}

export interface FetchJourneyResponse {
  journey: Journey | null
}

export interface SaveJourneyResponse {
  journey: Journey
}

export interface AuthPayload {
  email: string
  password: string
  name?: string
}

export interface SessionInfo {
  authenticated: boolean
  email: string | null
  configured: boolean
}

/** Load the logged-in customer's journey from the server. */
export async function fetchJourney(): Promise<FetchJourneyResponse> {
  return request<FetchJourneyResponse>('/api/journey')
}

/** Who is signed in (if anyone) — used to restore the session on page load. */
export async function fetchSession(): Promise<SessionInfo> {
  return request<SessionInfo>('/api/auth/session')
}

/** Persist a day's input + AI output, plus optional profile fields. */
export async function saveJourney(args: {
  day: number
  input: DayInput
  aiOutput: ReflectionCard
  name?: string
  email?: string | null
}): Promise<SaveJourneyResponse> {
  return request<SaveJourneyResponse>('/api/journey', {
    method: 'PATCH',
    body: JSON.stringify(args),
  })
}

/** Sign up a new customer and (if authenticated immediately) boot the journey. */
export async function signUp(payload: AuthPayload) {
  return request<{ session: any; journey: Journey }>('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** Sign in and bring the journey forward. */
export async function signIn(payload: Pick<AuthPayload, 'email' | 'password'>) {
  return request<{ session: any; journey: Journey }>('/api/auth/signin', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** Sign out. */
export async function signOut() {
  await request<void>('/api/auth/signout', { method: 'POST' })
}
