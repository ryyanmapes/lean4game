const LOAD_TIMEOUT = Number(Cypress.env('VISUAL_TIMEOUT') ?? 600_000)
const mountPath = Cypress.env('LEAN4GAME_MOUNT') ?? '/lean4game/index.html'

interface VisualHarness {
  runPlayerTactic(command: string): Promise<void>
  clickGoal(playTactic?: string): Promise<void>
  moveHypTo(hypName: string, x: number, y: number): void
  getProofAudit(): {
    processing: boolean
    visibleNames: string[]
    visibleTypes: string[]
  }
}

type HarnessWindow = Cypress.AUTWindow & { __visualTestHarness?: VisualHarness }

function harness() {
  return cy.window({ timeout: LOAD_TIMEOUT }).should(win => {
    expect((win as HarnessWindow).__visualTestHarness, 'visual player test bridge').to.exist
  }).then(win => (win as HarnessWindow).__visualTestHarness!)
}

function run(command: string) {
  harness().then(bridge => bridge.runPlayerTactic(command))
  cy.window({ timeout: 60_000 }).should(win => {
    const bridge = (win as HarnessWindow).__visualTestHarness
    expect(bridge, 'visual player test bridge remains mounted').to.exist
    expect(bridge!.getProofAudit().processing, `player is idle after ${command}`).to.equal(false)
  })
}

function findTheoremCard(theoremSuffix: string, remainingPages = 32): Cypress.Chainable<JQuery<HTMLElement>> {
  return cy.get('body').then($body => {
    const card = $body.find(`[data-theorem-name$="${theoremSuffix}"]`)
    if (card.length > 0) return cy.wrap(card)
    if (remainingPages <= 0) throw new Error(`Could not find theorem ${theoremSuffix} in the tray`)
    return cy.get('.theorem-tray-panel .tr-nav-btn[aria-label="Next"]')
      .should('not.be.disabled')
      .click()
      .then(() => findTheoremCard(theoremSuffix, remainingPages - 1))
  })
}

let applicationStarted = false

function openLevel(world: string, level: number) {
  const hash = `#/g/local/NNG4/world/${world}/level/${level}/visual`
  if (!applicationStarted) {
    cy.visit(`${mountPath}${hash}`)
    applicationStarted = true
  } else {
    cy.window().then(win => { win.location.hash = hash })
  }
  cy.get('[data-testid="visual-proof-page"]', { timeout: LOAD_TIMEOUT })
    .should('be.visible')
    .and('have.attr', 'data-world-id', world)
    .and('have.attr', 'data-level-id', String(level))
}

