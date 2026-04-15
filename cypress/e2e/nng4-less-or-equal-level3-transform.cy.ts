const NNG4_LESS_OR_EQUAL_LEVEL3 = '/#/g/local/NNG4/world/LessOrEqual/level/3/visual'
const LOAD_TIMEOUT = 600000

interface VisualTestHarness {
  clickGoal(playTactic?: string): Promise<void>
  openGoalTransform(): void
  rewriteGoalInTransform(
    theoremName: string,
    workingSide?: 'left' | 'right',
    path?: number[],
    isReverse?: boolean,
  ): Promise<void>
  getTransformStatus(): {
    isOpen: boolean
    pendingSync: boolean
    targetKind: 'goal' | 'hyp' | null
    targetStreamId: string | null
  }
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

function goalCard() {
  return cy.get('[data-testid="goal-card"]', { timeout: 60000 })
}

function normalizeExpr(text: string) {
  return text
    .replace(/\s+/g, '')
    .replace(/succ\(([^()]+)\)/g, 'succ$1')
}

function expectReflexiveEquality(goalText: string) {
  const parts = goalText.split(' = ')
  expect(parts, goalText).to.have.length(2)
  expect(normalizeExpr(parts[0]!)).to.equal(normalizeExpr(parts[1]!))
}

describe('NNG4 LessOrEqual level 3 transformation mode', () => {
  beforeEach(() => {
    cy.on('uncaught:exception', () => false)
    cy.viewport(1600, 1200)
    cy.clearCookies()
    cy.clearLocalStorage()
    cy.visit(NNG4_LESS_OR_EQUAL_LEVEL3)
    cy.get('[data-testid="visual-proof-page"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
    goalCard().should('be.visible')
  })

  it('keeps the reflexive succ goal live until the player backs out and clicks it', () => {
    goalCard().should('have.class', 'constructable').dblclick()
    cy.get('.cn-propose-label', { timeout: 60000 }).should('contain.text', 'Propose')
    cy.contains('button.cn-brick', /^1$/).click()
    cy.get('.cn-done-btn', { timeout: 60000 }).click()

    goalCard().should($goal => {
      const goalText = $goal.attr('data-goal-text') ?? ''
      expect(goalText).to.contain('succ')
      expect(goalText).to.contain('+ 1')
    })

    goalCard().should('have.class', 'transformable').dblclick()
    cy.get('.tr-back-btn', { timeout: 60000 }).should('be.visible')

    visualHarness().then(harness =>
      harness.rewriteGoalInTransform('succ_eq_add_one', 'right', undefined, true)
    )

    cy.wait(900)
    cy.get('.tr-back-btn').should('be.visible')

    visualHarness().then(harness => harness.getTransformStatus()).then(status => {
      expect(status.isOpen).to.equal(true)
      expect(status.targetKind).to.equal('goal')
    })

    visualHarness().then(harness => harness.getCurrentStreamSnapshot()).then(snapshot => {
      const goalText = snapshot.goalType
      expect(goalText).to.contain('succ')
      expectReflexiveEquality(goalText)
      expect(snapshot.currentStreamIsCompleted).to.equal(false)
      expect(snapshot.streamInteractionsEnabled).to.equal(true)
    })

    cy.get('.tr-back-btn').click()

    goalCard().should('have.class', 'clickable').should($goal => {
      const goalText = $goal.attr('data-goal-text') ?? ''
      expect(goalText).to.contain('succ')
      expectReflexiveEquality(goalText)
    })

    visualHarness().then(harness => harness.clickGoal())
    cy.wait(900)
    cy.window({ timeout: 60000 }).should(win => {
      const raw = win.localStorage.getItem('playlog/LessOrEqual/3')
      const entries = raw ? JSON.parse(raw) : []
      expect(entries.length).to.be.greaterThan(0)
      expect(entries.at(-1)?.playTactic).to.equal('click_goal')
      expect(entries.at(-1)?.succeeded).to.equal(true)
    })
    goalCard().should('have.class', 'solved')
  })

  it('keeps the construction undo button inset from the left border when the proof tab is open', () => {
    cy.get('.proof-sidebar-tab').click()
    cy.get('.proof-sidebar').should('have.class', 'open')

    goalCard().should('have.class', 'constructable').dblclick()
    cy.get('.visual-page.tr-construction-overlay .cn-propose-label', { timeout: 60000 })
      .should('be.visible')

    cy.get('body').then($body => {
      const mainAreaEl = $body.find('.visual-page.tr-construction-overlay .tr-main-area').get(0)
      const undoEl = $body.find('.visual-page.tr-construction-overlay .tr-controls .tr-ctrl-btn[title="Undo last fill"]').get(0)
      const doneEl = $body.find('.visual-page.tr-construction-overlay .tr-side-controls .cn-done-btn').get(0)
      const dockEl = $body.find('.visual-page.tr-construction-overlay .tr-rule-dock').get(0)

      expect(mainAreaEl, 'construction main area').to.exist
      expect(undoEl, 'undo button').to.exist
      expect(doneEl, 'done button').to.exist
      expect(dockEl, 'brick dock').to.exist

      const mainAreaRect = mainAreaEl!.getBoundingClientRect()
      const undoRect = undoEl!.getBoundingClientRect()
      const doneRect = doneEl!.getBoundingClientRect()
      const dockRect = dockEl!.getBoundingClientRect()

      expect(undoRect.bottom, 'undo button should sit above the brick dock').to.be.at.most(dockRect.top + 6)
      expect(doneRect.bottom, 'done button should sit above the brick dock').to.be.at.most(dockRect.top + 6)
      expect(
        Math.abs((undoRect.left - mainAreaRect.left) - (mainAreaRect.right - doneRect.right)),
        'undo and done should be the same distance from the construction panel borders'
      ).to.be.lessThan(8)
    })
  })

  it('keeps the lower transformation controls symmetric above the dock on mobile landscape', () => {
    cy.viewport(844, 390)
    cy.visit(NNG4_LESS_OR_EQUAL_LEVEL3)
    cy.get('[data-testid="visual-proof-page"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
    goalCard().should('be.visible')

    goalCard().should('have.class', 'constructable').dblclick()
    cy.get('.cn-propose-label', { timeout: 60000 }).should('contain.text', 'Propose')
    cy.contains('button.cn-brick', /^1$/).click()
    cy.get('.cn-done-btn', { timeout: 60000 }).click()

    goalCard().should('have.class', 'transformable').dblclick()

    cy.get('body').then($body => {
      const mainAreaEl = $body.find('.visual-page.tr-transformation-overlay .tr-main-area').get(0)
      const undoEl = $body.find('.visual-page.tr-transformation-overlay .tr-controls .tr-ctrl-btn[title="Undo"]').get(0)
      const reverseEl = $body.find('.visual-page.tr-transformation-overlay .tr-side-controls .tr-ctrl-btn[title^="Mode:"]').get(0)
      const dockEl = $body.find('.visual-page.tr-transformation-overlay .tr-rule-dock').get(0)

      expect(mainAreaEl, 'transformation main area').to.exist
      expect(undoEl, 'undo button').to.exist
      expect(reverseEl, 'reverse toggle').to.exist
      expect(dockEl, 'rule dock').to.exist

      const mainAreaRect = mainAreaEl!.getBoundingClientRect()
      const undoRect = undoEl!.getBoundingClientRect()
      const reverseRect = reverseEl!.getBoundingClientRect()
      const dockRect = dockEl!.getBoundingClientRect()

      expect(undoRect.width, 'undo button width').to.be.greaterThan(20)
      expect(reverseRect.width, 'reverse button width').to.be.greaterThan(20)
      expect(Math.abs(undoRect.top - reverseRect.top), 'undo and reverse should align vertically').to.be.lessThan(8)
      expect(undoRect.bottom, 'undo button should sit above the rule dock').to.be.at.most(dockRect.top + 6)
      expect(reverseRect.bottom, 'reverse button should sit above the rule dock').to.be.at.most(dockRect.top + 6)
      expect(reverseRect.left, 'reverse should remain on the right side of the panel').to.be.greaterThan(undoRect.right + 120)
      expect(
        Math.abs((undoRect.left - mainAreaRect.left) - (mainAreaRect.right - reverseRect.right)),
        'undo and reverse should be the same distance from the panel borders'
      ).to.be.lessThan(8)
    })
  })
})
