// cypress/e2e/basic-game-features.cy.ts
// Tests for basic game functionality using the simple TestGame

describe('Basic Lean4Game Features', () => {
  const LEVEL_LOAD_TIMEOUT = 120000
  const goalShouldContain = (text: string, timeout = 60000) => {
    cy.contains('.goal:visible', text, { timeout }).should('be.visible')
  }

  beforeEach(() => {
    // Handle Lean server timeout errors
    cy.on('uncaught:exception', (err) => {
      if (err.message.includes('Stopping the server timed out') ||
          err.message.includes('timeout') ||
          err.message.includes('WebSocket') ||
          err.message.includes('Socket') ||
          err.message.includes('Connection')) {
        return false
      }
      return true
    })

    // Navigate to test game before each test
    cy.visit('/#/g/test/TestGame')
    cy.contains('This is the introduction text of the game.', { timeout: 60000 })
  })

  // Helper function to navigate to introduction page
  const navigateToIntroduction = () => {
    cy.contains('Test World').click({ force: true })
    cy.url().should('include', '/level/0')  // Wait for navigation
  }

  // Helper function to navigate to level
  const navigateToLevel = () => {
    navigateToIntroduction()
    cy.contains('Start').click()
    cy.get('.monaco-editor', { timeout: LEVEL_LOAD_TIMEOUT }).should('be.visible')
    cy.get('.typewriter-input .monaco-editor .view-lines', { timeout: LEVEL_LOAD_TIMEOUT }).should('be.visible')
    goalShouldContain('x + x = y', LEVEL_LOAD_TIMEOUT)
  }

  describe('Navigation and UI Structure', () => {
    it('should navigate to world introduction via Test World button', () => {
      navigateToIntroduction()

      // Check we're on the introduction page with correct title
      cy.contains('Introduction').should('be.visible')
      cy.contains('This is the introduction of Test World.')
    })

    it('should navigate to world introduction via level 1 button', () => {
      // Click on level 1 directly
      cy.contains('1').click({ force: true })
      cy.url().should('include', '/level/0')  // Wait for navigation

      // Check we're on the introduction page with correct title
      cy.contains('Introduction').should('be.visible')
      cy.contains('This is the introduction of Test World.')
    })

    it('should navigate from introduction to level', () => {
      navigateToLevel()

      // Verify we're in the level with Monaco editor and goal
      cy.get('.monaco-editor').should('be.visible')
      cy.contains('Active Goal').should('be.visible')
    })
  })

  describe('Hints and Progressive Guidance', () => {
    it('should show initial hint after starting level', () => {
      navigateToLevel()

      // Check for the initial hint (should be the only hint visible)
      cy.contains('You can either start using').should('be.visible')

      // Verify no other hints are shown initially
      cy.contains('You should use g now').should('not.exist')
    })

    it('should show progressive hint after first tactic', () => {
      navigateToLevel()

      // Enter first tactic
      cy.get('.typewriter-input .monaco-editor .view-lines').type('rw [g]{enter}')

      // Wait for the goal state to update after first tactic
      goalShouldContain('x + x = 4', 10000)

      // Check that the progressive hint appears
      cy.contains('You should use h now').should('be.visible')
    })

    it('should show goal and hint in editor mode', () => {
      navigateToLevel()

      cy.get(".fa-code").click()

      cy.get('.codeview', { timeout: 60000 }).should('be.visible')
      cy.get('.infoview', { timeout: 60000 }).should('be.visible')
      cy.get('.infoview').contains('x + x = y', { timeout: 60000 })
      cy.get('.infoview').contains('You can either start using h or g.', { timeout: 60000 })

      cy.get('.codeview').type('rw [h]{enter}')

      goalShouldContain('2 + 2 = y', 60000)
      cy.get('.infoview').contains('2 + 2 = y', { timeout: 60000 })
      cy.get('.infoview').contains('You should use g now.', { timeout: 60000 })

      cy.focused().type('{uparrow}')
      cy.get('.infoview').contains('x + x = y', { timeout: 60000 })
      cy.get('.infoview').contains('You can either start using h or g.', { timeout: 60000 })

    })
  })

  describe('Tactics Panel and Documentation', () => {
    it('should display tactics panel with rfl and rw buttons', () => {
      navigateToLevel()

      // Check that tactics section exists, open it
      cy.get('.inventory').within(() => {
        cy.contains('Tactics').should('be.visible').click()
      })

      // Check for the specific tactics buttons
      cy.get('.inventory').within(() => {
        cy.contains('rfl').should('be.visible')
        cy.contains('rw').should('be.visible')
      })
    })

    it('should show tactic documentation when clicked', () => {
      navigateToLevel()
      cy.get('.inventory').within(() => {
        cy.contains('rfl').click()
      })
      cy.get('.documentation').within(() => {
        cy.contains('The way to proof reflexivity').should('be.visible')
      })
    })

    it('should show theorem documentation when clicked', () => {
      navigateToLevel()
      cy.get('.inventory').within(() => {
        cy.contains('Theorems').click()
        cy.contains('add_comm').click()
      })
      cy.get('.documentation').within(() => {
        cy.contains('Commutativity').should('be.visible')
      })
    })

    it('should show definition documentation when clicked', () => {
      navigateToLevel()
      cy.get('.inventory').within(() => {
        cy.contains('Definitions').click()
        cy.contains('==').click()
        cy.contains('equality').click()
      })
      cy.get('.documentation').within(() => {
        cy.contains('An equality').should('be.visible')
      })
    })
  })

  describe('Tactic Input and Goal Updates', () => {
    it('should accept tactic input and update goal state', () => {
      navigateToLevel()

      // Use typewriter interface (blue box at bottom)
      cy.get('.typewriter-input .monaco-editor .view-lines').type('rw [h]{enter}')

      // Wait for Lean to process the tactic
      // Should show updated goal state (proving the tactic was processed)
      goalShouldContain('2 + 2 = y', 10000)
    })

    it('should show error message when using invalid tactic call', () => {
      navigateToLevel()

      // Use typewriter interface to enter an invalid tactic
      cy.get('.typewriter-input .monaco-editor .view-lines').type('rw [x]{enter}')

      // Wait for the error message to appear
      cy.contains("Invalid rewrite argument", { timeout: 60000 })
    })
  })

  describe('Level Completion', () => {
    it('should complete the test level with proper solution', () => {
      navigateToLevel()

      // Solve the level step by step (based on the Lean file)
      cy.get('.typewriter-input .monaco-editor .view-lines').type('rw [h]{enter}')

      // Wait for the goal state to update after first tactic
      goalShouldContain('2 + 2 = y', 10000)

      // Enter second tactic
      cy.get('.typewriter-input .monaco-editor .view-lines').type('rw [g]{enter}')

      // Look for the completion message from the Lean file
      cy.contains('This last message appears if the level is solved.', { timeout: 60000 })
    })
  })


  describe('Unsolved Goals', () => {
    it('should show unsolved goals only in editor mode', () => {
      navigateToLevel()

      // Solve the level step by step (based on the Lean file)
      cy.get('.typewriter-input .monaco-editor .view-lines').type('rw [h]{enter}')

      // Wait for the goal state to update after first tactic
      goalShouldContain('2 + 2 = y', 10000)
      cy.contains('unsolved goals').should('not.exist')

      cy.get(".fa-code").click()
      cy.contains('unsolved goals').should('be.visible')
    })
  })

  describe('Hypothesis Names', () => {
    it('Should use player\'s hypothesis names in hints', () => {
      cy.visit('/#/g/test/TestGame/world/TestWorld/level/2')
      cy.contains('Assumptions:', { timeout: 60000 })

      cy.get('.typewriter-input .monaco-editor .view-lines').type('have myname : x + z = y + z := by rw [h]{enter}')

      // Check that the hint uses the player's hypothesis name `myname`
      cy.contains('You should use myname now')
    })
  })

  describe('Non-Prop Level', () => {
    it('Non-prop statements should be allowed', () => {
      cy.visit('/#/g/test/TestGame/world/TestWorld/level/3')
      cy.contains('intro first!', { timeout: 60000 }).should('be.visible')
      cy.get('.typewriter-input .monaco-editor .view-lines', { timeout: 60000 }).should('be.visible')
      cy.get('.typewriter-input .monaco-editor .view-lines').type('intro x{enter}')
      cy.contains('now apply!', { timeout: 10000 })
      cy.get('.typewriter-input .monaco-editor .view-lines').type('apply x{enter}')
      cy.contains('Done!', { timeout: 10000 })
    })
  })

  describe('Settings and Preferences', () => {
    const selectHintLanguage = (language: string) => {
      cy.get('.MuiSelect-select').click()
      cy.get('ul.MuiList-root[role="listbox"]', { timeout: 10000 }).should('be.visible').within(() => {
        cy.get(`li[data-value="${language}"]`).should('be.visible').click()
      })
    }

    it('should open preferences popup', () => {
      // Click menu button to open dropdown
      cy.get('#menu-btn').click()

      // Click preferences
      cy.contains('Preferences').click()

      // Check preferences popup opened
      cy.get('.MuiSlider-root').should('be.visible')

      // Close popup
      cy.get('body').click(0, 0)
    })

    it('should change language of hints to selected language if translation is available', () => {
      navigateToLevel()
      // Click menu button to open dropdown
      cy.get('#menu-btn').click()

      // Click preferences
      cy.contains('Preferences').click()

      // Select german language
      selectHintLanguage('de')

      // Close preferences
      cy.get('.codicon').click()

      // Check that displayed language is german
      cy.contains('Du kannst mit h oder g starten.').should('be.visible')
    })

    it('should not change language of hints to selected language if translation is not available', () => {
      navigateToLevel()
      // Click menu button to open dropdown
      cy.get('#menu-btn').click()

      // Click preferences
      cy.contains('Preferences').click()

      // Select mandarin language
      selectHintLanguage('zh')

      // Close preferences
      cy.get('.codicon').click()

      // Check that displayed language is english
      cy.contains('You can either start using h or g.').should('be.visible')
    })
  })
})
