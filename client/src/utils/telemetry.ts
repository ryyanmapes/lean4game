const CONSENT_KEY = 'telemetryConsent'
const LEGACY_USER_ID_KEY = 'telemetryUserId'
const USER_COOKIE = 'lean_game_anonymous_id'
const QUEUE_KEY = 'telemetryQueueV2'
const MAX_QUEUED_EVENTS = 500
const MAX_QUEUE_BYTES = 2 * 1024 * 1024
const MAX_BATCH_BYTES = 400 * 1024

export type ConsentState = 'accepted' | 'refused' | 'undecided'
export type TelemetryMode = 'visual' | 'classic'

type BaseEvent = {
  event_id?: string
  event_type: 'level_start' | 'proof_step' | 'level_complete'
  game_id: string
  world_id: string
  level_id: number
  attempt_uuid: string
  mode: TelemetryMode
  sequence: number
  elapsed_ms: number
}

export type TelemetryEvent = BaseEvent & {
  step_type?: 'command' | 'undo' | 'edit'
  command?: string
  from_line?: number
  removed_lines?: number
  initial_script?: string
  play_script?: string
  lean_script?: string
  source_attempt_uuid?: string
}

type QueuedEvent = TelemetryEvent & {
  event_id: string
  user_uuid: string
  ts: string
}

let flushing = false
let retryDelayMs = 1000
let retryTimer: number | undefined

export function getConsentState(): ConsentState {
  try {
    const value = localStorage.getItem(CONSENT_KEY)
    if (value === 'accepted' || value === 'refused') return value
  } catch {}
  return 'undecided'
}

export function setConsent(accepted: boolean): void {
  try {
    localStorage.setItem(CONSENT_KEY, accepted ? 'accepted' : 'refused')
    if (accepted) {
      getOrCreateUserId()
      void flushTelemetry()
    } else {
      localStorage.removeItem(QUEUE_KEY)
      expireCookie(USER_COOKIE)
    }
  } catch {}
}

function readCookie(name: string): string | null {
  try {
    const prefix = `${encodeURIComponent(name)}=`
    const item = document.cookie.split(';').map(value => value.trim())
      .find(value => value.startsWith(prefix))
    return item ? decodeURIComponent(item.slice(prefix.length)) : null
  } catch {
    return null
  }
}

function writeCookie(name: string, value: string): void {
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Path=/; Max-Age=34560000; SameSite=Lax${secure}`
}

function expireCookie(name: string): void {
  try {
    document.cookie = `${encodeURIComponent(name)}=; Path=/; Max-Age=0; SameSite=Lax`
  } catch {}
}

export function getOrCreateUserId(): string | null {
  if (getConsentState() !== 'accepted') return null
  try {
    let id = readCookie(USER_COOKIE)
    if (!id) {
      // Preserve an identifier created by the previous local-storage-only client.
      id = localStorage.getItem(LEGACY_USER_ID_KEY) || createTelemetryId()
      writeCookie(USER_COOKIE, id)
      localStorage.removeItem(LEGACY_USER_ID_KEY)
    }
    return id
  } catch {
    return null
  }
}

export function createTelemetryId(): string {
  try {
    if (crypto.randomUUID) return crypto.randomUUID()
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  } catch {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
      const random = Math.floor(Math.random() * 16)
      return (character === 'x' ? random : (random & 0x3) | 0x8).toString(16)
    })
  }
}

/** Compatibility name used by the existing visual proof page. */
export const createSolvingId = createTelemetryId

function telemetryEndpoint(): string {
  const configured = String(import.meta.env.VITE_TELEMETRY_URL ?? '').trim()
  return configured ? `${configured.replace(/\/$/u, '')}/v1/events` : ''
}

function readQueue(): QueuedEvent[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.slice(-MAX_QUEUED_EVENTS) : []
  } catch {
    return []
  }
}

function writeQueue(events: QueuedEvent[]): void {
  try {
    const retained = events.slice(-MAX_QUEUED_EVENTS)
    let encoded = JSON.stringify(retained)
    while (retained.length > 0 && encoded.length > MAX_QUEUE_BYTES) {
      retained.shift()
      encoded = JSON.stringify(retained)
    }
    localStorage.setItem(QUEUE_KEY, encoded)
  } catch {}
}

function utf8Size(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

export function sendTelemetry(event: TelemetryEvent): void {
  const endpoint = telemetryEndpoint()
  const user_uuid = getOrCreateUserId()
  if (!endpoint || !user_uuid) return
  const queued: QueuedEvent = {
    ...event,
    event_id: event.event_id ?? createTelemetryId(),
    user_uuid,
    ts: new Date().toISOString(),
  }
  if (queued.command) queued.command = queued.command.slice(0, 64 * 1024)
  if (queued.initial_script) queued.initial_script = queued.initial_script.slice(0, 256 * 1024)
  if (queued.play_script) queued.play_script = queued.play_script.slice(0, 256 * 1024)
  if (queued.lean_script) queued.lean_script = queued.lean_script.slice(0, 256 * 1024)
  writeQueue([...readQueue(), queued])
  void flushTelemetry()
}

export async function flushTelemetry(): Promise<void> {
  const endpoint = telemetryEndpoint()
  if (!endpoint || flushing || getConsentState() !== 'accepted') return
  const queue = readQueue()
  if (!queue.length) return
  flushing = true
  const batch: QueuedEvent[] = []
  for (const event of queue.slice(0, 50)) {
    const candidate = [...batch, event]
    if (batch.length > 0 && utf8Size({ events: candidate }) > MAX_BATCH_BYTES) break
    batch.push(event)
  }
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: batch }),
      keepalive: true,
    })
    const sent = new Set(batch.map(event => event.event_id))
    if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
      // Invalid client events cannot become valid by retrying. Drop that batch;
      // server/rate-limit failures remain queued.
      writeQueue(readQueue().filter(event => !sent.has(event.event_id)))
      retryDelayMs = 1000
    } else {
      retryDelayMs = Math.min(retryDelayMs * 2, 60000)
    }
  } catch {
    // Retain events for the next page action or online event.
    retryDelayMs = Math.min(retryDelayMs * 2, 60000)
  } finally {
    flushing = false
    if (readQueue().length > 0 && navigator.onLine) {
      if (retryTimer !== undefined) window.clearTimeout(retryTimer)
      retryTimer = window.setTimeout(() => {
        retryTimer = undefined
        void flushTelemetry()
      }, retryDelayMs)
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void flushTelemetry())
  window.setTimeout(() => void flushTelemetry(), 0)
}
