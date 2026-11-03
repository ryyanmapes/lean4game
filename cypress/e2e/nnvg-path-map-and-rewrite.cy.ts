// The Natural Numbers Video Game (Lean4Game/NNVG) against the native dev relay:
// the path-style world map, the opening text level, and Rewrite-only levels
// played with rule-card clicks and the check mark.
const base = Cypress.env('LEAN4GAME_MOUNT') ?? ''
const MAP = `${base}/g/local/NNVG/visual`
const level = (world: string, n: number) => `${base}/g/local/NNVG/world/${world}/level/${n}/visual`
const LOAD_TIMEOUT = Number(Cypress.env('VISUAL_TIMEOUT') ?? 180000)

type HarnessWindow = Cypress.AUTWindow & {
  __visualTestHarness?: {
    rewriteGoalInTransform(theoremName: string, workingSide?: 'left' | 'right', path?: number[], isReverse?: boolean): Promise<void>
    dragHypToGoal(hypName: string): Promise<void>
    getProofAudit(): { completed: boolean; processing: boolean }
  }
}

function visit(url: string, options: { fresh?: boolean } = {}) {
  cy.visit(url, {
    onBeforeLoad(win) {
      if (options.fresh) win.localStorage.clear()
      win.localStorage.setItem('telemetryConsent', 'refused')
    },
  })
}

function mapLevel(world: string, n: number) {
  return cy.get(`[data-testid="path-map-level"][data-world="${world}"][data-level="${n}"]`, { timeout: LOAD_TIMEOUT })
}

/** The relation shown in Rewrite Mode, as its two sides print. */
function relationShouldBe(text: string) {
  cy.get('.tr-expr-wrapper', { timeout: LOAD_TIMEOUT }).should($row => {
    const sides = $row.children('[data-expr-text]').toArray().map(side => side.getAttribute('data-expr-text'))
    expect(sides.join(' = ')).to.equal(text)
  })
}

function lessonsShouldContain(text: string) {
  cy.get('[data-testid="rewrite-lessons"]', { timeout: LOAD_TIMEOUT }).should('contain.text', text)
}

function notProcessing() {
  cy.window({ timeout: LOAD_TIMEOUT }).should(win => {
    const harness = (win as HarnessWindow).__visualTestHarness
    expect(harness, 'visual test harness').to.exist
    expect(harness!.getProofAudit().processing).to.equal(false)
  })
}

function clickRule(label: string) {
  notProcessing()
  cy.get(`.tr-rule-card[data-rule-label="${label}"]`, { timeout: LOAD_TIMEOUT }).filter(':visible').first().click()
}

function check() {
  notProcessing()
  cy.get('[data-testid="rewrite-check"]', { timeout: LOAD_TIMEOUT }).should('be.visible').click()
  cy.get('[data-testid="rewrite-check"]', { timeout: LOAD_TIMEOUT }).should('have.class', 'completed')
}

function openRewriteLevel(n: number) {
  visit(level('Rewrite', n))
  expectRewriteOnlyLevel()
}

function expectRewriteOnlyLevel() {
  // Rewrite-only: the level opens in Rewrite Mode with no way back.
  cy.get('.tr-transformation-overlay', { timeout: LOAD_TIMEOUT }).should('be.visible')
  cy.get('.tr-rule-dock[data-layout-ready="true"]', { timeout: LOAD_TIMEOUT }).should('exist')
  cy.get('.tr-back-btn').should('not.exist')
}

