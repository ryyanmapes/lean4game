import { CompletePlaythroughDriver } from '../support/completePlaythroughDriver'

const LOAD_TIMEOUT = Number(Cypress.env('VISUAL_TIMEOUT') ?? 600_000)
const mountPath = Cypress.env('LEAN4GAME_MOUNT') ?? '/lean4game/index.html'

// In-app browsers (X, Instagram, Messenger, ...) open links in a sheet under
// their own toolbar, so a phone-width page gets far less height than in
// Safari, and the embedder's toolbar floats over its bottom edge.
const EMBEDDED_VIEWPORTS = [
  // Measured from a player's screenshots of X's in-app browser on a 6.1"
  // iPhone: the page runs from below the status bar to the top of the post
  // sheet.
  { name: 'X in-app browser on a 6.1" iPhone', width: 393, height: 536 },
  { name: 'narrow Android in-app browser', width: 360, height: 560 },
]

// How long a hint may take to settle into place once it has appeared.
const LAYOUT_TIMEOUT = 10_000

// How far a dock tab's label stays above the bottom of the page, clear of an
// embedder's toolbar drawn over that edge.
const TAB_LABEL_CLEARANCE = 24

type Box = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom' | 'width' | 'height'>

type HarnessWindow = Cypress.AUTWindow & {
  __visualTestHarness?: { getProofAudit(): { processing: boolean } }
}

function overlaps(a: Box, b: Box, gap = 0) {
  return !(
    a.right + gap <= b.left
    || b.right + gap <= a.left
    || a.bottom + gap <= b.top
    || b.bottom + gap <= a.top
  )
}

/** The part of `element` its scrolling or clipping ancestors leave on screen. */
function visibleBox(element: HTMLElement): Box {
  const win = element.ownerDocument.defaultView!
  let { left, right, top, bottom } = element.getBoundingClientRect()
  left = Math.max(left, 0)
  top = Math.max(top, 0)
  right = Math.min(right, win.innerWidth)
  bottom = Math.min(bottom, win.innerHeight)
  // A fixed callout escapes its ancestors' overflow; anything else is cut
  // off where they stop.
  if (win.getComputedStyle(element).position !== 'fixed') {
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = win.getComputedStyle(ancestor)
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue
      const clip = ancestor.getBoundingClientRect()
      left = Math.max(left, clip.left)
      right = Math.min(right, clip.right)
      top = Math.max(top, clip.top)
      bottom = Math.min(bottom, clip.bottom)
      if (style.position === 'fixed') break
    }
  }
  return { left, right, top, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}

/** How many lines the callout's text wraps onto. */
function renderedLines(element: HTMLElement) {
  const range = element.ownerDocument.createRange()
  range.selectNodeContents(element)
  const lineHeight = parseFloat(getComputedStyle(element).lineHeight) || 16
  const tops = Array.from(range.getClientRects())
    .filter(rect => rect.width > 0 && rect.height > 0)
    .map(rect => rect.top)
    .sort((a, b) => a - b)
  let lines = 0
  let lineTop = -Infinity
  for (const top of tops) {
    if (top >= lineTop + lineHeight * 0.6) {
      lines += 1
      lineTop = top
    }
  }
  return lines
}

function visibleElements(doc: Document, selector: string) {
  return Array.from(doc.querySelectorAll<Element>(selector)).filter(element => {
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
  })
}

function boxSummary(box: Box) {
  return JSON.stringify([box.left, box.top, box.right, box.bottom].map(Math.round))
}

const touch = (type: 'touchStart' | 'touchEnd', touchPoints: { x: number; y: number }[]) =>
  Cypress.automation('remote:debugger:protocol', { command: 'Input.dispatchTouchEvent', params: { type, touchPoints } })

/** A finger's tap in the middle of `selector`, as trusted touch input. */
function tap(selector: string) {
  let point = { x: 0, y: 0 }
  cy.get(selector).should($element => {
    // DevTools input lands on the Cypress runner's page, where the game is a
    // scaled iframe. Wait until both pages agree the target is at that point:
    // the runner briefly rearranges itself around a screenshot.
    const element = $element[0]!
    const rect = element.getBoundingClientRect()
    const centre = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    const frame = window.top!.document.querySelector<HTMLIFrameElement>('iframe.aut-iframe')!
    const frameRect = frame.getBoundingClientRect()
    const scale = frameRect.width / frame.clientWidth
    point = { x: frameRect.left + centre.x * scale, y: frameRect.top + centre.y * scale }
    expect(window.top!.document.elementFromPoint(point.x, point.y), 'the game is under the finger').to.equal(frame)
    expect(element.contains(element.ownerDocument.elementFromPoint(centre.x, centre.y)), `${selector} is under the finger`)
      .to.equal(true)
  }).then(() => touch('touchStart', [point]).then(() => touch('touchEnd', [])))
}

