/** The durable, bounded telemetry queue (doc/telemetry-client.md).
 *
 * Every tab of the game shares one IndexedDB queue. Each append, removal and
 * eviction is a single IndexedDB transaction, so tabs never overwrite each
 * other's unsent events (the previous localStorage queue was read, modified
 * and written back by each tab, losing events under contention). When
 * IndexedDB is unavailable (private modes, disabled storage) a per-tab memory
 * queue is used instead.
 *
 * Bounds are explicit: at most MAX_EVENTS events and MAX_QUEUE_BYTES UTF-8
 * bytes (the oldest are evicted first), events older than MAX_AGE_MS expire,
 * and an event larger than MAX_EVENT_BYTES is refused. Each case is counted
 * (never with event content) and reported to the collector as client health. */

export const MAX_EVENTS = 1000
export const MAX_QUEUE_BYTES = 2 * 1024 * 1024
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
/** Largest event that fits one request under the collector's 512 KiB limit. */
export const MAX_EVENT_BYTES = 440 * 1024

export type HealthCounter = 'evicted' | 'expired' | 'oversize' | 'rejected' | 'retries' | 'sent'
export type HealthCounters = Record<HealthCounter, number>
export const HEALTH_COUNTERS: HealthCounter[] = ['evicted', 'expired', 'oversize', 'rejected', 'retries', 'sent']

export type QueueEntry<T> = { qid: number; event: T; bytes: number; enqueuedAt: number }

export interface QueueStore<T> {
  /** Append events in order. Returns, per event, whether it was queued. */
  append(events: T[], now: number): Promise<boolean[]>
  /** The oldest entries, up to `limit` events and `maxBytes` (always at least
   * one entry when any is queued). Expired entries are dropped first. */
  peek(limit: number, maxBytes: number, now: number): Promise<QueueEntry<T>[]>
  remove(qids: number[]): Promise<void>
  /** Remove every queued event and all metadata (telemetry refused). */
  clear(): Promise<void>
  size(): Promise<{ events: number; bytes: number }>
  addCounters(changes: Partial<HealthCounters>): Promise<void>
  counters(): Promise<HealthCounters>
  getMeta(key: string): Promise<unknown>
  setMeta(key: string, value: unknown): Promise<void>
  /** Atomic sender lease for platforms without the Web Locks API. */
  tryLease(owner: string, now: number, ttlMs: number): Promise<boolean>
  releaseLease(owner: string): Promise<void>
}

const encoder = new TextEncoder()

export function utf8Bytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength
}

function zeroCounters(): HealthCounters {
  return { evicted: 0, expired: 0, oversize: 0, rejected: 0, retries: 0, sent: 0 }
}

function addTo(counters: HealthCounters, changes: Partial<HealthCounters>): HealthCounters {
  const next = { ...zeroCounters(), ...counters }
  for (const key of HEALTH_COUNTERS) next[key] = Math.max(0, next[key] + (changes[key] ?? 0))
  return next
}

/** A per-tab queue, used when IndexedDB is unavailable and in tests. */
export class MemoryQueueStore<T> implements QueueStore<T> {
  private entries: QueueEntry<T>[] = []
  private nextId = 1
  private bytes = 0
  private health = zeroCounters()
  private meta = new Map<string, unknown>()

  async append(events: T[], now: number): Promise<boolean[]> {
    const queued = events.map(event => {
      const bytes = utf8Bytes(event)
      if (bytes > MAX_EVENT_BYTES) {
        this.health.oversize++
        return false
      }
      this.entries.push({ qid: this.nextId++, event, bytes, enqueuedAt: now })
      this.bytes += bytes
      return true
    })
    while (this.entries.length > MAX_EVENTS || this.bytes > MAX_QUEUE_BYTES) {
      const evicted = this.entries.shift()!
      this.bytes -= evicted.bytes
      this.health.evicted++
    }
    return queued
  }

