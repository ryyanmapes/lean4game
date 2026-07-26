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
})