/** A tapped control keeps no keyboard-focus ring. */
function expectNoFocusRing() {
  cy.document().should(doc => {
    const focused = doc.activeElement
    expect(focused?.matches(':focus-visible') ?? false, `${focused?.className || 'the page'} shows no focus ring`)
      .to.equal(false)
  })
}

/** The working expression stays clear of the boxes around it. */
function expectExpressionClear() {
  cy.get('.tr-transformation-overlay .tr-expr-wrapper', { timeout: LAYOUT_TIMEOUT }).should($expression => {
    const expression = $expression.get(0)!
    const rect = expression.getBoundingClientRect()
    for (const selector of [
      '.tr-static-group',
      '.tr-back-btn',
      '.tr-ctrl-btn',
      '.transform-info',
      '.tr-rule-dock',
    ]) {
      for (const box of visibleElements(expression.ownerDocument, `.tr-transformation-overlay ${selector}`)) {
        const boxRect = box.getBoundingClientRect()
        expect(
          overlaps(rect, boxRect),
          `the expression at ${boxSummary(rect)} stays clear of ${selector} at ${boxSummary(boxRect)}`,
        ).to.equal(false)
      }
    }
  })
}

/** A lesson's guide arrow ends near `targetSelector`, its head pointing at it. */
function expectArrowPointsAt(targetSelector: string) {
  cy.get('.tr-transformation-overlay', { timeout: LAYOUT_TIMEOUT }).should($overlay => {
    const doc = $overlay.get(0)!.ownerDocument
    const target = visibleElements(doc, `.tr-transformation-overlay ${targetSelector}`)
      .map(element => element.getBoundingClientRect())
      .sort((a, b) => a.width * a.height - b.width * b.height)[0]
    expect(target, `arrow target ${targetSelector}`).to.exist
    const centre = { x: target!.left + target!.width / 2, y: target!.top + target!.height / 2 }
    const distanceTo = (point: { x: number; y: number }) => Math.hypot(
      Math.max(target!.left - point.x, 0, point.x - target!.right),
      Math.max(target!.top - point.y, 0, point.y - target!.bottom),
    )
    const heads = visibleElements(doc, '.tr-transformation-overlay .visual-instruction-arrow polygon').map(head => {
      const [tip, left, right] = String(head.getAttribute('points')).split(' ')
        .map(point => point.split(',').map(Number)).map(([x, y]) => ({ x: x!, y: y! }))
      return { tip: tip!, base: { x: (left!.x + right!.x) / 2, y: (left!.y + right!.y) / 2 } }
    })
    expect(heads.length, 'guide arrows').to.be.greaterThan(0)
    const { tip, base } = heads.sort((a, b) => distanceTo(a.tip) - distanceTo(b.tip))[0]!
    const summary = JSON.stringify({ tip, base, target: boxSummary(target!) })
    expect(distanceTo(tip), `the arrow ends near ${targetSelector}: ${summary}`).to.be.at.most(72)
    if (distanceTo(tip) > 0) {
      const heading = { x: tip.x - base.x, y: tip.y - base.y }
      const toTarget = { x: centre.x - tip.x, y: centre.y - tip.y }
      const cosine = (heading.x * toTarget.x + heading.y * toTarget.y)
        / (Math.hypot(heading.x, heading.y) * Math.hypot(toTarget.x, toTarget.y))
      expect(cosine, `the arrow points at ${targetSelector}: ${summary}`).to.be.at.least(0.8)
    }
  })
}

/**
 * Wait for the hint saying `text`, then check a player can read all of it:
 * nothing paints over it, nothing cuts it off, and it is not squeezed into a
 * narrow column.
 */
