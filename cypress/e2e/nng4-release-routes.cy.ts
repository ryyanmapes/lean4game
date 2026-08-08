describe('local NNG4 release maps', () => {
  it('uses the release root as the only game selector', () => {
    cy.visit('/')

    cy.contains('h1', 'The Natural Numbers Game').should('be.visible')
    cy.get('a.game-card.visual[href="/lean4game/index.html#/g/local/NNG4/visual"]')
      .should('have.css', 'border-color', 'rgb(96, 71, 130)')
    cy.get('a.game-card.visual[href="/lean4game/index.html#/g/local/VisualTest/visual"]')
      .should('contain.text', 'Visual Capabilities Demo')
    cy.contains(/Real Numbers Game/iu).should('not.exist')
    cy.get('body').should('not.contain.text', 'The Natural Number Game')
  })

  it('uses the original three-column NNG4 map with every grey level clickable', () => {
    const consoleErrors: unknown[][] = []

    cy.visit('/lean4game/index.html#/g/local/NNG4', {
      onBeforeLoad(win) {
        cy.stub(win.console, 'error').callsFake((...args: unknown[]) => {
          consoleErrors.push(args)
        })
      },
    })

    cy.get('.welcome', { timeout: 30_000 }).should('be.visible')
    cy.get('.welcome > .chat-panel').should('be.visible')
    cy.get('.welcome > .inventory-panel').should('be.visible')
    cy.get('body').should('have.css', 'overflow', 'hidden')
    cy.window().then(win => {
      expect(win.document.documentElement.getBoundingClientRect().height, 'HTML fills viewport')
        .to.equal(win.innerHeight)
      expect(win.document.body.getBoundingClientRect().height, 'body fills viewport')
        .to.equal(win.innerHeight)
      expect(win.document.scrollingElement!.scrollHeight, 'page does not own map scrolling')
        .to.be.at.most(win.innerHeight)
    })
    cy.get('.visual-map-page').should('not.exist')
    cy.get('.world-selection-menu').should('not.exist')
    cy.contains('button', 'Unlock levels').should('not.exist')
    cy.get('.theme-mode-btn').should('have.attr', 'title', 'Switch to light mode')
    cy.get('.app-bar-left a[href="/"]').should('have.attr', 'title')
    cy.get('.welcome > .chat-panel')
      .should('have.css', 'padding-left', '16px')
      .and('have.css', 'padding-right', '16px')

    cy.get('#menu-btn').click()
    cy.get('.menu.dropdown').should('be.visible')
      .find('.btn')
      .should('have.length.greaterThan', 4)
    cy.get('.menu.dropdown .btn').filter(':contains("Erase")').should('have.length', 1)
    cy.get('#menu-btn').click()
    cy.get('.menu.dropdown').should('not.be.visible')

    cy.get('.inventory .item').contains(/rfl/u).click()
    cy.get('.inventory-panel .documentation').should('be.visible').then($documentation => {
      const documentation = $documentation[0].getBoundingClientRect()
      const panel = $documentation[0].parentElement!.getBoundingClientRect()
      expect(Math.abs(documentation.bottom - panel.bottom), 'documentation fills the panel').to.be.lessThan(2)
    })
    cy.get('.documentation .katex').should('exist')
    cy.get('.documentation .katex-mathml').should('have.css', 'display', 'none')
    cy.get('.documentation-close').should('have.css', 'border-radius', '50%').click()
    cy.get('.inventory-panel .documentation').should('not.exist')

    cy.get('a.level.locked').first()
      .should('have.attr', 'href')
      .and('match', /\/world\/.+\/level\/\d+$/u)
    cy.get('a.level.locked circle').first()
      .should('have.css', 'fill', 'rgb(83, 100, 123)')
    cy.get('a[href*="/level/0"]').should('not.exist')
    cy.get('a.level title').contains(/rfl tactic/iu, { timeout: 30_000 })

    cy.get('a[aria-label="Open Tutorial World"]').click()
    cy.location('hash').should('match', /#\/g\/local\/NNG4\/world\/Tutorial\/level\/1$/u)
    cy.location('hash').should('not.include', '/visual')

    cy.location('protocol').should('match', /^https?:$/u)
    cy.then(() => {
      expect(
        consoleErrors.filter(args => args.some(value => /file:\/\/|security error/iu.test(String(value)))),
        'no local-file security errors',
      ).to.deep.equal([])
    })
  })

  it('uses the same map chrome for visual play and retains visual level routes', () => {
    cy.visit('/lean4game/index.html#/g/local/NNG4/visual')

    cy.contains('The Natural Numbers Game', { timeout: 30_000 }).should('be.visible')
    cy.contains('button', 'Unlock levels').should('not.exist')
    cy.get('a.visual-map-back-btn[href="/"]').should('exist')
    cy.get('.app').invoke('attr', 'data-visual-theme').then(initialTheme => {
      cy.get('.visual-map-theme-toggle').click()
      cy.get('.app').should('have.attr', 'data-visual-theme').and('not.equal', initialTheme)
    })
    cy.get('[role="link"][aria-label="Open Tutorial World"]').click({ force: true })
    cy.location('hash').should('match', /#\/g\/local\/NNG4\/world\/Tutorial\/level\/1\/visual$/u)
  })

  it('keeps erase confirmation concise and offers no combined download action', () => {
    cy.visit('/lean4game/index.html#/g/local/NNG4/visual')
    cy.contains('The Natural Numbers Game', { timeout: 30_000 }).should('be.visible')
    cy.get('.visual-map-menu-btn').click()
    cy.contains('.visual-map-dropdown button', 'Erase').click()
    cy.contains('h2', 'Delete Progress?').should('be.visible')
    cy.contains('Deleting progress will delete all your proofs').should('not.exist')
    cy.contains('button', 'Download & Delete').should('not.exist')
    cy.contains('button', 'Delete Progress').should('exist')
  })

  it('redirects the removed embedded selector to the release root', () => {
    cy.visit('/lean4game/index.html#/')
    cy.location('pathname', { timeout: 30_000 }).should('equal', '/')
    cy.location('hash').should('equal', '')
    cy.contains('h1', 'The Natural Numbers Game').should('be.visible')
  })
})
