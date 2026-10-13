import { HEALTH_COUNTERS, type HealthCounters, type QueueEntry, type QueueStore } from './telemetryQueue'

/** The single telemetry sender (doc/telemetry-client.md).
 *
 * New events only append to the queue and ask for a flush; they never send
 * on their own and never shorten an active backoff. A flush sends queue
 * prefixes in order with ordinary fetch and a deadline, removes only events
 * the collector acknowledged (or terminally rejected), and backs off with
 * jitter on 408/429/5xx/network failures, honouring Retry-After. Page
 * lifecycle events send a small keepalive batch. One tab sends at a time. */

export const BATCH_MAX_EVENTS = 50
/** Body budget below the collector's 512 KiB limit, leaving room for the envelope. */
export const BATCH_MAX_BYTES = 448 * 1024
/** Browsers allow 64 KiB of in-flight keepalive bodies per page in total. */
export const KEEPALIVE_MAX_BYTES = 60 * 1024
export const FLUSH_MIN_MS = 2000
export const FLUSH_MAX_MS = 5000
export const SOON_MS = 250
export const SOON_EVENTS = 20
export const SOON_BYTES = 32 * 1024
export const FETCH_TIMEOUT_MS = 20000
export const BACKOFF_BASE_MS = 2000
export const BACKOFF_MAX_MS = 5 * 60 * 1000
export const RETRY_AFTER_MAX_MS = 60 * 60 * 1000
export const ONLINE_DELAY_MIN_MS = 1000
export const ONLINE_DELAY_MAX_MS = 15000
export const HEALTH_INTERVAL_MS = 10 * 60 * 1000
export const LEASE_TTL_MS = 30000
const MAX_BATCHES_PER_FLUSH = 20

export type PostResult = { status: number; retryAfter: string | null; body: unknown }
/** POST `body` as JSON; resolve with the response, reject on network failure or abort. */
export type Post = (url: string, body: string, options: { keepalive: boolean; signal: AbortSignal }) => Promise<PostResult>

export type QueuedEvent = { event_id: string; event_type: string }

export type SchedulerOptions<T extends QueuedEvent> = {
  store: QueueStore<T>
  post: Post
  /** Collector base URL, or '' when telemetry has no endpoint. */
  baseUrl: () => string
  /** Whether the player accepted telemetry. */
  enabled: () => boolean
  now?: () => number
  random?: () => number
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  online?: () => boolean
  /** Run `task` while holding the cross-tab sender lock; resolve null if
   * another tab holds it. Defaults to the Web Locks API, else a lease in the store. */
  withSenderLock?: <R>(task: () => Promise<R>) => Promise<R | null>
  owner?: string
}

/** Retry-After as milliseconds from `now`: delta-seconds or an HTTP-date. */
export function parseRetryAfter(value: string | null | undefined, now: number): number | null {
  if (value == null) return null
  const text = value.trim()
  let ms: number
  if (/^\d+$/u.test(text)) ms = Number(text) * 1000
  else {
    const date = Date.parse(text)
    if (!Number.isFinite(date)) return null
    ms = date - now
  }
  return Math.min(Math.max(ms, 0), RETRY_AFTER_MAX_MS)
}

/** Exponential backoff with jitter: half fixed, half random, so retries spread
 * out but never come back immediately. */
export function backoffDelay(failures: number, random: () => number): number {
  const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1))
  return ceiling / 2 + random() * (ceiling / 2)
}

function webLocks(): (<R>(task: () => Promise<R>) => Promise<R | null>) | null {
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined
  if (!locks?.request) return null
  return task => locks.request('lean-telemetry-sender', { ifAvailable: true }, lock => (lock ? task() : null)) as Promise<never>
}

export class TelemetryScheduler<T extends QueuedEvent> {
  private readonly store: QueueStore<T>
  private readonly post: Post
  private readonly baseUrl: () => string
  private readonly enabled: () => boolean
  private readonly now: () => number
  private readonly random: () => number
  private readonly setTimer: (callback: () => void, ms: number) => unknown
  private readonly clearTimer: (handle: unknown) => void
  private readonly online: () => boolean
  private readonly withSenderLock: <R>(task: () => Promise<R>) => Promise<R | null>
  private timer: unknown = null
  private timerDue = Infinity
  private flushing = false
  private failures = 0
  private lastFailure: 'network' | 'server' | null = null
  private nextAttemptAt = 0
  private protocol: 'v2' | 'v1' = 'v2'
  private batchLimit = BATCH_MAX_EVENTS
  private lastHealthAt = 0
  private keepaliveBytes = 0
  private generation = 0
  private readonly inflight = new Set<AbortController>()
  private loaded = false

