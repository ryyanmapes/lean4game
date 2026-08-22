describe('local NNG4 release maps', () => {
  it('uses the release root as the only game selector', () => {
    cy.visit('/')

    cy.contains('h1', 'Visual Lean').should('be.visible')
    cy.contains('An experimental graphical user interface for writing Lean code.').should('be.visible')
    cy.contains('Lean verification runs locally on both desktop and mobile through WASM.').should('be.visible')
    cy.get('a.destination[href="/visualNNG"]')
      .should('contain.text', 'Start here: The Visual Natural Numbers Game')
      .and('contain.text', 'Prove the fundamental properties of arithmetic from scratch!')
    cy.get('a.destination[href="/pitch"]')
      .should('contain.text', 'Elevator Pitch')
      .and('contain.text', "Take a brief tour of Visual Lean's three modes.")
    cy.get('a.destination[href="/classicNNG"]')
      .should('contain.text', 'The Natural Numbers Game Classic')
    cy.contains(/Real Numbers Game/iu).should('not.exist')
    cy.get('#credits').scrollIntoView().should('be.visible')
      .and('contain.text', 'It was coded with the help of Codex and Claude Code.')
      .and('contain.text', 'GPL-3.0 license')
    cy.get('#credits a[href="https://github.com/cauli/lean4-wasm-in-browser"]')
      .should('contain.text', 'Lean4.js')
  })

  it('serves each game from a short shareable path', () => {
    // The client is a hash router under /lean4game/, and GitHub Pages has no
    // rewrites, so each short path is a real page that replaces itself with
    // the hash URL. Check the destination, not just that the page loads.
    for (const [shortPath, expectedHash] of [
      ['/visualNNG', '#/g/local/NNG4/visual'],
      ['/classicNNG', '#/g/local/NNG4'],
      ['/pitch', '#/g/local/VisualTest/visual'],
    ] as const) {
      cy.visit(shortPath)
      cy.location('pathname', { timeout: 30_000 }).should('include', '/lean4game/')
      cy.location('hash', { timeout: 30_000 }).should('equal', expectedHash)
    }
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
    cy.get('.menu.dropdown .btn').filter(':contains("Reset")').should('have.length', 1)
    cy.get('.menu.dropdown').should('not.contain.text', 'Preferences').and('not.contain.text', 'Impressum')
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
    cy.get('a.level title').contains(/^rfl$/u, { timeout: 30_000 })
    cy.get('a.level').first().focus()
    cy.get('.map-level-name-tooltip').should('be.visible').and('not.be.empty')

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

    cy.contains('The Natural Numbers Video Game', { timeout: 30_000 }).should('be.visible')
    cy.contains('button', 'Unlock levels').should('not.exist')
    cy.get('a.visual-map-back-btn[href="/"]').should('exist')
    // Light mode is retired: no control offers it, and a stored preference
    // for it no longer applies, so the map always renders dark.
    cy.get('.visual-map-theme-toggle').should('not.exist')
    cy.get('.app').should('have.attr', 'data-visual-theme', 'dark')
    cy.get('.visual-map-link.level').first().focus()
    cy.get('.map-level-name-tooltip').should('be.visible').and('not.be.empty')
      .then($tooltip => {
        const bounds = $tooltip[0]!.getBoundingClientRect()
        const viewportWidth = $tooltip[0]!.ownerDocument.defaultView!.innerWidth
        expect(bounds.left, 'tooltip is not clipped on the left').to.be.at.least(8)
        expect(bounds.right, 'tooltip is not clipped on the right').to.be.at.most(viewportWidth - 8)
        expect(Number.parseFloat(getComputedStyle($tooltip[0]!).fontSize), 'readable map label').to.be.at.least(14)
        expect(Number.parseInt(getComputedStyle($tooltip[0]!).zIndex, 10), 'above the SVG map').to.be.at.least(1000)
        expect($tooltip.closest('svg'), 'tooltip escapes the SVG stacking context').to.have.length(0)
      })
    cy.get('.visual-map-link.level[aria-label*="Fermat"]').focus()
    cy.get('.map-level-name-tooltip')
      .should('contain.text', "Fermat's Last Theorem")
      .and('contain.text', 'Does not count towards completion')
      .and('not.contain.text', 'Difficult level')
      .and('not.contain.text', 'Skipped in Visual Lean')
    cy.get('.visual-map-menu-btn').click()
    cy.contains('.visual-map-dropdown button', 'Game Info').should('not.exist')
    cy.contains('.visual-map-dropdown button', 'Download').should('not.exist')
    cy.contains('.visual-map-dropdown button', 'Upload').should('not.exist')
    cy.contains('.visual-map-dropdown button', 'Export').should('be.visible')
    cy.contains('.visual-map-dropdown button', 'Import').should('be.visible')
    cy.get('.visual-map-dropdown button').then($buttons => {
      const labels = [...$buttons].map(button => button.textContent?.trim())
      expect(labels.indexOf('Import'), 'Import precedes Export').to.be.lessThan(labels.indexOf('Export'))
    })
    cy.contains('.visual-map-dropdown button', 'Auto branch switching')
      .should('have.attr', 'aria-pressed', 'false').click()
      .should('have.attr', 'aria-pressed', 'true')
    cy.contains('.visual-map-dropdown button', 'Anonymous telemetry')
      .should('have.attr', 'aria-pressed', 'false')
    cy.window().should(win => {
      expect(win.localStorage.getItem('visual_auto_branch_switch')).to.equal('true')
    })
    cy.get('[role="link"][aria-label="Open Tutorial World"]').click({ force: true })
    cy.location('hash').should('match', /#\/g\/local\/NNG4\/world\/Tutorial\/level\/1\/visual$/u)
  })

  it('keeps erase confirmation concise and offers no combined download action', () => {
    cy.visit('/lean4game/index.html#/g/local/NNG4/visual')
    cy.contains('The Natural Numbers Video Game', { timeout: 30_000 }).should('be.visible')
    cy.get('.visual-map-menu-btn').click()
    cy.contains('.visual-map-dropdown button', 'Reset').click()
    cy.contains('h2', 'Reset Progress?').should('be.visible')
    cy.contains('Deleting progress will delete all your proofs').should('not.exist')
    cy.contains('button', 'Download & Delete').should('not.exist')
    cy.contains('button', 'Reset Progress').should('exist')
  })

  it('omits Algorithm entirely and exposes optional Fermat metadata', () => {
    cy.request('/lean4game/data/g/local/NNG4/game.json').then(response => {
      expect(response.body.worlds.nodes).not.to.have.property('Algorithm')
      expect(response.body.worldSize).not.to.have.property('Algorithm')
      expect(response.body.completionNeutralLevels.Power).to.deep.equal([10])
      expect(response.body.skippedLevels.Power).not.to.include(10)
    })
    cy.request('/lean4game/data/g/local/NNG4/level__Power__10.json').then(response => {
      expect(response.body.title).to.equal("Fermat's Last Theorem ❌")
      expect(response.body.completionNeutral).to.equal(true)
      expect(response.body.visualGoalInfos.some(info =>
        info.position === 'below' && info.text === 'Good luck!'
      )).to.equal(true)
    })
    cy.request({
      url: '/lean4game/data/g/local/NNG4/level__Algorithm__1.json',
      failOnStatusCode: false,
    }).its('status').should('equal', 404)
  })

  it('shows Fermat as a playable optional level with an accessible title annotation', () => {
    cy.visit('/lean4game/index.html#/g/local/NNG4/world/Power/level/10/visual', {
      onBeforeLoad(win) {
        win.localStorage.removeItem('game_progress')
      },
    })
    cy.contains('.visual-info-callout', 'Good luck!', { timeout: 180_000 }).should('be.visible')
    cy.contains(
      '.visual-header-title .level-title-visible-annotation',
      '❌ (Does not count towards completion)',
      { timeout: 30_000 },
    ).should('be.visible')
    cy.get('.visual-header-title').should($title => {
      const annotation = $title.find('.level-title-visible-annotation')[0]!.getBoundingClientRect()
      const bounds = $title[0]!.getBoundingClientRect()
      expect(annotation.right, 'annotation remains inside the visible title region').to.be.at.most(bounds.right + 1)
    })
    cy.get('[data-testid="goal-card"]').should('not.have.class', 'solved')
    cy.window().should(win => {
      const progress = JSON.parse(win.localStorage.getItem('game_progress') ?? '{}')
      // Redux keys progress by the canonical game id from App
      // (`g/${owner}/${repo}`), normalized to lower case by the reducer.
      const level = progress.games?.['g/local/nng4']?.data?.Power?.[10]
      expect(level?.entered, 'opening the optional level is persisted').to.equal(true)
      expect(level?.completed, 'opening the optional level does not solve it').to.equal(false)
    })

    cy.contains('button', 'Back to map').click()
    cy.get('[role="link"][aria-label^="Open Power level 10:"]', { timeout: 30_000 })
      .should('have.attr', 'data-map-completed', 'true')
  })

  it('redirects the removed embedded selector to the release root', () => {
    cy.visit('/lean4game/index.html#/')
    cy.location('pathname', { timeout: 30_000 }).should('equal', '/')
    cy.location('hash').should('equal', '')
    cy.contains('h1', 'Visual Lean').should('be.visible')
  })
})
