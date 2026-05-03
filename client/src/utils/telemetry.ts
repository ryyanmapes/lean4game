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
      id = crypto.randomUUID()
      localStorage.setItem(USER_ID_KEY, id)
    }
    return id
  } catch {
    return null
  }
}

type LevelEvent =
  | {
      event_type: 'level_start'
      game_id: string
      world_id: string
      level_id: number
    }
  | {
      event_type: 'level_complete'
      game_id: string
      world_id: string
      level_id: number
      play_script: string
      lean_script: string
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
