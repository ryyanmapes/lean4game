const NNG4_ADDITION_LEVEL1 = '/#/g/local/NNG4/world/Addition/level/1/visual'
const LOAD_TIMEOUT = 600000

interface VisualTestHarness {
  dragHypToGoal(hypName: string): Promise<void>
  dragTacticToHyp(tacticName: string, hypName: string): Promise<void>
  clickGoal(playTactic?: string): Promise<void>
  openGoalTransform(): void
  openHypTransform(hypName: string): void
  rewriteGoalInTransform(theoremName: string, workingSide?: 'left' | 'right', path?: number[]): Promise<void>
  rewriteHypInTransform(theoremName: string, workingSide?: 'left' | 'right', path?: number[]): Promise<void>
  closeTransform(): void
  getTransformStatus(): {
    isOpen: boolean
    pendingSync: boolean
    targetKind: 'goal' | 'hyp' | null
    targetStreamId: string | null
  }
  getLastTransformRewriteDebug(): {
    playTactic: string
    focusedStreamId: string | null
    focusedGoalType: string | null
    focusedGoalUserName: string | null
    exactFocusedStreamIds: string[]
    exactFocusedGoalTypes: string[]
    exactFocusedUserNames: Array<string | null>
    reconciledFocusedStreamIds: string[]
    reconciledFocusedGoalTypes: string[]
    reconciledFocusedUserNames: Array<string | null>
    nextStreamId: string | null
    nextGoalType: string | null
    nextGoalUserName: string | null
    nextActiveId: string | null
    deferredCompletion: boolean
  } | null
  getCurrentStreamSnapshot(): {
    streamId: string
    displayStreamId: string | null
    goalType: string
    displayGoalType: string | null
    goalPlayTactic: string | null
    goalOptionTactics: string[]
    goalHasEqualityTree: boolean
    displayGoalHasEqualityTree: boolean | null
    currentStreamIsLive: boolean
    currentStreamIsCompleted: boolean
    streamInteractionsEnabled: boolean
    canvasStreamIds: string[]
    renderStreamIds: string[]
    hypTypes: Record<string, string>
  }
}

type VisualHarnessWindow = Cypress.AUTWindow & {
  __visualTestHarness?: VisualTestHarness
}

function visualHarness() {
  return cy.window({ timeout: 60000 }).then(win => {
    const harness = (win as VisualHarnessWindow).__visualTestHarness
    expect(harness).to.exist
    return harness as VisualTestHarness
  })
}

function watchGoalCardDoubleClicks() {
  cy.window().then(win => {
    ;(win as Cypress.AUTWindow & { __goalCardDblClicks?: number }).__goalCardDblClicks = 0
    win.document.querySelector('[data-testid="goal-card"]')?.addEventListener('dblclick', () => {
      ;(win as Cypress.AUTWindow & { __goalCardDblClicks?: number }).__goalCardDblClicks! += 1
    })
  })
}

