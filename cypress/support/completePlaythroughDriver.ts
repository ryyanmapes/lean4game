import { matchAndCapture, parse } from '../../client/src/visual/expr-engine'
import type { ExpressionNode } from '../../client/src/visual/expr-types'

interface ProofAudit {
  completed: boolean
  processing: boolean
  coreLines: string[]
  interactiveLines: string[]
}

interface StreamSnapshot {
  streamId: string
  goalType: string
  hypTypes: Record<string, string>
  currentStreamIsCompleted: boolean
}

interface ReadOnlyVisualHarness {
  getProofAudit(): ProofAudit
  getCurrentStreamSnapshot(): StreamSnapshot
  getLastDragDebug(): Record<string, unknown> | null
}

interface PlayLogEntry {
  timestamp: number
  playTactic: string
  leanTactic: string | null
  succeeded: boolean
}

type DriverWindow = Cypress.AUTWindow & {
  __visualTestHarness?: ReadOnlyVisualHarness
  __lastLeanProofError?: string
}

const POLL_MS = 25
const ACTION_TIMEOUT = Number(
  typeof Cypress !== 'undefined' && typeof Cypress.env === 'function'
    ? Cypress.env('VISUAL_TIMEOUT') ?? 600_000
    : (globalThis as typeof globalThis & { __playerGestureTimeout?: number }).__playerGestureTimeout ?? 600_000,
)
const INTERACTION_TIMEOUT = Math.min(ACTION_TIMEOUT, 60_000)

function sleep(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

async function waitFor<T>(
  description: string,
  read: () => T | null | undefined | false,
  timeout = INTERACTION_TIMEOUT,
): Promise<T> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = read()
    if (value) return value
    await sleep(POLL_MS)
  }
  throw new Error(`Timed out waiting for ${description}`)
}

async function rewindPages(container: HTMLElement, ariaLabel: string) {
  for (let page = 0; page < 100; page += 1) {
    const previous = container.querySelector<HTMLButtonElement>(`button[aria-label="${ariaLabel}"]`)
    if (!previous || previous.disabled) return
    click(previous)
    await sleep(35)
  }
  throw new Error(`Could not rewind ${ariaLabel.toLowerCase()} pagination`)
}

function harness(win: DriverWindow): ReadOnlyVisualHarness {
  const bridge = win.__visualTestHarness
  if (!bridge) throw new Error('The read-only visual audit bridge is unavailable')
  return bridge
}

function proofSignature(audit: ProofAudit) {
  return JSON.stringify({
    completed: audit.completed,
    coreLines: audit.coreLines,
    interactiveLines: audit.interactiveLines,
  })
}

function playerStateSignature(win: DriverWindow) {
  let snapshot: StreamSnapshot | null = null
  try {
    snapshot = harness(win).getCurrentStreamSnapshot()
  } catch {
    // Completing one branch can intentionally leave no interactive stream
    // selected until the player chooses another leaf in the proof graph.
  }
  const goal = currentGoal(win)
  return JSON.stringify({
    proof: proofSignature(harness(win).getProofAudit()),
    streamId: snapshot?.streamId ?? null,
    currentStreamIsCompleted: snapshot?.currentStreamIsCompleted ?? null,
    hypTypes: snapshot?.hypTypes ?? null,
    goalId: goal?.dataset.streamId ?? goal?.id ?? null,
    goalText: goal?.dataset.goalText ?? goal?.textContent ?? null,
    goalSolved: goal?.classList.contains('solved') ?? false,
  })
}

export function sortPlayLogEntries<T extends { timestamp: number }>(entries: T[]): T[] {
  return [...entries].sort((left, right) => left.timestamp - right.timestamp)
}

function playLog(win: DriverWindow): PlayLogEntry[] {
  const entries: PlayLogEntry[] = []
  for (let index = 0; index < win.localStorage.length; index += 1) {
    const key = win.localStorage.key(index)
    if (!key?.startsWith('playlog/')) continue
    try {
      const value = JSON.parse(win.localStorage.getItem(key) ?? '[]')
      if (Array.isArray(value)) entries.push(...value)
    } catch {
      // A malformed unrelated persisted log should not hide a new player action.
    }
  }
  // Each level has its own playlog/* key. localStorage key iteration order is
  // insertion order, not chronological order across those per-level arrays,
  // so the newest interaction is not necessarily entries.at(-1). That made a
  // later level observe an old, successful rewrite from an earlier level.
  return sortPlayLogEntries(entries)
}

async function waitForPlayAttempt(
  win: DriverWindow,
  previousCount: number,
  description: string,
  retry?: () => void,
) {
  const interactionDeadline = Date.now() + INTERACTION_TIMEOUT
  const responseDeadline = Date.now() + ACTION_TIMEOUT
  let actionStarted = false
  while (Date.now() < (actionStarted ? responseDeadline : interactionDeadline)) {
    const entries = playLog(win)
    const entry = entries.length > previousCount ? entries.at(-1) : undefined
    if (entry) {
      if (!entry.succeeded) {
        const leanError = (
          win.sessionStorage.getItem('visual-last-lean-error')
          ?? win.__lastLeanProofError
          ?? ''
        ).trim()
        throw new Error(
          `Player interaction was rejected: ${entry.playTactic}` +
          (leanError ? `\nLean: ${leanError}` : ''),
        )
      }
      return entry
    }

    // The play log is appended only after Lean answers. Once the UI enters
    // its processing state, the gesture has fired; allow the configured
    // backend timeout instead of reporting a slow compile as a missed click.
    let auditProcessing = false
    try {
      auditProcessing = harness(win).getProofAudit().processing
    } catch {
      // The bridge can briefly disappear while a completed branch is merged.
    }
    if (auditProcessing || win.document.querySelector('.tr-processing')) {
      actionStarted = true
    } else if (!actionStarted) {
      retry?.()
    }
    await sleep(POLL_MS)
  }
  throw new Error(
    `Timed out waiting for ${description}` +
    (actionStarted ? ' after the player action reached Lean' : ''),
  )
}

async function waitForProofChange(win: DriverWindow, previous: string, description: string) {
  await waitFor(description, () => {
    const audit = harness(win).getProofAudit()
    return !audit.processing && proofSignature(audit) !== previous ? audit : null
  }, INTERACTION_TIMEOUT)
}

async function dragChangedProof(
  win: DriverWindow,
  source: HTMLElement,
  target: HTMLElement,
  previous: string,
) {
  const previousAttempts = playLog(win).length
  await drag(source, target)
  const deadline = Date.now() + 1_000
  let attempt: PlayLogEntry | undefined
  let actionStarted = false
  while (Date.now() < deadline) {
    const entries = playLog(win)
    if (entries.length > previousAttempts) {
      attempt = entries.at(-1)
      break
    }
    // A matching expression starts Lean immediately, but the release WASM
    // worker can take several seconds to append its play-log result. Treat
    // the processing state as proof that this candidate accepted the drop;
    // non-matching expression nodes never enter that state.
    if (harness(win).getProofAudit().processing || win.document.querySelector('.tr-processing')) {
      actionStarted = true
      break
    }
    await sleep(POLL_MS)
  }
  // The local WASM runner can block the browser main thread for longer than
  // the probe deadline. In that case the loop cannot observe either the
  // processing render or the log entry before its condition expires, even
  // though the accepted interaction appended its result before control came
  // back to this task. Always sample the authoritative log once after the
  // deadline before classifying the expression as a rejected drop.
  if (!attempt) {
    const entries = playLog(win)
    if (entries.length > previousAttempts) attempt = entries.at(-1)
  }
  if (!attempt && !actionStarted) return false
  attempt ??= await waitForPlayAttempt(
    win,
    previousAttempts,
    'fallback rewrite drag after Lean accepted the expression target',
  )
  if (!attempt.succeeded) throw new Error(`Player rewrite was rejected: ${attempt.playTactic}`)
  await waitForProofChange(win, previous, 'dragged interaction to update the proof')
  return true
}

function visible<T extends Element>(elements: Iterable<T>): T[] {
  return Array.from(elements).filter(element => {
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
  })
}

