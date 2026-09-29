/**
 * @fileOverview Turning a failed Lean start-up into a message a player can act on.
 *
 * Three sources feed this:
 *  - `detectBrowserIncompatibility()` runs before the worker is created and
 *    catches browsers that cannot run Lean at all;
 *  - a crash marker in sessionStorage notices that the previous load in this
 *    tab never finished (mobile browsers silently restart a tab that used too
 *    much memory, which otherwise looks like an endless reload loop);
 *  - `classifyLoadFailure()` maps an error thrown during start-up to a case.
 *
 * The player-facing text for each case lives in `failure_cases.txt`.
 */
import failureCasesText from './failure_cases.txt?raw'

export const LOAD_FAILURE_CASES = [
  'wasm-disabled',
  'browser-outdated',
  'stack-overflow',
  'out-of-memory',
  'tab-crashed',
  'download-failed',
  'timeout',
  'worker-crashed',
  'unknown',
] as const

export type LoadFailureCase = typeof LOAD_FAILURE_CASES[number]

export type LoadFailure = {
  caseId: LoadFailureCase
  /** The case's text from failure_cases.txt, one entry per line. */
  lines: string[]
  /** Raw technical error, shown collapsed. */
  detail: string
}

// Used only when a case in failure_cases.txt has no text.
const DEFAULT_TEXT: Record<LoadFailureCase, string[]> = {
  'wasm-disabled': ['Visual Lean requires WebAssembly, which this browser has disabled or does not support.'],
  'browser-outdated': ['This browser is too old to run Visual Lean. Try a newer browser or device.'],
  'stack-overflow': ['This browser gave Lean too little stack space to start. Try a newer browser or device.'],
  'out-of-memory': ['This device did not have enough free memory to start Lean. Close other tabs and reload.'],
  'tab-crashed': ['The last attempt to load Lean did not finish, most likely for lack of memory. Close other tabs, then try again.'],
  'download-failed': ['A file Lean needs could not be downloaded. Check your connection and reload.'],
  'timeout': ['Lean took too long to start. Reload on a faster connection.'],
  'worker-crashed': ['Lean stopped unexpectedly. Try reloading.'],
  'unknown': ['Lean could not start. Try reloading.'],
}

/**
 * Parse the `[case-id]` sections of failure_cases.txt. Every non-comment,
 * non-blank line is shown exactly as written, one per line; a leading
 * `title:` is dropped (an empty `title:` line is ignored). Exported for tests.
 */
export function parseFailureCases(source: string): Partial<Record<LoadFailureCase, string[]>> {
  const result: Partial<Record<LoadFailureCase, string[]>> = {}
  let current: LoadFailureCase | null = null
  for (const rawLine of source.split(/\r?\n/u)) {
    const header = /^\s*\[([a-z0-9-]+)\]\s*$/u.exec(rawLine)
    if (header) {
      const id = header[1] as LoadFailureCase
      current = (LOAD_FAILURE_CASES as readonly string[]).includes(id) ? id : null
      if (current) result[current] = []
      continue
    }
    if (!current || /^\s*#/u.test(rawLine)) continue
    const line = rawLine.replace(/^\s*title:/iu, '').trim()
    if (line) result[current]!.push(line)
  }
  return result
}

const authoredCases = parseFailureCases(failureCasesText)

export function describeLoadFailure(caseId: LoadFailureCase, detail: string): LoadFailure {
  const authored = authoredCases[caseId]
  return { caseId, lines: authored?.length ? authored : DEFAULT_TEXT[caseId], detail }
}

/** An error that already knows which failure case it is. */
export class LeanLoadError extends Error {
  constructor(readonly caseId: LoadFailureCase, message: string) {
    super(message)
    this.name = 'LeanLoadError'
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message || error.name || String(error)
  if (typeof error === 'string') return error
  try { return JSON.stringify(error) } catch { return String(error) }
}

/** Map an error from Lean start-up to a failure case. Exported for tests. */
export function classifyErrorMessage(message: string): LoadFailureCase {
  const text = message.toLowerCase()
  if (/maximum call stack|call stack size|too much recursion|stack overflow|attempt to set sp to/u.test(text)) {
    return 'stack-overflow'
  }
  if (/out of memory|could not allocate|allocation failed|cannot enlarge memory|failed to grow|memory access out of bounds.*oom|webassembly\.memory\(\)|rangeerror:.*memory|\boom\b/u.test(text)) {
    return 'out-of-memory'
  }
  if (/timed out|timeout/u.test(text)) return 'timeout'
  if (/failed to fetch|networkerror|network error|load failed|fetch: \d{3}|could not load level data|failed to load lean\.js|importscripts|truncated module bundle|non-olean content/u.test(text)) {
    return 'download-failed'
  }
  // Before the generic "is not defined" check below.
  if (/webassembly (is )?(not (available|supported|defined)|disabled)/u.test(text)) {
    return 'wasm-disabled'
  }
  if (/cannot stream|decompressionstream|transformstream|is not defined|is not a function|bigint/u.test(text)) {
    return 'browser-outdated'
  }
  if (/^aborted|local lean worker failed|lean init failed|terminated|unreachable|runtimeerror/u.test(text)) {
    return 'worker-crashed'
  }
  return 'unknown'
}

export function classifyLoadFailure(error: unknown): LoadFailure {
  const detail = errorText(error)
  const caseId = error instanceof LeanLoadError ? error.caseId : classifyErrorMessage(detail)
  return describeLoadFailure(caseId, detail)
}

// The smallest valid module: "\0asm" + version 1. Instantiating it proves the
// engine will actually run WebAssembly, not merely expose the global (Lockdown
// Mode and some hardened configurations remove or neuter it).
const EMPTY_WASM_MODULE = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])

