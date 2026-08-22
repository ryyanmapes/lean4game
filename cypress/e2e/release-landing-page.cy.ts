describe('Visual Lean release landing page', () => {
  it('presents the supplied destinations and credits', () => {
    cy.visit('/')

    cy.contains('h1', 'Visual Lean').should('be.visible')
    cy.contains('An experimental graphical user interface for writing Lean code.').should('be.visible')
    cy.contains('Lean verification runs locally on both desktop and mobile through WASM.').should('be.visible')
    cy.get('a.destination[href="/visualNNG"]')
      .should('contain.text', 'Start here: The Visual Natural Numbers Game')
    cy.get('a.destination[href="/pitch"]')
      .should('contain.text', 'Elevator Pitch')
    cy.get('a.destination[href="/classicNNG"]')
      .should('contain.text', 'The Natural Numbers Game Classic')
    cy.get('.hero-mark, .destination-number, .destination-symbol').should('not.exist')
    cy.get('.destination-arrow').should('have.length', 3).each(arrow => {
      expect(arrow.text().trim()).to.equal('→')
    })
    cy.get('h1').should($title => {
      const page = $title[0].ownerDocument.defaultView
      const body = $title[0].ownerDocument.body
      expect(page?.getComputedStyle($title[0]).fontFamily)
        .to.equal(page?.getComputedStyle(body).fontFamily)
    })
    cy.get('#credits').scrollIntoView().should('be.visible')
      .and('contain.text', 'It was coded with the help of Codex and Claude Code.')
      .and('contain.text', 'GPL-3.0 license')
  })

  it('stays within a phone viewport', () => {
    cy.viewport(390, 844)
    cy.visit('/')

    cy.contains('h1', 'Visual Lean').should('be.visible')
    cy.get('.destination').should('have.length', 3)
    cy.window().then(win => {
      expect(win.document.documentElement.scrollWidth, 'landing page has no horizontal overflow')
        .to.be.at.most(win.innerWidth)
    })
  })
})
