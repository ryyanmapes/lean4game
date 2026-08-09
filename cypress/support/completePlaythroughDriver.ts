interface ProofAudit {
  completed: boolean
  processing: boolean
  coreLines: string[]
  interactiveLines: string[]
}

interface StreamSnapshot {
  streamId: string
  hypTypes: Record<string, string>
  currentStreamIsCompleted: boolean
}

interface ReadOnlyVisualHarness {
  getProofAudit(): ProofAudit
  getCurrentStreamSnapshot(): StreamSnapshot
}

interface PlayLogEntry {
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
  return entries
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
  const deadline = Date.now() + 600
  let attempt: PlayLogEntry | undefined
  while (Date.now() < deadline) {
    const entries = playLog(win)
    if (entries.length > previousAttempts) {
      attempt = entries.at(-1)
      break
    }
    await sleep(POLL_MS)
  }
  if (!attempt) return false
  if (!attempt.succeeded) throw new Error(`Player rewrite was rejected: ${attempt.playTactic}`)
  await waitForProofChange(win, previous, 'dragged interaction to update the proof')
  return true
}

function visible<T extends HTMLElement>(elements: Iterable<T>): T[] {
  return Array.from(elements).filter(element => {
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
  })
}

function click(element: HTMLElement) {
  element.scrollIntoView({ block: 'center', inline: 'center' })
  // Buttons already implement the browser's complete activation behavior.
  // Preceding their native click with synthetic mouse-down events can start
  // the canvas drag sensor in Chromium and cause React to ignore the button.
  if (element instanceof HTMLButtonElement) {
    element.focus()
    element.click()
    return
  }
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
  element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }))
  // Native activation matters for buttons (including React-controlled tabs).
  // SVG proof-tree nodes do not expose HTMLElement.click(), so retain the
  // explicit mouse event as a fallback for those player controls.
  if (typeof element.click === 'function') element.click()
  else element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
}