  async peek(limit: number, maxBytes: number, now: number): Promise<QueueEntry<T>[]> {
    while (this.entries.length > 0 && now - this.entries[0].enqueuedAt > MAX_AGE_MS) {
      this.bytes -= this.entries.shift()!.bytes
      this.health.expired++
    }
    const batch: QueueEntry<T>[] = []
    let bytes = 0
    for (const entry of this.entries) {
      if (batch.length >= limit || (batch.length > 0 && bytes + entry.bytes > maxBytes)) break
      batch.push(entry)
      bytes += entry.bytes
    }
    return batch
  }

  async remove(qids: number[]): Promise<void> {
    const removing = new Set(qids)
    this.entries = this.entries.filter(entry => {
      if (!removing.has(entry.qid)) return true
      this.bytes -= entry.bytes
      return false
    })
  }

  async clear(): Promise<void> {
    this.entries = []
    this.bytes = 0
    this.health = zeroCounters()
    this.meta.clear()
  }

  async size() { return { events: this.entries.length, bytes: this.bytes } }
  async addCounters(changes: Partial<HealthCounters>) { this.health = addTo(this.health, changes) }
  async counters() { return { ...this.health } }
  async getMeta(key: string) { return this.meta.get(key) }
  async setMeta(key: string, value: unknown) { this.meta.set(key, value) }
  async tryLease() { return true }
  async releaseLease() {}
}

const DB_NAME = 'lean-telemetry'
const EVENTS = 'events'
const META = 'meta'

function requestResult<R>(request: IDBRequest<R>): Promise<R> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** The shared queue in IndexedDB: store `events` (auto-increment key = order)
 * and store `meta` (totals, health counters, sender lease, backoff, protocol). */
export class IndexedDbQueueStore<T> implements QueueStore<T> {
  private constructor(private readonly db: IDBDatabase) {}

