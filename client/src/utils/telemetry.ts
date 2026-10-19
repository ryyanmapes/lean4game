import { proofStateJson } from './feedbackJson'
import { detectPlatform, type TelemetryPlatform } from './telemetryPlatform'
import { IndexedDbQueueStore, MAX_EVENT_BYTES, MemoryQueueStore, type QueueStore, utf8Bytes } from './telemetryQueue'
import { FETCH_TIMEOUT_MS, type PostResult, TelemetryScheduler } from './telemetryScheduler'

/** Anonymous gameplay telemetry (doc/telemetry-client.md). Events go into a
 * durable queue shared by all tabs (telemetryQueue.ts) and are sent by one
 * scheduler (telemetryScheduler.ts) with batching, backoff and deadlines. */

const CONSENT_KEY = 'telemetryConsent'
const LEGACY_USER_ID_KEY = 'telemetryUserId'
const USER_COOKIE = 'lean_game_anonymous_id'
/** The localStorage queue of clients before the IndexedDB queue; migrated once. */
const LEGACY_QUEUE_KEY = 'telemetryQueueV2'
/** The collector's per-field ceilings (UTF-16 code units). Longer values are
 * not truncated: a truncated proof would be silently wrong. */
const MAX_COMMAND_LENGTH = 64 * 1024
const MAX_SCRIPT_LENGTH = 256 * 1024

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
  /** `rejected` and `view` record visual gestures that left the proof
   * unchanged (a refused gesture, a mode switch); replays skip them. */
  step_type?: 'command' | 'undo' | 'reset' | 'edit' | 'rejected' | 'view'
  command?: string
  /** `rejected` only: why, e.g. `lean-error`, `busy`, `statement-does-not-fit-goal`. */
  reason?: string
  /** `rejected` only: Lean's error message. */
  error?: string
  from_line?: number
  removed_lines?: number
  initial_script?: string
  play_script?: string
  lean_script?: string
  source_attempt_uuid?: string
}

/** Which build of the game is running: source revisions and build time. The
 * release build (lean4.js scripts/sync-lean4game-client.mjs) provides it; dev
 * servers have none. */
export type GameBuild = Partial<Record<
  'site' | 'client' | 'runtime' | 'nng4' | 'visualtest' | 'lean' | 'built', string
>>

const GAME_BUILD: GameBuild | null = (() => {
  try {
    const build: unknown = JSON.parse(String(import.meta.env.VITE_GAME_BUILD ?? ''))
    return build && typeof build === 'object' && !Array.isArray(build) ? build as GameBuild : null
  } catch {
    return null
  }
})()

/** Browser family and phone/tablet vs. computer, classified once here; the
 * user-agent string itself is never sent (telemetryPlatform.ts). */
const PLATFORM: TelemetryPlatform | null = detectPlatform()

type QueuedEvent = TelemetryEvent & {
  event_id: string
  user_uuid: string
  ts: string
  build?: GameBuild
  platform?: TelemetryPlatform
}

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
      localStorage.removeItem(LEGACY_QUEUE_KEY)
      localStorage.removeItem(LEGACY_USER_ID_KEY)
      expireCookie(USER_COOKIE)
    }
  } catch {}
  // Refusal erases every pending event in every store and stops sending,
  // including requests already in flight (their results are ignored).
  if (!accepted) void schedulerReady.then(scheduler => scheduler?.reset())
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

function telemetryBaseUrl(): string {
  const runtimeConfigured = typeof window !== 'undefined'
    ? String((window as Window & { __LEAN_TELEMETRY_URL__?: string }).__LEAN_TELEMETRY_URL__ ?? '').trim()
    : ''
  if (runtimeConfigured) {
    try { sessionStorage.setItem('leanTelemetryRuntimeUrl', runtimeConfigured) } catch {}
  }
  let persistedRuntime = ''
  try { persistedRuntime = sessionStorage.getItem('leanTelemetryRuntimeUrl') ?? '' } catch {}
  const configured = runtimeConfigured || persistedRuntime || String(import.meta.env.VITE_TELEMETRY_URL ?? '').trim()
  return configured ? configured.replace(/\/$/u, '') : ''
}

function telemetryEndpoint(): string {
  const baseUrl = telemetryBaseUrl()
  return baseUrl ? `${baseUrl}/v1/events` : ''
}

export type FeedbackReport = {
  message: string
  game_id: string
  world_id: string
  level_id: number
  mode: TelemetryMode
  proof_state: unknown
}

