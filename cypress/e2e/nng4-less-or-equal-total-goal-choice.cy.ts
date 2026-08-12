const LOAD_TIMEOUT = Number(Cypress.env('VISUAL_TIMEOUT') ?? 600_000)
const mountPath = Cypress.env('LEAN4GAME_MOUNT') ?? '/lean4game/index.html'

interface VisualHarness {
  runPlayerTactic(command: string): Promise<void>
  getProofAudit(): {
    processing: boolean
    coreLines: string[]
    interactiveLines: string[]
  }
}

type HarnessWindow = Cypress.AUTWindow & { __visualTestHarness?: VisualHarness }

function run(command: string) {
  cy.window({ timeout: LOAD_TIMEOUT }).then(win =>
    (win as HarnessWindow).__visualTestHarness!.runPlayerTactic(command))
  cy.window({ timeout: 60_000 }).should(win => {
    const audit = (win as HarnessWindow).__visualTestHarness!.getProofAudit()
    expect(audit.processing, `player is idle after ${command}`).to.equal(false)
  })
}

describe('LessOrEqual level 8 goal choices', () => {
  it('lets the player choose the right side in the final induction branch', () => {
    cy.viewport(1440, 900)
    cy.visit(`${mountPath}#/g/local/NNG4/world/LessOrEqual/level/8/visual`, {
      onBeforeLoad(win) {
        win.localStorage.setItem('visual_auto_branch_switch', 'true')
      },
    })
    cy.get('[data-testid="visual-proof-page"]', { timeout: LOAD_TIMEOUT }).should('be.visible')

    ;[
      'intro x',
      'induction x with d hd',
      'intro y',
      'left',
      'apply zero_le',
      'intro y',
      'induction y with d2 hd2',
      'right',
      'apply zero_le',
      'have thm_hd3 := hd (y := d2)',
      'cases thm_hd3',
      'left',
      'cases thm_left with c h',
      'use c',
      'rw [succ_add]',
      'rw [← h]',
      'rfl',
    ].forEach(run)

    cy.get('[data-testid="goal-card"]')
      .should('have.attr', 'data-goal-text')
      .and('include', '∨')
    cy.get('[data-testid="goal-card"]').click()
    cy.get('[data-testid="goal-choice-option"][data-play-tactic="click_goal_right"]')
      .should('be.visible')
      .click()

    cy.window({ timeout: 60_000 }).should(win => {
      const audit = (win as HarnessWindow).__visualTestHarness!.getProofAudit()
      expect(audit.processing, 'right-side specialization finishes').to.equal(false)
      expect(audit.interactiveLines.at(-1)).to.equal('click_goal_right')
      expect(audit.coreLines.at(-1)).to.equal('right')
    })
    cy.get('[data-testid="goal-card"]')
      .should('have.attr', 'data-goal-text')
      .and('not.include', '∨')
  })
})
