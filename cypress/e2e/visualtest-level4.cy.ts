const VISUALTEST_LEVEL4 = '/#/g/local/VisualTest/world/Prototype/level/4/visual'
const VISUALTEST_LOAD_TIMEOUT = 120000

interface VisualTestHarness {
  clickGoal(playTactic?: string): Promise<void>
  openGoalTransform(): void
}

type VisualHarnessWindow = Cypress.AUTWindow & {
  __visualTestHarness?: VisualTestHarness
}

function visualHarness() {
  return cy.window({ timeout: 60000 }).then(win => {
    const harness = (win as VisualHarnessWindow).__visualTestHarness
    expect(harness).to.exist
    return harness as VisualTestHarness
  })
}

describe('VisualTest Level 4', () => {
  beforeEach(() => {
    cy.on('uncaught:exception', () => false)
    cy.viewport(1600, 1200)
    cy.clearCookies()
    cy.clearLocalStorage()
    cy.visit(VISUALTEST_LEVEL4)
    cy.get('[data-testid="visual-proof-page"]', { timeout: VISUALTEST_LOAD_TIMEOUT }).should('be.visible')
    cy.get('[data-testid="goal-card"]', { timeout: VISUALTEST_LOAD_TIMEOUT }).should('be.visible')
  })

  it('shows rewrite theorems in transformation mode after introducing the equality hypothesis', () => {
    visualHarness().then(harness => harness.clickGoal())

    cy.get('[data-testid="hyp-card"]', { timeout: 60000 })
      .should($cards => {
        expect($cards.length).to.be.at.least(1)
        const hypTypes = Array.from($cards).map(card => (card as HTMLElement).dataset.hypType ?? '')
        expect(hypTypes.some(type => type.includes('x') && type.includes('y + 1'))).to.equal(true)
      })

    visualHarness().then(harness => harness.openGoalTransform())

    cy.get('.tr-back-btn', { timeout: 60000 }).should('be.visible')
    cy.get('.tr-rule-card h3', { timeout: 60000 }).should($headers => {
      const labels = Array.from($headers).map(header => header.textContent?.trim() ?? '')
      expect(labels).to.include('h')
      expect(labels).to.include('mul_one')
      expect(labels).to.include('mul_add')
      expect(labels).to.include('add_comm')
      expect(labels).to.include('mul_comm')
    })
    cy.get('.tr-no-rules').should('not.exist')
  })
})
