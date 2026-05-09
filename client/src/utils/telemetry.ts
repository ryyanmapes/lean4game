import { getAppRelativePath } from './url'

const CONSENT_KEY = 'telemetryConsent'
const USER_ID_KEY = 'telemetryUserId'

export type ConsentState = 'accepted' | 'refused' | 'undecided'

export function getConsentState(): ConsentState {
  try {
    const v = localStorage.getItem(CONSENT_KEY)
    if (v === 'accepted' || v === 'refused') return v
  } catch {}
  return 'undecided'
}

export function setConsent(accepted: boolean): void {
  try {
    localStorage.setItem(CONSENT_KEY, accepted ? 'accepted' : 'refused')
    if (accepted) getOrCreateUserId()
  } catch {}
}

export function getOrCreateUserId(): string | null {
  if (getConsentState() !== 'accepted') return null
  try {
    let id = localStorage.getItem(USER_ID_KEY)
    if (!id) {
      id = createSolvingId()
      localStorage.setItem(USER_ID_KEY, id)
    }
    return id
  } catch {
    return null
  }
}

export function createSolvingId(): string {
  try {
    if (crypto.randomUUID) return crypto.randomUUID()
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  } catch {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.floor(Math.random() * 16)
      const v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }
}

type LevelEvent =
  | {
      event_type: 'level_start'
      game_id: string
      world_id: string
      level_id: number
      solving_uuid: string
    }
  | {
      event_type: 'level_complete'
      game_id: string
      world_id: string
      level_id: number
      solving_uuid: string
      play_script: string
      lean_script: string
    }
  | {
      event_type: 'proof_step'
      game_id: string
      world_id: string
      level_id: number
      solving_uuid: string
      interactive_lean_code: string
    }

export function sendTelemetry(evt: LevelEvent): void {
  const user_uuid = getOrCreateUserId()
  if (!user_uuid) return
  const body = JSON.stringify({ ...evt, user_uuid, ts: new Date().toISOString() })
  try {
    void fetch(getAppRelativePath('telemetry'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {})
  } catch {}
}