  constructor(options: SchedulerOptions<T>) {
    this.store = options.store
    this.post = options.post
    this.baseUrl = options.baseUrl
    this.enabled = options.enabled
    this.now = options.now ?? (() => Date.now())
    this.random = options.random ?? Math.random
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms))
    this.clearTimer = options.clearTimer ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>))
    this.online = options.online ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false)
    const owner = options.owner ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    this.withSenderLock = options.withSenderLock ?? webLocks() ?? (async <R>(task: () => Promise<R>) => {
      if (!(await this.store.tryLease(owner, this.now(), LEASE_TTL_MS))) return null
      try {
        return await task()
      } finally {
        await this.store.releaseLease(owner)
      }
    })
  }

  /** Backoff and protocol choice survive reloads and are shared by tabs. */
  private async loadPersisted(): Promise<void> {
    const until = await this.store.getMeta('backoffUntil')
    if (typeof until === 'number') this.nextAttemptAt = Math.max(this.nextAttemptAt, until)
    if (!this.loaded) {
      if ((await this.store.getMeta('protocol')) === 'v1') this.protocol = 'v1'
      this.loaded = true
    }
  }

  /** Queue events (in order). Resolves with whether each was queued. */
  async enqueue(events: T[]): Promise<boolean[]> {
    const generation = this.generation
    const queued = await this.store.append(events, this.now())
    if (generation !== this.generation) return queued.map(() => false)
    const size = await this.store.size()
    const completion = events.some(event => event.event_type === 'level_complete')
    if (completion || size.events >= SOON_EVENTS || size.bytes >= SOON_BYTES) this.schedule(SOON_MS)
    else this.schedule(FLUSH_MIN_MS + this.random() * (FLUSH_MAX_MS - FLUSH_MIN_MS))
    return queued
  }

  /** Count an event refused before queueing because it is too large to send. */
  async recordOversize(): Promise<void> {
    await this.store.addCounters({ oversize: 1 })
  }

  /** Flush no earlier than `delayMs` from now and never before the backoff
   * deadline; an earlier pending flush is kept. */
  schedule(delayMs: number): void {
    const due = Math.max(this.now() + delayMs, this.nextAttemptAt)
    if (this.timer !== null && this.timerDue <= due) return
    if (this.timer !== null) this.clearTimer(this.timer)
    this.timerDue = due
    this.timer = this.setTimer(() => {
      this.timer = null
      this.timerDue = Infinity
      void this.flush()
    }, Math.max(0, due - this.now()))
  }

  /** After 'online': retry soon, at a random point so a whole classroom
   * reconnecting does not retry in step. Server-requested backoff stands. */
  onOnline(): void {
    if (this.lastFailure === 'network' || this.failures === 0) {
      // Network backoff from the offline period no longer applies; the
      // random reconnect delay replaces any retry already pending.
      const delay = ONLINE_DELAY_MIN_MS + this.random() * (ONLINE_DELAY_MAX_MS - ONLINE_DELAY_MIN_MS)
      if (this.timer !== null) this.clearTimer(this.timer)
      this.timer = null
      this.timerDue = Infinity
      this.nextAttemptAt = this.now() + delay
      this.schedule(delay)
    } else {
      this.schedule(0)
    }
  }

  /** Page hidden or unloading: send what fits the keepalive budget, unless backing off. */
  lifecycleFlush(): Promise<void> {
    return this.flush({ keepalive: true })
  }

  /** Telemetry refused: stop sending, abandon in-flight requests (their
   * results are ignored, nothing is re-queued) and erase all pending storage. */
  async reset(): Promise<void> {
    this.generation++
    for (const controller of this.inflight) controller.abort()
    this.inflight.clear()
    if (this.timer !== null) this.clearTimer(this.timer)
    this.timer = null
    this.timerDue = Infinity
    this.failures = 0
    this.lastFailure = null
    this.nextAttemptAt = 0
    await this.store.clear()
  }

  async flush({ keepalive = false }: { keepalive?: boolean } = {}): Promise<void> {
    if (!this.enabled() || !this.baseUrl() || this.flushing) return
    const generation = this.generation
    await this.loadPersisted()
    if (this.now() < this.nextAttemptAt) {
      if (!keepalive) this.schedule(0)
      return
    }
    if (!this.online()) return
    this.flushing = true
    let sentAll = false
    try {
      const outcome = await this.withSenderLock(async () => {
        for (let round = 0; round < MAX_BATCHES_PER_FLUSH; round++) {
          if (generation !== this.generation || !this.enabled()) return true
          const budget = keepalive ? KEEPALIVE_MAX_BYTES - this.keepaliveBytes : BATCH_MAX_BYTES
          if (budget <= 0) return false
          const batch = await this.store.peek(this.batchLimit, budget, this.now())
          if (batch.length === 0) return true
          // An event larger than the keepalive budget waits for an ordinary send.
          if (keepalive && batch.reduce((sum, entry) => sum + entry.bytes, 0) > budget) return false
          if (!(await this.send(batch, keepalive, generation))) return false
          if (keepalive) return false
        }
        return false
      })
      sentAll = outcome === true
      // A batch size reduced after 413 holds until the queue has been drained.
      if (sentAll) this.batchLimit = BATCH_MAX_EVENTS
    } finally {
      this.flushing = false
    }
    if (generation !== this.generation) return
    if (!sentAll && !keepalive) {
      const size = await this.store.size()
      // Another tab may hold the sender lock: check again later in case it closed.
      if (size.events > 0) this.schedule(FLUSH_MIN_MS + this.random() * (FLUSH_MAX_MS - FLUSH_MIN_MS))
    }
  }

  private async healthSnapshot(): Promise<Record<string, number> | null> {
    if (this.protocol !== 'v2' || this.now() - this.lastHealthAt < HEALTH_INTERVAL_MS) return null
    const counters = await this.store.counters()
    const size = await this.store.size()
    return { queue_events: size.events, queue_bytes: size.bytes, ...counters }
  }

  /** Send one batch. Returns true when the flush may continue. */
  private async send(batch: QueueEntry<T>[], keepalive: boolean, generation: number): Promise<boolean> {
    const health = await this.healthSnapshot()
    const events = batch.map(entry => entry.event)
    const protocol = this.protocol
    const body = JSON.stringify(protocol === 'v2' && health ? { events, client: { health } } : { events })
    const bodyBytes = new TextEncoder().encode(body).byteLength
    const controller = new AbortController()
    this.inflight.add(controller)
    const deadline = this.setTimer(() => controller.abort(), FETCH_TIMEOUT_MS)
    if (keepalive) this.keepaliveBytes += bodyBytes
    let result: PostResult
    try {
      result = await this.post(`${this.baseUrl()}/${protocol}/events`, body, { keepalive, signal: controller.signal })
    } catch {
      if (generation === this.generation) await this.failed(null, 'network')
      return false
    } finally {
      this.clearTimer(deadline)
      this.inflight.delete(controller)
      if (keepalive) this.keepaliveBytes -= bodyBytes
    }
    if (generation !== this.generation) return false
    const { status } = result

    if (protocol === 'v2' && (status === 404 || status === 405)) {
      // A collector without /v2: use the compatible endpoint from now on.
      this.protocol = 'v1'
      await this.store.setMeta('protocol', 'v1')
      return true
    }
    if (status >= 200 && status < 300) {
      const settled = this.settle(batch, protocol, result)
      await this.store.remove(settled.remove)
      await this.store.addCounters({ sent: settled.remove.length - settled.rejected, rejected: settled.rejected })
      if (health) {
        // Reset reported counters only once the collector has them.
        this.lastHealthAt = this.now()
        const subtract: Partial<HealthCounters> = {}
        for (const key of HEALTH_COUNTERS) subtract[key] = -(health[key] ?? 0)
        await this.store.addCounters(subtract)
      }
      if (settled.remove.length < batch.length) {
        // Results did not cover every event: retry the rest later, not in a loop.
        await this.failed(null, 'server')
        return false
      }
      this.failures = 0
      this.lastFailure = null
      this.nextAttemptAt = 0
      await this.store.setMeta('backoffUntil', 0)
      return true
    }
    if (status === 413 && batch.length > 1) {
      this.batchLimit = Math.max(1, Math.floor(batch.length / 2))
      return true
    }
    if (status === 408 || status === 429 || status >= 500) {
      await this.failed(result.retryAfter, 'server')
      return false
    }
    // Any other client error is terminal for these events: they cannot become
    // valid by retrying, and must not block the queue.
    await this.store.remove(batch.map(entry => entry.qid))
    await this.store.addCounters(status === 413 ? { oversize: batch.length } : { rejected: batch.length })
    return true
  }

  /** Entries the response settles: v2 per-event results (accepted, duplicate,
   * rejected), or the whole batch for v1. */
  private settle(batch: QueueEntry<T>[], protocol: 'v2' | 'v1', result: PostResult): { remove: number[]; rejected: number } {
    const results = (result.body as { results?: unknown } | null)?.results
    if (protocol === 'v1' || result.status !== 200 || !Array.isArray(results)) {
      return { remove: batch.map(entry => entry.qid), rejected: 0 }
    }
    const remove: number[] = []
    let rejected = 0
    for (const item of results as Array<{ index?: unknown; status?: unknown }>) {
      if (typeof item?.index !== 'number' || !batch[item.index]) continue
      if (item.status === 'accepted' || item.status === 'duplicate' || item.status === 'rejected') {
        remove.push(batch[item.index].qid)
        if (item.status === 'rejected') rejected++
      }
    }
    return { remove: [...new Set(remove)], rejected }
  }

  private async failed(retryAfter: string | null, kind: 'network' | 'server'): Promise<void> {
    this.failures++
    this.lastFailure = kind
    const now = this.now()
    const requested = parseRetryAfter(retryAfter, now)
    const backoff = backoffDelay(this.failures, this.random)
    // Spread clients that were all told the same Retry-After.
    const delay = requested === null ? backoff : Math.max(requested + this.random() * Math.min(requested * 0.2 + 1000, 30000), backoff / 2)
    this.nextAttemptAt = now + delay
    await this.store.setMeta('backoffUntil', this.nextAttemptAt)
    await this.store.addCounters({ retries: 1 })
    this.schedule(0)
  }

  /** For tests and diagnostics. */
  get state() {
    return { failures: this.failures, nextAttemptAt: this.nextAttemptAt, protocol: this.protocol, batchLimit: this.batchLimit }
  }
}
