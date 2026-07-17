import type {
  InteractiveGoalWithHints,
  InteractiveGoalsWithHints,
  ProofState,
} from '../components/infoview/rpc_api'
import { getDataBaseUrl } from '../utils/url'

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

const SNAPSHOT_URL = '/visual-lean/snapshots/game.snap.gz?v=8c7ca0a1'
const PROOF_STATE_MARKER = '__VISUAL_LEAN_STATE_V1__'
// This purpose-linked runtime and the snapshot are produced by the same build.
// Keeping them paired is required because Lean snapshots contain function-table
// references that are not ABI-compatible with a separately linked WASM binary.
const WORKER_URL = '/lean-worker-persistent.worker.js?assetBase=%2Fvisual-lean%2Fruntime&v=8c7ca0a1'
const WORKER_TIMEOUT_MS = 600_000

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
  let leanTactic: string | undefined
  if (source === 'click_goal') leanTactic = 'intro'
  else if (source === 'click_goal_left') leanTactic = 'left'
  else if (source === 'click_goal_right') leanTactic = 'right'
  else if (source.startsWith('delete_theorem ')) leanTactic = `clear ${source.slice(15).trim()}`
  return source ? { playTactic: source, leanTactic } : undefined
}

class LocalLeanWorker {
  private worker: Worker | null = null
  private readyPromise: Promise<void> | null = null
  private pendingCompile: PendingCompile | null = null
  private snapshotResolver: ((result: { success: boolean; error?: string }) => void) | null = null
  private operationQueue: Promise<void> = Promise.resolve()

  ensureReady(): Promise<void> {
    if (this.readyPromise) return this.readyPromise
    this.readyPromise = new Promise<void>((resolve, reject) => {
      const worker = new Worker(WORKER_URL)
      this.worker = worker
      const timeout = window.setTimeout(() => reject(new Error('Local Lean WASM initialization timed out')), WORKER_TIMEOUT_MS)

      worker.onmessage = event => {
        const msg = event.data ?? {}
        if (msg.type === 'worker_boot') worker.postMessage({ type: 'load_library', files: [] })
        else if (msg.type === 'library_received') worker.postMessage({ type: 'start_worker' })
        else if (msg.type === 'worker_ready') {
          this.loadSnapshot().then(() => {
            window.clearTimeout(timeout)
            resolve()
          }, error => {
            window.clearTimeout(timeout)
            reject(error)
          })
        } else if (msg.type === 'snapshot_loaded') {
          this.snapshotResolver?.(msg)
          this.snapshotResolver = null
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
        : reject(new Error(result.error ?? 'Visual Lean snapshot failed to load'))
      this.worker!.postMessage({ type: 'load_snapshot', name: 'game.snap', url: SNAPSHOT_URL })
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
    return new Promise<CompileResult>(resolve => {
      this.pendingCompile = { diagnostics: [], resolve }
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
    this.initialDeclaration = await this.fetchInitialDeclaration(worldId, levelId)
    return this.checkProof('')
  }

  async sendProofUpdate(proofBody: string): Promise<ProofState | null> {
    if (this.closed) return null
    try {
      return await this.checkProof(proofBody)
    } catch (error) {
      console.error('Local Lean proof check failed', error)
      return null
    }
  }

  close() {
    this.closed = true
  }

  isClosed() {
    return this.closed
  }

  private async fetchInitialDeclaration(worldId: string, levelId: number): Promise<string> {
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
    const declaration = level.descrFormat?.trim().replace(/\s*:=\s*by\s*$/u, '')
    if (!declaration || !/^(?:example|theorem)\b/u.test(declaration)) {
      throw new Error('This level does not expose an executable Lean statement')
    }
    return declaration
  }

  private async checkProof(proofBody: string): Promise<ProofState> {
    // Game/level metadata is already delivered as JSON.  Import only the
    // custom tactic implementation needed to elaborate and kernel-check the
    // generated proof, keeping the cached browser environment much smaller.
    const code = `import GameServer.Tactic.Visual\n\n${this.initialDeclaration} := by\n${indentProof(proofBody)}\n  all_goals browser_report_state\n  all_goals sorry\n`
    const result = await this.engine.compile(code)
    if (!result.success) throw new Error(result.error ?? 'Lean WASM failed')

    const errors = result.diagnostics.filter(diag => diag.severity === 'error')
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
