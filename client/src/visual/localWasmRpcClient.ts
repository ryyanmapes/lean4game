import type {
  InteractiveGoalWithHints,
  InteractiveGoalsWithHints,
  ProofState,
} from '../components/infoview/rpc_api'
import { getDataBaseUrl } from '../utils/url'
import { instrumentBrowserProof } from './browserProof'
import { coreTacticForVisualCommand } from './proofText'

type WorkerDiagnostic = {
  severity?: string
  data?: string
  pos?: { line?: number; column?: number }
  endPos?: { line?: number; column?: number } | null
}

type PendingCompile = {
  diagnostics: WorkerDiagnostic[]
  resolve: (result: CompileResult) => void
}

type CompileResult = { success: boolean; diagnostics: WorkerDiagnostic[]; error?: string }

// Bump this whenever the paired runtime/snapshot artifact changes. Lean
// snapshots retain WASM function-table references, so mixing generations can
// fail as a call_indirect signature mismatch (especially on long-lived mobile
// browser caches).
const WORKER_UI_VERSION = 'mobile-modules-experiment-v1'
// Preserve the proven desktop path. The loose-module loader remains opt-in
// until it has passed real-device testing; place `?mobileModules=1` before the
// hash route to select it.
const USE_MOBILE_MODULE_BUNDLE = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('mobileModules') === '1'
const DESKTOP_RUNTIME_VERSION = 'nng4-browser-v4'
// Keep the experiment in a separate browser cache namespace. Reusing the
// desktop query key can pair a newly deployed worker with an older lean.js or
// lean.wasm from a long-lived mobile cache, which manifests as call_indirect
// signature mismatches before the module bundle is even requested.
const MOBILE_MODULE_RUNTIME_VERSION = 'mobile-modules-v1'
const BROWSER_RUNTIME_VERSION = USE_MOBILE_MODULE_BUNDLE
  ? MOBILE_MODULE_RUNTIME_VERSION
  : DESKTOP_RUNTIME_VERSION
const SNAPSHOT_URL = `/visual-lean/snapshots/game.snap.gz?v=${DESKTOP_RUNTIME_VERSION}`
const MODULE_BUNDLE_URL = `/visual-lean/modules/game-modules.tar.gz?v=${MOBILE_MODULE_RUNTIME_VERSION}`
const PROOF_STATE_MARKER = '__VISUAL_LEAN_STATE_V1__'
// This purpose-linked runtime and the snapshot are produced by the same build.
// Keeping them paired is required because Lean snapshots contain function-table
// references that are not ABI-compatible with a separately linked WASM binary.
const WORKER_URL = `/lean-worker-persistent.worker.js?assetBase=%2Fvisual-lean%2Fruntime&v=${BROWSER_RUNTIME_VERSION}&workerUi=${WORKER_UI_VERSION}${
  typeof window !== 'undefined' && window.Cypress ? '&memoryMB=1536' : ''
}`
const WORKER_TIMEOUT_MS = 600_000

export type LeanLoadingProgress = {
  value: number | null
  message: string
}

let leanLoadingProgress: LeanLoadingProgress = {
  value: 0,
  message: 'Preparing Lean…',
}
const leanLoadingListeners = new Set<(progress: LeanLoadingProgress) => void>()

function reportLeanLoading(value: number | null, message: string) {
  leanLoadingProgress = { value, message }
  for (const listener of leanLoadingListeners) listener(leanLoadingProgress)
}

export function subscribeLeanLoadingProgress(
  listener: (progress: LeanLoadingProgress) => void,
) {
  leanLoadingListeners.add(listener)
  listener(leanLoadingProgress)
  return () => leanLoadingListeners.delete(listener)
}

