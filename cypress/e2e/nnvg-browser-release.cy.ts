// The Natural Numbers Video Game in the browser release: its own module bundle
// in the shared Lean WebAssembly runtime (scripts/retarget-nnvg-browser-runtime.mjs),
// served at /g/local/NNVG/visual but not linked from the landing page. This checks
// what only the packaged runtime can get wrong: the bundle loads, numerals and the
// game's own axioms elaborate, and a player's `induction` and `cases` reach NNVG's
// macros. Gameplay itself is covered by nnvg-path-map-and-rewrite.cy.ts.
const MAP = '/g/local/NNVG/visual'
const level = (world: string, n: number) => `/g/local/NNVG/world/${world}/level/${n}/visual`
const LOAD_TIMEOUT = Number(Cypress.env('VISUAL_TIMEOUT') ?? 600000)

type HarnessWindow = Cypress.AUTWindow & {
  __visualTestHarness?: {
    dragTacticToHyp(tacticName: string, hypName: string): Promise<void>
    clickGoal(playTactic?: string): Promise<void>
    getCurrentStreamSnapshot(): { goalType: string }
    getProofAudit(): { completed: boolean; processing: boolean }
  }
}

function visit(url: string) {
  cy.visit(url, {
    onBeforeLoad(win) {
      win.localStorage.clear()
      win.localStorage.setItem('telemetryConsent', 'refused')
    },
  })
}

function notProcessing() {
  cy.window({ timeout: LOAD_TIMEOUT }).should(win => {
    const harness = (win as HarnessWindow).__visualTestHarness
    expect(harness, 'visual test harness').to.exist
    expect(harness!.getProofAudit().processing).to.equal(false)
  })
}

function harness(run: (harness: NonNullable<HarnessWindow['__visualTestHarness']>) => unknown) {
  notProcessing()
  cy.window().then(win => run((win as HarnessWindow).__visualTestHarness!))
}

function goalShouldBe(text: string) {
  cy.window({ timeout: LOAD_TIMEOUT }).should(win => {
    const current = (win as HarnessWindow).__visualTestHarness!
    expect(current?.getProofAudit().processing).to.equal(false)
    expect(current.getCurrentStreamSnapshot().goalType).to.equal(text)
  })
}

function relationShouldBe(text: string) {
  cy.get('.tr-expr-wrapper', { timeout: LOAD_TIMEOUT }).should($row => {
    const sides = $row.children('[data-expr-text]').toArray().map(side => side.getAttribute('data-expr-text'))
    expect(sides.join(' = ')).to.equal(text)
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

function enterRewriteMode() {
  notProcessing()
  cy.get('[data-testid="goal-card"]').filter(':visible').first().dblclick()
  cy.get('.tr-transformation-overlay', { timeout: LOAD_TIMEOUT }).should('be.visible')
  cy.get('.tr-rule-dock[data-layout-ready="true"]', { timeout: LOAD_TIMEOUT }).should('exist')
}

describe('The Natural Numbers Video Game in the browser release', () => {
  it('is served at its own path, and not linked from the landing page', () => {
    cy.request('/lean4game/data/g/local/NNVG/game.json').its('body.title').should('equal', 'Natural Numbers Video Game')
    cy.request('/').its('body').should('not.contain', 'NNVG')
    visit(MAP)
    cy.get('[data-testid="path-map-level"][data-world="Intro"][data-level="1"]', { timeout: LOAD_TIMEOUT })
      .should('exist')
  })

  it('checks a Rewrite World level with the game’s own Lean modules', () => {
    // Only NNVG's bundle has NNVG.Browser.Runtime, so a level that loads and
    // checks here was compiled against it. (Spying on the 70 MB bundle request
    // with cy.intercept stalls the run.)
    visit(level('Rewrite', 1))
    cy.get('.tr-transformation-overlay', { timeout: LOAD_TIMEOUT }).should('be.visible')
    cy.get('.tr-rule-dock[data-layout-ready="true"]', { timeout: LOAD_TIMEOUT }).should('exist')
    relationShouldBe('x + y = 1 + 2')
    clickRule('hypothesis1')
    relationShouldBe('1 + y = 1 + 2')
    clickRule('hypothesis2')
    relationShouldBe('1 + 2 = 1 + 2')
    check()
    cy.get('.visual-header.completed', { timeout: LOAD_TIMEOUT }).should('exist')
  })

  it('proves zero_add with a player’s induction', () => {
    visit(level('Induction', 1))
    cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
    goalShouldBe('∀ (n : ℕ), 0 + n = n')
    harness(h => h.clickGoal())
    goalShouldBe('0 + n = n')
    harness(h => h.dragTacticToHyp('induction', 'n'))
    goalShouldBe('0 + 0 = 0')
    enterRewriteMode()
    clickRule('add_zero')
    relationShouldBe('0 = 0')
    check()
    cy.get('.tr-transformation-overlay', { timeout: LOAD_TIMEOUT }).should('not.exist')

    notProcessing()
    cy.get('[data-testid^="stream-nav-"].toward-incomplete:not(:disabled)', { timeout: LOAD_TIMEOUT })
      .filter(':visible').first().click()
    goalShouldBe('0 + S d = S d')
    enterRewriteMode()
    clickRule('add_succ')
    relationShouldBe('S(0 + d) = S(d)')
    clickRule('hd')
    relationShouldBe('S(d) = S(d)')
    check()
    cy.window({ timeout: LOAD_TIMEOUT }).should(win => {
      expect((win as HarnessWindow).__visualTestHarness!.getProofAudit().completed).to.equal(true)
    })
  })

  it('splits a number with a player’s cases', () => {
    visit(level('AdvAddition', 5))
    cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
    goalShouldBe('a + b = 0 → a = 0')
    harness(h => h.dragTacticToHyp('cases', 'b'))
    goalShouldBe('a + 0 = 0 → a = 0')
  })
})