function expectReadableHint(
  selector: string,
  text: string,
  obstacleSelectors: string[],
  { maxLines = 3, scrolls = false } = {},
) {
  cy.contains(selector, text, { timeout: LOAD_TIMEOUT }).should('exist')
  // Hints in the card list scroll with it: the player brings them into view.
  if (scrolls) cy.contains(selector, text).scrollIntoView()
  cy.contains(selector, text, { timeout: LAYOUT_TIMEOUT }).should($hint => {
    const hint = $hint.get(0)!
    const doc = hint.ownerDocument
    const win = doc.defaultView!
    const rect = hint.getBoundingClientRect()
    const shown = visibleBox(hint)
    const summary = JSON.stringify({
      text,
      viewport: [win.innerWidth, win.innerHeight],
      rect: [rect.left, rect.top, rect.right, rect.bottom].map(Math.round),
      visible: [shown.left, shown.top, shown.right, shown.bottom].map(Math.round),
    })
    expect(shown.width, `"${text}" is shown at its full width: ${summary}`).to.be.closeTo(rect.width, 1)
    expect(shown.height, `"${text}" is shown at its full height: ${summary}`).to.be.closeTo(rect.height, 1)
    expect(hint.scrollHeight, `"${text}" needs no scrolling`).to.be.at.most(hint.clientHeight + 1)
    const style = win.getComputedStyle(hint)
    const scrollbarWidth = hint.offsetWidth - hint.clientWidth
      - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth)
    expect(scrollbarWidth, `"${text}" shows no scrollbar`).to.be.below(2)
    for (const obstacleSelector of obstacleSelectors) {
      for (const obstacle of visibleElements(doc, obstacleSelector)) {
        if (obstacle.contains(hint) || hint.contains(obstacle)) continue
        const box = obstacle.getBoundingClientRect()
        expect(
          overlaps(rect, box),
          `"${text}" stays clear of ${obstacleSelector} at ${boxSummary(box)}: ${summary}`,
        ).to.equal(false)
      }
    }
    expect(renderedLines(hint), `"${text}" wraps onto at most ${maxLines} lines: ${summary}`)
      .to.be.at.most(maxLines)
  })
}

/** The bottom row of dock tabs keeps its labels clear of a toolbar drawn over the page's bottom edge. */
function expectTabsClearOfBottomEdge() {
  cy.get('.tr-dock-tabs:last-child .tr-tab-btn:visible', { timeout: LAYOUT_TIMEOUT }).should($tabs => {
    expect($tabs.length, 'dock tabs').to.be.greaterThan(0)
    $tabs.each((_, tab) => {
      const range = tab.ownerDocument.createRange()
      range.selectNodeContents(tab)
      const label = range.getBoundingClientRect()
      const pageBottom = tab.ownerDocument.defaultView!.innerHeight
      expect(pageBottom - label.bottom, `space below the "${tab.textContent}" tab label`)
        .to.be.at.least(TAB_LABEL_CLEARANCE)
    })
  })
}

function waitForIdle() {
  cy.window({ timeout: LOAD_TIMEOUT }).should(win => {
    const harness = (win as HarnessWindow).__visualTestHarness
    expect(harness, 'visual player test bridge').to.exist
    expect(harness!.getProofAudit().processing, 'Lean is idle').to.equal(false)
  })
}

function visitLevel(world: string, level: number) {
  cy.visit(`${mountPath}#/g/local/NNG4/world/${world}/level/${level}/visual`)
  cy.get('[data-testid="visual-proof-page"]', { timeout: LOAD_TIMEOUT })
    .should('have.attr', 'data-level-id', String(level))
  cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
  waitForIdle()
}

const COMBINING_OBSTACLES = [
  '.visual-header',
  '.tr-controls .tr-ctrl-btn',
  '.theorem-tray-panel',
  '.mobile-page-links',
]

const TRANSFORMATION_OBSTACLES = [
  '.visual-header',
  '.tr-back-btn',
  '.tr-static-group',
  '.tr-expr-wrapper',
  '.tr-controls .tr-ctrl-btn',
  '.tr-side-controls .tr-ctrl-btn',
  '.tr-rule-dock',
]