function click(element: Element) {
  element.scrollIntoView({ block: 'center', inline: 'center' })
  const view = element.ownerDocument.defaultView
  if (!view) throw new Error('Cannot activate an element without a browser window')
  // Buttons already implement the browser's complete activation behavior.
  // Preceding their native click with synthetic mouse-down events can start
  // the canvas drag sensor in Chromium and cause React to ignore the button.
  if (element instanceof view.HTMLButtonElement) {
    element.focus()
    element.click()
    return
  }
  // Cypress runs specs in a separate iframe. Events constructed from that
  // window are not reliably accepted by React listeners on SVG proof-tree
  // nodes in the application iframe, so always use the target's own realm.
  element.dispatchEvent(new view.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
  element.dispatchEvent(new view.MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }))
  // Native activation matters for buttons (including React-controlled tabs).
  // SVG proof-tree nodes do not expose HTMLElement.click(), so retain the
  // explicit mouse event as a fallback for those player controls.
  if (element instanceof view.HTMLElement && typeof element.click === 'function') element.click()
  else element.dispatchEvent(new view.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
}

function doubleClick(element: HTMLElement) {
  element.scrollIntoView({ block: 'center', inline: 'center' })
  const view = element.ownerDocument.defaultView
  if (!view) throw new Error('Cannot double-click an element without a browser window')
  for (let detail = 1; detail <= 2; detail += 1) {
    element.dispatchEvent(new view.MouseEvent('mousedown', {
      bubbles: true, cancelable: true, button: 0, detail,
    }))
    element.dispatchEvent(new view.MouseEvent('mouseup', {
      bubbles: true, cancelable: true, button: 0, detail,
    }))
    element.dispatchEvent(new view.MouseEvent('click', {
      bubbles: true, cancelable: true, button: 0, detail,
    }))
  }
  element.dispatchEvent(new view.MouseEvent('dblclick', {
    bubbles: true,
    cancelable: true,
    button: 0,
    detail: 2,
  }))
}

async function drag(source: HTMLElement, target: HTMLElement) {
  source.scrollIntoView({ block: 'center', inline: 'center' })
  target.scrollIntoView({ block: 'center', inline: 'center' })
  await sleep(POLL_MS)
  const start = source.getBoundingClientRect()
  const startX = start.left + start.width / 2
  const startY = start.top + start.height / 2
  const ownerDocument = source.ownerDocument
  const moveTarget = ownerDocument.body
  const PointerEventCtor = ownerDocument.defaultView?.PointerEvent ?? PointerEvent
  const pointer = {
    bubbles: true,
    cancelable: true,
    pointerId: 91,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
  }
  source.dispatchEvent(new PointerEventCtor('pointerdown', {
    ...pointer,
    buttons: 1,
    clientX: startX,
    clientY: startY,
  }))
  // Cross dnd-kit's distance threshold before approaching the target. Cards
  // can legitimately overlap after a player places a theorem copy; without
  // this explicit first motion, a center-to-center synthetic drag may remain
  // a click and never enter the same drag path a player would trigger.
  moveTarget.dispatchEvent(new PointerEventCtor('pointermove', {
    ...pointer,
    buttons: 1,
    clientX: startX + 12,
    clientY: startY + 12,
  }))
  await sleep(20)
  await finishPointerDrag(source, target, startX, startY, 91)
}

async function dragToPoint(source: HTMLElement, clientX: number, clientY: number) {
  source.scrollIntoView({ block: 'center', inline: 'center' })
  await sleep(POLL_MS)
  const start = source.getBoundingClientRect()
  const startX = start.left + start.width / 2
  const startY = start.top + start.height / 2
  const ownerDocument = source.ownerDocument
  const moveTarget = ownerDocument.body
  const PointerEventCtor = ownerDocument.defaultView?.PointerEvent ?? PointerEvent
  const pointer = {
    bubbles: true,
    cancelable: true,
    pointerId: 93,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
  }
  source.dispatchEvent(new PointerEventCtor('pointerdown', {
    ...pointer,
    buttons: 1,
    clientX: startX,
    clientY: startY,
  }))
  moveTarget.dispatchEvent(new PointerEventCtor('pointermove', {
    ...pointer,
    buttons: 1,
    clientX: startX + 12,
    clientY: startY + 12,
  }))
  await sleep(20)
  for (let step = 1; step <= 8; step += 1) {
    const ratio = step / 8
    moveTarget.dispatchEvent(new PointerEventCtor('pointermove', {
      ...pointer,
      buttons: 1,
      clientX: startX + (clientX - startX) * ratio,
      clientY: startY + (clientY - startY) * ratio,
    }))
    await sleep(15)
  }
  moveTarget.dispatchEvent(new PointerEventCtor('pointerup', {
    ...pointer,
    buttons: 0,
    clientX,
    clientY,
  }))
}

async function finishPointerDrag(
  source: HTMLElement,
  target: HTMLElement,
  startX: number,
  startY: number,
  pointerId: number,
) {
  target.scrollIntoView({ block: 'center', inline: 'center' })
  await sleep(POLL_MS)
  const end = target.getBoundingClientRect()
  const endX = end.left + end.width / 2
  const endY = end.top + end.height / 2
  const ownerDocument = source.ownerDocument
  const moveTarget = ownerDocument.body
  const PointerEventCtor = ownerDocument.defaultView?.PointerEvent ?? PointerEvent
  const pointer = {
    bubbles: true,
    cancelable: true,
    pointerId,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
  }
  for (let step = 1; step <= 6; step += 1) {
    const ratio = step / 6
    moveTarget.dispatchEvent(new PointerEventCtor('pointermove', {
      ...pointer,
      buttons: 1,
      clientX: startX + (endX - startX) * ratio,
      clientY: startY + (endY - startY) * ratio,
    }))
    await sleep(12)
  }
  moveTarget.dispatchEvent(new PointerEventCtor('pointerup', {
    ...pointer,
    buttons: 0,
    clientX: endX,
    clientY: endY,
  }))
}

async function beginPointerDrag(source: HTMLElement, pointerId = 92) {
  source.scrollIntoView({ block: 'center', inline: 'center' })
  await sleep(POLL_MS)
  const rect = source.getBoundingClientRect()
  const startX = rect.left + rect.width / 2
  const startY = rect.top + rect.height / 2
  const ownerDocument = source.ownerDocument
  const PointerEventCtor = ownerDocument.defaultView?.PointerEvent ?? PointerEvent
  const pointer = {
    bubbles: true,
    cancelable: true,
    pointerId,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
  }
  source.dispatchEvent(new PointerEventCtor('pointerdown', {
    ...pointer,
    buttons: 1,
    clientX: startX,
    clientY: startY,
  }))
  for (const offset of [8, 16, 24]) {
    ownerDocument.body.dispatchEvent(new PointerEventCtor('pointermove', {
      ...pointer,
      buttons: 1,
      clientX: startX + offset,
      clientY: startY + offset,
    }))
    await sleep(25)
  }
  await sleep(100)
  return {
    finish: (target: HTMLElement) => finishPointerDrag(source, target, startX, startY, pointerId),
    cancel: () => {
      ownerDocument.body.dispatchEvent(new PointerEventCtor('pointerup', {
        ...pointer,
        buttons: 0,
        clientX: startX + 8,
        clientY: startY + 8,
      }))
    },
  }
}

function cssEscape(value: string) {
  return CSS.escape(value)
}

function currentGoal(win: DriverWindow) {
  try {
    const streamId = harness(win).getCurrentStreamSnapshot().streamId
    return visible(win.document.querySelectorAll<HTMLElement>(
      `[data-testid="goal-card"][data-stream-id="${cssEscape(streamId)}"]`,
    ))[0]
      ?? visible(win.document.querySelectorAll<HTMLElement>('[data-testid="goal-card"]'))[0]
      ?? null
  } catch {
    return visible(win.document.querySelectorAll<HTMLElement>('[data-testid="goal-card"]'))[0] ?? null
  }
}

