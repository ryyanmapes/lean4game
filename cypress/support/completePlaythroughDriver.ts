import {
  matchAndCapture,
  parse,
  substituteVariables,
} from '../../client/src/visual/expr-engine'
import type { ExpressionNode } from '../../client/src/visual/expr-types'

interface ProofAudit {
  completed: boolean
  processing: boolean
  proofBody: string
  coreLines: string[]
  interactiveLines: string[]
}

interface StreamSnapshot {
  streamId: string
  goalType: string
  hypTypes: Record<string, string>
  goalPlayTactic: string | null
  goalOptionTactics: string[]
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

function visiblePageSignature(container: HTMLElement) {
  const indicator = Array.from(container.querySelectorAll<HTMLElement>('[class*="page-indicator"]'))
    .filter(element => element.offsetParent !== null)
    .map(element => element.textContent?.trim() ?? '')
    .join('|')
  const cards = visible(container.querySelectorAll<HTMLElement>(
    '[data-tactic-name], [data-theorem-name], [data-rule-id], [data-rule-label], .statement-card',
  )).map(card => card.dataset.tacticName
    ?? card.dataset.theoremName
    ?? card.dataset.ruleId
    ?? card.dataset.ruleLabel
    ?? card.id
    ?? card.textContent?.trim()
    ?? '')
  return JSON.stringify({ indicator, cards })
}

async function clickPaginationAndWait(container: HTMLElement, button: HTMLButtonElement, description: string) {
  const before = visiblePageSignature(container)
  const ariaLabel = button.getAttribute('aria-label') ?? ''
  let clicked = false
  let lastClickAt = 0
  await waitFor(description, () => {
    const current = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${ariaLabel}"]`,
    )
    if (visiblePageSignature(container) !== before || (clicked && current?.disabled)) return true
    // Transformation controls intentionally remain visually enabled while a
    // Lean action is settling, but expose that temporary non-functional state
    // through aria-disabled. Wait for the same moment a player can click, and
    // retry if a render boundary still swallowed the event.
    const now = Date.now()
    if (current && !current.disabled && current.getAttribute('aria-disabled') !== 'true'
      && now - lastClickAt >= 100) {
      click(current)
      clicked = true
      lastClickAt = now
    }
    return null
  }, 5_000)
}

