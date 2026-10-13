import assert from 'node:assert/strict'
import test from 'node:test'
import { IDBFactory } from 'fake-indexeddb'

const queue = await import('../../tmp-telemetry-tests/telemetryQueue.js')
const scheduling = await import('../../tmp-telemetry-tests/telemetryScheduler.js')
const { IndexedDbQueueStore, MemoryQueueStore, MAX_AGE_MS, MAX_EVENTS, MAX_EVENT_BYTES } = queue
const {
  TelemetryScheduler, backoffDelay, parseRetryAfter, FETCH_TIMEOUT_MS, KEEPALIVE_MAX_BYTES, BACKOFF_MAX_MS,
} = scheduling

/** A manual clock and timer queue; real time never passes in these tests. */
function manualClock(start = 1_000_000) {
  let now = start
  const timers = new Set()
  return {
    now: () => now,
    setTimer(callback, ms) {
      const timer = { at: now + ms, callback }
      timers.add(timer)
      return timer
    },
    clearTimer(timer) { timers.delete(timer) },
    pending: () => [...timers].map(timer => timer.at - now).sort((a, b) => a - b),
    /** Advance time, firing due timers in order and letting their async work settle. */
    async advance(ms) {
      const target = now + ms
      for (;;) {
        await settle()
        const due = [...timers].filter(timer => timer.at <= target).sort((a, b) => a.at - b.at)[0]
        if (!due) break
        timers.delete(due)
        now = Math.max(now, due.at)
        due.callback()
      }
      now = target
      await settle()
    },
  }
}

async function settle() {
  for (let round = 0; round < 30; round++) await new Promise(resolve => setImmediate(resolve))
}

let ids = 0
function event(overrides = {}) {
  ids++
  return { event_id: `00000000-0000-4000-8000-${String(ids).padStart(12, '0')}`, event_type: 'proof_step', sequence: ids,
    command: 'rw [add_zero]', ...overrides }
}

/** A collector stand-in: records requests and answers from `respond`. */
function collector(respond = () => ({ status: 200 })) {
  const requests = []
  const post = async (url, body, { keepalive, signal }) => {
    const parsed = JSON.parse(body)
    const request = { url, body: parsed, bytes: Buffer.byteLength(body), keepalive, signal }
    requests.push(request)
    const answer = await respond(request, requests.length)
    if (answer instanceof Error) throw answer
    const status = answer.status
    const results = answer.results ?? parsed.events.map((item, index) => ({ index, event_id: item.event_id, status: 'accepted' }))
    return { status, retryAfter: answer.retryAfter ?? null, body: status === 200 && url.includes('/v2/') ? { protocol: 2, results } : null }
  }
  return { post, requests }
}

function scheduler({ store = new MemoryQueueStore(), clock = manualClock(), post, random = () => 0.5, enabled = () => true, ...rest } = {}) {
  return new TelemetryScheduler({
    store, post, baseUrl: () => 'https://collector.test', enabled, now: clock.now, random,
    setTimer: clock.setTimer, clearTimer: clock.clearTimer, online: () => true,
    withSenderLock: rest.withSenderLock ?? (async task => task()), ...rest,
  })
}

test('isolated actions are batched after a 2-5 s jittered window, in order', async () => {
  const clock = manualClock()
  const server = collector()
  const sender = scheduler({ clock, post: server.post })
  const events = [event(), event(), event()]
  for (const item of events) await sender.enqueue([item])
  await clock.advance(1900)
  assert.equal(server.requests.length, 0)
  await clock.advance(2000)
  assert.equal(server.requests.length, 1)
  assert.deepEqual(server.requests[0].body.events.map(item => item.event_id), events.map(item => item.event_id))
  assert.equal(server.requests[0].keepalive, false)
  assert.match(server.requests[0].url, /\/v2\/events$/u)
})

test('a completion is sent promptly', async () => {
  const clock = manualClock()
  const server = collector()
  const sender = scheduler({ clock, post: server.post })
  await sender.enqueue([event({ event_type: 'level_complete' })])
  await clock.advance(300)
  assert.equal(server.requests.length, 1)
})

