describe('local classic input modes', () => {
  it('starts post-intro levels with declaration binders inside the goal', () => {
    cy.clearLocalStorage()
    cy.visit('/lean4game/index.html#/g/local/NNG4/world/Implication/level/7')

    cy.get('input[aria-label="Lean command"]', { timeout: 600_000 }).should('be.enabled')
    cy.get('.hypotheses .hyp-group-title').should('not.exist')
    cy.get('.goal').should('contain.text', '∀').and('contain.text', 'x').and('contain.text', 'y')

    cy.get('input[aria-label="Lean command"]').type('intro x')
    cy.contains('button', 'Execute').click()
    cy.get('.hypotheses', { timeout: 600_000 }).should('contain.text', 'x')
    cy.get('.goal').should('contain.text', '∀').and('contain.text', 'y')
  })

  it('keeps the checked proof when switching from terminal mode to editor mode', () => {
    cy.clearLocalStorage()
    cy.visit('/lean4game/index.html#/g/local/NNG4/world/Tutorial/level/1')

    cy.get('input[aria-label="Lean command"]', { timeout: 600_000 })
      .should('be.enabled')
      .type('rfl')
    cy.contains('button', 'Execute').click()
    cy.get('.local-classic-status', { timeout: 600_000 })
      .should('contain.text', 'Proof complete')
      .and('have.class', 'is-complete')

    cy.get('[title="Editor mode"]').click()

    cy.get('#local-classic-proof.local-wasm-code-editor')
      .should('be.visible')
      .and('have.value', 'rfl')
    cy.get('.local-classic-status')
      .should('contain.text', 'Proof complete')
      .and('have.class', 'is-complete')
    cy.location('pathname').should('include', '/world/Tutorial/level/1')
  })
})
