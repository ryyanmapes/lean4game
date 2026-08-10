const LOAD_TIMEOUT = Number(Cypress.env('VISUAL_TIMEOUT') ?? 600_000)
// Development/CI exercises the websocket-backed game server. Release runs can
// point this at the mounted browser build with LEAN4GAME_MOUNT.
const mountPath = Cypress.env('LEAN4GAME_MOUNT') ?? '/'

interface VisualHarness {
  getProofAudit(): { processing: boolean }
}

type HarnessWindow = Cypress.AUTWindow & { __visualTestHarness?: VisualHarness }

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

function waitForPlayerIdle(label: string) {
  cy.window({ timeout: 60_000 }).should(win => {
    const bridge = (win as HarnessWindow).__visualTestHarness
    expect(bridge, 'visual player test bridge remains mounted').to.exist
    expect(bridge!.getProofAudit().processing, `player is idle after ${label}`).to.equal(false)
  })
}

function visiblePlayerState(win: Cypress.AUTWindow) {
  const goal = win.document.querySelector<HTMLElement>('[data-testid="goal-card"]')
  const hypotheses = Array.from(
    win.document.querySelectorAll<HTMLElement>('[data-testid="hyp-card"]'),
    card => `${card.dataset.hypName ?? ''}:${card.dataset.hypType ?? card.textContent ?? ''}`,
  )
  return JSON.stringify({
    goalId: goal?.dataset.streamId ?? goal?.id ?? null,
    goalText: goal?.dataset.goalText ?? goal?.textContent ?? null,
    hypotheses,
  })
}

function clickGoal() {
  cy.window().then(win => {
    const before = visiblePlayerState(win)
    cy.get('[data-testid="goal-card"].clickable', { timeout: 60_000 }).click()
    cy.window({ timeout: 60_000 }).should(currentWindow => {
      const bridge = (currentWindow as HarnessWindow).__visualTestHarness
      expect(bridge, 'visual player test bridge remains mounted').to.exist
      expect(bridge!.getProofAudit().processing, 'goal click has finished').to.equal(false)
      expect(visiblePlayerState(currentWindow), 'goal click changes the visible proof state')
        .not.to.equal(before)
    })
  })
}