function nextFresh(existing: Set<string>, base: string) {
  if (!existing.has(base)) return base
  let suffix = 1
  while (existing.has(`${base}${suffix}`)) suffix += 1
  return `${base}${suffix}`
}

function splitTopLevel(source: string, delimiter = ',') {
  const values: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (char === '(' || char === '[') depth += 1
    else if (char === ')' || char === ']') depth -= 1
    else if (char === delimiter && depth === 0) {
      values.push(source.slice(start, index).trim())
      start = index + 1
    }
  }
  values.push(source.slice(start).trim())
  return values.filter(Boolean)
}

function sourceName(source: string) {
  return source.trim().replace(/^\(?/, '').split(/[\s()]/u).find(Boolean) ?? source.trim()
}

interface RewriteRule {
  name: string
  reverse: boolean
  args: string[]
}

function splitTopLevelWhitespace(source: string): string[] {
  const terms: string[] = []
  let depth = 0
  let start = -1
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (/\s/u.test(char) && depth === 0) {
      if (start >= 0) terms.push(source.slice(start, index))
      start = -1
      continue
    }
    if (start < 0) start = index
    if (char === '(') depth += 1
    else if (char === ')') depth -= 1
  }
  if (start >= 0) terms.push(source.slice(start))
  return terms
}

function rewriteSource(source: string) {
  const terms = splitTopLevelWhitespace(source.trim())
  return {
    name: sourceName(terms[0] ?? source),
    args: terms.slice(1),
  }
}

function matchesExplicitArgument(actual: ExpressionNode, expected: ExpressionNode): boolean {
  if (expected.type === 'variable' && expected.name === '_') return true
  if (actual.type !== expected.type) return false
  if (actual.type === 'variable' && expected.type === 'variable') return actual.name === expected.name
  if (actual.type === 'constant' && expected.type === 'constant') return actual.value === expected.value
  if (actual.type === 'app' && expected.type === 'app') {
    return actual.func === expected.func && matchesExplicitArgument(actual.arg, expected.arg)
  }
  if (actual.type === 'binary' && expected.type === 'binary') {
    return actual.op === expected.op
      && matchesExplicitArgument(actual.left, expected.left)
      && matchesExplicitArgument(actual.right, expected.right)
  }
  return false
}

