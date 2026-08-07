const LOAD_TIMEOUT = Number(Cypress.env('VISUAL_TIMEOUT') ?? 600_000)
const mountPath = Cypress.env('LEAN4GAME_MOUNT') ?? '/lean4game/index.html'

function openTutorialOne(clearStorage = true) {
  const url = `${mountPath}#/g/local/NNG4/world/Tutorial/level/1/visual`
  if (clearStorage) cy.visit(url, { onBeforeLoad(win) { win.localStorage.clear() } })
  else cy.visit(url)
  cy.get('[data-testid="visual-proof-page"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
}

function visibleVariableNames() {
  return cy.get('.mobile-variable-column [data-testid="hyp-card"]').then($cards =>
    Array.from($cards, card => card.getAttribute('data-hyp-name'))
  )
}

function dragCardToDivider(cardName: string, dividerIndex: number) {
  cy.get(`.mobile-variable-column [data-hyp-name="${cardName}"]`).then($card => {
    cy.get(`.mobile-variable-column [data-testid="mobile-reorder-divider"][data-index="${dividerIndex}"]`).then($divider => {
      const start = $card[0]!.getBoundingClientRect()
      const end = $divider[0]!.getBoundingClientRect()
      const pointer = { pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 }
      cy.wrap($card).trigger('pointerdown', {
        ...pointer,
        clientX: start.left + start.width / 2,
        clientY: start.top + start.height / 2,
        force: true,
      })
      cy.get('body').trigger('pointermove', {
        ...pointer,
        clientX: end.left + end.width / 2,
        clientY: end.top + end.height / 2,
        force: true,
      })
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

describe('portrait-phone three-column play space', () => {
  beforeEach(() => cy.viewport(390, 844))

  it('keeps the goal fixed and puts below-goal dialogue and cards in the scrolling body', () => {
    openTutorialOne()
    cy.get('[data-testid="mobile-play-panel"]').should('be.visible')
    cy.get('.mobile-variable-column [data-hyp-name="x"]').should('exist')
    cy.get('.mobile-variable-column [data-hyp-name="q"]').should('exist')
    cy.get('.mobile-theorem-column').should('exist')
    cy.get('[data-testid="mobile-scrollbar"]').should('be.visible')
    cy.get('[data-testid="goal-card"]').then($goal => {
      cy.get('[data-testid="mobile-play-scroll"]').then($scroll => {
        expect($scroll[0]!.contains($goal[0]!), 'goal is outside scrolling body').to.equal(false)
        expect($scroll[0]!.querySelector('.mobile-below-goal-dialogues .goal-info.below'), 'below dialogue is inside scrolling body')
          .not.to.equal(null)
      })
    })
  })

  it('reorders only through dividers and restores the visual order after reload', () => {
    openTutorialOne()
    visibleVariableNames().should('deep.equal', ['x', 'q'])
    dragCardToDivider('q', 0)
    visibleVariableNames().should('deep.equal', ['q', 'x'])
    cy.reload()
    cy.get('[data-testid="visual-proof-page"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
    visibleVariableNames().should('deep.equal', ['q', 'x'])
  })

  it('leaves landscape on the existing free-canvas layout', () => {
    cy.viewport(844, 390)
    openTutorialOne()
    cy.get('[data-testid="mobile-play-panel"]').should('not.exist')
    cy.get('[data-testid="hyp-card"][data-hyp-name="x"]').should($card => {
      expect(getComputedStyle($card[0]!).position).to.equal('absolute')
    })
  })
})