test('repeated actions during an outage do not defeat the backoff', async () => {
  const clock = manualClock()
  let down = true
  const server = collector(() => (down ? { status: 503, retryAfter: '30' } : { status: 200 }))
  const sender = scheduler({ clock, post: server.post })
  await sender.enqueue([event()])
  await clock.advance(5000)
  assert.equal(server.requests.length, 1)
  for (let index = 0; index < 20; index++) {
    await sender.enqueue([event({ event_type: index === 5 ? 'level_complete' : 'proof_step' })])
    await clock.advance(1000)
  }
  assert.equal(server.requests.length, 1, 'no request before Retry-After, whatever is enqueued')
  down = false
  await clock.advance(20000)
  assert.equal(server.requests.length, 2)
  assert.equal(server.requests[1].body.events.length, 21, 'nothing was lost while backing off')
})

test('Retry-After is honoured in both forms and backoff grows to a ceiling', () => {
  const now = Date.parse('2026-10-13T12:00:00Z')
  assert.equal(parseRetryAfter('120', now), 120000)
  assert.equal(parseRetryAfter('Tue, 13 Oct 2026 12:01:30 GMT', now), 90000)
  assert.equal(parseRetryAfter('Tue, 13 Oct 2026 11:00:00 GMT', now), 0)
  assert.equal(parseRetryAfter('soon', now), null)
  assert.equal(parseRetryAfter(null, now), null)
  assert.equal(parseRetryAfter('999999', now), 3600000, 'capped')
  const low = backoffDelay(1, () => 0)
  const high = backoffDelay(1, () => 0.999)
  assert.ok(low >= 1000 && high <= 2000 && low < high, 'jittered within half to full of the step')
  assert.ok(backoffDelay(4, () => 0) >= 8000)
  assert.ok(backoffDelay(30, () => 1) <= BACKOFF_MAX_MS)
})

test('a stuck fetch is aborted at the deadline and retried later', async () => {
  const clock = manualClock()
  let calls = 0
  const post = (url, body, { signal }) => {
    calls++
    if (calls > 1) return Promise.resolve({ status: 200, retryAfter: null, body: { results: JSON.parse(body).events.map((_, index) => ({ index, status: 'accepted' })) } })
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))
  }
  const store = new MemoryQueueStore()
  const sender = scheduler({ clock, post, store })
  await sender.enqueue([event()])
  await clock.advance(5000)
  assert.equal(calls, 1)
  // The request started at 3.5 s; its deadline passes at 23.5 s.
  await clock.advance(FETCH_TIMEOUT_MS - 1400)
  assert.equal(calls, 1)
  assert.equal(sender.state.failures, 1)
  await clock.advance(10000)
  assert.equal(calls, 2)
  assert.deepEqual(await store.size(), { events: 0, bytes: 0 })
})

test('v2 results remove only settled events; unsettled ones are retried later', async () => {
  const clock = manualClock()
  const store = new MemoryQueueStore()
  const server = collector((request, count) => (count === 1
    ? { status: 200, results: [{ index: 0, status: 'accepted' }, { index: 1, status: 'duplicate' }, { index: 2, status: 'rejected', reason: 'invalid_text' }] }
    : { status: 200 }))
  const sender = scheduler({ clock, post: server.post, store })
  await sender.enqueue([event(), event(), event(), event()])
  await clock.advance(4000)
  assert.equal((await store.size()).events, 1)
  assert.equal((await store.counters()).rejected, 1)
  assert.equal(sender.state.failures, 1, 'missing results back off instead of looping')
  await clock.advance(10000)
  assert.equal((await store.size()).events, 0)
  assert.equal(server.requests[1].body.events.length, 1)
})

