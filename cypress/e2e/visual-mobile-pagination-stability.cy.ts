const LOAD_TIMEOUT = Number(Cypress.env('VISUAL_TIMEOUT') ?? 600_000)
const mountPath = Cypress.env('LEAN4GAME_MOUNT') ?? '/lean4game/index.html'

interface VisualHarness {
  dragTacticToHyp(tacticName: string, hypName: string): Promise<void>
  openGoalTransform(): void
  rewriteGoalInTransform(theoremName: string): Promise<void>
}

type HarnessWindow = Cypress.AUTWindow & { __visualTestHarness?: VisualHarness }

function visualHarness() {
  return cy.window({ timeout: 60_000 }).then(win => {
    const harness = (win as HarnessWindow).__visualTestHarness
    expect(harness, 'visual player test bridge').to.exist
    return harness!
  })
}

describe('Visual Lean mobile adaptive tray and action stability', () => {
  it('packs small rules together and preserves the overlay through an accepted rewrite', () => {
    cy.viewport(390, 844)
    cy.visit(`${mountPath}#/g/local/NNG4/world/Addition/level/1/visual`)
    cy.get('[data-testid="visual-proof-page"]', { timeout: LOAD_TIMEOUT }).should('be.visible')

    visualHarness().then(harness => harness.dragTacticToHyp('induction', 'n'))
    cy.get('.mobile-page-link.graph-link', { timeout: 60_000 }).click()
    cy.get('[data-testid="stream-nav-next"]:visible', { timeout: 60_000 }).click()
    cy.get('.mobile-graph-page.open .mobile-side-return-link').click()
    visualHarness().then(harness => harness.openGoalTransform())

    cy.get('.visual-page.tr-transformation-overlay', { timeout: 60_000 }).then($overlay => {
      const originalOverlay = $overlay[0]!

      // The provisional all-card measurement row is deliberately hidden.
      // Assert only after the same layout-ready signal that reveals the dock
      // to a player, so the test cannot mistake that transient row for a page.
      cy.get('.tr-rule-dock[data-layout-ready="true"]', { timeout: 60_000 }).within(() => {
        cy.get('.tr-rule-page-cards .tr-rule-card')
          .should('have.length.at.least', 2)
          .then($cards => {
            const pageRect = $cards[0]!.closest('.tr-rule-page')!.getBoundingClientRect()
            Array.from($cards).forEach(card => {
              const rect = card.getBoundingClientRect()
              expect(rect.left, 'card stays inside the page').to.be.at.least(pageRect.left - 1)
              expect(rect.right, 'card stays inside the page').to.be.at.most(pageRect.right + 1)
            })
          })
      })

      visualHarness().then(harness => harness.rewriteGoalInTransform('add_succ'))
      cy.get('.visual-page.tr-transformation-overlay', { timeout: 60_000 }).should($nextOverlay => {
        expect($nextOverlay[0], 'accepted rewrite keeps the same overlay DOM node').to.equal(originalOverlay)
      })
      cy.get('.tr-processing').should('not.exist')
    })
  })
})
