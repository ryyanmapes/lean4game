const LOAD_TIMEOUT = Number(Cypress.env('VISUAL_TIMEOUT') ?? 600_000)
const mountPath = Cypress.env('LEAN4GAME_MOUNT') ?? '/lean4game/index.html'
const leanIt = Cypress.env('SKIP_LEAN') ? it.skip : it
const mapIt = Cypress.env('SKIP_MAP') ? it.skip : it

type VisualHarness = {
  openGoalTransform(): void
}

type HarnessWindow = Cypress.AUTWindow & {
  __visualTestHarness?: VisualHarness
}

function rectsOverlap(left: DOMRect, right: DOMRect, gap = 0) {
  return !(
    left.right + gap <= right.left ||
    right.right + gap <= left.left ||
    left.bottom + gap <= right.top ||
    right.bottom + gap <= left.top
  )
}

function expectNoOverlap(subject: HTMLElement, obstacle: HTMLElement, label: string) {
  expect(
    rectsOverlap(subject.getBoundingClientRect(), obstacle.getBoundingClientRect(), 4),
    label,
  ).to.equal(false)
}

function openGoalTransformation(world: string, level: number) {
  cy.visit(`${mountPath}#/g/local/NNG4/world/${world}/level/${level}/visual`)
  cy.get('[data-testid="visual-proof-page"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
  cy.window().then(win => {
    const harness = (win as HarnessWindow).__visualTestHarness
    expect(harness, 'visual player test bridge').to.exist
    harness!.openGoalTransform()
  })
  cy.get('.visual-page.tr-transformation-overlay', { timeout: 60_000 }).should('be.visible')
}

describe('Visual Lean mobile layout', () => {
  beforeEach(() => {
    cy.viewport(390, 844)
  })

  mapIt('zooms and centers the first incomplete world while retaining two-axis panning', () => {
    cy.visit(`${mountPath}#/g/local/NNG4/visual`, {
      onBeforeLoad(win) {
        win.localStorage.clear()
        win.sessionStorage.clear()
      },
    })

    cy.get('[data-testid="visual-world-map"]', { timeout: 60_000 })
      .should('have.attr', 'data-focus-world', 'Tutorial')
      .then($map => {
        const map = $map[0]!
        const mapRect = map.getBoundingClientRect()
        const world = map.querySelector<SVGGraphicsElement>('[data-world-id="Tutorial"] .world-circle')!
        const worldRect = world.getBoundingClientRect()
        expect(worldRect.width, 'focused world is comfortably tappable').to.be.greaterThan(44)
        expect(worldRect.left + worldRect.width / 2, 'focused world is horizontally centered')
          .to.be.closeTo(mapRect.left + mapRect.width / 2, 12)
        const verticalMetrics = JSON.stringify({
          paddingTop: getComputedStyle(map).paddingTop,
          scrollTop: map.scrollTop,
          scrollHeight: map.scrollHeight,
          clientHeight: map.clientHeight,
        })
        expect(worldRect.top + worldRect.height / 2, `focused world is vertically centered: ${verticalMetrics}`)
          .to.be.closeTo(mapRect.top + mapRect.height / 2, 18)
        expect(map.scrollWidth, 'map can pan horizontally').to.be.greaterThan(map.clientWidth)
        expect(map.scrollHeight, 'map can pan vertically').to.be.greaterThan(map.clientHeight)
      })
  })

  mapIt('centers the world most recently visited when returning to the map', () => {
    cy.visit(`${mountPath}#/g/local/NNG4/visual`, {
      onBeforeLoad(win) {
        win.sessionStorage.setItem('visual-map-focus:g/local/NNG4', 'Addition')
      },
    })
    cy.get('[data-testid="visual-world-map"]', { timeout: 60_000 })
      .should('have.attr', 'data-focus-world', 'Addition')
      .then($map => {
        const mapRect = $map[0]!.getBoundingClientRect()
        const worldRect = $map[0]!
          .querySelector<SVGGraphicsElement>('[data-world-id="Addition"] .world-circle')!
          .getBoundingClientRect()
        expect(worldRect.left + worldRect.width / 2).to.be.closeTo(mapRect.left + mapRect.width / 2, 12)
        expect(worldRect.top + worldRect.height / 2).to.be.closeTo(mapRect.top + mapRect.height / 2, 18)
      })
  })

  leanIt('keeps the Tutorial 2 rewrite guide clear of mobile controls and the theorem tray', () => {
    openGoalTransformation('Tutorial', 2)
    cy.get('.tr-swap-btn').click()
    cy.get('.transform-info.rewrite-info', { timeout: 60_000 }).should('exist')
    cy.get('body').should($body => {
      // Cypress's visibility heuristic treats this fixed, pointer-events-none
      // guide as covered by its own main-area ancestor even while it is
      // visibly painted.  Assert its geometry directly instead.
      const info = $body.find('.transform-info.rewrite-info').get(0)
      const expression = $body.find('.tr-expr-wrapper:visible').get(0)
      const undo = $body.find('.tr-transformation-overlay .tr-controls .tr-ctrl-btn:visible').get(0)
      const dock = $body.find('.tr-rule-dock:visible').get(0)
      const arrowPath = $body.find('.visual-instruction-arrow path').attr('d') ?? ''
      expect(info, 'rewrite guide callout').to.exist
      expect(expression, 'working expression').to.exist
      expect(dock, 'theorem tray').to.exist
      expectNoOverlap(info!, expression!, 'rewrite guide does not cover the expression')
      if (undo) expectNoOverlap(info!, undo, 'tactic guide does not cover undo')
      expectNoOverlap(info!, dock!, 'tactic guide does not cover theorem tray')
      expect(arrowPath, 'phone guide uses a straight path').to.match(/\bL\b/)
      expect(arrowPath, 'phone guide avoids an oversized curve').not.to.match(/\bC\b/)
    })
  })

  leanIt('keeps the Tutorial 3 reverse-direction callout clear of both controls', () => {
    openGoalTransformation('Tutorial', 3)
    cy.get('.transform-info.reverse-info').should('be.visible')
    cy.get('body').should($body => {
      const info = $body.find('.transform-info.reverse-info:visible').get(0)
      const expression = $body.find('.tr-expr-wrapper:visible').get(0)
      const undo = $body.find('.tr-transformation-overlay .tr-controls .tr-ctrl-btn:visible').get(0)
      const reverse = $body.find('.tr-transformation-overlay .tr-side-controls .tr-ctrl-btn:visible').get(0)
      expect(info, 'reverse-direction callout').to.exist
      expect(expression, 'working expression').to.exist
      expectNoOverlap(info!, expression!, 'reverse-direction callout does not cover the expression')
      expectNoOverlap(info!, undo!, 'reverse-direction callout does not cover undo')
      expectNoOverlap(info!, reverse!, 'reverse-direction callout does not cover reverse')
    })
  })
})