describe('Visual Lean lessons in a phone in-app browser', () => {
  // Touch emulation makes the primary pointer coarse with no hover, so the
  // lessons are worded for a finger, as on the phone.
  const setTouchInput = (enabled: boolean) => Cypress.automation('remote:debugger:protocol', {
    command: 'Emulation.setTouchEmulationEnabled',
    params: enabled ? { enabled, maxTouchPoints: 5 } : { enabled },
  })

  beforeEach(() => {
    cy.on('uncaught:exception', () => false)
    cy.clearLocalStorage()
    cy.then(() => setTouchInput(true))
  })

  afterEach(() => {
    cy.then(() => setTouchInput(false))
  })

  for (const viewport of EMBEDDED_VIEWPORTS) {
    describe(`${viewport.name} (${viewport.width}×${viewport.height})`, () => {
      beforeEach(() => {
        cy.viewport(viewport.width, viewport.height)
      })

      it('keeps every Tutorial 2 lesson readable through a rewrite', () => {
        visitLevel('Tutorial', 2)
        expectReadableHint(
          '.goal-info',
          'Double-tap the goal equality to enter Rewrite Mode.',
          COMBINING_OBSTACLES,
        )

        cy.get('[data-testid="goal-card"]').dblclick()
        cy.get('.tr-transformation-overlay', { timeout: 60_000 }).should('be.visible')
        cy.get('.tr-rule-dock[data-layout-ready="true"]', { timeout: 60_000 }).should('exist')
        expectReadableHint(
          '.transform-info',
          'Tap this arrow to edit the left-hand side of the goal equality.',
          TRANSFORMATION_OBSTACLES,
        )
        expectArrowPointsAt('.tr-swap-btn')
        expectExpressionClear()
        expectTabsClearOfBottomEdge()

        tap('.tr-swap-btn')
        expectReadableHint('.transform-info', 'to plug in', TRANSFORMATION_OBSTACLES)
        expectArrowPointsAt('.tr-main-area [data-expr-text="y"]')
        expectExpressionClear()
        expectNoFocusRing()

        cy.window().then(win => new CompletePlaythroughDriver(win).performRewriteOnSide('rw [h]', 'left', true))
        waitForIdle()
        expectReadableHint(
          '.transform-info',
          "Return to Combining Mode with the 'back' button.",
          TRANSFORMATION_OBSTACLES,
        )
        expectArrowPointsAt('.tr-back-btn')
        expectExpressionClear()
        expectTabsClearOfBottomEdge()

        tap('.tr-back-btn')
        cy.get('.tr-transformation-overlay').should('not.exist')
        expectReadableHint(
          '.goal-info',
          "Tap once to apply 'rfl' just like before.",
          COMBINING_OBSTACLES,
        )
      })

      it('keeps the hypothesis and rewriting-direction lessons readable', () => {
        visitLevel('Tutorial', 2)
        cy.get('[data-testid="hyp-card"][data-hyp-name="h"]').dblclick()
        cy.get('.tr-transformation-overlay', { timeout: 60_000 }).should('be.visible')
        expectReadableHint(
          '.transform-info',
          'Tap back to rewrite the goal equality instead of a hypothesis.',
          TRANSFORMATION_OBSTACLES,
        )
        expectArrowPointsAt('.tr-back-btn')
        expectExpressionClear()

        visitLevel('Tutorial', 3)
        cy.get('[data-testid="goal-card"]').dblclick()
        cy.get('.tr-transformation-overlay', { timeout: 60_000 }).should('be.visible')
        expectReadableHint(
          '.transform-info.reverse-info',
          'Swap the rewriting direction by tapping this button.',
          TRANSFORMATION_OBSTACLES,
          { maxLines: 4 },
        )
        expectArrowPointsAt('.tr-direction-btn')
        expectExpressionClear()
        expectTabsClearOfBottomEdge()
      })

      it('keeps Combining Mode lessons readable above the controls and theorem tray', () => {
        visitLevel('Tutorial', 1)
        expectReadableHint(
          '.goal-info',
          "Tap goals of this form to satisfy them with 'rfl'.",
          COMBINING_OBSTACLES,
        )

        visitLevel('Implication', 1)
        expectReadableHint(
          '.visual-info-callout',
          'exactly matches the goal',
          COMBINING_OBSTACLES,
          { scrolls: true },
        )

        visitLevel('Addition', 1)
        expectReadableHint(
          '.visual-info-callout',
          'Drag the induction tactic',
          COMBINING_OBSTACLES,
          { maxLines: 5, scrolls: true },
        )

        // Two rows of tabs under the theorems leave the least room above them.
        visitLevel('LessOrEqual', 1)
        expectReadableHint(
          '.goal-info',
          'Tap there-exists goals to enter Construction Mode.',
          COMBINING_OBSTACLES,
        )
        expectTabsClearOfBottomEdge()
      })
    })
  }
})