describe('Natural Numbers Video Game', () => {
  beforeEach(() => {
    cy.intercept({ url: /\/v[12]\/(events|feedback)/u }, { statusCode: 204 })
  })

  it('opens on a path map where only the welcome text can be played', () => {
    visit(MAP, { fresh: true })
    cy.get('[data-testid="visual-path-map"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
    cy.get('[data-testid="path-map-world-label"]').then($labels => {
      expect([...$labels].map(label => label.textContent)).to.have.members(['Rewrite World', 'Proposition World'])
    })
    mapLevel('Intro', 1).should('have.attr', 'data-state', 'frontier').and('have.attr', 'data-text-level', 'true')
    mapLevel('Rewrite', 1).should('have.attr', 'data-state', 'locked')
    mapLevel('Proposition', 1).should('have.attr', 'data-state', 'locked')
    mapLevel('RewriteBonus', 1).should('have.attr', 'data-state', 'locked')
    cy.get('[data-segment="edge:Intro:Rewrite:in"]').should('have.attr', 'data-lit', 'false')

    // A text level opens over the map; closing it completes the level.
    mapLevel('Intro', 1).click()
    cy.get('[data-testid="text-level-dialog"]').should('contain.text', 'Welcome to the Natural Numbers Video Game!')
    cy.location('pathname').should('match', /\/g\/local\/NNVG\/visual$/u)
    cy.contains('button', 'Continue').click()
    cy.get('[data-testid="text-level-dialog"]').should('not.exist')
    mapLevel('Intro', 1).should('have.attr', 'data-state', 'completed')
    mapLevel('Rewrite', 1).should('have.attr', 'data-state', 'frontier')
    mapLevel('Proposition', 1).should('have.attr', 'data-state', 'frontier')
    mapLevel('Rewrite', 2).should('have.attr', 'data-state', 'locked')
    cy.get('[data-segment="edge:Intro:Rewrite:in"]').should('have.attr', 'data-lit', 'true')
    cy.get('[data-segment="edge:Intro:Proposition:in"]').should('have.attr', 'data-lit', 'true')
  })

  it('plays the first Rewrite World levels with clicks and the check mark', () => {
    // Progress is saved on a short delay, so move between levels the way a
    // player does (map, Next, Back to map) instead of reloading pages.
    visit(MAP, { fresh: true })
    mapLevel('Intro', 1).click()
    cy.contains('button', 'Continue').click()
    mapLevel('Rewrite', 1).should('have.attr', 'data-state', 'frontier').click()

    // Level 0: substitutions, then the check mark; no direction button yet.
    expectRewriteOnlyLevel()
    cy.get('.tr-direction-btn').should('not.exist')
    lessonsShouldContain('Drag a hypothesis onto a term')
    relationShouldBe('x + y = 1 + 2')
    cy.get('[data-testid="rewrite-check"]').should('not.exist')
    // Cards show Lean's `hypothesis_1` the way Visual Lean shows such names.
    clickRule('hypothesis1')
    relationShouldBe('1 + y = 1 + 2')
    clickRule('hypothesis2')
    relationShouldBe('1 + 2 = 1 + 2')
    lessonsShouldContain('check mark')
    check()
    cy.get('.visual-header.completed', { timeout: LOAD_TIMEOUT }).should('exist')

    // Level 1: many substitutions, each click rewriting its only match.
    cy.get('.visual-header-next-btn').filter(':visible').first().should('not.be.disabled').click()
    cy.location('pathname').should('contain', '/world/Rewrite/level/2/visual')
    expectRewriteOnlyLevel()
    lessonsShouldContain('many substitutions')
    relationShouldBe('0 = (a + b) + c')
    clickRule('hypothesis_a')
    clickRule('hypothesis_b')
    clickRule('hypothesis_c')
    relationShouldBe('0 = (0 + 0) + 0')
    clickRule('zero_add_zero')
    relationShouldBe('0 = 0 + 0')
    clickRule('zero_add_zero')
    relationShouldBe('0 = 0')
    check()

    // Level 2: the direction button rewrites backwards.
    cy.get('.visual-header-next-btn').filter(':visible').first().should('not.be.disabled').click()
    cy.location('pathname').should('contain', '/world/Rewrite/level/3/visual')
    expectRewriteOnlyLevel()
    lessonsShouldContain('forwards and backwards')
    cy.get('.tr-direction-btn').should('be.visible').click()
    clickRule('hypothesis_x')
    relationShouldBe('0 + y = 0')
    clickRule('hypothesis_y')
    relationShouldBe('0 + 0 = 0')
    cy.get('.tr-direction-btn').click()
    clickRule('zero_add_zero')
    relationShouldBe('0 = 0')
    check()

    // The bonus sprouts after level 2 without holding up level 3.
    cy.get('.visual-header-map-btn').filter(':visible').first().click()
    mapLevel('Rewrite', 3).should('have.attr', 'data-state', 'completed')
    mapLevel('Rewrite', 4).should('have.attr', 'data-state', 'frontier')
    mapLevel('RewriteBonus', 1).should('have.attr', 'data-state', 'frontier')
    cy.get('[data-segment="bonus:Rewrite:3:RewriteBonus"]').should('have.attr', 'data-lit', 'true')
  })

  it('uses a ∀ hypothesis as a rule anywhere it fits', () => {
    openRewriteLevel(4)
    cy.get('.tr-rule-card[data-rule-label="add_comm"] .tr-forall-footer.visual-forall-emphasize').should('exist')
    clickRule('hx')
    clickRule('hy')
    clickRule('hz')
    relationShouldBe('(1 + 2) + 3 = 3 + (2 + 1)')
    // A click rewrites the first match reading left to right: the whole side.
    clickRule('add_comm')
    relationShouldBe('3 + (1 + 2) = 3 + (2 + 1)')
    // Then swap the inner pair where it is.
    notProcessing()
    cy.window().then(win => (win as HarnessWindow).__visualTestHarness!.rewriteGoalInTransform('add_comm', 'left', [2]))
    relationShouldBe('3 + (2 + 1) = 3 + (2 + 1)')
    check()
  })

  it('plays Proposition World on the canvas', () => {
    visit(level('Proposition', 1))
    cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
    cy.contains('Goals can be proven by dragging over a proposition that matches it!').should('be.visible')
    notProcessing()
    cy.window().then(win => (win as HarnessWindow).__visualTestHarness!.dragHypToGoal('h'))
    cy.window({ timeout: LOAD_TIMEOUT }).should(win => {
      expect((win as HarnessWindow).__visualTestHarness!.getProofAudit().completed).to.equal(true)
    })
  })
})
