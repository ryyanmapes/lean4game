# Browser telemetry client

Optional, consent-based gameplay telemetry: `client/src/utils/telemetry.ts`
(public API used by the game), `telemetryQueue.ts` (durable queue) and
`telemetryScheduler.ts` (sending). The collector and its protocol live in the
lean4.js repository (`telemetry/docs/protocol.md`).

## Behaviour

- **One sender.** Recording an action only appends it to the queue and asks
  for a flush. Nothing sends on its own, so new actions never bypass a retry
  deadline. A flush happens after a jittered 2-5 s window (batching isolated
  actions), sooner when 20 events or 32 KiB are waiting or a level was
  completed, and on page lifecycle events. Events go out in queue order, at
  most 50 per request and well below the collector's 512 KiB body limit.
- **Acknowledgement.** The client uses `/v2/events`, which returns a result
  per event; only `accepted`, `duplicate` and `rejected` events leave the
  queue. Against a collector without `/v2` (404/405) it switches to
  `/v1/events`, where a 2xx removes the batch and any other 4xx except
  408/429 drops it as permanently invalid. 408, 429, 5xx, network errors and
  timeouts keep the events.
- **Backoff.** Failures back off exponentially (2 s doubling to 5 min, half
  fixed and half random). `Retry-After` is honoured as seconds or as an HTTP
  date, with a little added jitter so clients told the same value do not
  return together. The deadline is stored with the queue and shared by tabs.
  Every request has a 20 s deadline. Coming back online retries after a
  random 1-15 s instead of immediately.
- **Lifecycle sends.** When the page is hidden or unloading, one batch that
  fits the browser's keepalive allowance (60 KiB in flight in total) is sent
  with `keepalive`, unless a backoff is active. Larger events wait for an
  ordinary send; events are removed only when acknowledged.
- **Bounds.** At most 1,000 events and 2 MiB (UTF-8) are kept; the oldest
  are evicted first. Events older than 7 days expire. An event that cannot fit
  one request (over 440 KiB, or a command over 65,536 or a script over 262,144
  UTF-16 code units, the collector's limits) is not queued; it is counted, never
  truncated, because a truncated proof would be wrong. Evictions, expiries,
  oversize events, rejections, retries and sends are counted (no content) and
  reported to the collector as `client.health` at most every ten minutes; the
  counters reset only after the collector acknowledged them.
- **Multiple tabs.** All tabs share one IndexedDB queue; every append,
  removal and eviction is a single transaction, so tabs never erase each
  other's events. Only one tab sends at a time (Web Locks API, or a lease in
  IndexedDB where Web Locks are unavailable). Without IndexedDB, each tab uses
  its own memory queue. Events left by the previous localStorage queue
  (`telemetryQueueV2`) are moved into the new queue once.
- **Build and platform.** Every event and feedback report carries the game
  `build` record and a `platform`: the browser family (`chrome`, `safari`,
  `firefox`, `edge`, `brave`, `samsung`, `opera` or `unknown`) and the device
  type (`mobile` for phones and tablets, otherwise `desktop`), classified once
  per page load in `telemetryPlatform.ts` from the user agent, client hints and
  touch support. Only those fixed values are sent, never the user-agent string;
  the collector stores them in the attempt's and report's `attributes` and
  drops anything else. The privacy text in `popup/privacy.tsx` says so.
- **Consent.** Refusing telemetry clears the queue and all its metadata
  (counters, backoff, lease), the legacy localStorage queue and the
  identifier cookie, and abandons in-flight requests: their responses are
  ignored and nothing is re-queued. Nothing is sent without consent.
- **Visual attempts** (`client/src/visual/visualTelemetry.ts`). An attempt
  ends at its completion: undoing or resetting after solving starts a new
  attempt whose `level_start` carries the solved proof as `initial_script` (a
  JSON array of the recorded commands) and the completed attempt as
  `source_attempt_uuid`. A level reopened on a restored proof starts from that
  proof the same way, and a canvas restored already solved is not reported as
  a completion. Gestures that leave the proof unchanged are `proof_step`s too:
  `rejected` (refused by the canvas or by Lean, with a `reason` and Lean's
  `error`) and `view` (into or out of Transformation or Construction Mode).
- **Feedback.** A report's `proof_state` is serialized with only true cycles
  cut (`client/src/utils/feedbackJson.ts`): an object shared by two parts of
  the state keeps its contents in both.

## Rollout

1. Deploy the collector with `/v2/events` first (it keeps `/v1/events`
   unchanged for clients already loaded in browsers).
2. Then rebuild and publish this client (lean4.js
   `scripts/sync-lean4game-client.mjs` and the site release). Cached old
   clients keep using `/v1` until they reload; keep `/v1` and its limits
   until they are gone.
3. This client still works against a collector without `/v2` (it falls back
   to `/v1`), so the order matters only for per-event results and health
   reporting.
4. The `rejected` and `view` step types need the collector release with
   migration 011. Deploy it first: an older collector refuses those events
   (`invalid_step`), and the client drops and counts them.

## Tests

`npm run test:telemetry` compiles the queue and scheduler and runs
`client/test/telemetry.test.mjs` with a manual clock and `fake-indexeddb`:
batching, prompt completion sends, backoff during outages, both Retry-After
forms, deadlines, v2 partial results, the v1 fallback, 413 handling,
keepalive budgets, queue bounds, spread-out reconnects, two tabs sharing the
queue, consent refusal and health reporting; `telemetryPlatform.test.mjs`
checks the classification against real user agents of every supported browser
on phones, tablets (including iPadOS presenting as a Mac) and computers.