function forallBinderNames(card: HTMLElement): string[] {
  const footer = card.querySelector<HTMLElement>(
    '.tr-forall-footer, .statement-forall-footer',
  )?.textContent ?? ''
  return Array.from(footer.matchAll(/[({]\s*([^\s:(){}]+)/gu), match => match[1])
}

function matchesPartiallyAppliedRule(
  target: HTMLElement,
  card: HTMLElement,
  explicitArgs: string[],
): boolean {
  if (explicitArgs.length === 0) return true
  const expressionText = target.dataset.exprText
  const symbol = card.querySelector<HTMLElement>('.tr-symbol')?.textContent ?? ''
  const sourcePattern = symbol.split('\u2192', 1)[0]?.trim()
  if (!expressionText || !sourcePattern) return true
  try {
    const bindings = matchAndCapture(parse(expressionText), parse(sourcePattern))
    if (!bindings) return false
    const binderNames = forallBinderNames(card)
    return explicitArgs.every((argument, index) => {
      const binderName = binderNames[index]
      const actual = binderName ? bindings[binderName] : undefined
      return actual ? matchesExplicitArgument(actual, parse(argument)) : false
    })
  } catch {
    // If an older card format cannot be parsed, retain the normal visual
    // target behavior instead of inventing a false negative.
    return true
  }
}

function matchesTheoremPremise(
  theorem: HTMLElement,
  hypothesis: HTMLElement,
  explicitArgs: string[],
): boolean {
  const proposition = theorem.querySelector<HTMLElement>('.proposition')?.textContent ?? ''
  const arrow = proposition.indexOf('→')
  const targetType = hypothesis.dataset.hypType
  if (arrow < 0 || !targetType) return false
  try {
    const bindings = matchAndCapture(
      parse(targetType.replace(/≠/gu, '=')),
      parse(proposition.slice(0, arrow).trim().replace(/≠/gu, '=')),
    )
    if (!bindings) return false
    const binders = forallBinderNames(theorem)
    return explicitArgs.every((argument, index) => {
      const actual = bindings[binders[index]]
      return actual ? matchesExplicitArgument(actual, parse(argument)) : false
    })
  } catch {
    return false
  }
}

function parseRewrite(command: string) {
  const match = /^(repeat\s+)?(?:rw|nth_rewrite\s+(\d+))\s*\[([^\]]+)\](?:\s+at\s+(.+))?$/u.exec(command.trim())
  if (!match) throw new Error(`Unsupported rewrite command: ${command}`)
  const targets = match[4]
    ? match[4].trim().split(/\s+/u).map(target => target === '\u22a2' ? 'goal' : target)
    : ['goal']
  return {
    repeat: Boolean(match[1]),
    occurrence: match[2] ? Number(match[2]) : null,
    rules: splitTopLevel(match[3]).map(raw => {
      const reverse = /^\u2190\s*/u.test(raw)
      const body = raw.replace(/^\u2190\s*/u, '')
      return { ...rewriteSource(body), reverse } satisfies RewriteRule
    }),
    targets,
  }
}

type ConstructionExpr =
  | { kind: 'atom'; value: string }
  | { kind: 'binary'; op: '+' | '*'; left: ConstructionExpr; right: ConstructionExpr }

function parseConstructionExpr(source: string): ConstructionExpr {
  const text = source.trim().replace(/^\((.*)\)$/u, '$1')
  for (const op of ['+', '*'] as const) {
    let depth = 0
    for (let index = text.length - 1; index >= 0; index -= 1) {
      const char = text[index]
      if (char === ')') depth += 1
      else if (char === '(') depth -= 1
      else if (char === op && depth === 0) {
        return {
          kind: 'binary',
          op,
          left: parseConstructionExpr(text.slice(0, index)),
          right: parseConstructionExpr(text.slice(index + 1)),
        }
      }
    }
  }
  return { kind: 'atom', value: text }
}

export class CompletePlaythroughDriver {
  private readonly aliases = new Map<string, string>()
  private readonly pendingBranchAliases: Array<{ expected: string; before: Set<string> }> = []
  private classicCommandsAlreadyCovered = 0
  private implicitIntroAlreadyPerformed = false
  private preferredRewriteSide: 'left' | 'right' | null = null

  constructor(private readonly win: DriverWindow) {}

  private normalizedProposition(value: string) {
    return value
      .replace(/->/gu, '→')
      .replace(/\s+/gu, '')
  }

  private visibleHypothesisOfType(type: string) {
    const expected = this.normalizedProposition(type)
    return visible(this.win.document.querySelectorAll<HTMLElement>('[data-testid="hyp-card"]'))
      .find(card => this.normalizedProposition(card.dataset.hypType ?? '') === expected)
      ?? null
  }

  /** Combine two visible proposition cards using the same pointer drag as a
   * player. This deliberately addresses cards by their displayed types, not
   * by Lean names, so focused tests can exercise generic A / (A → B)
   * application without smuggling in a theorem-specific command. */
  async combineVisiblePropositions(sourceType: string, targetType: string, resultType: string) {
    const source = await waitFor(
      `visible proposition card ${sourceType}`,
      () => this.visibleHypothesisOfType(sourceType),
    )
    const target = await waitFor(
      `visible proposition card ${targetType}`,
      () => this.visibleHypothesisOfType(targetType),
    )
    await this.dragAndWait(source, target, `${sourceType} drag onto ${targetType}`)
    await waitFor(
      `the derived proposition card ${resultType}`,
      () => this.visibleHypothesisOfType(resultType),
    )
    if (harness(this.win).getProofAudit().completed) {
      throw new Error(`Combining ${sourceType} with ${targetType} completed before ${resultType} was applied to the goal`)
    }
  }

  /** Solve the current goal by dragging a visible proposition card onto it. */
  async solveGoalWithVisibleProposition(type: string) {
    const source = await waitFor(
      `visible proposition card ${type}`,
      () => this.visibleHypothesisOfType(type),
    )
    const target = await waitFor('current goal', () => currentGoal(this.win))
    await this.dragAndWait(source, target, `${type} drag onto the goal`)
    await waitFor(`${type} application to complete the proof`, () => {
      const audit = harness(this.win).getProofAudit()
      return !audit.processing && audit.completed ? audit : null
    })
  }

  /** Perform a rewrite after selecting the same side a player would with the
   * transformation view's arrow button. */
  async performRewriteOnSide(command: string, side: 'left' | 'right') {
    this.preferredRewriteSide = side
    try {
      await this.perform(command)
    } finally {
      this.preferredRewriteSide = null
    }
  }

  private async navigateFromCompletedBranch() {
    let before: StreamSnapshot | null = null
    try {
      before = harness(this.win).getCurrentStreamSnapshot()
    } catch {
      // A solved branch may deliberately leave the canvas without a current
      // stream until the player selects an incomplete graph leaf.
    }
    if (before && !before.currentStreamIsCompleted && currentGoal(this.win)) return

    const previousStreamId = before?.streamId ?? null
    // The proof tree and the completed-stream snapshot are updated by separate
    // React state changes. For one render, the just-completed current leaf can
    // therefore still say data-completed="false". It is not a route anywhere:
    // navigateToStream intentionally ignores a click on the current stream.
    // Wait for a clickable *different* leaf (or a live highlighted arrow), and
    // retain only its stable stream id rather than a soon-to-be-replaced node.
    const route = await waitFor('a visible route to an incomplete proof branch', () => {
      const leaf = visible(this.win.document.querySelectorAll<SVGElement>(
        '[data-testid="proof-stream-leaf"][data-completed="false"][data-stream-id]',
      )).find(candidate => candidate.dataset.streamId !== previousStreamId)
      if (leaf?.dataset.streamId) return { kind: 'leaf' as const, streamId: leaf.dataset.streamId }
      const arrow = visible(this.win.document.querySelectorAll<HTMLButtonElement>(
        '[data-testid^="stream-nav-"].toward-incomplete:not(:disabled)',
      ))[0]
      if (arrow) return { kind: 'arrow' as const, testId: arrow.getAttribute('data-testid') ?? '' }
      try {
        const snapshot = harness(this.win).getCurrentStreamSnapshot()
        if (
          snapshot.streamId !== previousStreamId
          && !snapshot.currentStreamIsCompleted
          && currentGoal(this.win)
        ) return { kind: 'already-selected' as const }
      } catch {
        // The graph can briefly have no selected stream between branches.
      }
      return null
    }, 15_000)
    if (route.kind === 'already-selected') return

    const findRoute = () => {
      if (route.kind === 'leaf') {
        return visible(this.win.document.querySelectorAll<SVGElement>(
          `[data-testid="proof-stream-leaf"][data-stream-id="${cssEscape(route.streamId)}"]`,
        ))[0] ?? null
      }
      return visible(this.win.document.querySelectorAll<HTMLButtonElement>(
        `[data-testid="${cssEscape(route.testId)}"].toward-incomplete:not(:disabled)`,
      ))[0] ?? null
    }
    let lastClickAt = 0
    const activateRoute = () => {
      const next = findRoute()
      if (!next || Date.now() - lastClickAt < 250) return
      click(next)
      lastClickAt = Date.now()
    }
    activateRoute()
    try {
      await waitFor('the selected incomplete proof branch to render', () => {
        let snapshot: StreamSnapshot
        try {
          snapshot = harness(this.win).getCurrentStreamSnapshot()
        } catch {
          // A completed branch deliberately has no interactive current stream.
          // The route click is what creates one, so keep activating the live
          // control while React replaces the solved branch's graph render.
          activateRoute()
          return null
        }
        const leftCompletedStream = !previousStreamId || snapshot.streamId !== previousStreamId
        const reachedIncompleteStream = !snapshot.currentStreamIsCompleted
        if (!leftCompletedStream || !reachedIncompleteStream) {
          // React can replace both graph leaves and responsive navigation bars
          // while the completed branch settles. Re-query the live control for
          // every retry, and stop clicking as soon as selection changes. Stream
          // reconciliation can replace the clicked leaf's transient id with a
          // new canonical id, so the observable player contract is a different,
          // incomplete stream with a rendered goal—not identifier equality.
          activateRoute()
          return null
        }
        return currentGoal(this.win)
      }, 15_000)
    } catch (error) {
      let snapshot: StreamSnapshot | string
      try {
        snapshot = harness(this.win).getCurrentStreamSnapshot()
      } catch (snapshotError) {
        snapshot = snapshotError instanceof Error ? snapshotError.message : String(snapshotError)
      }
      const goals = visible(this.win.document.querySelectorAll<HTMLElement>('[data-testid="goal-card"]'))
        .map(goal => ({
          streamId: goal.dataset.streamId,
          className: goal.className,
          text: goal.textContent?.trim(),
        }))
      const leaves = visible(this.win.document.querySelectorAll<SVGElement>('[data-testid="proof-stream-leaf"]'))
        .map(leaf => ({
          streamId: leaf.dataset.streamId,
          current: leaf.dataset.current,
          completed: leaf.dataset.completed,
        }))
      throw new Error(`Could not render the selected incomplete proof branch: ${JSON.stringify({
        previousStreamId,
        route,
        snapshot,
        goals,
        leaves,
      })}`, { cause: error })
    }
    if (this.pendingBranchAliases.length > 0) {
      const names = Object.keys(harness(this.win).getCurrentStreamSnapshot().hypTypes)
      for (let index = this.pendingBranchAliases.length - 1; index >= 0; index -= 1) {
        const pending = this.pendingBranchAliases[index]
        const createdName = names.find(name => !pending.before.has(name))
        if (!createdName) continue
        this.aliases.set(pending.expected, createdName)
        this.pendingBranchAliases.splice(index, 1)
      }
    }
  }

  private resolveName(name: string) {
    return this.aliases.get(name) ?? name
  }

  private hyp(name: string) {
    const resolved = this.resolveName(name)
    const baseSelector = `[data-testid="hyp-card"][data-hyp-name="${cssEscape(resolved)}"]`
    try {
      const streamId = harness(this.win).getCurrentStreamSnapshot().streamId
      const current = visible(this.win.document.querySelectorAll<HTMLElement>(
        `${baseSelector}[data-stream-id="${cssEscape(streamId)}"]`,
      ))[0]
      if (current) return current
    } catch {
      // The harness can briefly disappear while React changes proof branches.
    }
    return visible(this.win.document.querySelectorAll<HTMLElement>(baseSelector))[0] ?? null
  }

  private async pagedCard(tab: 'Tactics' | 'Theorems', selector: string) {
    const dock = await waitFor('player tray', () => this.win.document.querySelector<HTMLElement>('#theorem-tray'))
    await waitFor(`${tab} tray tab to activate`, () => {
      // React replaces the tab button while switching panes. Query and retry
      // the current enabled control just as a player would after an ignored
      // click, instead of retaining a detached node.
      const current = Array.from(dock.querySelectorAll<HTMLButtonElement>('.tr-tab-btn'))
        .find(button => button.textContent?.trim() === tab)
      if (current?.classList.contains('active')) return current
      // When a level exposes only one tray kind, the tab strip is omitted and
      // that sole pane is already active.
      if (dock.querySelectorAll('.tr-tab-btn').length === 0) return dock
      if (current && !current.disabled) click(current)
      return null
    }, 5_000)
    // The release build fetches theorem documentation lazily. Wait for the
    // selected tray to finish its first render instead of racing it.
    await waitFor(`${tab} tray contents`, () =>
      visible(dock.querySelectorAll<HTMLElement>('.tr-tactic-card, .tr-theorem-card, [data-tactic-name], [data-theorem-name]'))[0]
      ?? (dock.querySelector<HTMLButtonElement>('button[aria-label="Next"]')?.disabled ? null : dock), 10_000)
    await rewindPages(dock, 'Previous')
    for (let page = 0; page < 100; page += 1) {
      const card = visible(dock.querySelectorAll<HTMLElement>(selector))[0]
      if (card) return card
      const next = dock.querySelector<HTMLButtonElement>('button[aria-label="Next"]')
      if (!next || next.disabled) break
      click(next)
      await sleep(40)
    }
    throw new Error(`Could not find ${tab.toLowerCase()} card ${selector}`)
  }

  private tactic(name: string) {
    return this.pagedCard('Tactics', `[data-tactic-name="${cssEscape(name)}"]`)
  }

  private theorem(name: string) {
    const qualified = name.includes('.') ? name : `MyNat.${name}`
    return this.pagedCard(
      'Theorems',
      `[data-theorem-name="${cssEscape(name)}"], [data-theorem-name="${cssEscape(qualified)}"]`,
    )
  }

  private async dragAndWait(source: HTMLElement, target: HTMLElement, description: string) {
    const before = proofSignature(harness(this.win).getProofAudit())
    const previousAttempts = playLog(this.win).length
    await drag(source, target)
    try {
      await waitForPlayAttempt(this.win, previousAttempts, description)
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; ` +
        `dragDebug=${JSON.stringify(harness(this.win).getLastDragDebug())}`,
        { cause: error },
      )
    }
    await waitForProofChange(this.win, before, description)
  }

  private async dragTactic(name: string, target: HTMLElement) {
    await this.dragAndWait(await this.tactic(name), target, `${name} drag to update the proof`)
  }

  private rememberIntroducedNames(command: string, beforeNames: Set<string>) {
    const induction = /^induction\s+\S+\s+with\s+(\S+)\s+(\S+)/u.exec(command)
    if (induction) {
      const predecessor = nextFresh(beforeNames, 'd')
      beforeNames.add(predecessor)
      const inductionHyp = nextFresh(beforeNames, 'hd')
      this.aliases.set(induction[1], predecessor)
      this.aliases.set(induction[2], inductionHyp)
    }
  }

  private async clickGoalChoice(command: 'left' | 'right') {
    const goal = await waitFor('current goal', () => currentGoal(this.win))
    click(goal)
    const playTactic = command === 'left' ? 'click_goal_left' : 'click_goal_right'
    const option = await waitFor(`${command} goal option`, () =>
      this.win.document.querySelector<HTMLButtonElement>(
        `[data-testid="goal-choice-option"][data-play-tactic="${playTactic}"]`,
      ))
    const before = proofSignature(harness(this.win).getProofAudit())
    const previousAttempts = playLog(this.win).length
    click(option)
    await waitForPlayAttempt(this.win, previousAttempts, `${command} branch player action`)
    await waitForProofChange(this.win, before, `${command} branch selection`)
  }

  private async clickGoal() {
    const target = await waitFor('clickable current goal or completed proof', () => {
      const audit = harness(this.win).getProofAudit()
      if (!audit.processing && audit.completed) {
        return { goal: null, completed: true as const }
      }
      const current = currentGoal(this.win)
      return current?.classList.contains('clickable') && !current.classList.contains('solved')
        ? { goal: current, completed: false as const }
        : null
    })
    if (target.completed) return
    const goal = target.goal
    const before = playerStateSignature(this.win)
    const previousAttempts = playLog(this.win).length
    click(goal)
    let lastRetry = Date.now()
    await waitForPlayAttempt(this.win, previousAttempts, 'goal click player action', () => {
      if (Date.now() - lastRetry < 250) return
      lastRetry = Date.now()
      const current = currentGoal(this.win)
      if (current?.classList.contains('clickable') && !current.classList.contains('solved')) click(current)
    })
    await waitFor('goal click to update the visible player state', () => {
      const audit = harness(this.win).getProofAudit()
      return !audit.processing && playerStateSignature(this.win) !== before ? true : null
    }, INTERACTION_TIMEOUT)
  }

  private async cases(command: string) {
    const match = /^cases\s+(\S+)/u.exec(command)
    if (!match) throw new Error(`Unsupported cases command: ${command}`)
    const beforeSnapshot = harness(this.win).getCurrentStreamSnapshot()
    const beforeNames = new Set(Object.keys(beforeSnapshot.hypTypes))
    const target = await waitFor(`hypothesis ${match[1]}`, () => this.hyp(match[1]))
    const type = target.dataset.hypType ?? ''
    if (/^(?:\u2115|Nat|MyNat)$/u.test(type.trim())) {
      await this.dragTactic('cases', target)
    } else {
      const before = proofSignature(harness(this.win).getProofAudit())
      const previousAttempts = playLog(this.win).length
      click(target)
      await waitForPlayAttempt(this.win, previousAttempts, `clicking ${match[1]} player action`)
      await waitForProofChange(this.win, before, `clicking ${match[1]} to split it`)
    }
    await waitFor('cases result to become the current canvas stream', () => {
      const current = harness(this.win).getCurrentStreamSnapshot()
      return current.streamId !== beforeSnapshot.streamId ? current : null
    })
    const expectedNames = /^cases\s+\S+\s+with\s+(.+)$/u.exec(command)?.[1]
      ?.trim().split(/\s+/u).filter(Boolean) ?? []
    const actualNames = Object.keys(harness(this.win).getCurrentStreamSnapshot().hypTypes)
      .filter(name => !beforeNames.has(name))
    for (let index = 0; index < Math.min(expectedNames.length, actualNames.length); index += 1) {
      this.aliases.set(expectedNames[index], actualNames[index])
    }
    for (const expected of expectedNames.slice(actualNames.length)) {
      this.pendingBranchAliases.push({ expected, before: beforeNames })
    }
  }

  private async induction(command: string) {
    const match = /^induction\s+(\S+)/u.exec(command)
    if (!match) throw new Error(`Unsupported induction command: ${command}`)
    const snapshot = harness(this.win).getCurrentStreamSnapshot()
    const names = new Set(Object.keys(snapshot.hypTypes))
    const target = await waitFor(`hypothesis ${match[1]}`, () => this.hyp(match[1]))
    await this.dragTactic('induction', target)
    await waitFor('induction branch to become the current canvas stream', () => {
      const current = harness(this.win).getCurrentStreamSnapshot()
      if (!current.streamId || current.streamId === snapshot.streamId) return null
      return visible(this.win.document.querySelectorAll<HTMLElement>(
        `[data-testid="goal-card"][data-stream-id="${cssEscape(current.streamId)}"]`,
      ))[0] ?? null
    })
    this.rememberIntroducedNames(command, names)
  }

  private async sourceCard(name: string) {
    return this.hyp(name) ?? await this.theorem(name)
  }

  async placeTheoremCopy(name: string) {
    const source = await this.theorem(name)
    const canvas = await waitFor('combining canvas', () =>
      this.win.document.querySelector<HTMLElement>('[data-testid="combining-canvas"]'))
    const copiesBefore = visible(this.win.document.querySelectorAll<HTMLElement>(
      `[data-testid="theorem-copy-card"][data-theorem-name$="${cssEscape(sourceName(name))}"]`,
    )).length
    const bounds = canvas.getBoundingClientRect()
    const trayTop = this.win.document.getElementById('theorem-tray')
      ?.getBoundingClientRect().top ?? bounds.bottom
    // Place the copy in empty lower-left canvas space. Dropping at the canvas
    // centre can put a large theorem card directly over a hypothesis. Keep its
    // centre well above the tray too: dnd-kit uses the whole dragged rectangle
    // for collision detection, just like a player drag, not only the pointer.
    await dragToPoint(
      source,
      bounds.left + Math.min(300, bounds.width * 0.25),
      Math.min(bounds.top + bounds.height * 0.7, trayTop - 140),
    )
    const copy = await waitFor(`workspace copy of ${name}`, () => {
      const copies = visible(this.win.document.querySelectorAll<HTMLElement>(
        `[data-testid="theorem-copy-card"][data-theorem-name$="${cssEscape(sourceName(name))}"]`,
      ))
      return copies.length > copiesBefore ? copies.at(-1) ?? null : null
    })
    // React can paint the new copy just before dnd-kit's layout effect has
    // registered it with the pointer sensor. A player necessarily takes a
    // beat between releasing the tray card and grabbing the new card; model
    // that beat, then return the currently mounted node rather than the first
    // node observed during the placement render.
    await sleep(250)
    return (this.win.document.getElementById(copy.id) as HTMLElement | null) ?? copy
  }

  async applyTheoremCopyToHypothesis(
    theoremName: string,
    hypName: string,
    direction: 'theorem-to-hypothesis' | 'hypothesis-to-theorem',
  ) {
    const copy = await waitFor(`workspace copy of ${theoremName}`, () => visible(
      this.win.document.querySelectorAll<HTMLElement>(
        `[data-testid="theorem-copy-card"][data-theorem-name$="${cssEscape(sourceName(theoremName))}"]`,
      ),
    )[0])
    const hypothesis = await waitFor(`hypothesis ${hypName}`, () => this.hyp(this.resolveName(hypName)))
    const source = direction === 'theorem-to-hypothesis' ? copy : hypothesis
    const target = direction === 'theorem-to-hypothesis' ? hypothesis : copy
    const description = `${theoremName} ${direction}`
    const before = proofSignature(harness(this.win).getProofAudit())
    const previousAttempts = playLog(this.win).length
    const session = await beginPointerDrag(source, 94)
    await waitFor(`${description} drag activation`, () =>
      source.classList.contains('dragging') ? true : null, 2_000)
    await session.finish(target)
    try {
      await waitForPlayAttempt(this.win, previousAttempts, description)
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; ` +
        `dragDebug=${JSON.stringify(harness(this.win).getLastDragDebug())}`,
        { cause: error },
      )
    }
    await waitForProofChange(this.win, before, description)
  }

  async undoLastPlayerStep() {
    const before = proofSignature(harness(this.win).getProofAudit())
    const undo = await waitFor('combining-mode undo button', () =>
      visible(this.win.document.querySelectorAll<HTMLButtonElement>('.tr-controls .active-undo[title="Undo"]'))[0])
    click(undo)
    await waitFor('undo to restore the previous player state', () => {
      const audit = harness(this.win).getProofAudit()
      return !audit.processing && proofSignature(audit) !== before ? audit : null
    }, INTERACTION_TIMEOUT)
  }

  private async applyOrExact(command: string) {
    const match = /^(?:apply|exact)\s+(.+?)(?:\s+at\s+(\S+))?$/u.exec(command)
    if (!match) throw new Error(`Unsupported theorem application: ${command}`)
    const application = splitTopLevelWhitespace(match[1])
    const name = sourceName(application[0] ?? match[1])
    const explicitArgs = application.slice(1)
    const beforeNames = new Set(Object.keys(harness(this.win).getCurrentStreamSnapshot().hypTypes))
    let source = await this.sourceCard(name)
    let usedPremiseApplication = false
    if (!match[2] && explicitArgs.length > 0) {
      const matchingHypothesis = visible(
        this.win.document.querySelectorAll<HTMLElement>('[data-testid="hyp-card"]'),
      ).find(hypothesis => matchesTheoremPremise(source, hypothesis, explicitArgs))
      if (matchingHypothesis) {
        const namesBeforeApplication = new Set(Object.keys(harness(this.win).getCurrentStreamSnapshot().hypTypes))
        await this.dragAndWait(source, matchingHypothesis, `${command} premise application`)
        const createdName = Object.keys(harness(this.win).getCurrentStreamSnapshot().hypTypes)
          .find(candidate => !namesBeforeApplication.has(candidate))
        if (!createdName) throw new Error(`${command} did not derive its theorem conclusion`)
        source = await waitFor(`derived theorem ${createdName}`, () => this.hyp(createdName))
        usedPremiseApplication = true
      }
    }
    for (const argument of usedPremiseApplication ? [] : explicitArgs) {
      const namesBeforeArgument = new Set(Object.keys(harness(this.win).getCurrentStreamSnapshot().hypTypes))
      doubleClick(source)
      await waitFor('construction view', () => this.win.document.querySelector('.tr-construction-overlay'))
      await this.submitConstruction(parseConstructionExpr(argument), `${command} (${argument})`)
      const createdName = Object.keys(harness(this.win).getCurrentStreamSnapshot().hypTypes)
        .find(candidate => !namesBeforeArgument.has(candidate))
      if (!createdName) throw new Error(`${command} did not create a theorem card for ${argument}`)
      source = await waitFor(`specialized theorem ${createdName}`, () => this.hyp(createdName))
    }
    const target = match[2]
      ? await waitFor(`hypothesis ${match[2]}`, () => this.hyp(this.resolveName(match[2])))
      : await waitFor('current goal', () => currentGoal(this.win))
    await this.dragAndWait(source, target, `${command} player drag`)
    if (match[2]) {
      if (harness(this.win).getProofAudit().completed) {
        throw new Error(`${command} incorrectly completed: ${JSON.stringify({
          audit: harness(this.win).getProofAudit(),
          lastPlay: playLog(this.win).at(-1),
        })}`)
      }
      const afterNames = Object.keys(harness(this.win).getCurrentStreamSnapshot().hypTypes)
      const createdName = afterNames.find(candidate => !beforeNames.has(candidate))
      if (createdName) this.aliases.set(match[2], createdName)
    }
  }

  private async openTransform(target: string) {
    const element = target === 'goal'
      ? await waitFor('current goal', () => currentGoal(this.win))
      : await waitFor(`hypothesis ${target}`, () => this.hyp(target))
    doubleClick(element)
    await waitFor('transformation view', () =>
      this.win.document.querySelector<HTMLElement>('.tr-transformation-overlay'))
  }

  private async transformRule(name: string) {
    const overlay = await waitFor('transformation view', () =>
      this.win.document.querySelector<HTMLElement>('.tr-transformation-overlay'))
    const waitForMeasuredDock = () => waitFor('measured rewrite menu', () => {
      const dock = overlay.querySelector<HTMLElement>('.tr-rule-dock[data-layout-ready="true"]')
      return dock && getComputedStyle(dock).visibility !== 'hidden' ? dock : null
    })
    for (const tabName of ['Everything', 'Hypotheses', '+', '*', '^', '\u2264', '012', 'Peano']) {
      const tab = Array.from(overlay.querySelectorAll<HTMLButtonElement>('.tr-tab-btn'))
        .find(button => button.textContent?.trim() === tabName)
      if (tab && !tab.classList.contains('active')) {
        click(tab)
      }
      await waitForMeasuredDock()
      await rewindPages(overlay, 'Previous rule')
      for (let page = 0; page < 100; page += 1) {
        await waitForMeasuredDock()
        const rule = visible(overlay.querySelectorAll<HTMLElement>(
          `[data-rule-label="${cssEscape(this.resolveName(name))}"], [data-rule-label="${cssEscape(name)}"]`,
        ))[0]
        if (rule) return rule
        const next = overlay.querySelector<HTMLButtonElement>('button[aria-label="Next rule"]')
        if (!next || next.disabled) break
        click(next)
      }
    }
    throw new Error(`Could not find rewrite rule ${name}`)
  }

  private rewriteSide(overlay: HTMLElement): 'left' | 'right' {
    const group = overlay.querySelector<HTMLElement>('.tr-static-group')
    return group?.classList.contains('static-right') ? 'left' : 'right'
  }

  private async selectRewriteSide(overlay: HTMLElement, requestedSide: 'left' | 'right') {
    let lastClickAt = 0
    await waitFor(`rewrite ${requestedSide} side`, () => {
      if (this.rewriteSide(overlay) === requestedSide) return true
      const button = overlay.querySelector<HTMLButtonElement>('.tr-swap-btn')
      if (
        button &&
        button.getAttribute('aria-disabled') !== 'true' &&
        !overlay.querySelector('.tr-processing') &&
        Date.now() - lastClickAt >= 250
      ) {
        // Re-query on every retry: React can replace this control while the
        // preceding rewrite result settles, invalidating a one-shot click.
        click(button)
        lastClickAt = Date.now()
      }
      return null
    })
  }

  private async selectRewriteDirection(overlay: HTMLElement, reverse: boolean) {
    let lastClickAt = 0
    await waitFor(`rewrite ${reverse ? 'reverse' : 'forward'} direction`, () => {
      const button = overlay.querySelector<HTMLButtonElement>('button[title^="Mode:"]')
      if (!button) return null
      if (button.classList.contains('active-reverse') === reverse) return true
      if (
        button.getAttribute('aria-disabled') !== 'true' &&
        !overlay.querySelector('.tr-processing') &&
        Date.now() - lastClickAt >= 250
      ) {
        click(button)
        lastClickAt = Date.now()
      }
      return null
    })
  }

  private async applyRewriteRule(
    rule: RewriteRule,
    occurrence: number | null,
    allowNoMatch = false,
  ): Promise<boolean> {
    const overlay = await waitFor('transformation view', () =>
      this.win.document.querySelector<HTMLElement>('.tr-transformation-overlay'))
    await waitFor('rewrite controls to become interactive', () => {
      const swap = overlay.querySelector<HTMLButtonElement>('.tr-swap-btn')
      return !overlay.querySelector('.tr-processing') && swap?.getAttribute('aria-disabled') !== 'true'
        ? true
        : null
    })
    await this.selectRewriteDirection(overlay, rule.reverse)

    // Lean's `rw` searches a relation from left to right. Visual mode edits one
    // side at a time, so explicitly reproduce that search order instead of
    // inheriting whichever side the preceding player gesture happened to
    // leave selected. This matters when the same theorem matches both sides:
    // choosing the right first can make a later rewrite in the same command
    // impossible even though the original Lean tactic is valid.
    const requestedSides: Array<'left' | 'right'> = this.preferredRewriteSide
      ? [this.preferredRewriteSide]
      : ['left', 'right']
    let remainingOccurrence = occurrence

    for (const requestedSide of requestedSides) {
      await this.selectRewriteSide(overlay, requestedSide)

      const card = await this.transformRule(rule.name)
      const session = await beginPointerDrag(card)
      let targets: HTMLElement[] = []
      const targetDeadline = Date.now() + 1_000
      while (Date.now() < targetDeadline) {
        targets = visible(overlay.querySelectorAll<HTMLElement>('.tr-expression-node.potential-target'))
          .filter(target => matchesPartiallyAppliedRule(target, card, rule.args))
        if (targets.length > 0) break
        await sleep(POLL_MS)
      }
      const targetIndex = remainingOccurrence === null ? 0 : remainingOccurrence - 1
      const target = targets[targetIndex]
      if (target) {
        const before = proofSignature(harness(this.win).getProofAudit())
        const previousAttempts = playLog(this.win).length
        await session.finish(target)
        await waitForPlayAttempt(this.win, previousAttempts, `${rule.name} rewrite drag`)
        await waitForProofChange(this.win, before, `${rule.name} rewrite result`)
        return true
      }
      session.cancel()

      // `nth_rewrite` numbers occurrences across both sides of the relation,
      // not independently within each visual side.
      if (remainingOccurrence !== null && targets.length > 0) {
        remainingOccurrence -= targets.length
        continue
      }

      // A partially applied theorem must never fall back to arbitrary nodes:
      // doing so discards the explicit argument and can make symmetric rules
      // such as commutativity oscillate forever.
      if (rule.args.length > 0) continue

      const expressionNodes = visible(
        overlay.querySelectorAll<HTMLElement>('.tr-expr-wrapper .tr-expression-node'),
      )
      for (const expressionNode of expressionNodes) {
        const fallbackCard = await this.transformRule(rule.name)
        const before = proofSignature(harness(this.win).getProofAudit())
        if (await dragChangedProof(this.win, fallbackCard, expressionNode, before)) return true
      }
    }
    if (allowNoMatch) return false
    throw new Error(
      `Rewrite ${rule.name} could not be dragged to a matching expression ` +
      `(audit=${JSON.stringify(harness(this.win).getProofAudit())}; ` +
      `lastPlay=${JSON.stringify(playLog(this.win).at(-1))})`,
    )
  }

  private async rewrite(command: string) {
    const parsed = parseRewrite(command)
    for (const rawTarget of parsed.targets) {
      let target = rawTarget === 'goal' ? 'goal' : this.resolveName(rawTarget)
      if (target === 'goal') {
        const goal = await waitFor('current goal', () => currentGoal(this.win))
        if (!goal.classList.contains('transformable') && goal.classList.contains('clickable')) {
          // Lean can rewrite inside an implication before `intro`, but the
          // visual player transforms statement cards rather than syntax under
          // an implication. Perform the equivalent player sequence: introduce
          // the premise, then rewrite its newly created relation card. The
          // following classic `intro` line has already been covered by this
          // visible click and must not produce a second gesture.
          const beforeNames = new Set(Object.keys(harness(this.win).getCurrentStreamSnapshot().hypTypes))
          await this.clickGoal()
          const snapshot = harness(this.win).getCurrentStreamSnapshot()
          const introducedName = Object.keys(snapshot.hypTypes)
            .find(name => !beforeNames.has(name) && this.hyp(name)?.classList.contains('transformable'))
          if (!introducedName) {
            throw new Error(`Rewriting under an implication did not introduce a transformable premise (${command})`)
          }
          this.aliases.set('h', introducedName)
          this.implicitIntroAlreadyPerformed = true
          target = introducedName
        }
      }
      await this.openTransform(target)
      const preferredSide = this.preferredRewriteSide
      if (target === 'goal' && preferredSide) {
        const overlay = await waitFor('transformation view', () =>
          this.win.document.querySelector<HTMLElement>('.tr-transformation-overlay'))
        await this.selectRewriteSide(overlay, preferredSide)
      }
      if (parsed.repeat) {
        let changed = true
        let repetitions = 0
        while (changed && repetitions < 100) {
          changed = false
          for (const rule of parsed.rules) {
            const before = proofSignature(harness(this.win).getProofAudit())
            try {
              const applied = await this.applyRewriteRule(rule, null, true)
              changed = applied && proofSignature(harness(this.win).getProofAudit()) !== before
            } catch (error) {
              if (!(error instanceof Error) || !error.message.startsWith('Timed out waiting for rewrite')) throw error
            }
          }
          repetitions += 1
        }
      } else {
        for (const rule of parsed.rules) await this.applyRewriteRule(rule, parsed.occurrence)
      }
      await waitFor('transformation view to close', () => {
        const overlay = this.win.document.querySelector('.tr-transformation-overlay')
        if (!overlay) return true
        const button = overlay.querySelector<HTMLButtonElement>('.tr-back-btn')
        if (button && !button.disabled) click(button)
        return null
      })
    }
  }

  private async clickConstructionBrick(brickId: string) {
    const overlay = await waitFor('construction view', () =>
      this.win.document.querySelector<HTMLElement>('.tr-construction-overlay'))
    for (const tabName of ['Everything', 'Variables', 'Numbers', 'Functions']) {
      const tab = Array.from(overlay.querySelectorAll<HTMLButtonElement>('.tr-tab-btn'))
        .find(button => button.textContent?.trim() === tabName)
      if (tab && !tab.classList.contains('active')) {
        click(tab)
        await sleep(30)
      }
      await rewindPages(overlay, 'Previous construction item')
      for (let page = 0; page < 100; page += 1) {
        const brick = visible(overlay.querySelectorAll<HTMLButtonElement>(
          `[data-brick-id="${cssEscape(brickId)}"]`,
        ))[0]
        if (brick) {
          click(brick)
          await sleep(30)
          return
        }
        const next = overlay.querySelector<HTMLButtonElement>('button[aria-label="Next construction item"]')
        if (!next || next.disabled) break
        click(next)
        await sleep(30)
      }
    }
    throw new Error(`Could not find construction brick ${brickId}`)
  }

  private async construct(expr: ConstructionExpr) {
    if (expr.kind === 'atom') {
      const value = this.resolveName(expr.value)
      await this.clickConstructionBrick(/^\d+$/u.test(value) ? `num_${value}` : `var_${value}`)
      return
    }
    await this.clickConstructionBrick(expr.op === '+' ? 'fn_add' : 'fn_mul')
    await this.construct(expr.left)
    await this.construct(expr.right)
  }

  private async submitConstruction(expr: ConstructionExpr, description: string) {
    await this.construct(expr)
    const done = await waitFor('enabled construction Done button', () => {
      const button = this.win.document.querySelector<HTMLButtonElement>('.tr-construction-overlay .cn-done-btn')
      return button && !button.disabled ? button : null
    })
    const before = proofSignature(harness(this.win).getProofAudit())
    const previousAttempts = playLog(this.win).length
    click(done)
    let lastRetry = Date.now()
    await waitForPlayAttempt(
      this.win,
      previousAttempts,
      `${description} player construction action`,
      () => {
        if (Date.now() - lastRetry < 250) return
        lastRetry = Date.now()
        const current = this.win.document.querySelector<HTMLButtonElement>(
          '.tr-construction-overlay .cn-done-btn',
        )
        if (current && !current.disabled) click(current)
      },
    )
    await waitForProofChange(this.win, before, `${description} construction`)
  }

  private async specializeHave(command: string) {
    const match = /^have\s+(\S+)\s*:=\s*(\S+)(?:\s+(.+))?$/u.exec(command)
    if (!match) throw new Error(`Unsupported have command: ${command}`)
    const expectedName = match[1]
    const arguments_ = match[3]?.trim().split(/\s+/u).filter(Boolean) ?? []
    let source = await this.theorem(match[2])
    let createdName: string | null = null
    for (const argument of arguments_) {
      const beforeNames = new Set(Object.keys(harness(this.win).getCurrentStreamSnapshot().hypTypes))
      doubleClick(source)
      await waitFor('construction view', () => this.win.document.querySelector('.tr-construction-overlay'))
      await this.submitConstruction(parseConstructionExpr(argument), `${command} (${argument})`)
      const afterNames = Object.keys(harness(this.win).getCurrentStreamSnapshot().hypTypes)
      createdName = afterNames.find(name => !beforeNames.has(name)) ?? null
      if (!createdName) throw new Error(`${command} did not create a specialized theorem card`)
      source = await waitFor(`specialized theorem ${createdName}`, () => this.hyp(createdName!))
    }
    if (!createdName) throw new Error(`${command} has no player-supplied specialization arguments`)
    this.aliases.set(expectedName, createdName)
  }

  private async deriveTypedHave(command: string) {
    const match = /^have\s+(\S+)\s*:\s*(.+)\s+≠\s+0$/u.exec(command)
    if (!match) throw new Error(`Unsupported typed have command: ${command}`)
    const expectedName = match[1]
    const expression = match[2].replace(/\s+/gu, '')
    const target = visible(this.win.document.querySelectorAll<HTMLElement>('[data-testid="hyp-card"]'))
      .find(card => {
        const type = (card.dataset.hypType ?? '').replace(/\s+/gu, '')
        return type.includes(expression) && /(?:=|↔)1/u.test(type)
      })
    if (!target) throw new Error(`Could not find an equality card that proves ${match[2]} = 1`)
    const beforeNames = new Set(Object.keys(harness(this.win).getCurrentStreamSnapshot().hypTypes))
    await this.dragAndWait(await this.theorem('one_ne_zero'), target, `${command} theorem drag`)
    const createdName = Object.keys(harness(this.win).getCurrentStreamSnapshot().hypTypes)
      .find(name => !beforeNames.has(name))
    if (!createdName) throw new Error(`${command} did not create a theorem card`)
    this.aliases.set(expectedName, createdName)
    // The one visible drag derives the theorem directly. In the fixture's
    // classic proof the following rewrite and exact commands instead fill a
    // temporary `have` subgoal, so they require no additional player action.
    this.classicCommandsAlreadyCovered = 2
  }

  private async use(command: string) {
    const match = /^use\s+(.+)$/u.exec(command)
    if (!match) throw new Error(`Unsupported use command: ${command}`)
    const goal = await waitFor('current goal', () => currentGoal(this.win))
    doubleClick(goal)
    await waitFor('construction view', () => this.win.document.querySelector('.tr-construction-overlay'))
    await this.submitConstruction(parseConstructionExpr(match[1]), command)
  }

  private async introduceLeadingForalls() {
    for (let count = 0; count < 32; count += 1) {
      const snapshot = harness(this.win).getCurrentStreamSnapshot()
      if (!/^\s*∀/u.test(snapshot.goalType)) return
      await this.clickGoal()
    }
    throw new Error('More than 32 leading forall binders remained after player introductions')
  }

  async perform(command: string) {
    await waitFor(
      `visual proof to become idle before ${command}`,
      () => !harness(this.win).getProofAudit().processing,
      INTERACTION_TIMEOUT,
    )
    if (harness(this.win).getProofAudit().completed) return
    await this.navigateFromCompletedBranch()
    await this.introduceLeadingForalls()
    const normalized = command.trim()
    if (this.implicitIntroAlreadyPerformed) {
      this.implicitIntroAlreadyPerformed = false
      if (/^intro(?:\s+|$)/u.test(normalized)) return
    }
    if (this.classicCommandsAlreadyCovered > 0) {
      this.classicCommandsAlreadyCovered -= 1
      return
    }
    if (normalized === 'rfl') {
      await this.clickGoal()
      return
    }
    if (/^intro(?:\s+|$)/u.test(normalized)) {
      const requestedNames = normalized.replace(/^intro\s*/u, '').trim().split(/\s+/u).filter(Boolean)
      const introductions = requestedNames.length > 0 ? requestedNames : ['h']
      for (const requestedName of introductions) {
        const beforeNames = new Set(Object.keys(harness(this.win).getCurrentStreamSnapshot().hypTypes))
        await this.clickGoal()
        let afterNames: string[]
        try {
          afterNames = Object.keys(harness(this.win).getCurrentStreamSnapshot().hypTypes)
        } catch {
          const audit = harness(this.win).getProofAudit()
          throw new Error(
            `Intro ${requestedName} left no interactive stream: ${JSON.stringify({
              completed: audit.completed,
              coreLines: audit.coreLines,
              interactiveLines: audit.interactiveLines,
              proofBody: audit.proofBody,
            })}`,
          )
        }
        const actualName = afterNames.find(name => !beforeNames.has(name))
        if (actualName) this.aliases.set(requestedName, actualName)
      }
      return
    }
    if (normalized === 'left' || normalized === 'right') {
      await this.clickGoalChoice(normalized)
      return
    }
    if (normalized.startsWith('cases ')) {
      await this.cases(normalized)
      return
    }
    if (normalized.startsWith('induction ')) {
      await this.induction(normalized)
      return
    }
    if (/^(?:repeat\s+)?rw\s|^nth_rewrite\s/u.test(normalized)) {
      await this.rewrite(normalized)
      return
    }
    if (normalized.startsWith('use ')) {
      await this.use(normalized)
      return
    }
    if (/^have\s+\S+\s*:=/u.test(normalized)) {
      await this.specializeHave(normalized)
      return
    }
    if (/^have\s+\S+\s*:/u.test(normalized)) {
      await this.deriveTypedHave(normalized)
      return
    }
    if (/^(?:apply|exact)\s/u.test(normalized)) {
      await this.applyOrExact(normalized)
      return
    }
    if (/^symm(?:\s+at\s+\S+)?$/u.test(normalized)) {
      const targetName = /^symm\s+at\s+(\S+)$/u.exec(normalized)?.[1]
      const target = targetName
        ? await waitFor(`hypothesis ${targetName}`, () => this.hyp(targetName))
        : await waitFor('current goal', () => currentGoal(this.win))
      await this.dragTactic('symm', target)
      return
    }
    if (normalized === 'tauto') {
      await this.dragTactic('tauto', await waitFor('current goal', () => currentGoal(this.win)))
      return
    }
    throw new Error(`No player gesture mapping exists for: ${command}`)
  }
}