/** Capabilities Lean needs before any download starts; null when all present. */
export function detectBrowserIncompatibility(): LeanLoadError | null {
  const scope = globalThis as typeof globalThis & Record<string, unknown>
  if (typeof WebAssembly !== 'object' || typeof WebAssembly.Module !== 'function') {
    return new LeanLoadError('wasm-disabled', 'WebAssembly is not available in this browser')
  }
  try {
    const module = new WebAssembly.Module(EMPTY_WASM_MODULE)
    new WebAssembly.Instance(module)
  } catch (error) {
    return new LeanLoadError('wasm-disabled', `WebAssembly is disabled: ${errorText(error)}`)
  }
  const missing = [
    ['Worker', typeof scope.Worker],
    ['ReadableStream', typeof scope.ReadableStream],
    ['TransformStream', typeof scope.TransformStream],
    // Static hosts serve the module bundle as raw .gz bytes, so the worker
    // decompresses it itself.
    ['DecompressionStream', typeof scope.DecompressionStream],
    ['BigInt64Array', typeof scope.BigInt64Array],
  ].filter(([, type]) => type !== 'function').map(([name]) => name)
  if (missing.length > 0) {
    return new LeanLoadError('browser-outdated', `This browser is missing: ${missing.join(', ')}`)
  }
  return null
}

// ── Crash marker ────────────────────────────────────────────────────────────
// Set while Lean is loading; cleared when loading settles or the page is left
// normally (pagehide). A marker that survives into a fresh page load means the
// browser killed the tab mid-load.

const CRASH_MARKER_KEY = 'visual-lean-load-in-progress'
const CRASH_MARKER_MAX_AGE_MS = 15 * 60 * 1000

function session(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage } catch { return null }
}

/** True once per page load when the previous load in this tab crashed. */
export function consumePreviousLoadCrash(): boolean {
  const storage = session()
  if (!storage) return false
  try {
    const raw = storage.getItem(CRASH_MARKER_KEY)
    storage.removeItem(CRASH_MARKER_KEY)
    const startedAt = Number(raw)
    return Number.isFinite(startedAt) && Date.now() - startedAt < CRASH_MARKER_MAX_AGE_MS
  } catch {
    return false
  }
}

let pagehideRegistered = false

export function markLoadStarted() {
  const storage = session()
  if (!storage) return
  try { storage.setItem(CRASH_MARKER_KEY, String(Date.now())) } catch { /* storage full/blocked */ }
  if (!pagehideRegistered) {
    pagehideRegistered = true
    window.addEventListener('pagehide', markLoadSettled)
  }
}

export function markLoadSettled() {
  try { session()?.removeItem(CRASH_MARKER_KEY) } catch { /* ignore */ }
}

/** `?simulateFailure=<case-id>` forces a case, for previewing the messages. */
export function simulatedLoadFailure(): LeanLoadError | null {
  if (typeof window === 'undefined') return null
  const requested = new URLSearchParams(window.location.search).get('simulateFailure')
  if (!requested || !(LOAD_FAILURE_CASES as readonly string[]).includes(requested)) return null
  return new LeanLoadError(requested as LoadFailureCase, `Simulated failure: ${requested}`)
}