test('an old collector without /v2 is used through /v1, with its semantics', async () => {
  const clock = manualClock()
  const store = new MemoryQueueStore()
  const server = collector(request => {
    if (request.url.endsWith('/v2/events')) return { status: 404 }
    return request.body.events.some(item => item.command === 'bad') ? { status: 400 } : { status: 204 }
  })
  const sender = scheduler({ clock, post: server.post, store })
  await sender.enqueue([event()])
  await clock.advance(5000)
  assert.deepEqual(server.requests.map(request => request.url.split('/').slice(-2).join('/')), ['v2/events', 'v1/events'])
  assert.equal(sender.state.protocol, 'v1')
  assert.equal(await store.getMeta('protocol'), 'v1')
  await sender.enqueue([event({ command: 'bad' })])
  await clock.advance(5000)
  assert.equal((await store.size()).events, 0, 'a terminal 400 drops the batch instead of blocking the queue')
  assert.equal((await store.counters()).rejected, 1)
})

test('413 halves the batch; server errors keep events', async () => {
  const clock = manualClock()
  const store = new MemoryQueueStore()
  const server = collector(request => (request.body.events.length > 2 ? { status: 413 } : { status: 200 }))
  const sender = scheduler({ clock, post: server.post, store })
  await sender.enqueue([event(), event(), event(), event(), event()])
  await clock.advance(5000)
  assert.equal((await store.size()).events, 0)
  assert.deepEqual(server.requests.map(request => request.body.events.length), [5, 2, 2, 1])
  const failing = scheduler({ clock, post: collector(() => ({ status: 500 })).post, store })
  await failing.enqueue([event()])
  await clock.advance(5000)
  assert.equal((await store.size()).events, 1)
})

test('lifecycle sends stay within the keepalive budget and skip larger events', async () => {
  const clock = manualClock()
  const store = new MemoryQueueStore()
  const server = collector()
  const sender = scheduler({ clock, post: server.post, store })
  await sender.enqueue([event({ command: 'x'.repeat(100 * 1024) }), event()])
  await sender.lifecycleFlush()
  assert.equal(server.requests.length, 0, 'an event above the keepalive budget is not sent with keepalive')
  await clock.advance(5000)
  assert.equal(server.requests.length, 1)
  assert.equal(server.requests[0].keepalive, false)
  const small = Array.from({ length: 40 }, () => event({ command: 'y'.repeat(4000) }))
  await sender.enqueue(small)
  await sender.lifecycleFlush()
  assert.equal(server.requests.length, 2)
  assert.equal(server.requests[1].keepalive, true)
  assert.ok(server.requests[1].bytes <= KEEPALIVE_MAX_BYTES, `${server.requests[1].bytes} bytes`)
})

test('the queue is bounded by size, count and age, oldest first, and counts what it drops', async () => {
  const store = new MemoryQueueStore()
  const now = 1_000_000
  assert.deepEqual(await store.append([event({ command: 'z'.repeat(MAX_EVENT_BYTES) })], now), [false])
  const many = Array.from({ length: MAX_EVENTS + 5 }, () => event())
  await store.append(many, now)
  const size = await store.size()
  assert.equal(size.events, MAX_EVENTS)
  const head = await store.peek(1, 1 << 20, now)
  assert.equal(head[0].event.event_id, many[5].event_id, 'the oldest were evicted')
  assert.deepEqual(await store.peek(1, 1 << 20, now + MAX_AGE_MS + 1), [])
  const counters = await store.counters()
  assert.deepEqual([counters.oversize, counters.evicted, counters.expired], [1, 5, MAX_EVENTS])
})

test('reconnecting clients retry at spread-out moments', async () => {
  const delays = []
  for (const value of [0.05, 0.5, 0.95]) {
    const clock = manualClock()
    const server = collector(() => new Error('offline'))
    const sender = scheduler({ clock, post: server.post, random: () => value })
    await sender.enqueue([event()])
    await clock.advance(5000)
    sender.onOnline()
    delays.push(clock.pending()[0])
  }
  assert.ok(delays.every(delay => delay >= 1000 && delay <= 15000), delays.join())
  assert.equal(new Set(delays).size, 3)
})

