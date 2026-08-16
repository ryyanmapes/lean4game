const mountPath = Cypress.env('LEAN4GAME_MOUNT') ?? '/lean4game/index.html'
const LOAD_TIMEOUT = Number(Cypress.env('VISUAL_TIMEOUT') ?? 180_000)

describe('tapered variable rendering review', () => {
  it('draws the neutral frame and compatible-tactic glow', () => {
    cy.viewport(1440, 900)
    cy.visit(`${mountPath}#/g/local/NNG4/world/Addition/level/1/visual`)

    cy.get('[data-tactic-name="induction"]', { timeout: LOAD_TIMEOUT })
      .should('be.visible')
      .then($card => {
        const card = $card[0]!
        const frame = getComputedStyle(card, '::after')
        expect(getComputedStyle(card).clipPath).to.contain('16px')
        expect(frame.backgroundImage.match(/linear-gradient/gu)).to.have.length(8)
      })
    cy.get('[data-testid="hyp-card"][data-hyp-name="n"]', { timeout: LOAD_TIMEOUT })
      .should('be.visible')
      .and('have.class', 'variable-card')
    cy.screenshot('review/tapered-variable-neutral', { capture: 'viewport' })

    cy.get('[data-tactic-name="induction"]').then($card => {
      const rect = $card[0]!.getBoundingClientRect()
      const pointer = { pointerId: 27, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 }
      cy.wrap($card).trigger('pointerdown', {
        ...pointer,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        force: true,
      })
      cy.get('body').trigger('pointermove', {
        ...pointer,
        clientX: rect.left + rect.width / 2 + 12,
        clientY: rect.top + rect.height / 2 + 12,
        force: true,
      })
    })

    cy.get('[data-testid="hyp-card"][data-hyp-name="n"]')
      .should('have.class', 'potential-drop-target')
      .should($card => {
        const style = getComputedStyle($card[0]!)
        expect(style.getPropertyValue('--bevel-border-color').trim())
          .to.equal(style.getPropertyValue('--visual-drop-target-border').trim())
        expect(style.filter).to.contain('drop-shadow')
      })
    cy.screenshot('review/tapered-variable-compatible-target', { capture: 'viewport' })
  })

  it('shows the completion-neutral note directly after the Fermat title', () => {
    cy.viewport(1440, 900)
    cy.visit(`${mountPath}#/g/local/NNG4/world/Power/level/10/visual`)
    cy.contains(
      '.visual-header-title .level-title-visible-annotation',
      '❌ (Does not count towards completion)',
      { timeout: LOAD_TIMEOUT },
    ).should('be.visible')
  })
})