describe('Visual Lean advanced mobile regressions', { testIsolation: false }, () => {
  beforeEach(() => {
    cy.viewport(390, 844)
  })

  it('opens quantified hd construction with one tap and formats zero choices as numerals', () => {
    openLevel('LessOrEqual', 8)

    run('induction x with d hd generalizing y')
    cy.get('.mobile-variable-column [data-hyp-name="d"]').should('exist')
    cy.get('.mobile-theorem-column [data-hyp-name="hd"]').should('exist')
    cy.get('.mobile-variable-column [data-hyp-name="hd"]').should('not.exist')
    cy.get('[data-testid="goal-card"]').click()
    cy.get('[data-testid="goal-choice-menu"]', { timeout: 60_000 })
      .should('be.visible')
      .and('not.contain.text', 'zero')
    cy.get('.or-tooltip-backdrop').click({ force: true })

    cy.get('.mobile-page-link.graph-link').click()
    cy.get('[data-testid="stream-nav-next"]:visible', { timeout: 60_000 }).click()
    cy.get('.mobile-graph-page.open .mobile-side-return-link').click()
    cy.get('[data-testid="hyp-card"][data-hyp-name="hd"]', { timeout: 60_000 })
      .should('have.attr', 'data-constructable', 'true')
      .click()
    cy.get('.visual-page.tr-construction-overlay', { timeout: 60_000 })
      .should('be.visible')
      .and('contain.text', 'Specify y')
  })

  it('never exposes hygienic names after a player uses cases', () => {
    cy.get('.visual-page.tr-construction-overlay .tr-back-btn').click()

    const commands = ['cases y with a']
    commands.forEach(command => {
      run(command)
      cy.get('[data-hyp-name], [data-hyp-type], [data-goal-text]').should($elements => {
        const displayed = Array.from($elements).flatMap(element => [
          element.getAttribute('data-hyp-name') ?? '',
          element.getAttribute('data-hyp-type') ?? '',
          element.getAttribute('data-goal-text') ?? '',
          element.textContent ?? '',
        ])
        expect(displayed.join('\n'), `clean display after ${command}`)
          .not.to.match(/(?:_@|_internal|_hyg|[†✝]|\bzero\b)/u)
      })
    })
  })

  it('keeps long theorem cards inside the tray and uses a stable compact size', () => {
    openLevel('AdvMultiplication', 7)
    cy.get('.tr-tab-btn').contains('Theorems').click()
    findTheoremCard('add_left_cancel').should($card => {
      expect($card, 'long theorem exists').to.have.length(1)
      expect($card[0]!.classList.contains('theorem-card-compact'), 'uses persistent compact class').to.equal(true)
      const cardRect = $card[0]!.getBoundingClientRect()
      const pageRect = $card[0]!.closest('.tr-rule-page')!.getBoundingClientRect()
      const name = $card[0]!.querySelector<HTMLElement>('.hyp-name')!
      const proposition = $card[0]!.querySelector<HTMLElement>('.proposition')!
      const nameRect = name.getBoundingClientRect()
      const propositionRect = proposition.getBoundingClientRect()
      expect(cardRect.left, 'card stays right of page start').to.be.at.least(pageRect.left - 1)
      expect(cardRect.right, 'card stays left of page end').to.be.at.most(pageRect.right + 1)
      expect(propositionRect.top, 'long proposition wraps below its label and colon')
        .to.be.at.least(nameRect.bottom - 1)
      expect(parseFloat(getComputedStyle(proposition).fontSize), 'wrapped proposition keeps normal text size')
        .to.be.at.least(15)
    })
  })

  it('splits a long mobile title into two complete lines within the fixed header', () => {
    openLevel('AdvMultiplication', 7)
    cy.get('.visual-header-center').should('have.class', 'split-title').then($center => {
      const headerRect = $center[0]!.closest('.visual-header')!.getBoundingClientRect()
      const levelRect = $center.find('.visual-header-level')[0]!.getBoundingClientRect()
      const titleRect = $center.find('.visual-header-title')[0]!.getBoundingClientRect()
      expect($center.find('.visual-header-separator')).not.to.be.visible
      expect(levelRect.bottom, 'world line remains inside header').to.be.at.most(headerRect.bottom)
      expect(titleRect.bottom, 'title line remains inside header').to.be.at.most(headerRect.bottom)
      expect($center.find('.visual-header-title:visible').first().text()).to.equal('mul_ne_zero')
    })
  })

  it('uses the portrait-only variable/theorem columns without scrolling the goal', () => {
    openLevel('Tutorial', 1)
    cy.get('[data-testid="mobile-play-panel"]').should('be.visible')
    cy.get('.mobile-variable-column [data-hyp-name="x"]').should('exist')
    cy.get('.mobile-variable-column [data-hyp-name="q"]').should('exist')
    cy.get('.mobile-theorem-column').should('exist')
    cy.get('[data-testid="mobile-scrollbar"]').should('be.visible')
    cy.get('.mobile-below-goal-dialogues .goal-info.below').should('be.visible')
    cy.get('[data-testid="goal-card"]').then($goal => {
      cy.get('[data-testid="mobile-play-scroll"]').then($scroll => {
        expect($scroll[0]!.contains($goal[0]!), 'goal is outside the scrolling region').to.equal(false)
        expect($scroll[0]!.contains(Cypress.$('.mobile-below-goal-dialogues .goal-info.below')[0]!), 'below-goal dialogue scrolls')
          .to.equal(true)
      })
    })
  })
})
