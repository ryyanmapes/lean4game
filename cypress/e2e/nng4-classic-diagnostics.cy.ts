describe('local classic Lean diagnostics', () => {
  it('shows Lean parser diagnostics and restores a rejected typewriter command', () => {
    cy.visit('/lean4game/index.html#/g/local/NNG4/world/Tutorial/level/1')

    cy.get('.classic-loading-page', { timeout: 30_000 }).should('be.visible')
    cy.get('.classic-loading-app-bar')
      .should('have.css', 'background-color', 'rgb(23, 72, 115)')
    cy.get('.classic-loading-title').then($title => {
      const title = $title[0].getBoundingClientRect()
      expect(title.left + title.width / 2, 'loading title is viewport-centered')
        .to.be.closeTo(Cypress.config('viewportWidth') / 2, 1)
    })
    cy.get('.classic-loading-content .hop-ball', { timeout: 30_000 })
      .should('have.css', 'background-image')
      .and('include', 'rgb(47, 121, 185)')

    cy.get('input[aria-label="Lean command"]', { timeout: 600_000 })
      .should('be.enabled')
      .type('rw h')

    cy.get('.app').should('have.attr', 'data-visual-theme', 'dark')
    cy.get('.typewriter-interface .content')
      .should('have.css', 'background-color', 'rgb(13, 24, 42)')
    cy.get('.chat .message.information').first()
      .should('have.css', 'color', 'rgb(230, 237, 247)')
      .and('have.css', 'background-color', 'rgb(23, 43, 61)')
    cy.get('.inventory .item').first()
      .should('not.have.css', 'background-color', 'rgb(255, 255, 255)')

    cy.contains('button', 'Execute').click()

    cy.contains('.message.error', 'Failed command', { timeout: 600_000 })
      .should('contain.text', ': rw h')
      .and('contain.text', "unexpected identifier; expected '['")
      .and('not.contain.text', 'Retry the last command and try again')
    cy.get('input[aria-label="Lean command"]').should('have.value', 'rw h')
  })
})