export async function submitFeedbackReport(report: FeedbackReport): Promise<boolean> {
  const baseUrl = telemetryBaseUrl()
  const message = report.message.trim()
  if (!baseUrl || !message || message.length > 1000) return false
  const userId = getConsentState() === 'accepted' ? getOrCreateUserId() : null
  const proofState = JSON.parse(proofStateJson(report.proof_state))
  const controller = new AbortController()
  const deadline = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  const response = await fetch(`${baseUrl}/v1/feedback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: controller.signal,
    body: JSON.stringify({
      report_id: createTelemetryId(),
      ...(userId ? { user_uuid: userId } : {}),
      ...report,
      proof_state: proofState,
      message,
      ts: new Date().toISOString(),
      ...(GAME_BUILD ? { build: GAME_BUILD } : {}),
      ...(PLATFORM ? { platform: PLATFORM } : {}),
    }),
  }).finally(() => window.clearTimeout(deadline))
  return response.ok
}

async function post(url: string, body: string, { keepalive, signal }: { keepalive: boolean; signal: AbortSignal }): Promise<PostResult> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    keepalive,
    signal,
    credentials: 'omit',
  })
  let json: unknown = null
  if ((response.headers.get('content-type') ?? '').includes('application/json')) {
    try { json = await response.json() } catch {}
  }
  // Readable cross-origin because the collector exposes Retry-After (CORS).
  return { status: response.status, retryAfter: response.headers.get('retry-after'), body: json }
}

/** The shared IndexedDB queue, or a per-tab memory queue without IndexedDB. */
async function openStore(): Promise<QueueStore<QueuedEvent>> {
  try {
    if (typeof indexedDB !== 'undefined') return await IndexedDbQueueStore.open<QueuedEvent>()
  } catch {}
  return new MemoryQueueStore<QueuedEvent>()
}

/** Move events from the old localStorage queue into the new one, once. */
async function migrateLegacyQueue(scheduler: TelemetryScheduler<QueuedEvent>): Promise<void> {
  let legacy: unknown = null
  try {
    legacy = JSON.parse(localStorage.getItem(LEGACY_QUEUE_KEY) ?? 'null')
  } catch {}
  try { localStorage.removeItem(LEGACY_QUEUE_KEY) } catch {}
  if (!Array.isArray(legacy) || legacy.length === 0 || getConsentState() !== 'accepted') return
  const events = legacy.filter((event): event is QueuedEvent =>
    Boolean(event) && typeof event === 'object' && typeof (event as QueuedEvent).event_id === 'string')
  if (events.length > 0) await scheduler.enqueue(events)
}

const schedulerReady: Promise<TelemetryScheduler<QueuedEvent> | null> = typeof window === 'undefined'
  ? Promise.resolve(null)
  : (async () => {
    const scheduler = new TelemetryScheduler<QueuedEvent>({
      store: await openStore(),
      post,
      baseUrl: telemetryBaseUrl,
      enabled: () => getConsentState() === 'accepted',
    })
    try {
      await migrateLegacyQueue(scheduler)
    } catch {}
    window.addEventListener('online', () => scheduler.onOnline())
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void scheduler.lifecycleFlush()
    })
    window.addEventListener('pagehide', () => void scheduler.lifecycleFlush())
    // Events queued by an earlier visit: send them soon, at a random moment,
    // so a cohort loading the page together does not send in step.
    scheduler.schedule(1000 + Math.random() * 4000)
    return scheduler
  })().catch(() => null)

function tooLong(value: string | undefined, limit: number): boolean {
  return typeof value === 'string' && value.length > limit
}

/** Queue one event. Returns whether it was accepted into the queue: false
 * without consent or an endpoint, or when the event is too large to send. */
export function sendTelemetry(event: TelemetryEvent): boolean {
  const endpoint = telemetryBaseUrl()
  const user_uuid = getOrCreateUserId()
  if (!endpoint || !user_uuid) return false
  const queued: QueuedEvent = {
    ...event,
    event_id: event.event_id ?? createTelemetryId(),
    user_uuid,
    ts: new Date().toISOString(),
    // Sent with every event: the collector records them on the attempt from
    // whichever event creates that, which is level_start unless it was lost.
    ...(GAME_BUILD ? { build: GAME_BUILD } : {}),
    ...(PLATFORM ? { platform: PLATFORM } : {}),
  }
  const oversize = tooLong(queued.command, MAX_COMMAND_LENGTH) || tooLong(queued.error, MAX_COMMAND_LENGTH) ||
    tooLong(queued.initial_script, MAX_SCRIPT_LENGTH) ||
    tooLong(queued.play_script, MAX_SCRIPT_LENGTH) || tooLong(queued.lean_script, MAX_SCRIPT_LENGTH) ||
    utf8Bytes(queued) > MAX_EVENT_BYTES
  void schedulerReady.then(async scheduler => {
    if (!scheduler) return
    // Counted (never sent): the collector would reject it as too large.
    if (oversize) await scheduler.recordOversize()
    else await scheduler.enqueue([queued])
  }).catch(() => {})
  return !oversize
}

export async function flushTelemetry(): Promise<void> {
  const scheduler = await schedulerReady
  await scheduler?.flush()
}
