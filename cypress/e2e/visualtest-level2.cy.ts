const VISUALTEST_LEVEL2 = '/#/g/local/VisualTest/world/Prototype/level/2/visual'

interface VisualTestHarness {
  dragHypToGoal(hypName: string): Promise<void>
  dragHypToHyp(sourceName: string, targetName: string): Promise<void>
  clickHyp(hypName: string): Promise<void>
  getCurrentStreamSnapshot(): {
    streamId: string
    goalType: string
    hypTypes: Record<string, string>
  }
}

type VisualHarnessWindow = Cypress.AUTWindow & {
  __visualTestHarness?: VisualTestHarness
}

function visitVisualTestLevel2() {
  cy.visit(VISUALTEST_LEVEL2)
  cy.get('[data-testid="visual-proof-page"]', { timeout: 60000 }).should('be.visible')
  cy.get('[data-testid="goal-card"]', { timeout: 60000 }).should('be.visible')
}

function goalCard() {
  return cy.get('[data-testid="goal-card"]', { timeout: 60000 })
}

function goalTextShouldContain(text: string) {
  goalCard()
    .should('have.attr', 'data-goal-text')
    .then(goalText => {
      expect(goalText).to.contain(text)
    })
}

function hypCard(name: string) {
  return cy.get(`[data-testid="hyp-card"][data-hyp-name="${name}"]`, { timeout: 60000 })
    .filter(':visible')
}

function clickHyp(name: string) {
  hypCard(name).then(cards => {
    const element = cards.get(0)
    expect(element).to.exist
    ;(element as HTMLElement).click()
  })
}

function hypTypeShouldContain(name: string, text: string) {
  cy.window({ timeout: 60000 }).should(win => {
    const harness = (win as VisualHarnessWindow).__visualTestHarness
    expect(harness).to.exist
    const snapshot = harness!.getCurrentStreamSnapshot()
    expect(snapshot.hypTypes[name]).to.contain(text)
  })
}

function playLogEntries() {
  return cy.window().then(win => {
    const raw = win.localStorage.getItem('playlog/Prototype/2')
    return raw ? JSON.parse(raw) : []
  })
}

function clickGoal() {
  goalCard().click()
}

function lastPlayTacticShouldBe(playTactic: string) {
  cy.window({ timeout: 60000 }).should(win => {
    const raw = win.localStorage.getItem('playlog/Prototype/2')
    const entries = raw ? JSON.parse(raw) : []
    expect(entries.length).to.be.greaterThan(0)
    expect(entries.at(-1)?.playTactic).to.equal(playTactic)
    expect(entries.at(-1)?.succeeded).to.equal(true)
  })
}

function visualHarness() {
  return cy.window({ timeout: 60000 }).then(win => {
    const harness = (win as VisualHarnessWindow).__visualTestHarness
    expect(harness).to.exist
    return harness as VisualTestHarness
  })
}

function dragHypToGoal(name: string) {
  return visualHarness().then(harness => harness.dragHypToGoal(name))
}

function dragHypToHyp(sourceName: string, targetName: string) {
  return visualHarness().then(harness => harness.dragHypToHyp(sourceName, targetName))
}

function clickHypViaHarness(name: string) {
  return visualHarness().then(harness => harness.clickHyp(name))
}

function clickNextStream() {
  cy.get('[data-testid="stream-nav-next"]', { timeout: 60000 }).click()
}

function clickPreviousStream() {
  cy.get('[data-testid="stream-nav-prev"]', { timeout: 60000 }).click()
}

function streamLabelShouldBe(current: number, total: number) {
  cy.get('[data-testid="stream-nav-label"]', { timeout: 60000 })
    .should('have.attr', 'data-current-stream-index', String(current))
    .and('have.attr', 'data-total-streams', String(total))
    .and('contain.text', `Stream ${current} of ${total}`)
}

