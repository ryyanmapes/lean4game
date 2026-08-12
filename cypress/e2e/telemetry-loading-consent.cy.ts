const LOAD_TIMEOUT = Number(Cypress.env('VISUAL_TIMEOUT') ?? 600_000)
const mountPath = Cypress.env('LEAN4GAME_MOUNT') ?? '/lean4game/index.html'
const endpoint = 'https://telemetry.test/v1/events'

type VisualHarness = {
  runPlayerTactic(command: string): Promise<void>
}

type HarnessWindow = Cypress.AUTWindow & {
  __LEAN_TELEMETRY_URL__?: string
  __visualTestHarness?: VisualHarness
}

function levelUrl(level: number) {
  return `${mountPath}#/g/local/NNG4/world/Tutorial/level/${level}/visual`
}

function visitWithoutConsent(level: number) {
  cy.visit(levelUrl(level), {
    onBeforeLoad(win) {
      win.localStorage.removeItem('telemetryConsent')
      win.localStorage.removeItem('telemetryQueueV2')
      win.localStorage.removeItem('telemetryUserId')
      win.document.cookie = 'lean_game_anonymous_id=; Path=/; Max-Age=0; SameSite=Lax'
      ;(win as HarnessWindow).__LEAN_TELEMETRY_URL__ = 'https://telemetry.test'
    },
  })
}

describe('loading-screen telemetry consent', { testIsolation: true }, () => {
  beforeEach(() => {
    Cypress.env('TELEMETRY_PROMPT', true)
    cy.intercept('OPTIONS', endpoint, {
      statusCode: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
      },
    })
  })

  afterEach(() => {
    Cypress.env('TELEMETRY_PROMPT', false)
  })

  it('postpones once, holds a completed load, and logs nothing after refusal', () => {
    let telemetryRequests = 0
    cy.intercept('POST', endpoint, request => {
      telemetryRequests += 1
      request.reply({ statusCode: 204, headers: { 'access-control-allow-origin': '*' } })
    })

    visitWithoutConsent(1)
    cy.get('[role="dialog"][aria-label="Anonymous telemetry permission"]', { timeout: 30_000 })
      .should('be.visible')
      .and('contain.text', "Visual Lean is an experimental prototype; we are still trying to figure out what works and what doesn't. Anonymous telemetry helps us improve the program for future users.")
      .within(() => {
        cy.contains('button', 'Refuse').should('be.visible')
        cy.contains('button', 'Accept').should('be.visible')
      })
    cy.get('.telemetry-consent-dialog').then($dialog => {
      const dialog = $dialog[0]!.getBoundingClientRect()
      cy.get('[role="progressbar"]').then($bar => {
        expect(dialog.bottom, 'consent remains above the loading bar')
          .to.be.lessThan($bar[0]!.getBoundingClientRect().top)
      })
    })

    cy.get('[aria-label="Ask about telemetry later"]').click()
    cy.get('[data-testid="visual-proof-page"]', { timeout: LOAD_TIMEOUT }).should('be.visible')

    cy.visit(levelUrl(2))
    cy.get('[role="dialog"][aria-label="Anonymous telemetry permission"]', { timeout: 30_000 })
      .should('be.visible')
    cy.get('[role="progressbar"]', { timeout: LOAD_TIMEOUT })
      .should('have.attr', 'aria-valuenow', '100')
      .and('have.attr', 'aria-label', 'Complete')
    cy.get('.visual-loading-text').should('have.text', 'Complete')
    cy.get('[data-testid="visual-proof-page"]').should('not.exist')

    cy.contains('.telemetry-consent-button', 'Refuse').click()
    cy.get('[data-testid="visual-proof-page"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
    cy.window().then(async win => {
      const harness = (win as HarnessWindow).__visualTestHarness
      expect(harness, 'visual player test bridge').to.exist
      await harness!.runPlayerTactic('rw [h]')
    })
    cy.wait(500)
    cy.window().then(win => {
      expect(win.localStorage.getItem('telemetryConsent')).to.equal('refused')
      expect(win.localStorage.getItem('telemetryQueueV2')).to.equal(null)
      expect(win.localStorage.getItem('telemetryUserId')).to.equal(null)
      expect(win.document.cookie).not.to.contain('lean_game_anonymous_id=')
      expect(telemetryRequests, 'telemetry POST requests after refusal').to.equal(0)
    })

    cy.visit(levelUrl(3))
    cy.get('[data-testid="visual-proof-page"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
    cy.get('.telemetry-consent-dialog').should('not.exist')
  })

  it('saves acceptance and enables telemetry without asking again', () => {
    cy.intercept('POST', endpoint, request => {
      request.reply({ statusCode: 204, headers: { 'access-control-allow-origin': '*' } })
    }).as('telemetry')

    visitWithoutConsent(1)
    cy.get('[role="dialog"][aria-label="Anonymous telemetry permission"]', { timeout: 30_000 })
      .should('be.visible')
    cy.get('[role="progressbar"]', { timeout: LOAD_TIMEOUT })
      .should('have.attr', 'aria-valuenow', '100')
      .and('have.attr', 'aria-label', 'Complete')
    cy.contains('.telemetry-consent-button', 'Accept').click()
    cy.window().should(win => {
      expect(win.localStorage.getItem('telemetryConsent')).to.equal('accepted')
      expect(win.document.cookie).to.contain('lean_game_anonymous_id=')
    })
    cy.get('[data-testid="visual-proof-page"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
    cy.wait('@telemetry', { timeout: 30_000 })

    cy.visit(levelUrl(2))
    cy.get('[data-testid="visual-proof-page"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
    cy.get('.telemetry-consent-dialog').should('not.exist')
  })
})