async function rewindPages(container: HTMLElement, ariaLabel: string) {
  for (let page = 0; page < 100; page += 1) {
    const previous = container.querySelector<HTMLButtonElement>(`button[aria-label="${ariaLabel}"]`)
    if (!previous || previous.disabled) return
    await clickPaginationAndWait(container, previous, `${ariaLabel.toLowerCase()} pagination to change`)
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

/** Player actions must affect the proof stream the player is looking at, not
 * merely append a valid tactic somewhere else in Lean's outstanding-goal
 * list. Keep this signature independent of the global proof log so a command
 * accepted on a sibling branch cannot satisfy the assertion. */
function selectedStreamSignature(win: DriverWindow) {
  const audit = harness(win).getProofAudit()
  try {
    const snapshot = harness(win).getCurrentStreamSnapshot()
    return JSON.stringify({
      completed: audit.completed,
      streamId: snapshot.streamId,
      goalType: snapshot.goalType,
      hypTypes: snapshot.hypTypes,
      currentStreamIsCompleted: snapshot.currentStreamIsCompleted,
    })
  } catch {
    return JSON.stringify({ completed: audit.completed, streamId: null })
  }
}

async function waitForSelectedStreamChange(
  win: DriverWindow,
  previous: string,
  description: string,
) {
  try {
    await waitFor(`${description} to update the selected proof branch`, () => {
      const audit = harness(win).getProofAudit()
      return !audit.processing && selectedStreamSignature(win) !== previous ? true : null
    }, INTERACTION_TIMEOUT)
  } catch (error) {
    throw new Error(
      `${description} changed the proof log but not the player-selected branch: ${JSON.stringify({
        before: JSON.parse(previous),
        after: JSON.parse(selectedStreamSignature(win)),
        lastPlay: playLog(win).at(-1),
        lastDrag: harness(win).getLastDragDebug(),
      })}`,
      { cause: error },
    )
  }
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

async function waitForPlayerIdle(win: DriverWindow, description: string) {
  await waitFor(description, () => {
    const audit = harness(win).getProofAudit()
    return !audit.processing && !win.document.querySelector('.tr-processing') ? true : null
  })
  // Require the idle state to survive another browser task. This models the
  // beat between deliberate player gestures and avoids grabbing a card during
  // the same React commit that finishes the preceding Lean interaction.
  await sleep(50)
  await waitFor(description, () => {
    const audit = harness(win).getProofAudit()
    return !audit.processing && !win.document.querySelector('.tr-processing') ? true : null
  })
}

async function dragChangedProof(
  win: DriverWindow,
  source: HTMLElement,
  target: HTMLElement,
  previous: string,
) {
  const previousSelectedStream = selectedStreamSignature(win)
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
  await waitForSelectedStreamChange(win, previousSelectedStream, 'dragged rewrite')
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
  const view = element.ownerDocument.defaultView
  if (!view) throw new Error('Cannot activate an element without a browser window')
  if (element instanceof view.HTMLElement && !isWithinViewport(element)) {
    element.scrollIntoView({ block: 'center', inline: 'center' })
  }
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
  const targetIdentity = captureDragTargetIdentity(target)
  // Start from the source while it is visible. On a long mobile card stack the
  // source and destination cannot always fit onscreen together; scrolling the
  // destination before pointer-down can move the source away and make the
  // gesture begin at a stale coordinate.
  if (!isWithinViewport(source)) source.scrollIntoView({ block: 'center', inline: 'center' })
  await sleep(POLL_MS)
  target = resolveRemountedDragTarget(source.ownerDocument, targetIdentity, target)
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
  // Move the held card away from the lower tray before scrolling a distant
  // phone target into view. Leaving the pointer at the tray edge keeps the
  // app's real drag autoscroller running in the opposite direction, which can
  // pull the destination back underneath the fixed goal between our scroll
  // and pointer-up. A player naturally moves their finger into the open card
  // panel first.
  const mobileScroll = target.closest<HTMLElement>('[data-testid="mobile-play-scroll"]')
  const safeRect = mobileScroll?.getBoundingClientRect()
  const travelStartX = safeRect ? safeRect.left + safeRect.width / 2 : startX + 12
  const travelStartY = safeRect ? safeRect.top + safeRect.height / 2 : startY + 12
  if (mobileScroll) {
    moveTarget.dispatchEvent(new PointerEventCtor('pointermove', {
      ...pointer,
      buttons: 1,
      clientX: travelStartX,
      clientY: travelStartY,
    }))
    await sleep(50)
  }
  // Scrolling the source and activating dnd-kit can reconcile the mobile card
  // list. Resolve the destination by its stable card id again; otherwise its
  // detached pre-scroll rectangle can point at the fixed goal even though the
  // replacement card is visibly lower in the theorem column.
  target = resolveRemountedDragTarget(ownerDocument, targetIdentity, target)
  // Once dnd-kit's sensor is active, scroll the same canvas toward the target
  // just as a player does during a long drag. Verify the actual hit target
  // before releasing rather than trusting an overlay-obscured rectangle.
  if (!isWithinViewport(target) || !receivesPointerAtCenter(target)) {
    // Centre the destination inside its nearest scrolling ancestor. On the
    // phone layout, `nearest` can leave the first theorem card underneath the
    // fixed goal stack; dnd-kit then quite correctly reports the adjacent
    // reorder divider as the drop target even though the card exists in the
    // DOM. A player scrolls the obscured card into the open middle of the
    // column before releasing it.
    target.scrollIntoView({ block: 'center', inline: 'nearest' })
    await sleep(50)
    target = resolveRemountedDragTarget(ownerDocument, targetIdentity, target)
  }
  if (!receivesPointerAtCenter(target)) {
    target.scrollIntoView({ block: 'center', inline: 'center' })
    await sleep(50)
    target = resolveRemountedDragTarget(ownerDocument, targetIdentity, target)
  }
  if (mobileScroll && !receivesPointerAtCenter(target)) {
    // `scrollIntoView()` may align an inner card beneath the fixed mobile goal
    // rather than in the actually exposed part of the proof column.  Move the
    // owning scroller by the measured delta, exactly as a player drags the
    // list while holding the theorem, and resolve the remounted card once
    // more before releasing.
    const scrollRect = mobileScroll.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const desiredY = scrollRect.top + scrollRect.height * 0.58
    mobileScroll.scrollTop += targetRect.top + targetRect.height / 2 - desiredY
    await sleep(75)
    target = resolveRemountedDragTarget(ownerDocument, targetIdentity, target)
  }
  if (!receivesPointerAtCenter(target)) {
    throw new Error(`Player drag destination remained obscured after scrolling: ${target.id}`)
  }
  await finishPointerDrag(source, target, travelStartX, travelStartY, 91, targetIdentity)
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
  targetIdentity: DragTargetIdentity = captureDragTargetIdentity(target),
) {
  // The source and target are brought into view before pointer-down. Scrolling
  // after a drag begins changes dnd-kit's measured collision rectangles and is
  // not part of the corresponding player gesture. On phones it could turn a
  // valid rewrite into an ignored drop between pointer-down and pointer-up.
  const end = target.getBoundingClientRect()
  // Nested expression targets overlap all of their descendants. Dropping at
  // the bounding-box centre can therefore resolve to a smaller child even
  // when the player selected the highlighted parent (for example the right
  // child of `a * (b * c)`). Aim at the target's own operator/text instead;
  // that is the visible, unambiguous part of the expression a player uses.
  const ownExpressionPart = target.matches('.tr-expression-node')
    ? Array.from(target.children).find(child =>
        child.matches('.tr-op, .tr-node-content')) as HTMLElement | undefined
    : undefined
  const dropRect = ownExpressionPart?.getBoundingClientRect() ?? end
  const endX = dropRect.left + dropRect.width / 2
  const endY = dropRect.top + dropRect.height / 2
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
  // Drag activation can remount/reflow a mobile card stack during those
  // travel frames. Re-measure the stable target immediately before release;
  // otherwise the old centre may now be occupied by the fixed goal card.
  const liveTarget = resolveRemountedDragTarget(ownerDocument, targetIdentity, target)
  const liveOwnExpressionPart = liveTarget.matches('.tr-expression-node')
    ? Array.from(liveTarget.children).find(child =>
        child.matches('.tr-op, .tr-node-content')) as HTMLElement | undefined
    : undefined
  const liveDropRect = liveOwnExpressionPart?.getBoundingClientRect() ?? liveTarget.getBoundingClientRect()
  const unobscuredPoint = pointerPointWithin(liveTarget)
  let releaseX = unobscuredPoint?.x ?? liveDropRect.left + liveDropRect.width / 2
  let releaseY = unobscuredPoint?.y ?? liveDropRect.top + liveDropRect.height / 2
  // Let dnd-kit's final collision measurement settle on the release target.
  // A real player naturally pauses for at least a frame before releasing; an
  // immediate synthetic pointerup could retain the hypothesis crossed on the
  // preceding move even though the pointer was visibly over the goal.
  await sleep(50)
  moveTarget.dispatchEvent(new PointerEventCtor('pointermove', {
    ...pointer,
    buttons: 1,
    clientX: releaseX,
    clientY: releaseY,
  }))
  await sleep(25)
  // The app's own auto-scroller can move the card during that settling
  // frame. Sample once more at the actual release instant so a long mobile
  // drag lands on the same visible portion a player's finger is over.
  const settledTarget = resolveRemountedDragTarget(ownerDocument, targetIdentity, liveTarget)
  const settledPoint = pointerPointWithin(settledTarget)
  if (settledPoint) {
    releaseX = settledPoint.x
    releaseY = settledPoint.y
    moveTarget.dispatchEvent(new PointerEventCtor('pointermove', {
      ...pointer,
      buttons: 1,
      clientX: releaseX,
      clientY: releaseY,
    }))
    await sleep(12)
  }
  moveTarget.dispatchEvent(new PointerEventCtor('pointerup', {
    ...pointer,
    buttons: 0,
    clientX: releaseX,
    clientY: releaseY,
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

interface DragTargetIdentity {
  id: string
  testId?: string
  streamId?: string
  hypName?: string
  hypType?: string
  theoremName?: string
}

function captureDragTargetIdentity(target: HTMLElement): DragTargetIdentity {
  return {
    id: target.id,
    testId: target.dataset.testid,
    streamId: target.dataset.streamId,
    hypName: target.dataset.hypName,
    hypType: target.dataset.hypType,
    theoremName: target.dataset.theoremName,
  }
}

function resolveRemountedDragTarget(
  ownerDocument: Document,
  identity: DragTargetIdentity,
  fallback: HTMLElement,
): HTMLElement {
  const exact = identity.id
    ? ownerDocument.getElementById(identity.id) as HTMLElement | null
    : null
  if (!identity.testId) return exact?.isConnected ? exact : fallback

  // Phone layouts can keep a hidden desktop twin with the same DOM id.
  // Resolve among visible semantic twins before using getElementById(), which
  // is allowed to return that hidden first occurrence.
  const candidates = visible(ownerDocument.querySelectorAll<HTMLElement>(
    `[data-testid="${cssEscape(identity.testId)}"]`,
  )).filter(candidate =>
    (!identity.hypName || candidate.dataset.hypName === identity.hypName) &&
    (!identity.hypType || candidate.dataset.hypType === identity.hypType) &&
    (!identity.theoremName || candidate.dataset.theoremName === identity.theoremName),
  )
  let currentStreamId: string | undefined
  try {
    const view = ownerDocument.defaultView as DriverWindow | null
    currentStreamId = view ? harness(view).getCurrentStreamSnapshot().streamId : undefined
  } catch {
    // The audit bridge can be between React commits while the card remounts.
  }
  const semanticMatch = (candidate: HTMLElement | null | undefined) => Boolean(candidate)
    && (!identity.testId || candidate!.dataset.testid === identity.testId)
    && (!identity.hypName || candidate!.dataset.hypName === identity.hypName)
    && (!identity.hypType || candidate!.dataset.hypType === identity.hypType)
    && (!identity.theoremName || candidate!.dataset.theoremName === identity.theoremName)
  const resolved = candidates.find(candidate => candidate.dataset.streamId === currentStreamId)
    ?? candidates.find(candidate => candidate.dataset.streamId === identity.streamId)
    ?? candidates[0]
    ?? (exact?.isConnected && semanticMatch(exact) ? exact : null)
    ?? (fallback.isConnected && semanticMatch(fallback) ? fallback : null)
  if (!resolved) {
    throw new Error(`Player drag target remounted without a semantic replacement: ${JSON.stringify(identity)}`)
  }
  return resolved
}

function isWithinViewport(element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  const view = element.ownerDocument.defaultView
  return Boolean(view)
    && rect.width > 0
    && rect.height > 0
    && rect.left >= 0
    && rect.top >= 0
    && rect.right <= view!.innerWidth
    && rect.bottom <= view!.innerHeight
}

function pointerPointWithin(element: HTMLElement): { x: number; y: number } | null {
  const rect = element.getBoundingClientRect()
  const fractions = [0.5, 0.7, 0.3, 0.85, 0.15]
  for (const yFraction of fractions) {
    for (const xFraction of fractions) {
      const x = rect.left + rect.width * xFraction
      const y = rect.top + rect.height * yFraction
      const hit = element.ownerDocument.elementFromPoint(x, y)
      if (hit && (hit === element || element.contains(hit))) return { x, y }
    }
  }
  return null
}

function receivesPointerAtCenter(element: HTMLElement) {
  return pointerPointWithin(element) !== null
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
  if (expected.type === 'variable' && expected.name === 'visualWildcard') return true
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

function parseExplicitArgument(argument: string): ExpressionNode {
  // `_` is valid Lean placeholder syntax but is intentionally not an
  // arithmetic-parser identifier. Give it a private parseable wildcard name
  // so structural argument matching does not fall into the permissive catch
  // path and accept the first unrelated occurrence.
  return parse(argument.replace(/(^|[^\p{L}\p{N}_'])_([^\p{L}\p{N}_']|$)/gu, '$1visualWildcard$2'))
}

function expressionVariableNames(node: ExpressionNode, result: string[] = []): string[] {
  if (node.type === 'variable') {
    if (node.name !== '_' && !result.includes(node.name)) result.push(node.name)
    return result
  }
  if (node.type === 'app') return expressionVariableNames(node.arg, result)
  if (node.type === 'binary') {
    expressionVariableNames(node.left, result)
    expressionVariableNames(node.right, result)
  }
  return result
}

function forallBinderNames(card: HTMLElement): string[] {
  const footer = card.querySelector<HTMLElement>(
    '.tr-forall-footer, .statement-forall-footer',
  )?.textContent ?? ''
  // Lean commonly groups binders as `(a b : ℕ)`. Reading only the first name
  // made a partially applied commutativity rule such as `mul_comm a (_ * b)`
  // look like `mul_comm a _`, so the player driver could choose an entirely
  // different visible occurrence. Preserve every name in each binder group.
  return Array.from(footer.matchAll(/[({]\s*([^:(){}]+?)\s*:\s*[^(){}]+[)}]/gu))
    .flatMap(match => match[1].trim().split(/\s+/u))
    .filter(Boolean)
}

function matchesPartiallyAppliedRule(
  target: HTMLElement,
  card: HTMLElement,
  explicitArgs: string[],
): boolean {
  if (explicitArgs.length === 0) return true
  const expressionText = target.dataset.exprText
  const symbol = card.querySelector<HTMLElement>('.tr-symbol')?.textContent ?? ''
  // OverflowMarquee may render duplicate text nodes for animation, so its
  // combined textContent is not an authoritative theorem formula. Cards
  // expose the unformatted source relation explicitly for structural tests.
  const sourcePattern = card.dataset.ruleSource ?? symbol.split('\u2192', 1)[0]?.trim()
  if (!expressionText || !sourcePattern) return true
  try {
    const parsedPattern = parse(sourcePattern)
    const bindings = matchAndCapture(parse(expressionText), parsedPattern)
    if (!bindings) return false
    const binderNames = forallBinderNames(card)
    const patternNames = expressionVariableNames(parsedPattern)
    const parsedArgs = explicitArgs.map(parseExplicitArgument)
    if (parsedArgs.length >= patternNames.length) {
      const explicitBindings: Record<string, ExpressionNode> = {}
      parsedArgs.forEach((argument, index) => {
        const binderName = binderNames[index]
        // The source side is reversed when the player swaps rewrite
        // direction, while forall binders remain in theorem-argument order.
        // Bind by the named forall whenever that name occurs in the source;
        // only use source-order variables when the pretty-printer omitted or
        // renamed the binder. Binding both could overwrite two different
        // variables and turn `mul_comm a (_ * b)` into `_ * _`, accepting an
        // unrelated multiplication card.
        const patternName = binderName && patternNames.includes(binderName)
          ? binderName
          : patternNames[index]
        if (patternName) explicitBindings[patternName] = argument
      })
      return matchesExplicitArgument(
        parse(expressionText),
        substituteVariables(parsedPattern, explicitBindings),
      )
    }
    return explicitArgs.every((argument, index) => {
      const binderName = binderNames[index]
      // Pretty-printed forall names can differ from the equality body's
      // parser names. Fall back to positional variables in the rewrite
      // pattern, which is precisely how explicit theorem arguments bind.
      const actual = (patternNames[index] ? bindings[patternNames[index]] : undefined)
        ?? (binderName ? bindings[binderName] : undefined)
      return actual ? matchesExplicitArgument(actual, parsedArgs[index]!) : false
    })
  } catch {
    // Explicit Lean arguments are constraints, not hints. If a card's
    // formatted formula cannot be parsed, accepting an arbitrary visible
    // occurrence silently rewrites the wrong subexpression (notably for
    // commutativity, where almost every multiplication is otherwise valid).
    // Fail closed and let the driver report that no faithful player target
    // exists instead of discarding the user's structural selection.
    return false
  }
}

function matchesTheoremPremise(
  theorem: HTMLElement,
  hypothesis: HTMLElement,
  explicitArgs: string[],
): boolean {
  // A specialized workspace theorem's authoritative proposition is stored
  // on the card. Its rendered `.proposition` can still include the original
  // forall presentation (or a definitionally-reduced second line), which
  // makes a visible implication fail to match its visible premise.
  const proposition = theorem.dataset.hypType
    ?? theorem.querySelector<HTMLElement>('.proposition')?.textContent
    ?? ''
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
    return binders.every((binder, index) => {
      const actual = bindings[binder]
      // A premise often determines only some of a theorem's forall binders.
      // Check every binder it does determine and leave the rest for later
      // premise drags, just as Lean/player function application does.
      if (!actual) return true
      const argument = explicitArgs[index]
      return argument ? matchesExplicitArgument(actual, parseExplicitArgument(argument)) : true
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
  private readonly aliasTypes = new Map<string, string>()
  private readonly pendingBranchAliases: Array<{
    expected: string
    before: Set<string>
    reusedName?: string
  }> = []
  private classicCommandsAlreadyCovered = 0
  private implicitIntroAlreadyPerformed = false
  private preferredRewriteSide: 'left' | 'right' | null = null
  private implicitGoalRewriteTarget: string | null = null
  private readonly pendingGoalRewrites: string[] = []
  private readonly pendingPostConstructionGoalRewrites: string[] = []
  private deferredInitialBinderNames: string[] = []

  constructor(private readonly win: DriverWindow) {}

  /** Exercise the same visible stream controls a player uses while every
   * branch is still live. Switching away and back catches stale active-stream
   * state before the reference proof starts solving either branch. */
  private async roundTripLiveProofBranch(expectedSplit: boolean) {
    if (!expectedSplit) return
    await waitForPlayerIdle(this.win, 'the new proof branches to become selectable')
    const before = harness(this.win).getCurrentStreamSnapshot()
    const nextButton = await waitFor('the next live proof-stream control', () =>
      visible(this.win.document.querySelectorAll<HTMLButtonElement>(
        '[data-testid="stream-nav-next"]:not(:disabled), button[aria-label="Next proof stream"]:not(:disabled)',
      ))[0] ?? null)

    click(nextButton)
    const sibling = await waitFor('the player-selected sibling proof stream', () => {
      const snapshot = harness(this.win).getCurrentStreamSnapshot()
      return snapshot.streamId !== before.streamId && currentGoal(this.win) ? snapshot : null
    })

    await waitForPlayerIdle(this.win, 'the sibling proof branch to become selectable')
    const previousButton = await waitFor('the previous proof-stream control', () =>
      visible(this.win.document.querySelectorAll<HTMLButtonElement>(
        '[data-testid="stream-nav-prev"]:not(:disabled), button[aria-label="Previous proof stream"]:not(:disabled)',
      ))[0] ?? null)
    click(previousButton)
    await waitFor('the original proof stream after the player switches back', () => {
      const snapshot = harness(this.win).getCurrentStreamSnapshot()
      return snapshot.streamId === before.streamId && snapshot.streamId !== sibling.streamId && currentGoal(this.win)
        ? snapshot
        : null
    })
  }

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
    const reconcilePendingBranchAliases = () => {
      if (this.pendingBranchAliases.length === 0) return
      const names = Object.keys(harness(this.win).getCurrentStreamSnapshot().hypTypes)
      for (let index = this.pendingBranchAliases.length - 1; index >= 0; index -= 1) {
        const pending = this.pendingBranchAliases[index]
        const createdName = names.find(name => !pending.before.has(name))
          ?? (pending.reusedName && names.includes(pending.reusedName)
            ? pending.reusedName
            : undefined)
        if (!createdName) continue
        this.rememberAlias(pending.expected, createdName)
        this.pendingBranchAliases.splice(index, 1)
      }
    }
    let before: StreamSnapshot | null = null
    try {
      before = harness(this.win).getCurrentStreamSnapshot()
    } catch {
      // A solved branch may deliberately leave the canvas without a current
      // stream until the player selects an incomplete graph leaf.
    }
    if (before && !before.currentStreamIsCompleted && currentGoal(this.win)) {
      // Auto branch switching may already have selected the successor before
      // the next reference step starts. Reconcile the names introduced only
      // on that branch even when no navigation click is necessary.
      reconcilePendingBranchAliases()
      return
    }

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
        '[data-testid^="stream-nav-"].toward-incomplete:not(:disabled), ' +
        'button[aria-label="Previous proof stream"].toward-incomplete:not(:disabled), ' +
        'button[aria-label="Next proof stream"].toward-incomplete:not(:disabled)',
      ))[0]
      if (arrow) return {
        kind: 'arrow' as const,
        testId: arrow.getAttribute('data-testid'),
        ariaLabel: arrow.getAttribute('aria-label'),
      }
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
      const arrowSelector = route.testId
        ? `[data-testid="${cssEscape(route.testId)}"]`
        : `button[aria-label="${cssEscape(route.ariaLabel ?? '')}"]`
      return visible(this.win.document.querySelectorAll<HTMLButtonElement>(
        `${arrowSelector}.toward-incomplete:not(:disabled)`,
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
    reconcilePendingBranchAliases()
  }

  private resolveName(name: string) {
    const resolved = this.aliases.get(name) ?? name
    try {
      const snapshot = harness(this.win).getCurrentStreamSnapshot()
      const rememberedType = this.aliasTypes.get(name)
      const directType = snapshot.hypTypes[name]
      const resolvedType = snapshot.hypTypes[resolved]
      // Prefer the literal name requested by the reference proof whenever it
      // exists in this branch with the expected proposition. Several binders
      // share the same type (most commonly `a b c : ℕ`), so reconciling a
      // historical alias by type alone can turn `cases c` into `cases a` after
      // switching branches. Collision-renamed cards still fall through to the
      // remembered alias/type lookup below.
      if (directType && (!rememberedType || this.normalizedProposition(directType) === rememberedType)) {
        if (resolved !== name) this.aliases.set(name, name)
        return name
      }
      // Short Lean names are reused independently across cases/induction
      // branches. A historical alias is live only when its proposition still
      // agrees with the card in the currently selected branch.
      if (resolvedType && (!rememberedType || this.normalizedProposition(resolvedType) === rememberedType)) {
        return resolved
      }
      if (rememberedType) {
        const reconciled = Object.entries(snapshot.hypTypes)
          .find(([, type]) => this.normalizedProposition(type) === rememberedType)?.[0]
        if (reconciled) {
          this.aliases.set(name, reconciled)
          return reconciled
        }
      }
      if (resolvedType) return resolved
    } catch {
      // The harness can briefly disappear between proof streams.
    }
    return resolved
  }

  private rememberAlias(expected: string, actual: string) {
    this.aliases.set(expected, actual)
    try {
      const type = harness(this.win).getCurrentStreamSnapshot().hypTypes[actual]
      if (type) this.aliasTypes.set(expected, this.normalizedProposition(type))
    } catch {
      // The name remains useful even if the proof stream is between renders.
    }
  }

  private hyp(name: string) {
    return this.hypExact(this.resolveName(name))
  }

  /** Introduce binders deliberately left in the goal for a generalized
   * induction. Each generated branch owns a fresh copy, so retain the expected
   * declaration order and remap it from the cards created in this stream. */
  private async exposeDeferredInitialBinders(name: string) {
    if (!this.deferredInitialBinderNames.includes(name) || this.hypExact(name)) return
    const introduced: string[] = []
    for (let attempt = 0; attempt < this.deferredInitialBinderNames.length; attempt += 1) {
      const snapshot = harness(this.win).getCurrentStreamSnapshot()
      if (snapshot.goalPlayTactic !== 'click_goal') break
      const beforeNames = new Set(Object.keys(snapshot.hypTypes))
      await this.clickGoal()
      const createdName = Object.keys(harness(this.win).getCurrentStreamSnapshot().hypTypes)
        .find(candidate => !beforeNames.has(candidate))
      if (!createdName) break
      introduced.push(createdName)
    }
    introduced.forEach((actualName, index) => {
      const expectedName = this.deferredInitialBinderNames[index]
      if (expectedName) this.rememberAlias(expectedName, actualName)
    })
  }

  /** Look up an already-resolved Lean name without following another alias. */
  private hypExact(name: string) {
    const baseSelector = `[data-testid="hyp-card"][data-hyp-name="${cssEscape(name)}"]`
    try {
      const streamId = harness(this.win).getCurrentStreamSnapshot().streamId
      return visible(this.win.document.querySelectorAll<HTMLElement>(
        `${baseSelector}[data-stream-id="${cssEscape(streamId)}"]`,
      ))[0] ?? null
    } catch {
      // The harness can briefly disappear while React changes proof branches.
      return visible(this.win.document.querySelectorAll<HTMLElement>(baseSelector))[0] ?? null
    }
  }

  private refreshCard(card: HTMLElement) {
    const hypName = card.dataset.hypName
    if (!hypName) return card
    const exact = this.hypExact(hypName)
    if (exact) return exact
    const hypType = card.dataset.hypType
    if (!hypType) return card
    const normalizedType = this.normalizedProposition(hypType)
    const snapshot = harness(this.win).getCurrentStreamSnapshot()
    const currentName = Object.entries(snapshot.hypTypes)
      .find(([, type]) => this.normalizedProposition(type) === normalizedType)?.[0]
    return currentName ? this.hypExact(currentName) ?? card : card
  }

  private latestRelationName() {
    const snapshot = harness(this.win).getCurrentStreamSnapshot()
    return Object.entries(snapshot.hypTypes).reverse()
      .find(([, type]) => /(?:=|≠|≤)/u.test(type))?.[0] ?? null
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
    const discoveredCategoryIds = tab === 'Theorems'
      ? Array.from(dock.querySelectorAll<HTMLButtonElement>('[data-theorem-category]'))
        .map(button => button.dataset.theoremCategory)
        .filter((id): id is string => Boolean(id))
      : []
    // All is the authoritative player-visible listing and contains every
    // unlocked theorem. Search it first, then the narrower buckets as a
    // defensive fallback. A previously selected category survives between
    // levels, so relying on DOM order made the test skip cards while the dock
    // was still adaptively repacking its pages.
    const categoryIds = discoveredCategoryIds.length > 0
      ? ['all', ...discoveredCategoryIds.filter(id => id !== 'all')]
      : []
    // Search every visible theorem category through the same tab clicks and
    // pagination a player uses. The selection survives route changes, and an
    // asynchronous All-tab click alone was not sufficient to expose cards
    // hidden in the 012/+/≤/* buckets.
    for (const categoryId of categoryIds.length > 0 ? categoryIds : [null]) {
      if (categoryId) {
        await waitFor(`${categoryId} theorem category to activate`, () => {
          const category = dock.querySelector<HTMLButtonElement>(
            `[data-theorem-category="${cssEscape(categoryId)}"]`,
          )
          if (category?.classList.contains('active')) return category
          if (category && !category.disabled) click(category)
          return null
        }, 5_000)
      }
      await rewindPages(dock, 'Previous')
      for (let page = 0; page < 100; page += 1) {
        const card = visible(dock.querySelectorAll<HTMLElement>(selector))[0]
        if (card) return card
        const next = dock.querySelector<HTMLButtonElement>('button[aria-label="Next"]')
        if (!next || next.disabled) break
        await clickPaginationAndWait(dock, next, 'theorem pagination to advance')
      }
    }
    const available = visible(dock.querySelectorAll<HTMLElement>('[data-theorem-name], [data-tactic-name]'))
      .map(card => card.dataset.theoremName ?? card.dataset.tacticName)
      .filter(Boolean)
    throw new Error(
      `Could not find ${tab.toLowerCase()} card ${selector}; ` +
      `active category=${dock.querySelector<HTMLElement>('[data-theorem-category].active')?.dataset.theoremCategory ?? 'none'}; ` +
      `visible cards=${JSON.stringify(available)}`,
    )
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
    await waitForPlayerIdle(this.win, `${description} to become available`)
    source = this.refreshCard(source)
    target = this.refreshCard(target)
    const before = proofSignature(harness(this.win).getProofAudit())
    const selectedStreamBefore = selectedStreamSignature(this.win)
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
    await waitForSelectedStreamChange(this.win, selectedStreamBefore, description)
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
      this.rememberAlias(induction[1], predecessor)
      this.rememberAlias(induction[2], inductionHyp)
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
    const selectedStreamBefore = selectedStreamSignature(this.win)
    const previousAttempts = playLog(this.win).length
    click(option)
    await waitForPlayAttempt(this.win, previousAttempts, `${command} branch player action`)
    await waitForProofChange(this.win, before, `${command} branch selection`)
    await waitForSelectedStreamChange(
      this.win,
      selectedStreamBefore,
      `${command} goal choice`,
    )
    for (const pending of this.pendingGoalRewrites.splice(0)) await this.rewrite(pending)
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
    const before = selectedStreamSignature(this.win)
    const previousAttempts = playLog(this.win).length
    click(goal)
    let lastRetry = Date.now()
    await waitForPlayAttempt(this.win, previousAttempts, 'goal click player action', () => {
      if (Date.now() - lastRetry < 250) return
      lastRetry = Date.now()
      const current = currentGoal(this.win)
      if (current?.classList.contains('clickable') && !current.classList.contains('solved')) click(current)
    })
    await waitForSelectedStreamChange(this.win, before, 'goal click')
  }

  private async cases(command: string) {
    const match = /^cases\s+(\S+)/u.exec(command)
    if (!match) throw new Error(`Unsupported cases command: ${command}`)
    await this.exposeDeferredInitialBinders(match[1])
    const beforeSnapshot = harness(this.win).getCurrentStreamSnapshot()
    const beforeNames = new Set(Object.keys(beforeSnapshot.hypTypes))
    const target = await waitFor(`hypothesis ${match[1]}`, () => this.hyp(match[1]))
    const eliminatedDisplayName = target.dataset.hypName
    const type = target.dataset.hypType ?? ''
    const casesNumber = /^(?:\u2115|Nat|MyNat)$/u.test(type.trim())
    const casesOr = type.includes('\u2228')
    if (casesNumber) {
      await this.dragTactic('cases', target)
    } else if (type.trim() === 'False') {
      // `cases h` is its own explicit player interaction and is taught before
      // exfalso: drag the already-unlocked cases tactic onto the False card.
      // This does not reintroduce the forbidden False-card-to-arbitrary-goal
      // shortcut.
      await this.dragTactic('cases', target)
      // dragTactic already waits for Lean to accept the play and for the proof
      // signature to change. A `cases` result with zero goals has no successor
      // stream to select; the normal post-command audit owns completion checks.
      return
    } else {
      await waitForPlayerIdle(this.win, `clicking ${match[1]} to become available`)
      const before = proofSignature(harness(this.win).getProofAudit())
      const previousAttempts = playLog(this.win).length
      click(target)
      let lastRetry = Date.now()
      await waitForPlayAttempt(this.win, previousAttempts, `clicking ${match[1]} player action`, () => {
        if (Date.now() - lastRetry < 250) return
        lastRetry = Date.now()
        const current = this.hyp(match[1])
        if (current) click(current)
      })
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
      this.rememberAlias(expectedNames[index], actualNames[index])
    }
    for (const expected of expectedNames.slice(actualNames.length)) {
      this.pendingBranchAliases.push({
        expected,
        before: beforeNames,
        ...(eliminatedDisplayName ? { reusedName: eliminatedDisplayName } : {}),
      })
    }
    await this.roundTripLiveProofBranch(casesNumber || casesOr)
  }

  private async induction(command: string) {
    const match = /^induction\s+(\S+)/u.exec(command)
    if (!match) throw new Error(`Unsupported induction command: ${command}`)
    const snapshot = harness(this.win).getCurrentStreamSnapshot()
    const names = new Set(Object.keys(snapshot.hypTypes))
    const target = await waitFor(`hypothesis ${match[1]}`, () => this.hyp(match[1]))
    const beforeState = playerStateSignature(this.win)
    const previousAttempts = playLog(this.win).length
    await waitForPlayerIdle(this.win, 'induction drag to become available')
    await drag(await this.tactic('induction'), this.refreshCard(target))
    try {
      await waitForPlayAttempt(this.win, previousAttempts, 'induction drag player action')
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; ` +
        `dragDebug=${JSON.stringify(harness(this.win).getLastDragDebug())}`,
        { cause: error },
      )
    }
    // Splitting a proof stream can commit the new branch graph before the
    // proof-pane text is reconciled. The player-visible state transition is
    // the authoritative completion signal for this gesture; the per-command
    // audit immediately afterwards still validates both proof panes.
    await waitFor('induction drag to update the player state', () =>
      playerStateSignature(this.win) !== beforeState ? true : null)
    await waitFor('induction branch to become the current canvas stream', () => {
      const current = harness(this.win).getCurrentStreamSnapshot()
      if (!current.streamId || current.streamId === snapshot.streamId) return null
      return visible(this.win.document.querySelectorAll<HTMLElement>(
        `[data-testid="goal-card"][data-stream-id="${cssEscape(current.streamId)}"]`,
      ))[0] ?? null
    })
    this.rememberIntroducedNames(command, names)
    await this.roundTripLiveProofBranch(true)
  }

  private async sourceCard(name: string) {
    await this.exposeDeferredInitialBinders(name)
    const local = this.hyp(name)
    if (local) return local
    if (this.aliases.has(name)) {
      const reconciledName = this.latestRelationName()
      if (reconciledName) {
        this.rememberAlias(name, reconciledName)
        return await waitFor(`reconciled hypothesis ${name}`, () => this.hypExact(reconciledName))
      }
    }
    return await this.theorem(name)
  }

  async placeTheoremCopy(name: string) {
    const canvas = await waitFor('combining canvas', () =>
      this.win.document.querySelector<HTMLElement>('[data-testid="combining-canvas"]'))
    const copiesBefore = visible(this.win.document.querySelectorAll<HTMLElement>(
      `[data-testid="theorem-copy-card"][data-theorem-name$="${cssEscape(sourceName(name))}"]`,
    )).length
    const bounds = canvas.getBoundingClientRect()
    const trayTop = this.win.document.getElementById('theorem-tray')
      ?.getBoundingClientRect().top ?? bounds.bottom
    const sourceRect = (await this.theorem(name)).getBoundingClientRect()
    const obstacles = visible(this.win.document.querySelectorAll<HTMLElement>(
      '[data-testid="goal-card"], [data-testid="hyp-card"], [data-testid="theorem-copy-card"]',
    )).map(element => element.getBoundingClientRect())
    const candidates = [
      [0.2, 0.65], [0.4, 0.65], [0.6, 0.65], [0.2, 0.4], [0.4, 0.4], [0.6, 0.4],
    ].map(([xRatio, yRatio]) => ({
      x: bounds.left + bounds.width * xRatio!,
      y: Math.min(bounds.top + bounds.height * yRatio!, trayTop - sourceRect.height / 2 - 24),
    }))
    const openCandidates = candidates.filter(point => {
      const candidate = {
        left: point.x - sourceRect.width / 2,
        right: point.x + sourceRect.width / 2,
        top: point.y - sourceRect.height / 2,
        bottom: point.y + sourceRect.height / 2,
      }
      return obstacles.every(obstacle =>
        candidate.right < obstacle.left - 12
        || candidate.left > obstacle.right + 12
        || candidate.bottom < obstacle.top - 12
        || candidate.top > obstacle.bottom + 12)
    })
    const placements = openCandidates.length > 0 ? openCandidates : candidates
    let copy: HTMLElement | null = null
    let placementError: unknown
    for (let attempt = 0; attempt < Math.min(3, placements.length); attempt += 1) {
      const source = await this.theorem(name)
      const point = placements[attempt]!
      await dragToPoint(source, point.x, point.y)
      try {
        copy = await waitFor(`workspace copy of ${name}`, () => {
          const copies = visible(this.win.document.querySelectorAll<HTMLElement>(
            `[data-testid="theorem-copy-card"][data-theorem-name$="${cssEscape(sourceName(name))}"]`,
          ))
          return copies.length > copiesBefore ? copies.at(-1) ?? null : null
        }, 5_000)
        break
      } catch (error) {
        placementError = error
      }
    }
    if (!copy) throw placementError ?? new Error(`Could not place workspace copy of ${name}`)
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
    await waitForPlayerIdle(this.win, `${theoremName} application to become available`)
    const copy = await waitFor(`workspace copy of ${theoremName}`, () => visible(
      this.win.document.querySelectorAll<HTMLElement>(
        `[data-testid="theorem-copy-card"][data-theorem-name$="${cssEscape(sourceName(theoremName))}"]`,
      ),
    )[0])
    const hypothesis = await waitFor(`hypothesis ${hypName}`, () => this.hyp(hypName))
    const source = direction === 'theorem-to-hypothesis' ? copy : hypothesis
    const target = direction === 'theorem-to-hypothesis' ? hypothesis : copy
    const description = `${theoremName} ${direction}`
    const before = proofSignature(harness(this.win).getProofAudit())
    const selectedStreamBefore = selectedStreamSignature(this.win)
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
    await waitForSelectedStreamChange(this.win, selectedStreamBefore, description)
  }

  async undoLastPlayerStep() {
    const before = proofSignature(harness(this.win).getProofAudit())
    const undo = await waitFor('combining-mode undo button', () =>
      visible(this.win.document.querySelectorAll<HTMLButtonElement>(
        '.tr-controls .active-undo[aria-label="Undo"], .tr-controls .active-undo[title="Undo"]',
      ))[0])
    click(undo)
    await waitFor('undo to restore the previous player state', () => {
      const audit = harness(this.win).getProofAudit()
      return !audit.processing && proofSignature(audit) !== before ? audit : null
    }, INTERACTION_TIMEOUT)
  }

  private async applyOrExact(command: string) {
    const applicationMatch = /^(?:apply|exact)\s+(.+)$/u.exec(command)
    if (!applicationMatch) throw new Error(`Unsupported theorem application: ${command}`)
    // Parse a trailing `at h` directly from the end of the command. The
    // theorem application itself can contain parenthesized arguments, but a
    // target is always one final Lean identifier. Token-index parsing proved
    // vulnerable to the generated command text and silently turned
    // `apply f ... at h` into a theorem-on-goal drag.
    const applicationBody = applicationMatch[1].trim()
    const targetMatch = /\s+at\s+(\S+)\s*$/u.exec(applicationBody)
    const match: [string, string, string?] = [
      applicationMatch[0],
      targetMatch ? applicationBody.slice(0, targetMatch.index).trim() : applicationBody,
      targetMatch?.[1],
    ]
    const application = splitTopLevelWhitespace(match[1])
    const name = sourceName(application[0] ?? match[1])
    const explicitArgs = application.slice(1)
    let source: HTMLElement
    try {
      source = await this.sourceCard(name)
    } catch (error) {
      const goal = currentGoal(this.win)
      if (match[2] || !goal?.classList.contains('transformable')) throw error
      // Equality lemmas live in the transformation theorem dock, not always
      // in the combining-mode proposition tray. An `exact add_assoc ...`
      // reference step is performed by rewriting the visible equality with
      // that lemma and then clicking the reflexive result if needed.
      await this.rewrite(`rw [${name}]`)
      if (!harness(this.win).getProofAudit().completed) {
        const rewrittenGoal = currentGoal(this.win)
        if (rewrittenGoal?.classList.contains('clickable')) await this.clickGoal()
      }
      return
    }
    const isExactCommand = command.startsWith('exact ')
    if (isExactCommand && !match[2] && explicitArgs.length === 0) {
      const goalType = harness(this.win).getCurrentStreamSnapshot().goalType
      // `exact` is the player gesture “drag a proof of the displayed goal to
      // that goal”. Repeated applications can replace the classic Lean name
      // several times, so prefer the currently visible proposition of the
      // right type over a stale historical alias.
      source = this.visibleHypothesisOfType(goalType) ?? source
    }
    const sourceWasLocalHypothesis = source.matches('[data-testid="hyp-card"]')
    if (!match[2]) {
      // Follow Lean's application order one argument at a time. Forall term
      // arguments use Construction Mode; once those binders are gone, proof
      // arguments are ordinary proposition-card drags. Treating every token
      // as a forall specialization left implications unapplied and then
      // dragged the generalized theorem onto the goal.
      let remainingForallArguments = Math.min(explicitArgs.length, forallBinderNames(source).length)
      for (const [argumentIndex, argument] of explicitArgs.entries()) {
        source = this.refreshCard(source)
        const typesBeforeArgument = harness(this.win).getCurrentStreamSnapshot().hypTypes
        const namesBeforeArgument = new Set(Object.keys(typesBeforeArgument))
        const visibleTypesBeforeArgument = new Map(visible(
          this.win.document.querySelectorAll<HTMLElement>('[data-testid="hyp-card"]'),
        ).flatMap(card => card.dataset.hypName
          ? [[card.dataset.hypName, card.dataset.hypType ?? ''] as const]
          : []))
        const sourceNameBeforeArgument = source.dataset.hypName
        const sourceTypeBeforeArgument = source.dataset.hypType
        const sourceArrowBeforeArgument = sourceTypeBeforeArgument?.indexOf('→') ?? -1
        const expectedConclusionAfterArgument = sourceArrowBeforeArgument >= 0 && sourceTypeBeforeArgument
          ? this.normalizedProposition(sourceTypeBeforeArgument.slice(sourceArrowBeforeArgument + 1))
          : null
        // Construction Mode consumes the theorem's visible forall binders.
        // Do not keep using a stale `constructable` class after those binders
        // are gone: later explicit arguments such as `ha` and `h` are proofs
        // and must be applied by proposition-card drags.
        const specializesForall = remainingForallArguments > 0
          || (source.classList.contains('constructable') && !this.hyp(argument))
        if (specializesForall) {
          doubleClick(source)
          await waitFor('construction view', () => this.win.document.querySelector('.tr-construction-overlay'))
          await this.submitConstruction(parseConstructionExpr(argument), `${command} (${argument})`)
          if (remainingForallArguments > 0) remainingForallArguments -= 1
        } else {
          let matchingHypothesis = this.hyp(argument)
          if (!matchingHypothesis || !matchesTheoremPremise(source, matchingHypothesis, [])) {
            // A rewrite or branch reconciliation may replace the card that a
            // classic proof name used to denote. Resolve the proof argument
            // from the premise of the theorem the player is visibly holding,
            // then update the alias. Looking for another theorem that accepts
            // the stale card reverses this relationship and can select an old
            // curried theorem from the workspace.
            const semanticHypothesis = visible(
              this.win.document.querySelectorAll<HTMLElement>('[data-testid="hyp-card"]'),
            ).find(candidate =>
              candidate !== source && matchesTheoremPremise(source, candidate, []),
            )
            if (semanticHypothesis) {
              matchingHypothesis = semanticHypothesis
              const semanticName = semanticHypothesis.dataset.hypName
              if (semanticName) this.rememberAlias(argument, semanticName)
            }
          }
          if (matchingHypothesis && !matchesTheoremPremise(source, matchingHypothesis, [])) {
            // Reconciliation can preserve the old curried card while mounting
            // its derived result under a fresh Lean name. Follow the visible
            // card that actually accepts the named proof argument, just as a
            // player follows the highlighted theorem after each application.
            const semanticSource = visible(
              this.win.document.querySelectorAll<HTMLElement>('[data-testid="hyp-card"]'),
            ).find(candidate =>
              candidate !== matchingHypothesis &&
              matchesTheoremPremise(candidate, matchingHypothesis, []),
            )
            if (semanticSource) source = semanticSource
          }
          if (!matchingHypothesis || !matchesTheoremPremise(source, matchingHypothesis, [])) {
            throw new Error(`${command} cannot apply visible proof argument ${argument}`)
          }
          await this.dragAndWait(source, matchingHypothesis, `${command} premise ${argument} application`)
        }
        const snapshotAfterArgument = harness(this.win).getCurrentStreamSnapshot()
        const visibleCardsAfterArgument = visible(
          this.win.document.querySelectorAll<HTMLElement>('[data-testid="hyp-card"]'),
        )
        const visibleCreatedName = visibleCardsAfterArgument
          .map(card => card.dataset.hypName)
          .find((candidate): candidate is string => Boolean(candidate) &&
            candidate !== sourceNameBeforeArgument &&
            !visibleTypesBeforeArgument.has(candidate!),
          )
        const visibleChangedName = visibleCardsAfterArgument
          .map(card => [card.dataset.hypName, card.dataset.hypType ?? ''] as const)
          .find(([candidate, type]) => Boolean(candidate) &&
            candidate !== sourceNameBeforeArgument &&
            visibleTypesBeforeArgument.has(candidate!) &&
            visibleTypesBeforeArgument.get(candidate!) !== type,
          )?.[0]
        const createdName = Object.keys(snapshotAfterArgument.hypTypes)
          // A specialization card can reach the DOM one audit snapshot late.
          // Do not mistake that still-curried source for the conclusion just
          // derived by applying the visible proof premise.
          .find(candidate =>
            !namesBeforeArgument.has(candidate) && candidate !== sourceNameBeforeArgument,
          )
        const changedName = Object.entries(snapshotAfterArgument.hypTypes)
          .find(([candidate, type]) =>
            namesBeforeArgument.has(candidate) && typesBeforeArgument[candidate] !== type,
          )?.[0]
        // A workspace theorem application may update the existing card in
        // place instead of allocating another hypothesis name. That is a
        // normal player-visible result (and is what chained applications of
        // `mul_left_cancel ... ha h` do), so follow the changed card rather
        // than requiring every premise drag to grow the hypothesis list.
        const retainedName = sourceNameBeforeArgument
          && snapshotAfterArgument.hypTypes[sourceNameBeforeArgument] != null
          && snapshotAfterArgument.hypTypes[sourceNameBeforeArgument] !== sourceTypeBeforeArgument
            ? sourceNameBeforeArgument
            : null
        const nextArgument = explicitArgs[argumentIndex + 1]
        const visibleDerivedName = await waitFor(
          `${command} visible conclusion after ${argument}`,
          () => {
            const nextPremise = nextArgument ? this.hyp(nextArgument) : null
            const goalType = harness(this.win).getCurrentStreamSnapshot().goalType
            const candidate = visible(
              this.win.document.querySelectorAll<HTMLElement>('[data-testid="hyp-card"]'),
            ).find(card => {
              const candidateName = card.dataset.hypName
              const candidateType = card.dataset.hypType ?? ''
              if (!candidateName || !candidateType) return false
              // Browser reconciliation may reuse both the theorem card name
              // and its optimistic displayed type. The semantic next premise
              // (or final goal) is stronger evidence than identity churn.
              if (
                expectedConclusionAfterArgument &&
                this.normalizedProposition(candidateType) === expectedConclusionAfterArgument
              ) return true
              return nextPremise
                ? matchesTheoremPremise(card, nextPremise, [])
                : this.normalizedProposition(candidateType) === this.normalizedProposition(goalType)
            })
            return candidate?.dataset.hypName ?? null
          },
          3_000,
        ).catch(() => null)
        const reusedName = sourceNameBeforeArgument
          && snapshotAfterArgument.hypTypes[sourceNameBeforeArgument] != null
            ? sourceNameBeforeArgument
            : null
        // Prefer the card whose current proposition consumes the next
        // visible premise. Identity-based fallbacks can see an asynchronously
        // mounted specialization source before its derived conclusion.
        const resultName = visibleDerivedName ?? createdName ?? retainedName ?? changedName ??
          visibleCreatedName ?? visibleChangedName ?? reusedName
        if (!resultName) throw new Error(`${command} did not derive its conclusion after ${argument}`)
        source = await waitFor(`derived theorem ${resultName}`, () => this.hypExact(resultName))
      }
    } else {
      for (const argument of explicitArgs) {
        const namesBeforeArgument = new Set(Object.keys(harness(this.win).getCurrentStreamSnapshot().hypTypes))
        doubleClick(source)
        await waitFor('construction view', () => this.win.document.querySelector('.tr-construction-overlay'))
        await this.submitConstruction(parseConstructionExpr(argument), `${command} (${argument})`)
        const createdName = Object.keys(harness(this.win).getCurrentStreamSnapshot().hypTypes)
          .find(candidate => !namesBeforeArgument.has(candidate))
        if (!createdName) throw new Error(`${command} did not create a theorem card for ${argument}`)
        source = await waitFor(`specialized theorem ${createdName}`, () => this.hyp(createdName))
      }
    }
    // Specializing forall binders can expose an implication whose premise is
    // already a visible hypothesis. Apply it through the same card-on-card
    // drag a player uses, rather than applying A → B to the B goal and
    // accidentally creating a duplicate A subgoal.
    for (let premise = 0; !match[2] && premise < 8; premise += 1) {
      source = this.refreshCard(source)
      const matchingHypothesis = visible(
        this.win.document.querySelectorAll<HTMLElement>('[data-testid="hyp-card"]'),
      ).find(hypothesis => hypothesis !== source && matchesTheoremPremise(source, hypothesis, []))
      if (!matchingHypothesis) break
      const sourceName = source.dataset.hypName
      const namesBeforeApplication = new Set(Object.keys(harness(this.win).getCurrentStreamSnapshot().hypTypes))
      await this.dragAndWait(source, matchingHypothesis, `${command} visible premise application`)
      const createdName = Object.keys(harness(this.win).getCurrentStreamSnapshot().hypTypes)
        .find(candidate => !namesBeforeApplication.has(candidate))
      const replacementName = createdName ?? sourceName
      if (!replacementName) throw new Error(`${command} did not identify its visible-premise conclusion`)
      source = await waitFor(`derived theorem ${replacementName}`, () => this.hyp(replacementName))
    }
    const currentGoalType = harness(this.win).getCurrentStreamSnapshot().goalType.trim()
    const sourceAlreadyProvesGoal = Boolean(source.dataset.hypType)
      && this.normalizedProposition(source.dataset.hypType ?? '')
        === this.normalizedProposition(currentGoalType)
    const contradictionTarget = !match[2]
      && !isExactCommand
      && !sourceAlreadyProvesGoal
      && !sourceWasLocalHypothesis
      && /^False$/u.test(currentGoalType)
      && this.implicitGoalRewriteTarget
      && this.hypExact(this.implicitGoalRewriteTarget)
        ? this.hypExact(this.implicitGoalRewriteTarget)
        : null
    if (match[2]) await this.exposeDeferredInitialBinders(match[2])
    const target = match[2]
      ? await waitFor(`hypothesis ${match[2]}`, () => {
          const named = this.hyp(match[2])
          if (named && matchesTheoremPremise(source, named, [])) return named
          // Browser reconciliation keeps earlier derived cards visible. A
          // classic name such as `h` therefore can still point at the first
          // link in a chain (`b ≠ 0`) after the player has visibly derived the
          // next one (`1 ≤ b`). Follow the unique proposition that matches
          // the specialized theorem premise, exactly as a player choosing the
          // highlighted card does.
          const matchingVisibleHypothesis = visible(
            this.win.document.querySelectorAll<HTMLElement>('[data-testid="hyp-card"]'),
          ).find(candidate => candidate !== source && matchesTheoremPremise(source, candidate, []))
          if (matchingVisibleHypothesis) return matchingVisibleHypothesis
          // The lightweight display matcher does not unfold numeral notation
          // (`1` versus `succ 0`). If the branch-local named card survived,
          // let Lean perform that authoritative definitional-equality check.
          if (named) return named
          if (!this.aliases.has(match[2])) return null
          const reconciledName = this.latestRelationName()
          if (!reconciledName) return null
          const reconciled = this.hypExact(reconciledName)
          if (!reconciled || !matchesTheoremPremise(source, reconciled, [])) return null
          this.rememberAlias(match[2], reconciledName)
          return reconciled
        })
      : contradictionTarget ?? await waitFor('current goal', () => currentGoal(this.win))
    if (isExactCommand && !match[2]) {
      // The final proposition application can mount its conclusion one React
      // commit after Lean accepts the drag. `exact` always means choosing the
      // currently visible card whose proposition is the displayed goal, not
      // whichever curried theorem name appeared first in an audit snapshot.
      const goalType = harness(this.win).getCurrentStreamSnapshot().goalType
      source = await waitFor(
        `${command} visible proof of the current goal`,
        () => this.visibleHypothesisOfType(goalType),
      )
    }
    const beforeFinalNames = new Set(Object.keys(harness(this.win).getCurrentStreamSnapshot().hypTypes))
    const finalSourceName = source.dataset.hypName
    const finalSourceType = source.dataset.hypType ?? ''
    const finalArrow = finalSourceType.indexOf('→')
    const expectedFinalConclusion = finalArrow >= 0
      ? this.normalizedProposition(finalSourceType.slice(finalArrow + 1))
      : null
    await this.dragAndWait(source, target, `${command} player drag`)
    if (contradictionTarget && !harness(this.win).getProofAudit().completed) {
      const derivedName = Object.keys(harness(this.win).getCurrentStreamSnapshot().hypTypes)
        .find(candidate => !beforeFinalNames.has(candidate))
      if (!derivedName) throw new Error(`${command} did not derive the visible contradiction`)
      await this.dragAndWait(
        await waitFor(`derived contradiction ${derivedName}`, () => this.hyp(derivedName)),
        await waitFor('False goal', () => currentGoal(this.win)),
        `${command} contradiction drag to goal`,
      )
    }
    if (match[2]) {
      if (harness(this.win).getProofAudit().completed) {
        throw new Error(`${command} incorrectly completed: ${JSON.stringify({
          audit: harness(this.win).getProofAudit(),
          lastPlay: playLog(this.win).at(-1),
        })}`)
      }
      // Prefer the proposition produced by the application over identity
      // churn. The browser can mount an intermediate specialized theorem and
      // the atomic conclusion in the same update; choosing merely the first
      // new name binds the classic alias to the stale `A → B` card.
      const semanticConclusionName = expectedFinalConclusion
        ? await waitFor(`${command} semantic conclusion card`, () => {
            const snapshotMatch = Object.entries(harness(this.win).getCurrentStreamSnapshot().hypTypes)
              .find(([, type]) => this.normalizedProposition(type) === expectedFinalConclusion)?.[0]
            if (snapshotMatch) return snapshotMatch
            return visible(
              this.win.document.querySelectorAll<HTMLElement>('[data-testid="hyp-card"]'),
            ).find(card =>
              Boolean(card.dataset.hypName) &&
              this.normalizedProposition(card.dataset.hypType ?? '') === expectedFinalConclusion,
            )?.dataset.hypName ?? null
          }).catch(() => null)
        : null
      const leastCurriedConclusionName = visible(
        this.win.document.querySelectorAll<HTMLElement>('[data-testid="hyp-card"]'),
      ).filter(card => {
        const candidateName = card.dataset.hypName
        const candidateType = card.dataset.hypType ?? ''
        return Boolean(candidateName)
          && candidateName !== finalSourceName
          && /(?:=|≠|≤|∨|∧|False)/u.test(candidateType)
      }).sort((left, right) => {
        const leftArrows = (left.dataset.hypType?.match(/→/gu) ?? []).length
        const rightArrows = (right.dataset.hypType?.match(/→/gu) ?? []).length
        const leftWasPresent = beforeFinalNames.has(left.dataset.hypName ?? '') ? 1 : 0
        const rightWasPresent = beforeFinalNames.has(right.dataset.hypName ?? '') ? 1 : 0
        return leftArrows - rightArrows || leftWasPresent - rightWasPresent
      })[0]?.dataset.hypName ?? null
      const createdName = sourceWasLocalHypothesis
        ? Object.keys(harness(this.win).getCurrentStreamSnapshot().hypTypes)
          .find(candidate => !beforeFinalNames.has(candidate))
        : await waitFor(`${command} derived conclusion card`, () =>
            Object.keys(harness(this.win).getCurrentStreamSnapshot().hypTypes)
              .find(candidate =>
                !beforeFinalNames.has(candidate) && candidate !== finalSourceName,
              ) ?? null).catch(() => null)
      let resultName = semanticConclusionName
        ?? createdName
        ?? leastCurriedConclusionName
        ?? target.dataset.hypName
      // Applying a generalized induction hypothesis to an equality can leave
      // earlier premises (for example `ha : a ≠ 0`) unapplied. Continue with
      // ordinary proposition-on-implication drags while a visible premise
      // matches, then bind the classic target name to the actual conclusion.
      // A local induction/function hypothesis can remain curried after its
      // first application. A theorem dragged from the tray, however, has
      // already had the selected `at h` premise applied by drag_apply; its
      // derived atomic result must not be fed the same hypothesis again just
      // because Lean exposes a definitionally reduced arrow type for `≠`.
      for (let premise = 0; sourceWasLocalHypothesis && resultName && premise < 8; premise += 1) {
        const resultCard = await waitFor(`derived theorem ${resultName}`, () => this.hypExact(resultName!))
        // The card can also show a definitionally reduced implication below
        // an atomic proposition such as `b ≠ 0`. Only the authoritative main
        // hypothesis type determines whether another premise application is
        // valid; the grey reduction is explanatory, not another function.
        const displayedProposition = resultCard.dataset.hypType ?? ''
        if (!displayedProposition.includes('→')) break
        const matchingHypothesis = visible(
          this.win.document.querySelectorAll<HTMLElement>('[data-testid="hyp-card"]'),
        ).find(hypothesis => hypothesis !== resultCard && matchesTheoremPremise(resultCard, hypothesis, []))
        if (!matchingHypothesis) break
        const namesBeforeApplication = new Set(Object.keys(harness(this.win).getCurrentStreamSnapshot().hypTypes))
        await this.dragAndWait(resultCard, matchingHypothesis, `${command} remaining premise application`)
        resultName = Object.keys(harness(this.win).getCurrentStreamSnapshot().hypTypes)
          .find(candidate => !namesBeforeApplication.has(candidate)) ?? resultName
      }
      if (resultName) {
        this.rememberAlias(match[2], resultName)
        const resultType = harness(this.win).getCurrentStreamSnapshot().hypTypes[resultName]
        if (resultType?.trim() === 'False') this.implicitGoalRewriteTarget = null
      }
    }
  }

  private async openTransform(target: string) {
    await waitForPlayerIdle(this.win, `${target} to become transformable`)
    let lastAttemptAt = 0
    try {
      await waitFor('transformation view', () => {
      const overlay = this.win.document.querySelector<HTMLElement>('.tr-transformation-overlay')
      if (overlay) return overlay
      if (target !== 'goal') {
        const snapshot = harness(this.win).getCurrentStreamSnapshot()
        if (!snapshot.hypTypes[target]) target = this.latestRelationName() ?? target
      }
      const element = target === 'goal' ? currentGoal(this.win) : this.hypExact(target)
      if (element && Date.now() - lastAttemptAt >= 300) {
        // Re-resolve the card for each attempt. Lean responses replace cards
        // during reconciliation, so retaining the element found before the
        // final React commit can send a perfectly realistic double-click to a
        // detached node and silently do nothing.
        doubleClick(element)
        lastAttemptAt = Date.now()
      }
      return null
      })
    } catch (error) {
      const element = target === 'goal' ? currentGoal(this.win) : this.hypExact(target)
      let snapshot: StreamSnapshot | string
      try {
        snapshot = harness(this.win).getCurrentStreamSnapshot()
      } catch (snapshotError) {
        snapshot = snapshotError instanceof Error ? snapshotError.message : String(snapshotError)
      }
      throw new Error(`Timed out opening transformation target ${target}: ${JSON.stringify({
        found: Boolean(element),
        className: element?.className,
        hypName: element?.dataset.hypName,
        hypType: element?.dataset.hypType,
        goalText: element?.dataset.goalText,
        snapshot,
      })}`, { cause: error })
    }
  }

  private async transformRule(name: string, allowReconciledFallback = true): Promise<HTMLElement> {
    let overlay = await waitFor('transformation view', () =>
      this.win.document.querySelector<HTMLElement>('.tr-transformation-overlay'))
    const currentOverlay = () => {
      overlay = this.win.document.querySelector<HTMLElement>('.tr-transformation-overlay') ?? overlay
      return overlay
    }
    const waitForMeasuredDock = () => waitFor('measured rewrite menu', () => {
      const dock = currentOverlay().querySelector<HTMLElement>('.tr-rule-dock[data-layout-ready="true"]')
      return dock && getComputedStyle(dock).visibility !== 'hidden' ? dock : null
    })
    let hypothesisFallback: HTMLElement | null = null
    for (const tabName of ['Everything', 'Hypotheses', '+', '*', '^', '\u2264', '012', 'Peano']) {
      const findTab = () => Array.from(currentOverlay().querySelectorAll<HTMLButtonElement>('.tr-tab-btn'))
        .find(button => button.textContent?.trim() === tabName)
      const tab = findTab()
      if (tab && !tab.classList.contains('active')) {
        let lastClickAt = 0
        await waitFor(`${tabName} rewrite category to become active`, () => {
          const current = findTab()
          if (current?.classList.contains('active')) return true
          const currentView = currentOverlay()
          if (
            current &&
            current.getAttribute('aria-disabled') !== 'true' &&
            !currentView.querySelector('.tr-processing') &&
            Date.now() - lastClickAt >= 250
          ) {
            // A rewrite response can remount the tabs or briefly leave the
            // menu non-interactive. Re-resolve and retry the same player
            // click instead of waiting on the detached first button.
            click(current)
            lastClickAt = Date.now()
          }
          return null
        })
      }
      await waitForMeasuredDock()
      await rewindPages(currentOverlay(), 'Previous rule')
      for (let page = 0; page < 100; page += 1) {
        await waitForMeasuredDock()
        const resolvedName = this.resolveName(name)
        const rule = visible(currentOverlay().querySelectorAll<HTMLElement>(
          `[data-rule-label="${cssEscape(resolvedName)}"], [data-rule-label="${cssEscape(name)}"]`,
        ))[0]
        if (rule) return rule
        if (tabName === 'Hypotheses') {
          hypothesisFallback = visible(
            currentOverlay().querySelectorAll<HTMLElement>('[data-rule-label]'),
          ).at(-1) ?? hypothesisFallback
        }
        const next = currentOverlay().querySelector<HTMLButtonElement>('button[aria-label="Next rule"]')
        if (!next || next.disabled) break
        await clickPaginationAndWait(
          currentOverlay(),
          next,
          `${tabName} rewrite pagination to change`,
        )
      }
    }
    const resolvedName = this.resolveName(name)
    const reconciledName = this.latestRelationName()
    if (allowReconciledFallback && reconciledName && reconciledName !== resolvedName) {
      try {
        return await this.transformRule(reconciledName, false)
      } catch {
        // The rule menu can reconcile one frame after the proof snapshot.
        // Fall through to the last actual Hypotheses card observed above.
      }
    }
    if (allowReconciledFallback && hypothesisFallback) return hypothesisFallback
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
      const button = overlay.querySelector<HTMLButtonElement>(
        'button[aria-label^="Mode:"], button[title^="Mode:"]',
      )
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
        const selectedStreamBefore = selectedStreamSignature(this.win)
        const previousAttempts = playLog(this.win).length
        await session.finish(target)
        await waitForPlayAttempt(this.win, previousAttempts, `${rule.name} rewrite drag`)
        await waitForProofChange(this.win, before, `${rule.name} rewrite result`)
        await waitForSelectedStreamChange(
          this.win,
          selectedStreamBefore,
          `${rule.name} rewrite`,
        )
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
        const snapshot = harness(this.win).getCurrentStreamSnapshot()
        if (!goal.classList.contains('transformable') && snapshot.goalOptionTactics.length > 0) {
          // Lean can rewrite under an Or before choosing a branch, but the
          // player must first choose which disjunct to construct. Defer this
          // rewrite until that visible choice, then perform it on the selected
          // equality goal before the following classic command.
          // The player cannot rewrite underneath an unresolved Or card. Defer
          // only the goal half until a branch is selected; replaying the whole
          // `rw [...] at h ⊢` command would incorrectly rewrite h twice.
          this.pendingGoalRewrites.push(command.replace(/\s+at\s+.+$/u, ''))
          continue
        }
        if (goal.classList.contains('constructable') && goal.classList.contains('transformable')) {
          // The current UI deliberately opens Construction Mode, rather than
          // Transformation Mode, for a proposition such as a bare ≤ goal. A
          // player can make the same proof by choosing the witness first and
          // rewriting the resulting equality in normal Transformation Mode.
          // Preserve that established interaction model and translate the
          // classic proof order instead of requiring equality cards in the
          // Combining Mode tray.
          this.pendingPostConstructionGoalRewrites.push(command.replace(/\s+at\s+.+$/u, ''))
          continue
        }
        if (!goal.classList.contains('transformable') && this.implicitGoalRewriteTarget
          && this.hypExact(this.implicitGoalRewriteTarget)) {
          // A negated goal becomes `False` after its equality premise is
          // introduced. Consecutive unqualified `rw` steps continue acting on
          // that visible premise, exactly where the player made the first
          // rewrite, rather than trying to transform the inert `False` card.
          target = this.implicitGoalRewriteTarget
        } else if (!goal.classList.contains('transformable') && goal.classList.contains('clickable')) {
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
            .find(name => !beforeNames.has(name) && this.hypExact(name)?.classList.contains('transformable'))
          if (!introducedName) {
            throw new Error(`Rewriting under an implication did not introduce a transformable premise (${command})`)
          }
          this.rememberAlias('h', introducedName)
          this.implicitIntroAlreadyPerformed = true
          target = introducedName
          this.implicitGoalRewriteTarget = introducedName
        }
      } else if (!this.hypExact(target)) {
        await this.exposeDeferredInitialBinders(rawTarget)
        target = this.resolveName(rawTarget)
        const existingName = this.latestRelationName()
        if (!this.hypExact(target) && existingName) {
          // Clicking a ≤ proposition replaces it with a witness and equality.
          // Address that visible equality rather than clicking the unrelated
          // disjunction goal while trying to recover the former ≤ card.
          this.rememberAlias(rawTarget, existingName)
          target = existingName
        }
        // Induction/cases can move a dependent local hypothesis back into the
        // goal. Expose it through the same goal click a player must perform,
        // and then continue addressing its collision-safe displayed name.
        for (let attempt = 0; attempt < 4 && !this.hypExact(target); attempt += 1) {
          const goal = currentGoal(this.win)
          if (!goal?.classList.contains('clickable')) break
          const beforeNames = new Set(Object.keys(harness(this.win).getCurrentStreamSnapshot().hypTypes))
          await this.clickGoal()
          const actualName = Object.keys(harness(this.win).getCurrentStreamSnapshot().hypTypes)
            .find(name => !beforeNames.has(name))
          if (actualName) {
            this.rememberAlias(rawTarget, actualName)
            target = actualName
            this.implicitGoalRewriteTarget = actualName
          }
        }
      }
      if (target !== 'goal' && !this.hypExact(target)) {
        const replacementName = this.latestRelationName()
        if (replacementName) {
          this.rememberAlias(rawTarget, replacementName)
          target = replacementName
        }
      }
      if (target !== 'goal') {
        const snapshot = harness(this.win).getCurrentStreamSnapshot()
        if (!snapshot.hypTypes[target]) {
          const currentRelationName = this.latestRelationName()
          if (currentRelationName) {
            this.rememberAlias(rawTarget, currentRelationName)
            target = currentRelationName
          }
        }
      }
      if (target !== 'goal') {
        const targetCard = this.hypExact(target)
        if (
          targetCard?.classList.contains('constructable') &&
          !targetCard.classList.contains('transformable') &&
          parsed.rules.every(rule => /^(?:one_eq_succ_zero|two_eq_succ_one)$/u.test(sourceName(rule.name)))
        ) {
          // A ≤ hypothesis deliberately opens witness construction instead
          // of Transformation Mode. Numeral notation is definitionally equal,
          // so the following theorem-card application can consume this premise
          // without first rewriting `1`/`2`. Do not turn a requested rewrite
          // into the unrelated player action that expands the ≤ hypothesis.
          continue
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
      if (rawTarget !== 'goal') {
        const currentName = this.hypExact(target)?.dataset.hypName ?? this.latestRelationName()
        if (currentName) this.rememberAlias(rawTarget, currentName)
      }
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
    const selectedStreamBefore = selectedStreamSignature(this.win)
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
    await waitForSelectedStreamChange(
      this.win,
      selectedStreamBefore,
      `${description} construction`,
    )
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
    this.rememberAlias(expectedName, createdName)
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
    this.rememberAlias(expectedName, createdName)
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
    let lastRetry = Date.now()
    await waitFor('construction view', () => {
      const overlay = this.win.document.querySelector('.tr-construction-overlay')
      if (overlay) return overlay
      if (Date.now() - lastRetry >= 250) {
        lastRetry = Date.now()
        const current = currentGoal(this.win)
        if (current) doubleClick(current)
      }
      return null
    })
    await this.submitConstruction(parseConstructionExpr(match[1]), command)
    for (const pending of this.pendingPostConstructionGoalRewrites.splice(0)) {
      await this.rewrite(pending)
    }
  }

  /** Introduce exactly one leading forall by clicking the goal, returning the
   * collision-safe name that the player UI actually created. */
  async introduceOneForall() {
    const before = new Set(Object.keys(harness(this.win).getCurrentStreamSnapshot().hypTypes))
    await this.clickGoal()
    const introducedName = Object.keys(harness(this.win).getCurrentStreamSnapshot().hypTypes)
      .find(name => !before.has(name))
    if (!introducedName) throw new Error('Goal click did not introduce a visible forall variable')
    return introducedName
  }

  /** Introduce the declaration's original binders through goal clicks. NNG4
   * now presents these binders in the goal instead of pre-populating the
   * canvas, so the reference proof's first command must see the same context
   * that Lean's theorem body sees. */
  async prepareInitialBinders(expectedNames: string[], firstCommand = '') {
    // First expose the entire declaration context through the same successive
    // goal clicks a player makes. Mapping aliases while only a prefix is
    // visible is ambiguous: a visible `h` may be Lean's collision-safe name
    // for an earlier `ha`, while the declaration's real `h` is still in the
    // goal. That was causing later commands to target the wrong card.
    const generalizedInduction = /^induction\s+(\S+).+\bgeneralizing\s+/u.exec(firstCommand)
    const inductionTargetIndex = generalizedInduction
      ? expectedNames.indexOf(generalizedInduction[1])
      : -1
    if (inductionTargetIndex >= 0) {
      // Non-dependent assumptions can already be displayed while the natural
      // variables they depend on remain in the forall goal. Count only cards
      // introduced by these clicks; counting all cards mapped `a`/`b` onto
      // the pre-existing `ha`/`h` propositions and made induction a no-op.
      const initialNames = Object.keys(harness(this.win).getCurrentStreamSnapshot().hypTypes)
      const namesToIntroduce = expectedNames.slice(0, inductionTargetIndex + 1)
        .filter(name => !initialNames.includes(name))
      const introducedNames: string[] = []
      for (let attempt = 0; attempt < namesToIntroduce.length + 4; attempt += 1) {
        if (introducedNames.length >= namesToIntroduce.length) break
        const goal = currentGoal(this.win)
        if (!goal?.classList.contains('clickable')) break
        const beforeNames = new Set(Object.keys(harness(this.win).getCurrentStreamSnapshot().hypTypes))
        await this.clickGoal()
        const actualName = Object.keys(harness(this.win).getCurrentStreamSnapshot().hypTypes)
          .find(name => !beforeNames.has(name))
        if (actualName) introducedNames.push(actualName)
      }
      namesToIntroduce.forEach((expectedName, index) => {
        const actualName = introducedNames[index]
        if (actualName) this.rememberAlias(expectedName, actualName)
      })
      initialNames.filter(name => expectedNames.includes(name))
        .forEach(name => this.rememberAlias(name, name))
      // Induction re-generalizes the later dependent assumptions too, even if
      // they were visible before the split. Each new branch must introduce
      // c/ha/h again in declaration order before addressing one of them.
      this.deferredInitialBinderNames = expectedNames.slice(inductionTargetIndex + 1)
      for (const expectedName of expectedNames.slice(0, inductionTargetIndex + 1)) {
        if (this.hyp(expectedName)) continue
        throw new Error(`Generalized induction binder ${expectedName} is not visible: ${JSON.stringify({
          expectedNames,
          initialNames,
          introducedNames,
          aliases: [...this.aliases.entries()],
        })}`)
      }
      return
    }
    const desiredInitialCount = inductionTargetIndex >= 0
      ? inductionTargetIndex + 1
      : expectedNames.length
    this.deferredInitialBinderNames = expectedNames.slice(desiredInitialCount)
    for (let attempt = 0; attempt < desiredInitialCount + 4; attempt += 1) {
      const names = Object.keys(harness(this.win).getCurrentStreamSnapshot().hypTypes)
      if (names.length >= desiredInitialCount) break
      const goal = currentGoal(this.win)
      if (!goal?.classList.contains('clickable')) break
      await this.clickGoal()
      // The proof audit can settle a frame before the card list paints. Give
      // that normal reconciliation one player-sized beat before deciding
      // whether another declaration binder remains.
      await sleep(250)
    }
    const initialNames = Object.keys(harness(this.win).getCurrentStreamSnapshot().hypTypes)
    // Display-name collision handling is intentionally allowed to rename
    // declaration binders. When the complete declaration context is already
    // visible, associate it positionally with Lean's binder order instead of
    // trying to introduce a nonexistent extra binder by clicking the goal.
    // Once the complete context is visible, its hypothesis order is Lean's
    // declaration order. Use that order as the authority: an exact-looking
    // name can itself be a collision rename for an earlier binder (for
    // example expected `ha, h` displayed as `h, h1`).
    expectedNames.slice(0, desiredInitialCount).forEach((expectedName, index) => {
      const actualName = initialNames[index]
      if (actualName) this.rememberAlias(expectedName, actualName)
    })
    for (const expectedName of expectedNames.slice(0, desiredInitialCount)) {
      if (this.hyp(expectedName)) continue
      throw new Error(`Declaration binder ${expectedName} is not visible after player introductions: ${JSON.stringify({
        expectedNames,
        initialNames,
        aliases: [...this.aliases.entries()],
        audit: harness(this.win).getProofAudit(),
      })}`)
    }
  }

  /** Drag the induction tactic card onto a currently visible variable card. */
  async inductVisibleVariable(name: string) {
    await this.induction(`induction ${name} with d hd`)
  }

  /** Drag a named Combining Mode tactic onto the current goal. */
  async applyTacticToGoal(name: string) {
    await this.dragTactic(name, await waitFor('current goal', () => currentGoal(this.win)))
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
    const normalized = command.trim()
    if (
      this.pendingPostConstructionGoalRewrites.length > 0
      && !/^(?:(?:repeat\s+)?rw\s|nth_rewrite\s|use\s)/u.test(normalized)
    ) {
      throw new Error(
        `Constructable-goal rewrite must be followed by witness construction; ` +
        `pending=${JSON.stringify(this.pendingPostConstructionGoalRewrites)}, next=${command}`,
      )
    }
    // A generalized induction is only general if its later declaration
    // binders remain in the goal. Those binders are introduced and mapped by
    // the first later command that actually addresses one of them.
    if (this.deferredInitialBinderNames.length === 0) {
      await this.introduceLeadingForalls()
    }
    if (this.implicitIntroAlreadyPerformed) {
      this.implicitIntroAlreadyPerformed = false
      if (/^intro(?:\s+|$)/u.test(normalized)) return
    }
    if (this.classicCommandsAlreadyCovered > 0) {
      this.classicCommandsAlreadyCovered -= 1
      return
    }
    if (normalized === 'rfl') {
      // Closing transformation mode and painting its post-rewrite goal happen
      // in adjacent React commits. Always let clickGoal wait for the same
      // clickable card a player sees instead of sampling once and silently
      // skipping rfl during that render boundary.
      await this.clickGoal()
      // A preceding player action can already have discharged the reference
      // proof's reflexive branch. In that case there is no goal card to click;
      // treating the classic trailing `rfl` as covered avoids inventing an
      // extra interaction while the completed-state audit remains strict.
      return
    }
    if (/^intro(?:\s+|$)/u.test(normalized)) {
      const requestedNames = normalized.replace(/^intro\s*/u, '').trim().split(/\s+/u).filter(Boolean)
      const introductions = requestedNames.length > 0 ? requestedNames : ['h']
      for (const requestedName of introductions) {
        let actualName: string | undefined
        for (let attempt = 0; attempt < 3 && !actualName; attempt += 1) {
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
          actualName = afterNames.find(name => !beforeNames.has(name))
        }
        if (!actualName) throw new Error(`Intro ${requestedName} did not create a hypothesis card`)
        if (actualName) this.rememberAlias(requestedName, actualName)
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
    const repeatedApplication = /^repeat\s+apply\s+(.+?)\s+at\s+(\S+)$/u.exec(normalized)
    if (repeatedApplication) {
      const [, theoremApplication, targetName] = repeatedApplication
      const theoremName = sourceName(splitTopLevelWhitespace(theoremApplication)[0] ?? theoremApplication)
      let currentTargetName = this.resolveName(targetName)
      let applications = 0
      for (; applications < 32; applications += 1) {
        const source = await this.sourceCard(theoremName)
        const target = this.hypExact(currentTargetName)
        if (!target || !matchesTheoremPremise(source, target, [])) break
        await this.applyOrExact(`apply ${theoremApplication} at ${currentTargetName}`)
        // applyOrExact records the concrete card produced by the drag. Follow
        // that card on the next repetition instead of resolving the original
        // classic name again after React has reconciled the stream.
        currentTargetName = this.resolveName(currentTargetName)
      }
      if (applications === 0) {
        throw new Error(`${normalized} had no player-applicable premise`)
      }
      if (applications === 32) {
        throw new Error(`${normalized} exceeded the repeated player-application limit`)
      }
      this.rememberAlias(targetName, currentTargetName)
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
        : /^False$/u.test(harness(this.win).getCurrentStreamSnapshot().goalType.trim())
          && this.implicitGoalRewriteTarget
          && this.hypExact(this.implicitGoalRewriteTarget)
          ? this.hypExact(this.implicitGoalRewriteTarget)!
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