describe('NNG4 Addition 1 induction transform mode', () => {
  beforeEach(() => {
    cy.on('uncaught:exception', () => false)
    cy.clearCookies()
    cy.clearLocalStorage()
    cy.visit(NNG4_ADDITION_LEVEL1)
    cy.get('[data-testid="visual-proof-page"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
    cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
  })

  it('can open transformation mode on the base-case goal after induction', () => {
    visualHarness().then(harness => harness.dragTacticToHyp('induction', 'n'))

    cy.get('[data-testid="stream-nav-label"]', { timeout: 60000 })
      .should('contain.text', 'Stream 1 of 2')

    visualHarness().then(harness => harness.getCurrentStreamSnapshot()).then(snapshot => {
      cy.log(JSON.stringify(snapshot))
      expect(snapshot.goalType).to.contain('0 + 0 = 0')
      expect(snapshot.streamInteractionsEnabled).to.equal(true)
    })

    watchGoalCardDoubleClicks()

    cy.get('[data-testid="goal-card"]', { timeout: 60000 }).should($goal => {
      expect($goal.attr('data-goal-text')).to.contain('0 + 0 = 0')
      expect($goal).to.have.class('transformable')
    }).dblclick()

    cy.window().its('__goalCardDblClicks').should('equal', 1)

    cy.get('.tr-back-btn', { timeout: 60000 }).should('be.visible')
  })

  it('can open transformation mode on the successor goal after induction', () => {
    visualHarness().then(harness => harness.dragTacticToHyp('induction', 'n'))

    cy.get('[data-testid="stream-nav-next"]', { timeout: 60000 }).click()
    cy.get('[data-testid="stream-nav-label"]', { timeout: 60000 })
      .should('contain.text', 'Stream 2 of 2')

    visualHarness().then(harness => harness.getCurrentStreamSnapshot()).then(snapshot => {
      cy.log(JSON.stringify(snapshot))
      expect(snapshot.goalType).to.contain('=')
      expect(snapshot.goalType).to.contain('succ')
      expect(snapshot.streamInteractionsEnabled).to.equal(true)
    })

    watchGoalCardDoubleClicks()

    cy.get('[data-testid="goal-card"]', { timeout: 60000 }).should($goal => {
      expect($goal.attr('data-goal-text')).to.contain('=')
      expect($goal.attr('data-goal-text')).to.contain('succ')
      expect($goal).to.have.class('transformable')
    }).dblclick()

    cy.window().its('__goalCardDblClicks').should('equal', 1)

    cy.get('.tr-back-btn', { timeout: 60000 }).should('be.visible')
  })

  it('keeps the base-case goal available until the player backs out and clicks rfl', () => {
    visualHarness().then(harness => harness.dragTacticToHyp('induction', 'n'))

    cy.get('[data-testid="goal-card"]', { timeout: 60000 }).should($goal => {
      expect($goal.attr('data-goal-text')).to.contain('0 + 0 = 0')
      expect($goal).to.have.class('transformable')
    }).dblclick()

    cy.get('.tr-back-btn', { timeout: 60000 }).should('be.visible')

    visualHarness().then(harness => harness.getTransformStatus()).then(status => {
      expect(status.targetStreamId).to.not.equal(null)
    })

    visualHarness().then(harness => harness.rewriteGoalInTransform('add_zero'))

    visualHarness().then(harness => harness.getLastTransformRewriteDebug()).then(debug => {
      expect(debug, 'rewrite debug should be captured').to.not.equal(null)
      expect(debug?.deferredCompletion, JSON.stringify(debug)).to.equal(false)
      expect(debug?.nextStreamId, JSON.stringify(debug)).to.not.equal(null)
      expect(debug?.nextGoalType, JSON.stringify(debug)).to.contain('0 = 0')
    })

    visualHarness().then(harness => harness.getTransformStatus()).then(status => {
      expect(status.isOpen).to.equal(true)
      expect(status.targetKind).to.equal('goal')
      expect(status.targetStreamId).to.not.equal(null)
    })

    visualHarness().then(harness => harness.getCurrentStreamSnapshot()).then(snapshot => {
      expect(snapshot.displayGoalType ?? snapshot.goalType).to.contain('0 = 0')
    })

    cy.get('[data-testid="stream-nav-label"]').should('contain.text', 'Stream 1 of 2')
    cy.get('.tr-back-btn').click()
    cy.get('[data-testid="stream-nav-label"]', { timeout: 60000 }).should('contain.text', 'Stream 1 of 2')

    visualHarness().then(harness => harness.getCurrentStreamSnapshot()).then(snapshot => {
      expect(snapshot.goalType).to.contain('0 = 0')
      expect(snapshot.goalPlayTactic).to.equal('click_goal')
      expect(snapshot.currentStreamIsCompleted).to.equal(false)
      expect(snapshot.streamInteractionsEnabled).to.equal(true)
    })

    visualHarness().then(harness => harness.clickGoal())
    cy.get('[data-testid="stream-nav-label"]', { timeout: 60000 }).should('contain.text', 'Stream 2 of 2')
  })

  it('keeps transform mode open after add_succ on the successor stream', () => {
    visualHarness().then(harness => harness.dragTacticToHyp('induction', 'n'))
    cy.get('[data-testid="stream-nav-next"]', { timeout: 60000 }).click()

    cy.get('[data-testid="goal-card"]', { timeout: 60000 }).should($goal => {
      expect($goal.attr('data-goal-text')).to.contain('succ')
      expect($goal).to.have.class('transformable')
    })
    visualHarness().then(harness => harness.openGoalTransform())

    cy.get('.tr-back-btn', { timeout: 60000 }).should('be.visible')
    visualHarness().then(harness => harness.rewriteGoalInTransform('add_succ'))

    visualHarness().then(harness => harness.getTransformStatus()).then(status => {
      expect(status.isOpen).to.equal(true)
      expect(status.targetKind).to.equal('goal')
    })

    cy.get('.tr-back-btn').should('be.visible')
    cy.get('[data-testid="stream-nav-label"]').should('contain.text', 'Stream 2 of 2')
  })

  it('keeps the base-case reflexive goal live even after the successor stream was solved first', () => {
    visualHarness().then(harness => harness.dragTacticToHyp('induction', 'n'))

    cy.get('[data-testid="stream-nav-next"]', { timeout: 60000 }).click()
    cy.get('[data-testid="stream-nav-label"]', { timeout: 60000 })
      .should('contain.text', 'Stream 2 of 2')

    cy.get('[data-testid="goal-card"]', { timeout: 60000 }).should($goal => {
      expect($goal.attr('data-goal-text')).to.contain('succ')
      expect($goal).to.have.class('transformable')
    })
    visualHarness().then(harness => harness.openGoalTransform())

    cy.get('.tr-back-btn', { timeout: 60000 }).should('be.visible')
    visualHarness().then(harness => harness.rewriteGoalInTransform('add_succ'))

    visualHarness().then(harness => harness.getCurrentStreamSnapshot()).then(snapshot => {
      expect(snapshot.displayGoalType ?? snapshot.goalType).to.contain('succ')
      expect(snapshot.displayGoalType ?? snapshot.goalType).to.match(/=\s*succ/)
    })

    cy.get('.tr-back-btn').click()
    visualHarness().then(harness => harness.dragHypToGoal('n_ih'))

    cy.get('[data-testid="stream-nav-label"]', { timeout: 60000 })
      .should('contain.text', 'Stream 1 of 2')

    visualHarness().then(harness => harness.getCurrentStreamSnapshot()).then(snapshot => {
      expect(snapshot.goalType).to.contain('0 + 0 = 0')
      expect(snapshot.currentStreamIsCompleted).to.equal(false)
      expect(snapshot.streamInteractionsEnabled).to.equal(true)
    })
    cy.get('[data-testid="goal-card"]', { timeout: 60000 }).should($goal => {
      expect($goal.attr('data-goal-text')).to.contain('0 + 0 = 0')
    }).dblclick()

    cy.get('.tr-back-btn', { timeout: 60000 }).should('be.visible')
    visualHarness().then(harness => harness.rewriteGoalInTransform('add_zero'))

    visualHarness().then(harness => harness.getLastTransformRewriteDebug()).then(debug => {
      expect(debug, 'rewrite debug should be captured').to.not.equal(null)
      expect(debug?.deferredCompletion, JSON.stringify(debug)).to.equal(false)
      expect(debug?.nextStreamId, JSON.stringify(debug)).to.not.equal(null)
      expect(debug?.nextGoalType, JSON.stringify(debug)).to.contain('0 = 0')
    })

    cy.get('.tr-back-btn').click()

    visualHarness().then(harness => harness.getCurrentStreamSnapshot()).then(snapshot => {
      expect(snapshot.goalType).to.contain('0 = 0')
      expect(snapshot.goalPlayTactic).to.equal('click_goal')
      expect(snapshot.currentStreamIsCompleted).to.equal(false)
      expect(snapshot.streamInteractionsEnabled).to.equal(true)
    })
  })

  it('keeps the switched successor goal live after applying n_ih', () => {
    let switchedGoalType = ''

    visualHarness().then(harness => harness.dragTacticToHyp('induction', 'n'))

    cy.get('[data-testid="stream-nav-label"]', { timeout: 60000 })
      .should('contain.text', 'Stream 1 of 2')
    cy.get('[data-testid="goal-card"]', { timeout: 60000 }).should($goal => {
      expect($goal.attr('data-goal-text')).to.contain('0 + 0 = 0')
      expect($goal).to.have.class('transformable')
    }).dblclick()

    cy.get('.tr-back-btn', { timeout: 60000 }).should('be.visible')
    visualHarness().then(harness => harness.rewriteGoalInTransform('add_zero'))
    cy.get('.tr-back-btn').click()

    visualHarness().then(harness => harness.getCurrentStreamSnapshot()).then(snapshot => {
      const goalText = snapshot.displayGoalType ?? snapshot.goalType
      if (goalText.includes('0 = 0') && snapshot.goalPlayTactic === 'click_goal') {
        return visualHarness().then(harness => harness.clickGoal())
      }
    })

    cy.get('[data-testid="stream-nav-label"]', { timeout: 60000 })
      .should('contain.text', 'Stream 2 of 2')

    visualHarness().then(harness => harness.dragHypToGoal('n_ih'))

    cy.get('[data-testid="stream-nav-label"]', { timeout: 60000 })
      .should('contain.text', 'Stream 2 of 2')

    visualHarness().then(harness => harness.getCurrentStreamSnapshot()).then(snapshot => {
      expect(snapshot.goalType).to.contain('=')
      expect(snapshot.goalType).to.not.contain('→')
      expect(snapshot.goalType).to.contain('succ')
      switchedGoalType = snapshot.goalType
      expect(snapshot.currentStreamIsCompleted).to.equal(false)
      expect(snapshot.streamInteractionsEnabled).to.equal(true)
    })

    cy.get('[data-testid="goal-card"]', { timeout: 60000 }).should($goal => {
      const goalText = $goal.attr('data-goal-text') ?? ''
      expect(goalText).to.contain('0 + succ')
      expect(goalText).to.contain('= succ')
    })
    cy.get('[data-testid="hyp-card"][data-hyp-name="n_ih"]', { timeout: 60000 })
      .should('be.visible')

    visualHarness().then(harness => harness.getCurrentStreamSnapshot()).then(snapshot => {
      expect(snapshot.goalType).to.equal(switchedGoalType)
      expect(snapshot.goalType).to.contain('succ')
      expect(snapshot.currentStreamIsCompleted).to.equal(false)
      expect(snapshot.streamInteractionsEnabled).to.equal(true)
    })
  })
})
