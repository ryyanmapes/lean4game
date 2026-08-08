const mountPath = Cypress.env('LEAN4GAME_MOUNT') ?? '/'
const LOAD_TIMEOUT = 600000

interface VisualHarness {
  runPlayerTactic(command: string): Promise<void>
  copyTheoremToCanvas(theoremName: string): void
}

type HarnessWindow = Cypress.AUTWindow & { __visualTestHarness?: VisualHarness }

function visualHarness() {
  return cy.window({ timeout: 60_000 }).then(win => {
    const harness = (win as HarnessWindow).__visualTestHarness
    expect(harness, 'visual player test bridge').to.exist
    return harness!
  })
}

describe('NNG4 implication and definition display regressions', () => {
  beforeEach(() => {
    cy.on('uncaught:exception', () => false)
    cy.clearCookies()
    cy.clearLocalStorage()
  })

  it('applies a local zero-ne-one theorem to a 0 = 1 hypothesis', () => {
    cy.visit(`${mountPath}#/g/local/NNG4/world/Implication/level/10/visual`)
    cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')

    visualHarness().then(harness => harness.runPlayerTactic(
      'intro h; have thm_zero_ne_one : (0 : ℕ) ≠ 1 := MyNat.zero_ne_one; drag_to h thm_zero_ne_one',
    ))
  })

  it('shows the definitionally expanded form on a less-or-equal theorem card', () => {
    cy.visit(`${mountPath}#/g/local/NNG4/world/LessOrEqual/level/2/visual`)
    cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')

    visualHarness().then(harness => harness.copyTheoremToCanvas('MyNat.le_refl'))
    cy.get('[data-testid="theorem-copy-card"][data-theorem-name="MyNat.le_refl"] .statement-atomic-form')
      .should('be.visible')
      .and('contain.text', '∃')

    cy.get('[data-testid="hyp-card"].variable-card').first().should($card => {
      const card = $card[0]!
      const edgeWidth = getComputedStyle(card).borderTopWidth
      const bevel = getComputedStyle(card, '::after').backgroundImage
      expect(edgeWidth, 'normal edge width').to.equal('1px')
      expect(bevel, 'diagonal bevel uses the same one-pixel band').to.contain('0.5px')
      expect(bevel, 'old thicker diagonal band is absent').not.to.contain('0.85px')
    })
  })

  it('rewrites x to x + 0 with reverse add_zero', () => {
    cy.visit(`${mountPath}#/g/local/NNG4/world/LessOrEqual/level/1/visual`)
    cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')

    visualHarness().then(harness => harness.runPlayerTactic(
      'use 0; drag_rw_lhs [← MyNat.add_zero]',
    ))
  })
})