function chooseConstructionBrick(label: string) {
  cy.contains('button.cn-brick', new RegExp(`^${label}$`), { timeout: 60_000 }).click()
  cy.get('.cn-done-btn.ready').click()
  waitForPlayerIdle(`specifying ${label}`)
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

function dragTheoremTemplateToDivider(theoremSuffix: string, dividerIndex: number) {
  findTheoremCard(theoremSuffix).then($card => {
    cy.get(`.mobile-theorem-column [data-testid="mobile-reorder-divider"][data-index="${dividerIndex}"]`).then($divider => {
      const start = $card[0]!.getBoundingClientRect()
      const end = $divider[0]!.getBoundingClientRect()
      const pointer = { pointerId: 19, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 }
      cy.wrap($card).trigger('pointerdown', {
        ...pointer,
        clientX: start.left + start.width / 2,
        clientY: start.top + start.height / 2,
        force: true,
      })
      // Cross the PointerSensor activation threshold before entering the
      // divider. A real finger always produces this intermediate movement.
      cy.get('body').trigger('pointermove', {
        ...pointer,
        clientX: start.left + start.width / 2 + 8,
        clientY: start.top + start.height / 2,
        force: true,
      })
      cy.get(`.mobile-theorem-column [data-testid="mobile-reorder-divider"][data-index="${dividerIndex}"]`)
        .should('have.class', 'enabled')
      cy.get('body').trigger('pointermove', {
        ...pointer,
        clientX: end.left + end.width / 2,
        clientY: end.top + end.height / 2,
        force: true,
      })
      cy.get(`.mobile-theorem-column [data-testid="mobile-reorder-divider"][data-index="${dividerIndex}"]`)
        .should('have.class', 'active')
      cy.get('body').trigger('pointerup', {
        ...pointer,
        buttons: 0,
        clientX: end.left + end.width / 2,
        clientY: end.top + end.height / 2,
        force: true,
      })
    })
  })
}

describe('Visual Lean mobile theorem player regressions', { testIsolation: false }, () => {
  beforeEach(() => cy.viewport(390, 844))

  it('places a theorem tray card into a chosen theorem slot and keeps theorem styling', () => {
    openLevel('Implication', 9)
    cy.contains('.tr-tab-btn', 'Theorems').click()
    cy.get('[data-testid="theorem-category-tabs"] .tr-tab-btn').then($tabs => {
      expect(Array.from($tabs, tab => tab.textContent?.trim())).to.deep.equal(['All', '+', '≠'])
    })
    cy.get('[data-testid="theorem-category-tabs"]').should('not.contain.text', '≤').and('not.contain.text', '*')
    findTheoremCard('zero_ne_succ').then($template => {
      const templateBorder = getComputedStyle($template[0]!).borderColor
      dragTheoremTemplateToDivider('zero_ne_succ', 0)
      cy.get('.mobile-theorem-column [data-testid="theorem-copy-card"][data-theorem-name$="zero_ne_succ"]')
        .should('be.visible')
        .and($copy => {
          expect(getComputedStyle($copy[0]!).borderColor, 'placed copy retains theorem color')
            .to.equal(templateBorder)
        })
      cy.get('.mobile-theorem-column [data-testid="theorem-copy-card"]').first()
        .should('have.attr', 'data-theorem-name').and('match', /zero_ne_succ$/)
    })
  })

  it('specializes collision-renamed binders and preserves the remaining forall footer', () => {
    openLevel('AdvMultiplication', 2)
    clickGoal()
    clickGoal()
    cy.get('.mobile-variable-column [data-testid="hyp-card"]').then($cards => {
      expect(Array.from($cards, card => card.getAttribute('data-hyp-name')),
        'goal-created variables append in introduction order').to.deep.equal(['a', 'b'])
    })
    cy.get('.mobile-theorem-column [data-hyp-name="h"]').should('exist')
    cy.get('.mobile-scroll-deadspace').should($space => {
      const cardHeights = Array.from(
        $space[0]!.ownerDocument.querySelectorAll<HTMLElement>('.mobile-list-card'),
        card => card.getBoundingClientRect().height,
      )
      expect($space[0]!.getBoundingClientRect().height, 'one largest-card-height remains scrollable')
        .to.be.at.least(Math.max(...cardHeights))
    })

    cy.contains('.tr-tab-btn', 'Theorems').click()
    findTheoremCard('mul_le_mul_right').dblclick({ force: true })
    cy.get('.visual-page.tr-construction-overlay .cn-propose-var', { timeout: 60_000 })
      .should('have.text', 'a')
    chooseConstructionBrick('b')

    let sourceTheoremBorder = ''
    cy.get('.mobile-theorem-column [data-testid="hyp-card"].derived-theorem-card')
      .last().should('have.attr', 'data-constructable', 'true').then($card => {
        sourceTheoremBorder = getComputedStyle($card[0]!).borderColor
        cy.wrap($card).dblclick({ force: true })
      })
    cy.get('.visual-page.tr-construction-overlay .cn-propose-var', { timeout: 60_000 })
      .invoke('text').should('match', /^b1?$/)
    cy.get('.visual-page.tr-construction-overlay .cn-propose-var')
      .and('not.contain.text', '_')
    chooseConstructionBrick('0')

    cy.get('.visual-page.tr-construction-overlay').should('not.exist')
    cy.get('.mobile-theorem-column [data-testid="hyp-card"].derived-theorem-card').last()
      .should('contain.text', '∀')
      .and('contain.text', 't')
      .and($card => {
        expect(getComputedStyle($card[0]!).borderColor, 'specialized card retains theorem color')
          .to.equal(sourceTheoremBorder)
      })
  })
})
