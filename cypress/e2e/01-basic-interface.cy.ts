// cypress/e2e/basic-game-features.cy.ts
// Tests for basic game functionality using the simple TestGame

describe('Basic Lean4game Interface', () => {
  describe('Error Page', () => {
    beforeEach(() => {
      cy.visit('/#/not-found')
      cy.get('#error-page').should('be.visible')
    })
    it('shows only the centered error', () => {
      cy.get('#error-page').should($page => {
        expect($page).to.have.css('display', 'flex')
        expect($page).to.have.css('align-items', 'center')
        expect($page).to.have.css('justify-content', 'center')
      })

      cy.get('#error-page .error-message')
        .should('be.visible')
        .and('contain', '404 Not Found')

      cy.get('#error-page a').should('not.exist')
      cy.get('#error-page h1').should('not.exist')
    })
    it('does not use the old illustrated background', () => {
      cy.get('#error-page')
        .should('have.css', 'background-image')
        .and('not.include', 'RoboSurprised')
    })
  })
  describe('Popup', () => {
    describe('Erase', () => {})
    describe('Impressum', () => {
      it('landing page footer', () => {
        cy.visit('/#/')
        cy.get('footer').contains('a', 'Impressum').should('be.visible').click()
        cy.contains('a', 'Contact Details').should('have.attr', 'target', '_blank')
        .then($a => {
          const href = $a.prop('href')
          cy.request(href).its('status').should('eq', 200)
        })
      })
    })
    describe('Info', () => {})
    describe('Preferences', () => {})
    describe('Privacy', () => {
      it('landing page footer', () => {
        cy.visit('/#/')
        cy.get('footer').contains('a', 'Privacy Policy').should('be.visible').click()
        cy.contains('a', 'Contact Details').should('have.attr', 'target', '_blank')
        .then($a => {
          const href = $a.prop('href')
          cy.request(href).its('status').should('eq', 200)
        })
      })
    })
    describe('Rules', () => {
      it('can be opened from world tree', () => {
        cy.visit('/#/g/test/TestGame')
        cy.get('.difficulty-label').find('.helpButton').should('be.visible').click()
        cy.contains('🔐')
        cy.contains('🔓')
      })
    })
    describe('Upload', () => {})
  })
})
