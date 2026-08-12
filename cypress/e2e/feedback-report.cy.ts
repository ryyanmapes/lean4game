const LOAD_TIMEOUT = Number(Cypress.env('VISUAL_TIMEOUT') ?? 600_000)
const mountPath = Cypress.env('LEAN4GAME_MOUNT') ?? '/lean4game/index.html'
const feedbackEndpoint = 'https://telemetry.test/v1/feedback'

type HarnessWindow = Cypress.AUTWindow & { __LEAN_TELEMETRY_URL__?: string }

function visitLevel(path: string, consent: 'accepted' | 'refused') {
  cy.visit(`${mountPath}#${path}`, {
    onBeforeLoad(win) {
      win.localStorage.setItem('telemetryConsent', consent)
      win.document.cookie = 'lean_game_anonymous_id=; Path=/; Max-Age=0; SameSite=Lax'
      ;(win as HarnessWindow).__LEAN_TELEMETRY_URL__ = 'https://telemetry.test'
    },
  })
}

describe('in-level feedback reports', { testIsolation: true }, () => {
  beforeEach(() => {
    cy.intercept('OPTIONS', feedbackEndpoint, {
      statusCode: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
      },
    })
  })

  it('submits visual state without an identity when telemetry is disabled', () => {
    cy.intercept('POST', feedbackEndpoint, request => {
      expect(request.body.message).to.equal('Dragging this card did nothing.')
      expect(request.body.game_id).to.equal('g/local/NNG4')
      expect(request.body.world_id).to.equal('Tutorial')
      expect(request.body.level_id).to.equal(1)
      expect(request.body.mode).to.equal('visual')
      expect(request.body).not.to.have.property('user_uuid')
      expect(request.body.proof_state).to.have.property('proofBody')
      expect(request.body.proof_state).to.have.property('canvasState')
      request.reply({ statusCode: 204, headers: { 'access-control-allow-origin': '*' } })
    }).as('feedback')

    visitLevel('/g/local/NNG4/world/Tutorial/level/1/visual', 'refused')
    cy.get('[data-testid="visual-proof-page"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
    cy.get('.visual-header-side').first().within(() => {
      cy.get('.visual-header-map-btn').should('be.visible')
      cy.get('.feedback-report-open').should('be.visible').click()
    })
    cy.get('[role="dialog"][aria-label="Send feedback"]').should('be.visible').within(() => {
      cy.contains('This form will send a feedback report along with your game state.')
      cy.contains('button', 'Submit feedback').should('be.disabled')
      cy.get('textarea').should('have.attr', 'maxlength', '1000')
        .type('Dragging this card did nothing.')
      cy.contains('button', 'Submit feedback').should('be.enabled').click()
      cy.contains('Feedback sent. Thank you!').should('be.visible')
    })
    cy.wait('@feedback')
  })

  it('submits classic proof state with the opted-in anonymous identity', () => {
    cy.intercept('POST', feedbackEndpoint, request => {
      expect(request.body.mode).to.equal('classic')
      expect(request.body.user_uuid).to.match(/^[0-9a-f-]{36}$/u)
      expect(request.body.proof_state).to.have.property('proofBody')
      expect(request.body.proof_state).to.have.property('proof')
      request.reply({ statusCode: 204, headers: { 'access-control-allow-origin': '*' } })
    }).as('feedback')

    visitLevel('/g/local/NNG4/world/Tutorial/level/1', 'accepted')
    cy.get('.app-content.level, .app-content.level-mobile', { timeout: LOAD_TIMEOUT }).should('be.visible')
    cy.get('.app-bar .feedback-report-open').first().click()
    cy.get('[role="dialog"][aria-label="Send feedback"]').within(() => {
      cy.get('textarea').type('Classic editor feedback')
      cy.contains('button', 'Submit feedback').click()
    })
    cy.wait('@feedback')
  })
})