function doubleClick(element: HTMLElement) {
  element.scrollIntoView({ block: 'center', inline: 'center' })
  for (let detail = 1; detail <= 2; detail += 1) {
    element.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, button: 0, detail,
    }))
    element.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true, cancelable: true, button: 0, detail,
    }))
    element.dispatchEvent(new MouseEvent('click', {
      bubbles: true, cancelable: true, button: 0, detail,
    }))
  }
  element.dispatchEvent(new MouseEvent('dblclick', {
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
  await finishPointerDrag(source, target, startX, startY, 91)
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
      return { name: sourceName(body), reverse } satisfies RewriteRule
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
  private preferredRewriteSide: 'left' | 'right' | null = null

  constructor(private readonly win: DriverWindow) {}

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
    const towardIncomplete = visible(this.win.document.querySelectorAll<HTMLButtonElement>(
      '[data-testid^="stream-nav-"].toward-incomplete:not(:disabled)',
    ))[0]
    const nextLeaf = visible(this.win.document.querySelectorAll<HTMLElement>(
      '[data-testid="proof-stream-leaf"][data-completed="false"]',
    ))[0]
    const next = towardIncomplete ?? nextLeaf
    if (!next) {
      if (currentGoal(this.win)) return
      throw new Error(`Completed branch has no visible route to an incomplete stream (${JSON.stringify({
        previousStreamId,
        leaves: Array.from(this.win.document.querySelectorAll<HTMLElement>('[data-testid="proof-stream-leaf"]'))
          .map(leaf => ({
            streamId: leaf.dataset.streamId,
            current: leaf.dataset.current,
            completed: leaf.dataset.completed,
          })),
      })})`)
    }
    const streamId = nextLeaf?.dataset.streamId
    click(next)
    await waitFor('the selected incomplete proof branch to render', () => {
      let snapshot: StreamSnapshot
      try {
        snapshot = harness(this.win).getCurrentStreamSnapshot()
      } catch {
        return null
      }
      if (previousStreamId && snapshot.streamId === previousStreamId) return null
      if (streamId && snapshot.streamId !== streamId) return null
      return currentGoal(this.win)
    }, 15_000)
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
    return visible(this.win.document.querySelectorAll<HTMLElement>(
      `[data-testid="hyp-card"][data-hyp-name="${cssEscape(resolved)}"]`,
    ))[0] ?? null
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
    await waitForPlayAttempt(this.win, previousAttempts, description)
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
    const goal = await waitFor('current goal', () => currentGoal(this.win))
    const before = playerStateSignature(this.win)
    const previousAttempts = playLog(this.win).length
    click(goal)
    await waitForPlayAttempt(this.win, previousAttempts, 'goal click player action')
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

  private async applyOrExact(command: string) {
    const match = /^(?:apply|exact)\s+(.+?)(?:\s+at\s+(\S+))?$/u.exec(command)
    if (!match) throw new Error(`Unsupported theorem application: ${command}`)
    const name = sourceName(match[1])
    const beforeNames = new Set(Object.keys(harness(this.win).getCurrentStreamSnapshot().hypTypes))
    const source = await this.sourceCard(name)
    const target = match[2]
      ? await waitFor(`hypothesis ${match[2]}`, () => this.hyp(match[2]))
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
    for (const tabName of ['Everything', 'Hypotheses', '+', '*', '^', '\u2264', '012', 'Peano']) {
      const tab = Array.from(overlay.querySelectorAll<HTMLButtonElement>('.tr-tab-btn'))
        .find(button => button.textContent?.trim() === tabName)
      if (tab && !tab.classList.contains('active')) {
        click(tab)
        await sleep(35)
      }
      await rewindPages(overlay, 'Previous rule')
      for (let page = 0; page < 100; page += 1) {
        const rule = visible(overlay.querySelectorAll<HTMLElement>(
          `[data-rule-label="${cssEscape(this.resolveName(name))}"], [data-rule-label="${cssEscape(name)}"]`,
        ))[0]
        if (rule) return rule
        const next = overlay.querySelector<HTMLButtonElement>('button[aria-label="Next rule"]')
        if (!next || next.disabled) break
        click(next)
        await sleep(35)
      }
    }
    throw new Error(`Could not find rewrite rule ${name}`)
  }

  private async applyRewriteRule(rule: RewriteRule, occurrence: number | null) {
    const overlay = await waitFor('transformation view', () =>
      this.win.document.querySelector<HTMLElement>('.tr-transformation-overlay'))
    const reverse = overlay.querySelector<HTMLButtonElement>('button[title^="Mode:"]')
    const isReverse = reverse?.classList.contains('active-reverse') ?? false
    if (reverse && isReverse !== rule.reverse) {
      click(reverse)
      await sleep(30)
    }
    for (let sideAttempt = 0; sideAttempt < 2; sideAttempt += 1) {
      const card = await this.transformRule(rule.name)
      const session = await beginPointerDrag(card)
      let targets: HTMLElement[] = []
      const targetDeadline = Date.now() + 1_000
      while (Date.now() < targetDeadline) {
        targets = visible(overlay.querySelectorAll<HTMLElement>('.tr-expression-node.potential-target'))
        if (targets.length > 0) break
        await sleep(POLL_MS)
      }
      const targetIndex = occurrence === null ? 0 : occurrence - 1
      const target = targets[targetIndex]
      if (target) {
        const before = proofSignature(harness(this.win).getProofAudit())
        const previousAttempts = playLog(this.win).length
        await session.finish(target)
        await waitForPlayAttempt(this.win, previousAttempts, `${rule.name} rewrite drag`)
        await waitForProofChange(this.win, before, `${rule.name} rewrite result`)
        return
      }
      session.cancel()
      const expressionNodes = visible(
        overlay.querySelectorAll<HTMLElement>('.tr-expr-wrapper .tr-expression-node'),
      )
      for (const expressionNode of expressionNodes) {
        const fallbackCard = await this.transformRule(rule.name)
        const before = proofSignature(harness(this.win).getProofAudit())
        if (await dragChangedProof(this.win, fallbackCard, expressionNode, before)) return
      }

      const swap = overlay.querySelector<HTMLButtonElement>('.tr-swap-btn')
      if (!swap || sideAttempt > 0) break
      click(swap)
      await sleep(50)
    }
    throw new Error(
      `Rewrite ${rule.name} could not be dragged to a matching expression ` +
      `(audit=${JSON.stringify(harness(this.win).getProofAudit())}; ` +
      `lastPlay=${JSON.stringify(playLog(this.win).at(-1))})`,
    )
  }

  private async rewrite(command: string) {
    const parsed = parseRewrite(command)
    for (const rawTarget of parsed.targets) {
      const target = rawTarget === 'goal' ? 'goal' : this.resolveName(rawTarget)
      await this.openTransform(target)
      if (target === 'goal' && this.preferredRewriteSide) {
        const overlay = await waitFor('transformation view', () =>
          this.win.document.querySelector<HTMLElement>('.tr-transformation-overlay'))
        const staticGroup = overlay.querySelector<HTMLElement>('.tr-static-group')
        const currentSide = staticGroup?.classList.contains('static-right') ? 'left' : 'right'
        if (currentSide !== this.preferredRewriteSide) {
          const swap = overlay.querySelector<HTMLButtonElement>('.tr-swap-btn')
          if (!swap) throw new Error('Could not find the transformation side selector')
          click(swap)
          await waitFor(`rewrite ${this.preferredRewriteSide} side`, () => {
            const group = overlay.querySelector<HTMLElement>('.tr-static-group')
            const selected = group?.classList.contains('static-right') ? 'left' : 'right'
            return selected === this.preferredRewriteSide ? true : null
          })
        }
      }
      if (parsed.repeat) {
        let changed = true
        let repetitions = 0
        while (changed && repetitions < 100) {
          changed = false
          for (const rule of parsed.rules) {
            const before = proofSignature(harness(this.win).getProofAudit())
            try {
              await this.applyRewriteRule(rule, null)
              changed = proofSignature(harness(this.win).getProofAudit()) !== before
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

  async perform(command: string) {
    await waitFor(
      `visual proof to become idle before ${command}`,
      () => !harness(this.win).getProofAudit().processing,
      INTERACTION_TIMEOUT,
    )
    if (harness(this.win).getProofAudit().completed) return
    await this.navigateFromCompletedBranch()
    const normalized = command.trim()
    if (this.classicCommandsAlreadyCovered > 0) {
      this.classicCommandsAlreadyCovered -= 1
      return
    }
    if (normalized === 'rfl' || normalized === 'intro h' || /^intro\s+/u.test(normalized)) {
      await this.clickGoal()
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