function proofTreeShouldHaveUniqueStreamIds() {
  cy.get('[data-testid="proof-stream-leaf"]', { timeout: 60000 })
    .map((leaf: HTMLElement) => leaf.dataset.streamId ?? '')
    .then(streamIds => {
      expect(streamIds).to.have.length.greaterThan(0)
      expect(new Set(streamIds).size).to.equal(streamIds.length)
    })
}

function proofTreeShouldHighlightExactlyOneCurrentLeaf() {
  cy.get('[data-testid="stream-nav-label"]', { timeout: 60000 })
    .invoke('attr', 'data-current-stream-id')
    .then(currentStreamId => {
      expect(currentStreamId).to.be.a('string').and.not.be.empty
      cy.get('[data-testid="proof-stream-leaf"][data-current="true"]', { timeout: 60000 })
        .should('have.length', 1)
        .and('have.attr', 'data-stream-id', currentStreamId as string)
    })
}

function buildThreeStreams() {
  clickGoal()
  hypCard('h').should('be.visible')

  clickGoal()
  hypCard('h2').should('be.visible')

  clickGoal()
  streamLabelShouldBe(1, 2)
  goalTextShouldContain('A ∧ B')

  clickGoal()
  streamLabelShouldBe(1, 3)
  goalTextShouldContain('A')
  cy.get('[data-testid="proof-stream-leaf"]').should('have.length', 3)
  proofTreeShouldHaveUniqueStreamIds()
  proofTreeShouldHighlightExactlyOneCurrentLeaf()
}

