import { CompletePlaythroughDriver } from '../support/completePlaythroughDriver'

const mountPath = Cypress.env('LEAN4GAME_MOUNT') ?? '/'
const LOAD_TIMEOUT = 600000

interface VisualHarness {
  copyTheoremToCanvas(theoremName: string): void
  getProofAudit(): { completed: boolean; processing: boolean }
}

type HarnessWindow = Cypress.AUTWindow & { __visualTestHarness?: VisualHarness }
type PlayerGesture = string | { rewrite: string; side: 'left' | 'right' }

function visualHarness() {
  return cy.window({ timeout: 60_000 }).then(win => {
    const harness = (win as HarnessWindow).__visualTestHarness
    expect(harness, 'visual player test bridge').to.exist
    return harness!
  })
}

function performPlayerGestures(commands: PlayerGesture[]) {
  cy.window({ timeout: LOAD_TIMEOUT }).then({ timeout: LOAD_TIMEOUT }, async win => {
    const player = new CompletePlaythroughDriver(win)
    for (const command of commands) {
      if (typeof command === 'string') await player.perform(command)
      else await player.performRewriteOnSide(command.rewrite, command.side)
    }
  })
  cy.window().should(win => {
    const audit = (win as HarnessWindow).__visualTestHarness?.getProofAudit()
    expect(audit?.processing, 'visual proof is idle').to.equal(false)
    expect(audit?.completed, 'visual proof is complete').to.equal(true)
  })
}

describe('NNG4 implication and definition display regressions', () => {
  beforeEach(() => {
    cy.on('uncaught:exception', () => false)
    cy.clearCookies()
    cy.clearLocalStorage()
  })

  it('applies zero-ne-one through player theorem and tactic drags', () => {
    cy.visit(`${mountPath}#/g/local/NNG4/world/Implication/level/10/visual`)
    cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')

    performPlayerGestures(['symm', 'exact zero_ne_one'])
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

  it('rewrites the selected x to x + 0 with reverse add_zero', () => {
    cy.visit(`${mountPath}#/g/local/NNG4/world/LessOrEqual/level/1/visual`)
    cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')

    // After `use 0`, select the left-hand side of `x = x + 0` with the visual
    // arrow control, then drag reverse add_zero directly onto that displayed
    // `x`, as a player does. The resulting reflexive equality is closed by
    // Lean's rewrite tactic itself, so no synthetic trailing `rfl` is needed.
    performPlayerGestures([
      'use 0',
      { rewrite: 'rw [\u2190 add_zero]', side: 'left' },
    ])
  })
})