  static async open<T>(factory: IDBFactory = indexedDB): Promise<IndexedDbQueueStore<T>> {
    const request = factory.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(EVENTS)) db.createObjectStore(EVENTS, { keyPath: 'qid', autoIncrement: true })
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META)
    }
    const db = await requestResult(request)
    // Another tab upgrading the schema must not be blocked by this one.
    db.onversionchange = () => db.close()
    return new IndexedDbQueueStore<T>(db)
  }

  /** Run `body` in one transaction; resolves with its result after commit. */
  private run<R>(mode: IDBTransactionMode, body: (events: IDBObjectStore, meta: IDBObjectStore) => Promise<R> | R): Promise<R> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([EVENTS, META], mode)
      let result: R
      transaction.oncomplete = () => resolve(result)
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error ?? new Error('telemetry queue transaction aborted'))
      Promise.resolve(body(transaction.objectStore(EVENTS), transaction.objectStore(META))).then(
        value => { result = value },
        error => {
          try { transaction.abort() } catch {}
          reject(error)
        })
    })
  }

  private async totals(meta: IDBObjectStore): Promise<{ events: number; bytes: number }> {
    return ((await requestResult(meta.get('totals'))) as { events: number; bytes: number } | undefined) ?? { events: 0, bytes: 0 }
  }

  private async health(meta: IDBObjectStore): Promise<HealthCounters> {
    return { ...zeroCounters(), ...((await requestResult(meta.get('counters'))) as HealthCounters | undefined) }
  }

  /** Delete entries from the head while `drop(entry)` holds. */
  private headDelete(events: IDBObjectStore, drop: (entry: QueueEntry<T>) => boolean): Promise<QueueEntry<T>[]> {
    return new Promise((resolve, reject) => {
      const dropped: QueueEntry<T>[] = []
      const cursor = events.openCursor()
      cursor.onerror = () => reject(cursor.error)
      cursor.onsuccess = () => {
        const current = cursor.result
        if (!current || !drop(current.value as QueueEntry<T>)) return resolve(dropped)
        dropped.push(current.value as QueueEntry<T>)
        current.delete()
        current.continue()
      }
    })
  }

  append(events: T[], now: number): Promise<boolean[]> {
    return this.run('readwrite', async (store, meta) => {
      const totals = await this.totals(meta)
      const health = await this.health(meta)
      const queued: boolean[] = []
      for (const event of events) {
        const bytes = utf8Bytes(event)
        if (bytes > MAX_EVENT_BYTES) {
          health.oversize++
          queued.push(false)
          continue
        }
        await requestResult(store.add({ event, bytes, enqueuedAt: now }))
        totals.events++
        totals.bytes += bytes
        queued.push(true)
      }
      // Oldest first, only as many as needed to get back within both bounds.
      const evicted = await this.headDelete(store, entry => {
        if (totals.events <= MAX_EVENTS && totals.bytes <= MAX_QUEUE_BYTES) return false
        totals.events--
        totals.bytes -= entry.bytes
        return true
      })
      health.evicted += evicted.length
      meta.put(totals, 'totals')
      meta.put(health, 'counters')
      return queued
    })
  }

  peek(limit: number, maxBytes: number, now: number): Promise<QueueEntry<T>[]> {
    return this.run('readwrite', async (store, meta) => {
      const expired = await this.headDelete(store, entry => now - entry.enqueuedAt > MAX_AGE_MS)
      if (expired.length > 0) {
        const totals = await this.totals(meta)
        const health = await this.health(meta)
        totals.events -= expired.length
        totals.bytes -= expired.reduce((sum, entry) => sum + entry.bytes, 0)
        health.expired += expired.length
        meta.put(totals, 'totals')
        meta.put(health, 'counters')
      }
      return new Promise<QueueEntry<T>[]>((resolve, reject) => {
        const batch: QueueEntry<T>[] = []
        let bytes = 0
        const cursor = store.openCursor()
        cursor.onerror = () => reject(cursor.error)
        cursor.onsuccess = () => {
          const current = cursor.result
          if (!current) return resolve(batch)
          const entry = current.value as QueueEntry<T>
          if (batch.length >= limit || (batch.length > 0 && bytes + entry.bytes > maxBytes)) return resolve(batch)
          batch.push(entry)
          bytes += entry.bytes
          current.continue()
        }
      })
    })
  }

  remove(qids: number[]): Promise<void> {
    return this.run('readwrite', async (store, meta) => {
      const totals = await this.totals(meta)
      for (const qid of qids) {
        const entry = (await requestResult(store.get(qid))) as QueueEntry<T> | undefined
        if (!entry) continue
        store.delete(qid)
        totals.events--
        totals.bytes -= entry.bytes
      }
      meta.put(totals, 'totals')
    })
  }

  clear(): Promise<void> {
    return this.run('readwrite', (store, meta) => {
      store.clear()
      meta.clear()
    })
  }

  size() { return this.run('readonly', (_store, meta) => this.totals(meta)) }

  addCounters(changes: Partial<HealthCounters>): Promise<void> {
    return this.run('readwrite', async (_store, meta) => {
      meta.put(addTo(await this.health(meta), changes), 'counters')
    })
  }

  counters() { return this.run('readonly', (_store, meta) => this.health(meta)) }

  getMeta(key: string) { return this.run('readonly', (_store, meta) => requestResult(meta.get(key))) }

  setMeta(key: string, value: unknown) {
    return this.run('readwrite', (_store, meta) => { meta.put(value, key) })
  }

  tryLease(owner: string, now: number, ttlMs: number): Promise<boolean> {
    return this.run('readwrite', async (_store, meta) => {
      const lease = (await requestResult(meta.get('lease'))) as { owner: string; expiresAt: number } | undefined
      if (lease && lease.owner !== owner && lease.expiresAt > now) return false
      meta.put({ owner, expiresAt: now + ttlMs }, 'lease')
      return true
    })
  }

  releaseLease(owner: string): Promise<void> {
    return this.run('readwrite', async (_store, meta) => {
      const lease = (await requestResult(meta.get('lease'))) as { owner: string } | undefined
      if (lease?.owner === owner) meta.delete('lease')
    })
  }
}