describe('VisualTest Level 2', () => {
  beforeEach(() => {
    cy.on('uncaught:exception', () => false)
    cy.clearCookies()
    cy.clearLocalStorage()
    visitVisualTestLevel2()
  })

  it('keeps the three proof streams in the expected order', () => {
    buildThreeStreams()

    clickNextStream()
    streamLabelShouldBe(2, 3)
    goalTextShouldContain('B')
    proofTreeShouldHaveUniqueStreamIds()
    proofTreeShouldHighlightExactlyOneCurrentLeaf()

    clickNextStream()
    streamLabelShouldBe(3, 3)
    goalTextShouldContain('C')
    proofTreeShouldHaveUniqueStreamIds()
    proofTreeShouldHighlightExactlyOneCurrentLeaf()

    clickPreviousStream()
    streamLabelShouldBe(2, 3)
    goalTextShouldContain('B')
    proofTreeShouldHaveUniqueStreamIds()
    proofTreeShouldHighlightExactlyOneCurrentLeaf()
  })

  it('splits h2 on the middle stream without jumping to the wrong goal', () => {
    buildThreeStreams()

    clickNextStream()
    streamLabelShouldBe(2, 3)
    goalTextShouldContain('B')
    hypCard('h2').should('have.class', 'clickable')
    proofTreeShouldHaveUniqueStreamIds()
    proofTreeShouldHighlightExactlyOneCurrentLeaf()

    playLogEntries().then(entriesBefore => {
      clickHyp('h2')
      cy.window().should(win => {
        const raw = win.localStorage.getItem('playlog/Prototype/2')
        const entriesAfter = raw ? JSON.parse(raw) : []
        expect(entriesAfter.length).to.equal(entriesBefore.length + 1)
        expect(entriesAfter.at(-1)?.playTactic).to.equal('click_prop h2')
        expect(entriesAfter.at(-1)?.succeeded).to.equal(true)
      })
    })

    streamLabelShouldBe(2, 3)
    goalTextShouldContain('B')
    hypCard('left').should('be.visible')
    hypCard('right').should('be.visible')
    cy.get('[data-testid="hyp-card"][data-hyp-name="h2"]').should('not.exist')
    proofTreeShouldHaveUniqueStreamIds()
    proofTreeShouldHighlightExactlyOneCurrentLeaf()
  })

  it('keeps the split middle stream stable while navigating to the C branch and back', () => {
    buildThreeStreams()

    clickNextStream()
    clickHyp('h2')
    hypCard('left').should('be.visible')
    hypCard('right').should('be.visible')
    goalTextShouldContain('B')

    clickNextStream()

    streamLabelShouldBe(3, 3)
    goalTextShouldContain('C')
    proofTreeShouldHaveUniqueStreamIds()
    proofTreeShouldHighlightExactlyOneCurrentLeaf()

    clickPreviousStream()
    streamLabelShouldBe(2, 3)
    goalTextShouldContain('B')
    hypCard('left').should('be.visible')
    hypCard('right').should('be.visible')
    proofTreeShouldHaveUniqueStreamIds()
    proofTreeShouldHighlightExactlyOneCurrentLeaf()
  })

  it('completes the entire proof through all three streams', () => {
    buildThreeStreams()

    dragHypToGoal('h')
    lastPlayTacticShouldBe('drag_goal h')
    streamLabelShouldBe(2, 3)
    goalTextShouldContain('B')
    proofTreeShouldHaveUniqueStreamIds()
    proofTreeShouldHighlightExactlyOneCurrentLeaf()

    clickHypViaHarness('h2')
    lastPlayTacticShouldBe('click_prop h2')
    hypCard('left').should('be.visible')
    hypCard('right').should('be.visible')
    goalTextShouldContain('B')
    proofTreeShouldHaveUniqueStreamIds()
    proofTreeShouldHighlightExactlyOneCurrentLeaf()

    dragHypToGoal('left')
    lastPlayTacticShouldBe('drag_goal left')
    streamLabelShouldBe(3, 3)
    goalTextShouldContain('C')
    proofTreeShouldHaveUniqueStreamIds()
    proofTreeShouldHighlightExactlyOneCurrentLeaf()

    clickHypViaHarness('h2')
    lastPlayTacticShouldBe('click_prop h2')
    hypCard('left').should('be.visible')
    hypCard('right').should('be.visible')
    goalTextShouldContain('C')
    proofTreeShouldHaveUniqueStreamIds()
    proofTreeShouldHighlightExactlyOneCurrentLeaf()

    dragHypToHyp('h', 'right')
    lastPlayTacticShouldBe('drag_to h right')
    streamLabelShouldBe(3, 3)
    goalTextShouldContain('C')
    hypTypeShouldContain('h', 'B')
    hypTypeShouldContain('h', 'C')
    proofTreeShouldHaveUniqueStreamIds()
    proofTreeShouldHighlightExactlyOneCurrentLeaf()

    dragHypToHyp('left', 'h')
    lastPlayTacticShouldBe('drag_to left h')
    streamLabelShouldBe(3, 3)
    goalTextShouldContain('C')
    hypTypeShouldContain('left', 'C')
    proofTreeShouldHaveUniqueStreamIds()
    proofTreeShouldHighlightExactlyOneCurrentLeaf()

    dragHypToGoal('left')
    lastPlayTacticShouldBe('drag_goal left')

    cy.get('.completion-banner-title', { timeout: 60000 }).should('contain.text', 'Proof complete!')
    cy.get('.completion-banner-sub', { timeout: 60000 }).should('contain.text', 'All goals have been solved.')
    cy.get('[data-testid="proof-stream-leaf"][data-completed="true"]', { timeout: 60000 })
      .should('have.length', 3)
    proofTreeShouldHaveUniqueStreamIds()

    playLogEntries().then(entries => {
      expect(entries.map(entry => entry.playTactic)).to.deep.equal([
        'click_goal',
        'click_goal',
        'click_goal',
        'click_goal',
        'drag_goal h',
        'click_prop h2',
        'drag_goal left',
        'click_prop h2',
        'drag_to h right',
        'drag_to left h',
        'drag_goal left',
      ])
      expect(entries.every(entry => entry.succeeded === true)).to.equal(true)
    })
  })
})