test('two tabs sharing the IndexedDB queue keep each other\'s unsent events', async () => {
  const factory = new IDBFactory()
  const clock = manualClock()
  const [storeA, storeB] = await Promise.all([IndexedDbQueueStore.open(factory), IndexedDbQueueStore.open(factory)])
  const delivered = []
  let concurrent = 0
  let maxConcurrent = 0
  const post = async (url, body) => {
    concurrent++
    maxConcurrent = Math.max(maxConcurrent, concurrent)
    await settle()
    concurrent--
    const events = JSON.parse(body).events
    delivered.push(...events.map(item => item.event_id))
    return { status: 200, retryAfter: null, body: { results: events.map((_, index) => ({ index, status: 'accepted' })) } }
  }
  // Without Web Locks in Node, the schedulers coordinate through the lease in IndexedDB.
  const tabA = new TelemetryScheduler({ store: storeA, post, baseUrl: () => 'https://c.test', enabled: () => true,
    now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, online: () => true, random: () => 0.5, owner: 'a' })
  const tabB = new TelemetryScheduler({ store: storeB, post, baseUrl: () => 'https://c.test', enabled: () => true,
    now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, online: () => true, random: () => 0.5, owner: 'b' })
  const sent = []
  await Promise.all(Array.from({ length: 30 }, (_, index) => {
    const item = event()
    sent.push(item.event_id)
    return (index % 2 ? tabA : tabB).enqueue([item])
  }))
  assert.equal((await storeA.size()).events, 30)
  await Promise.all([tabA.flush(), tabB.flush()])
  await clock.advance(10000)
  assert.deepEqual([...new Set(delivered)].sort(), [...sent].sort())
  assert.equal(maxConcurrent, 1, 'one tab sends at a time')
  assert.equal((await storeB.size()).events, 0)
})

test('refusing telemetry clears all pending storage and ignores in-flight results', async () => {
  const factory = new IDBFactory()
  const clock = manualClock()
  const store = await IndexedDbQueueStore.open(factory)
  let release
  let posts = 0
  const post = () => {
    posts++
    return new Promise(resolve => { release = resolve })
  }
  let consent = true
  const sender = scheduler({ clock, post, store, enabled: () => consent })
  await sender.enqueue([event(), event()])
  await store.addCounters({ retries: 3 })
  await clock.advance(5000)
  assert.ok(release, 'a request is in flight')
  consent = false
  await sender.reset()
  release({ status: 200, retryAfter: null, body: { results: [{ index: 0, status: 'accepted' }, { index: 1, status: 'accepted' }] } })
  await settle()
  assert.deepEqual(await store.size(), { events: 0, bytes: 0 })
  assert.equal((await store.counters()).retries, 0)
  assert.deepEqual(clock.pending(), [], 'nothing is scheduled')
  await sender.flush()
  await clock.advance(60000)
  assert.equal(posts, 1, 'nothing is sent without consent')
})

test('client health is reported at most every ten minutes and reset only after acknowledgement', async () => {
  const clock = manualClock()
  const store = new MemoryQueueStore()
  let fail = false
  const server = collector(() => (fail ? { status: 503 } : { status: 200 }))
  const sender = scheduler({ clock, post: server.post, store })
  await store.addCounters({ evicted: 2, oversize: 1 })
  await sender.enqueue([event()])
  await clock.advance(5000)
  assert.deepEqual(server.requests[0].body.client.health.evicted, 2)
  assert.equal((await store.counters()).evicted, 0)
  await sender.enqueue([event()])
  await clock.advance(5000)
  assert.equal(server.requests[1].body.client, undefined, 'not again within ten minutes')
  fail = true
  await store.addCounters({ rejected: 4 })
  await clock.advance(10 * 60 * 1000)
  await sender.enqueue([event()])
  await clock.advance(5000)
  const failed = server.requests.at(-1)
  assert.equal(failed.body.client.health.rejected, 4)
  assert.equal((await store.counters()).rejected, 4, 'kept when the request failed')
})
