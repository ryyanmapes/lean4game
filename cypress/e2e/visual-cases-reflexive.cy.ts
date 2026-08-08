const LOAD_TIMEOUT = Number(Cypress.env('VISUAL_TIMEOUT') ?? 600_000)
const mountPath = Cypress.env('LEAN4GAME_MOUNT') ?? '/lean4game/index.html'

interface VisualHarness {
  runPlayerTactic(command: string): Promise<void>
  getProofAudit(): {
    processing: boolean
    proofBody: string
    coreProofBody: string
  }
}

type HarnessWindow = Cypress.AUTWindow & { __visualTestHarness?: VisualHarness }

function harness() {
  return cy.window({ timeout: LOAD_TIMEOUT }).should(win => {
    expect((win as HarnessWindow).__visualTestHarness, 'visual player test bridge').to.exist
  }).then(win => (win as HarnessWindow).__visualTestHarness!)
}

describe('Visual cases reflexive branch', () => {
  it('records rfl and completes the selected zero branch when the goal is tapped', () => {
    cy.viewport(390, 844)
    cy.visit(`${mountPath}#/g/local/NNG4/world/LessOrEqual/level/10/visual`, {
      onBeforeLoad(win) {
        win.localStorage.clear()
        win.sessionStorage.clear()
      },
    })
    cy.get('[data-testid="visual-proof-page"]', { timeout: LOAD_TIMEOUT }).should('be.visible')

    harness().then(bridge => bridge.runPlayerTactic('cases x with y'))
    cy.get('[data-testid="goal-card"]').click()
    cy.get('[data-testid="goal-choice-option"][data-play-tactic="click_goal_left"]', { timeout: 60_000 })
      .click()
    cy.get('[data-testid="goal-card"][data-goal-text="0 = 0"]', { timeout: 60_000 })
      .should('have.class', 'clickable')
      .click()

    cy.window({ timeout: 60_000 }).should(win => {
      const audit = (win as HarnessWindow).__visualTestHarness?.getProofAudit()
      expect(audit?.processing, 'goal interaction completed').to.equal(false)
      expect(audit?.proofBody.trim().split(/\r?\n/u), 'replayable player script').to.deep.equal([
        'cases x with y',
        'click_goal_left',
        'rfl',
      ])
      expect(audit?.coreProofBody.trim().split(/\r?\n/u), 'displayed core proof').to.deep.equal([
        'cases x with y',
        'left',
        'rfl',
      ])
    })
    cy.get('[data-testid="goal-card"][data-goal-text="0 = 0"]')
      .should('have.class', 'solved')
    cy.get('[data-testid="stream-nav-next"]').should('have.class', 'toward-incomplete')
  })
})