function formatLoadedBytes(bytes: number) {
  return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`
}

function parseStructuredGoals(diagnostics: WorkerDiagnostic[]): InteractiveGoalWithHints[] {
  const goals: InteractiveGoalWithHints[] = []
  for (const diagnostic of diagnostics) {
    const data = diagnostic.data ?? ''
    const markerIndex = data.indexOf(PROOF_STATE_MARKER)
    if (markerIndex < 0) continue
    const payload = data.slice(markerIndex + PROOF_STATE_MARKER.length).trim()
    try {
      const parsed = JSON.parse(payload) as InteractiveGoalWithHints
      if (parsed?.goal && Array.isArray(parsed.goal.hyps)) goals.push(parsed)
    } catch (error) {
      throw new Error(`Lean returned malformed structured proof state: ${String(error)}`)
    }
  }
  return goals
}

function indentProof(proofBody: string): string {
  const proof = proofBody.trimEnd()
  if (!proof) return '  skip'
  return proof.split('\n').map(line => `  ${line}`).join('\n')
}

function lastCommand(proofBody: string): string {
  const lines = proofBody.split('\n').map(line => line.trim()).filter(Boolean)
  return lines.at(-1) ?? ''
}

function annotationFor(command: string) {
  const source = command.replace(/^case'?\s+\S+\s*=>\s*/u, '').trim()
  let leanTactic: string | undefined = coreTacticForVisualCommand(source) ?? undefined
  if (source === 'click_goal_left') leanTactic = 'left'
  else if (source === 'click_goal_right') leanTactic = 'right'
  else if (source.startsWith('delete_theorem ')) leanTactic = `clear ${source.slice(15).trim()}`
  return source ? { playTactic: source, leanTactic } : undefined
}

class LocalLeanWorker {
  private worker: Worker | null = null
  private readyPromise: Promise<void> | null = null
  private pendingCompile: PendingCompile | null = null
  private snapshotResolver: ((result: { success: boolean; error?: string }) => void) | null = null
  private moduleBundleResolver: ((result: { success: boolean; error?: string }) => void) | null = null
  private operationQueue: Promise<void> = Promise.resolve()

  ensureReady(): Promise<void> {
    if (this.readyPromise) return this.readyPromise
    this.readyPromise = new Promise<void>((resolve, reject) => {
      const worker = new Worker(WORKER_URL)
      this.worker = worker
      const timeout = window.setTimeout(() => reject(new Error('Local Lean WASM initialization timed out')), WORKER_TIMEOUT_MS)

      worker.onmessage = event => {
        const msg = event.data ?? {}
        if (window.Cypress) {
          ;(window as typeof window & { __leanWorkerStatus?: unknown }).__leanWorkerStatus = msg
        }
        if (msg.type === 'runtime_memory') {
          ;(window as typeof window & { __leanRuntimeMemoryBytes?: number }).__leanRuntimeMemoryBytes = Number(msg.bytes) || 0
        } else if (msg.type === 'worker_boot') {
          reportLeanLoading(5, 'Starting the Lean WebAssembly worker…')
          worker.postMessage({ type: 'load_library', files: [] })
        } else if (msg.type === 'library_received') {
          reportLeanLoading(10, 'Loading the Lean WebAssembly runtime…')
          worker.postMessage({ type: 'start_worker' })
        } else if (msg.type === 'startup_stage') {
          reportLeanLoading(18, `${String(msg.data ?? 'Starting Lean')}…`)
        } else if (msg.type === 'progress') {
          reportLeanLoading(24, String(msg.data ?? 'Loading the Lean runtime…'))
        }
        else if (msg.type === 'worker_ready') {
          const loadEnvironment = USE_MOBILE_MODULE_BUNDLE
            ? this.loadModuleBundle()
            : this.loadSnapshot()
          reportLeanLoading(30, 'Downloading the Lean game snapshot…')
          if (USE_MOBILE_MODULE_BUNDLE) reportLeanLoading(30, 'Downloading Lean modules...')
          loadEnvironment.then(() => {
            window.clearTimeout(timeout)
            resolve()
          }, error => {
            window.clearTimeout(timeout)
            reject(error)
          })
        } else if (msg.type === 'snapshot_progress') {
          const received = Number(msg.received) || 0
          const total = Number(msg.total) || 0
          const progress = total > 0
            ? 30 + Math.min(52, (received / total) * 52)
            : 30 + Math.min(46, (received / (512 * 1024 * 1024)) * 46)
          reportLeanLoading(
            progress,
            total > 0
              ? `Downloading Lean game snapshot (${formatLoadedBytes(received)} of ${formatLoadedBytes(total)})…`
              : `Loading Lean game snapshot (${formatLoadedBytes(received)} loaded)…`,
          )
        } else if (msg.type === 'snapshot_loaded') {
          reportLeanLoading(84, 'Restoring the Lean game environment…')
          this.snapshotResolver?.(msg)
          this.snapshotResolver = null
        } else if (msg.type === 'module_bundle_progress') {
          const received = Number(msg.received) || 0
          const total = Number(msg.total) || 0
          const progress = total > 0
            ? 30 + Math.min(52, (received / total) * 52)
            : 30
          reportLeanLoading(
            progress,
            total > 0
              ? `Downloading Lean modules (${formatLoadedBytes(received)} of ${formatLoadedBytes(total)})...`
              : `Downloading Lean modules (${formatLoadedBytes(received)} loaded)...`,
          )
        } else if (msg.type === 'module_bundle_loaded') {
          reportLeanLoading(84, 'Preparing Lean modules...')
          this.moduleBundleResolver?.(msg)
          this.moduleBundleResolver = null
        } else if (msg.type === 'import_progress') {
          const loaded = Number(msg.loaded) || 0
          const total = Number(msg.total) || 1
          reportLeanLoading(
            84 + Math.min(10, (loaded / total) * 10),
            `Loading Lean modules (${loaded} of ${total})…`,
          )
        } else if (msg.type === 'stdout') {
          try {
            const value = JSON.parse(String(msg.data)) as WorkerDiagnostic
            if (value && typeof value === 'object') this.pendingCompile?.diagnostics.push(value)
          } catch {
            // Non-JSON stdout is compiler progress/debug output.
          }
        } else if (msg.type === 'compile_result') {
          const pending = this.pendingCompile
          this.pendingCompile = null
          const diagnostics = Array.isArray(msg.diagnostics) ? msg.diagnostics : pending?.diagnostics ?? []
          pending?.resolve({ success: Boolean(msg.success), diagnostics, error: msg.error })
        } else if (msg.type === 'error') {
          const message = msg.error ?? msg.data ?? 'Local Lean worker failed'
          if (this.pendingCompile) {
            const pending = this.pendingCompile
            this.pendingCompile = null
            pending.resolve({ success: false, diagnostics: pending.diagnostics, error: String(message) })
          } else {
            window.clearTimeout(timeout)
            reject(new Error(String(message)))
          }
        }
      }
      worker.onerror = event => {
        window.clearTimeout(timeout)
        reject(new Error(event.message || 'Local Lean worker failed'))
      }
    })
    return this.readyPromise
  }

  private loadSnapshot(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.snapshotResolver = result => result.success
        ? resolve()
        : reject(new Error(result.error ?? 'Lean game snapshot failed to load'))
      this.worker!.postMessage({ type: 'load_snapshot', name: 'game.snap', url: SNAPSHOT_URL })
    })
  }

  private loadModuleBundle(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.moduleBundleResolver = result => result.success
        ? resolve()
        : reject(new Error(result.error ?? 'Lean module bundle failed to load'))
      this.worker!.postMessage({ type: 'load_module_bundle', url: MODULE_BUNDLE_URL })
    })
  }

  compile(code: string): Promise<CompileResult> {
    const operation = this.operationQueue.then(
      () => this.compileNow(code),
      () => this.compileNow(code),
    )
    this.operationQueue = operation.then(() => undefined, () => undefined)
    return operation
  }

  private async compileNow(code: string): Promise<CompileResult> {
    await this.ensureReady()
    if (this.pendingCompile) throw new Error('A Lean proof is already being checked')
    reportLeanLoading(96, 'Checking the level with Lean…')
    return new Promise<CompileResult>(resolve => {
      this.pendingCompile = {
        diagnostics: [],
        resolve: result => {
          reportLeanLoading(100, 'Lean is ready')
          resolve(result)
        },
      }
      this.worker!.postMessage({ type: 'compile', code, path: '/workspace/VisualLean.lean' })
    })
  }
}

// One Lean process for the lifetime of the browser application. Individual
// game/level clients only own document context; closing a route must never
// discard the WASM runtime, imported environment, or snapshot.
const sharedLeanWorker = new LocalLeanWorker()

export class LocalWasmRpcClient {
  private readonly engine = sharedLeanWorker
  private closed = false
  private lastProofError = ''
  private worldId: string
  private levelId: number
  private initialDeclaration = ''

  constructor(private readonly gameId: string, worldId: string, levelId: number) {
    this.worldId = worldId
    this.levelId = levelId
  }

  async getProofState(): Promise<ProofState> {
    return this.loadProofState(this.worldId, this.levelId)
  }

  async loadProofState(worldId: string, levelId: number): Promise<ProofState> {
    if (this.closed) throw new Error('Local Lean worker closed')
    this.worldId = worldId
    this.levelId = levelId
    const level = await this.fetchInitialDeclaration(worldId, levelId)
    this.initialDeclaration = level.declaration
    return this.checkProof('')
  }

  async sendProofUpdate(proofBody: string): Promise<ProofState | null> {
    if (this.closed) return null
    this.lastProofError = ''
    try {
      const proof = await this.checkProof(proofBody)
      ;(window as typeof window & { __lastLeanProofError?: string }).__lastLeanProofError = ''
      return proof
    } catch (error) {
      console.error('Local Lean proof check failed', error)
      this.lastProofError = error instanceof Error ? error.message : String(error)
      ;(window as typeof window & { __lastLeanProofError?: string }).__lastLeanProofError = this.lastProofError
      return null
    }
  }

  getLastProofError() {
    return this.lastProofError
  }

  close() {
    this.closed = true
  }

  isClosed() {
    return this.closed
  }

  private async fetchInitialDeclaration(worldId: string, levelId: number): Promise<{ declaration: string }> {
    const base = getDataBaseUrl().replace(/\/$/u, '')
    const response = await fetch(`${base}/${this.gameId}/level__${worldId}__${levelId}.json`)
    if (!response.ok) throw new Error(`Could not load level data (${response.status})`)
    const level = await response.json() as {
      descrFormat?: string | null
      visualGoalInfos?: Array<{ goal?: string | null }>
    }

    // `visualGoalInfos.goal` is presentation metadata used to decide when an
    // instructional callout is visible.  It deliberately omits the theorem's
    // binders, so compiling it as a declaration would turn e.g. `P Q : Prop`
    // into auto-implicit universe-polymorphic sorts.  `descrFormat` is emitted
    // from the actual `Statement` syntax and preserves the exact local context.
    const authoredDeclaration = level.descrFormat?.trim().replace(/\s*:=\s*by\s*$/u, '')
    // The persistent snapshot already contains the named declarations proved
    // by earlier NNG levels. Re-elaborate the current puzzle as an anonymous
    // example so loading a level never attempts to redeclare its theorem.
    const declaration = authoredDeclaration?.replace(
      /^(?:theorem|lemma)\s+(?:«[^»]+»|[^\s(:]+)\s*/u,
      'example ',
    )
    if (!declaration || !/^(?:example|theorem)\b/u.test(declaration)) {
      throw new Error('This level does not expose an executable Lean statement')
    }
    return { declaration }
  }

  private async checkProof(proofBody: string): Promise<ProofState> {
    // Game/level presentation metadata is delivered as JSON; the declarations
    // and custom tactics used to elaborate and kernel-check proofs live in the
    // persistent browser environment.
    // The snapshot contains all non-Algorithm NNG declarations behind one
    // stable facade. Every level must repeat this exact import header: the
    // persistent WASM compiler keys its cached environment by that header.
    const declaration = `${this.initialDeclaration} := by\n${indentProof(instrumentBrowserProof(proofBody))}\n  all_goals browser_report_state\n  all_goals sorry`
    // Lean4Game's exported `descrFormat` contains the statement itself, but not
    // the namespace surrounding the authored level. Every NNG4 level is
    // declared in `MyNat`; restoring that context is what makes unqualified
    // names such as `succ`, `zero_add`, and `add_assoc` resolve exactly as they
    // do in the original game sources.
    const repositoryName = this.gameId.split('/').at(-1)?.toLowerCase()
    const namespacedDeclaration = repositoryName === 'nng4'
      ? `namespace MyNat\n\n${declaration}\n\nend MyNat`
      : declaration
    const code = `import GameServer.Tactic.Visual\nimport Game.Browser.Runtime\n\n${namespacedDeclaration}\n`
    const result = await this.engine.compile(code)
    const errors = result.diagnostics.filter(diag => diag.severity === 'error')
    if (!result.success) {
      const diagnosticText = errors.map(diag => diag.data).filter(Boolean).join('\n')
      throw new Error(diagnosticText || result.error || 'Lean WASM failed')
    }
    if (errors.length > 0) {
      throw new Error(errors.map(diag => diag.data).filter(Boolean).join('\n'))
    }

    const goals = parseStructuredGoals(result.diagnostics)
    const admittedRemainder = result.diagnostics.some(diag => /declaration uses [`']sorry/iu.test(diag.data ?? ''))
    if (goals.length === 0 && admittedRemainder) {
      throw new Error('Lean left goals open but the structured proof-state probe returned no state')
    }
    const command = lastCommand(proofBody)
    const step: InteractiveGoalsWithHints = {
      goals,
      focusedGoals: goals,
      command,
      diags: [],
      annotation: annotationFor(command),
    }
    const completed = goals.length === 0
    return {
      steps: [step],
      diagnostics: [],
      completed,
      completedWithWarnings: completed,
    }
  }
}
