describe('VisualTest local WASM transport', () => {
  it('loads the original visual level without a websocket relay', () => {
    cy.visit('/lean4game/index.html#/g/local/VisualTest/world/Prototype/level/1/visual')
    cy.contains('WebSocket connection timed out', { timeout: 10_000 }).should('not.exist')
    cy.get('[data-testid="visual-proof-page"]', { timeout: 600_000 }).should('be.visible')
    cy.get('[data-testid="goal-card"]', { timeout: 600_000 })
      .should('be.visible')
      .and('have.attr', 'data-goal-text')
      .and('contain', 'P')
  })

  it('teaches existential specialization with one click below the goal', () => {
    cy.visit('/lean4game/index.html#/g/local/VisualTest/world/Prototype/level/5/visual')
    cy.get('[data-testid="goal-card"]', { timeout: 600_000 }).should('be.visible')
    cy.contains(
      '.goal-info.below',
      'Click there-exists goals to specialize them with a particular constructed example',
      { timeout: 600_000 },
    ).should('be.visible')
    cy.get('[data-testid="goal-card"]').click()
    cy.get('.visual-page.tr-construction-overlay', { timeout: 60_000 }).should('be.visible')
  })
})
