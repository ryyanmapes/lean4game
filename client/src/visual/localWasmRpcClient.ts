import type {
  ClickAction,
  InteractiveGoalWithHints,
  InteractiveGoalsWithHints,
  InteractiveHypothesisBundle,
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

const SNAPSHOT_URL = '/visual-lean/snapshots/game.snap.gz'
// This purpose-linked runtime and the snapshot are produced by the same build.
// Keeping them paired is required because Lean snapshots contain function-table
// references that are not ABI-compatible with a separately linked WASM binary.
const WORKER_URL = '/lean-worker-persistent.worker.js?assetBase=%2Fvisual-lean%2Fruntime&v=1237bea6'
const WORKER_TIMEOUT_MS = 600_000

function topLevelArrow(text: string): boolean {
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(' || text[i] === '[' || text[i] === '{') depth++
    else if (text[i] === ')' || text[i] === ']' || text[i] === '}') depth--
    else if (depth === 0 && text[i] === '→') return true
  }
  return false
}

function goalClickAction(type: string): ClickAction | undefined {
  const text = type.trim()
  if (topLevelArrow(text) || /^∀\s/u.test(text)) {
    return { playTactic: 'click_goal', tooltip: 'Click to introduce', options: [] }
  }
  if (/^(?:And\b|.+\s∧\s)/u.test(text)) {
    return { playTactic: 'click_goal', tooltip: 'Click to split conjunction', streamSplit: true, options: [] }
  }
  if (/^(?:Or\b|.+\s∨\s)/u.test(text)) {
    return {
      tooltip: 'Choose which side to prove',
      options: [
        { label: 'Left', playTactic: 'click_goal_left' },
        { label: 'Right', playTactic: 'click_goal_right' },
      ],
    }
  }
  const equality = text.split('=')
  if (equality.length === 2 && equality[0]?.trim() === equality[1]?.trim()) {
    return { playTactic: 'click_goal', tooltip: 'Click to complete', options: [] }
  }
  return undefined
}

function hypClickAction(name: string, type: string): ClickAction | undefined {
  const text = type.trim()
  if (/^(?:And\b|.+\s∧\s)/u.test(text)) {
    return { playTactic: `click_prop ${name}`, tooltip: 'Click to split conjunction', options: [] }
  }
  if (/^(?:Or\b|.+\s∨\s)/u.test(text)) {
    return { playTactic: `click_prop ${name}`, tooltip: 'Click to split into cases', streamSplit: true, options: [] }
  }
  if (/^∃\s/u.test(text)) {
    return { playTactic: `click_prop ${name}`, tooltip: 'Click to introduce witness and condition', options: [] }
  }
  return undefined
}

function codeWithInfos(text: string) {
  // CodeWithInfos is Lean's tagged-text JSON shape. Plain strings render in
  // React, but infoview's tag traversal uses `"append" in value` and therefore
  // requires the leaf wrapper even when there are no semantic info tags.
  return { text } as never
}

function hypothesis(names: string[], type: string): InteractiveHypothesisBundle {
  const primaryName = names[0] ?? 'h'
  return {
    names,
    fvarIds: names as InteractiveHypothesisBundle['fvarIds'],
    type: codeWithInfos(type),
    isAssumption: type.trim() !== 'Prop' && type.trim() !== 'Type',
    clickAction: hypClickAction(primaryName, type),
    reductionForms: [],
  }
}

function parseGoalBlock(lines: string[], index: number): InteractiveGoalWithHints | null {
  const turnstile = lines.findIndex(line => /^\s*⊢\s/u.test(line))
  if (turnstile < 0) return null

  const heading = lines.find(line => /^case\s+/u.test(line.trim()))?.trim()
  const hyps: InteractiveHypothesisBundle[] = []
  for (const rawLine of lines.slice(0, turnstile)) {
    const line = rawLine.trim()
    if (!line || /^case\s+/u.test(line)) continue
    const match = /^(.+?)\s*:\s*(.+)$/u.exec(line)
    if (!match) continue
    const names = match[1]!.trim().split(/\s+/u).filter(Boolean)
    if (names.length > 0) hyps.push(hypothesis(names, match[2]!.trim()))
  }

  const goalType = lines.slice(turnstile)
    .map((line, lineIndex) => lineIndex === 0 ? line.replace(/^\s*⊢\s*/u, '') : line.trim())
    .join(' ')
    .trim()
  if (!goalType) return null

  return {
    goal: {
      hyps,
      type: codeWithInfos(goalType),
      userName: heading?.replace(/^case\s+/u, ''),
      mvarId: `wasm-goal-${index}-${goalType}` as never,
      goalPrefix: '⊢ ',
      clickAction: goalClickAction(goalType),
      reductionForms: [],
    },
    hints: [],
    reductionForms: [],
  }
}

function parseUnsolvedGoals(message: string): InteractiveGoalWithHints[] {
  const normalized = message.replace(/\r/g, '')
  const start = normalized.indexOf('unsolved goals')
  const lines = (start < 0 ? normalized : normalized.slice(start + 'unsolved goals'.length)).split('\n')
  const blocks: string[][] = []
  let current: string[] = []
  for (const line of lines) {
    if (/^case\s+/u.test(line.trim()) && current.some(item => /^\s*⊢\s/u.test(item))) {
      blocks.push(current)
      current = [line]
    } else {
      current.push(line)
    }
  }
  if (current.some(item => item.trim())) blocks.push(current)
  return blocks.map(parseGoalBlock).filter((goal): goal is InteractiveGoalWithHints => goal !== null)
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
  private initialGoal = ''

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
    this.initialGoal = await this.fetchInitialGoal(worldId, levelId)
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

  private async fetchInitialGoal(worldId: string, levelId: number): Promise<string> {
    const base = getDataBaseUrl().replace(/\/$/u, '')
    const response = await fetch(`${base}/${this.gameId}/level__${worldId}__${levelId}.json`)
    if (!response.ok) throw new Error(`Could not load level data (${response.status})`)
    const level = await response.json() as { visualGoalInfos?: Array<{ goal?: string | null }> }
    const goal = level.visualGoalInfos?.find(item => item.goal)?.goal?.trim()
    if (!goal) throw new Error('This level does not expose an initial visual goal yet')
    return goal
  }

  private async checkProof(proofBody: string): Promise<ProofState> {
    // Game/level metadata is already delivered as JSON.  Import only the
    // custom tactic implementation needed to elaborate and kernel-check the
    // generated proof, keeping the cached browser environment much smaller.
    const code = `import GameServer.Tactic.Visual\n\nexample : ${this.initialGoal} := by\n${indentProof(proofBody)}\n`
    const result = await this.engine.compile(code)
    if (!result.success) throw new Error(result.error ?? 'Lean WASM failed')

    const errors = result.diagnostics.filter(diag => diag.severity === 'error')
    const unsolved = errors.filter(diag => /unsolved goals/iu.test(diag.data ?? ''))
    const tacticErrors = errors.filter(diag => !/unsolved goals/iu.test(diag.data ?? ''))
    if (tacticErrors.length > 0) {
      throw new Error(tacticErrors.map(diag => diag.data).filter(Boolean).join('\n'))
    }

    const goals = unsolved.flatMap(diag => parseUnsolvedGoals(diag.data ?? ''))
    const command = lastCommand(proofBody)
    const step: InteractiveGoalsWithHints = {
      goals,
      focusedGoals: goals,
      command,
      diags: [],
      annotation: annotationFor(command),
    }
    const completed = errors.length === 0
    return {
      steps: [step],
      diagnostics: [],
      completed,
      completedWithWarnings: completed,
    }
  }
}
