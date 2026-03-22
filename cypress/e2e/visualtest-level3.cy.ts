const VISUALTEST_LEVEL3 = '/#/g/local/VisualTest/world/Prototype/level/3/visual'
const VISUALTEST_LOAD_TIMEOUT = 120000

interface VisualTestHarness {
  dragHypToGoal(hypName: string): Promise<void>
  dragHypToHyp(sourceName: string, targetName: string): Promise<void>
  clickHyp(hypName: string): Promise<void>
  clickGoal(playTactic?: string): Promise<void>
  getCurrentStreamSnapshot(): {
    streamId: string
    goalType: string
    goalPlayTactic: string | null
    goalOptionTactics: string[]
    hypTypes: Record<string, string>
    hypPlayTactics: Record<string, string | null>
    hypOptionTactics: Record<string, string[]>
  }
}

type VisualHarnessWindow = Cypress.AUTWindow & {
  __visualTestHarness?: VisualTestHarness
}

function normalizeFormula(text: string) {
  return text.replace(/\s+/g, ' ').trim()
}

function isDisjunctionGoal(text: string) {
  return text.includes('∨') || text.includes(' Or ') || text.startsWith('Or ')
}

function visitVisualTestLevel3() {
  cy.visit(VISUALTEST_LEVEL3)
  cy.get('[data-testid="visual-proof-page"]', { timeout: VISUALTEST_LOAD_TIMEOUT }).should('be.visible')
  cy.get('[data-testid="goal-card"]', { timeout: VISUALTEST_LOAD_TIMEOUT }).should('be.visible')
}

function goalCard() {
  return cy.get('[data-testid="goal-card"]', { timeout: 60000 })
}

function goalChoiceMenu() {
  return cy.get('[data-testid="goal-choice-menu"]', { timeout: 60000 })
}

function goalChoiceOption(playTactic: string) {
  return cy.get(
    `[data-testid="goal-choice-option"][data-play-tactic="${playTactic}"]`,
    { timeout: 60000 },
  )
}

function goalTextShouldContain(text: string) {
  goalCard()
    .should('have.attr', 'data-goal-text')
    .then(goalText => {
      expect(goalText).to.contain(text)
    })
}

function clickGoal() {
  goalCard()
    .should('have.class', 'clickable')
    .click({ force: true })
}

function chooseGoalOption(playTactic: string) {
  goalChoiceOption(playTactic).click()
}

function hypCard(name: string) {
  return cy.get(`[data-testid="hyp-card"][data-hyp-name="${name}"]:visible`, { timeout: 60000 })
}

function visibleHypNameMatching(
  predicate: (type: string, name: string) => boolean,
  description: string,
) {
  return cy.get('[data-testid="hyp-card"]:visible', { timeout: 60000 })
    .should(cards => {
      const match = Array.from(cards).find(card => {
        const element = card as HTMLElement
        const type = normalizeFormula(element.dataset.hypType ?? '')
        const name = element.dataset.hypName ?? ''
        return predicate(type, name)
      })
      expect(match, description).to.exist
    })
    .then(cards => {
      const match = Array.from(cards).find(card => {
        const element = card as HTMLElement
        const type = normalizeFormula(element.dataset.hypType ?? '')
        const name = element.dataset.hypName ?? ''
        return predicate(type, name)
      }) as HTMLElement | undefined
      return match!.dataset.hypName as string
    })
}

function playLogEntries() {
  return cy.window().then(win => {
    const raw = win.localStorage.getItem('playlog/Prototype/3')
    return raw ? JSON.parse(raw) : []
  })
}

function lastPlayTacticShouldBe(playTactic: string) {
  cy.window({ timeout: 60000 }).should(win => {
    const raw = win.localStorage.getItem('playlog/Prototype/3')
    const entries = raw ? JSON.parse(raw) : []
    expect(entries.length).to.be.greaterThan(0)
    expect(entries.at(-1)?.playTactic).to.equal(playTactic)
    expect(entries.at(-1)?.succeeded).to.equal(true)
  })
}

function lastPlayTacticShouldMatch(pattern: RegExp) {
  cy.window({ timeout: 60000 }).should(win => {
    const raw = win.localStorage.getItem('playlog/Prototype/3')
    const entries = raw ? JSON.parse(raw) : []
    expect(entries.length).to.be.greaterThan(0)
    expect(entries.at(-1)?.playTactic).to.match(pattern)
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

function currentStreamSnapshot() {
  return visualHarness().then(harness => harness.getCurrentStreamSnapshot())
}

function dragHypToGoal(name: string) {
  return visualHarness().then(harness => harness.dragHypToGoal(name))
}

function clickHypViaHarness(name: string) {
  return visualHarness().then(harness => harness.clickHyp(name))
}

function clickGoalViaHarness(playTactic?: string) {
  return visualHarness().then(harness => harness.clickGoal(playTactic))
}

function streamLabelShouldBe(current: number, total: number) {
  cy.get('[data-testid="stream-nav-label"]', { timeout: 60000 })
    .should('have.attr', 'data-current-stream-index', String(current))
    .and('have.attr', 'data-total-streams', String(total))
    .and('contain.text', `Stream ${current} of ${total}`)
}

function focusRemainingOrBranch() {
  return cy.get('[data-testid="stream-nav-label"]', { timeout: 60000 })
    .should('have.attr', 'data-total-streams', '2')
    .should('have.attr', 'data-current-stream-index', '2')
    .then(() => {
      streamLabelShouldBe(2, 2)
      return visibleHypNameMatching(
        type => type === 'A' || type === 'B',
        'expected the remaining Or branch to expose either an A or B hypothesis',
      )
    })
}

function goalChoiceMenuShouldBeWiderThanGoal(extraWidth = 60) {
  goalCard().then($goal => {
    const goalWidth = $goal.get(0)!.getBoundingClientRect().width
    goalChoiceMenu().then($menu => {
      const menuWidth = $menu.get(0)!.getBoundingClientRect().width
      expect(menuWidth).to.be.greaterThan(goalWidth + extraWidth)
    })
  })
}

function solveCurrentOrBranch() {
  return visibleHypNameMatching(
    type => type === 'A' || type === 'B',
    'expected the current branch to expose either an A or B hypothesis',
  ).then(hypName => {
    return hypCard(hypName)
      .invoke('attr', 'data-hyp-type')
      .then(hypType => {
        const normalizedType = normalizeFormula(String(hypType ?? ''))
        return currentStreamSnapshot().then(snapshot => {
          const normalizedGoal = normalizeFormula(snapshot.goalType)
          const expectedGoalTactic = normalizedType === 'A' ? 'click_goal_right' : 'click_goal_left'
          if (isDisjunctionGoal(normalizedGoal)) {
            expect(
              snapshot.goalOptionTactics,
              `expected goal ${normalizedGoal} to offer a branch selector before solving with ${hypName}`,
            ).to.include(expectedGoalTactic)
          }
          return goalCard()
            .invoke('attr', 'data-goal-text')
            .then(goalText => {
              expect(normalizeFormula(String(goalText ?? ''))).to.equal(normalizedGoal)
            })
            .then(() => {
              if (!isDisjunctionGoal(normalizedGoal)) {
                return dragHypToGoal(hypName)
                  .then(() => {
                    lastPlayTacticShouldMatch(/^drag_goal /)
                  })
              }
              return clickGoalViaHarness(expectedGoalTactic)
                .then(() => {
                  lastPlayTacticShouldBe(expectedGoalTactic)
                  return goalCard()
                    .should($goal => {
                      const goalText = $goal.attr('data-goal-text') ?? ''
                      expect(normalizeFormula(goalText)).to.equal(normalizedType)
                    })
                    .then(() => currentStreamSnapshot())
                    .then(updatedSnapshot => {
                      expect(normalizeFormula(updatedSnapshot.goalType)).to.equal(normalizedType)
                      return dragHypToGoal(hypName)
                    })
                })
                .then(() => {
                  lastPlayTacticShouldMatch(/^drag_goal /)
                })
            })
        })
      })
  })
}

function findOrAssumptionName(hypTypes: Record<string, string>) {
  return Object.entries(hypTypes)
    .find(([, type]) => {
      const normalized = normalizeFormula(type)
      return normalized !== 'A' && normalized !== 'B' && normalized.includes('A') && normalized.includes('B')
    })?.[0]
}

function ensureOrAssumptionName() {
  return currentStreamSnapshot().then(snapshot => {
    const existing = findOrAssumptionName(snapshot.hypTypes)
    if (existing) return existing

    return clickGoalViaHarness()
      .then(() => {
        lastPlayTacticShouldBe('click_goal')

        return visibleHypNameMatching(
          type => type !== 'A' && type !== 'B' && type.includes('A') && type.includes('B'),
          'expected the implication intro to expose an A or B disjunction hypothesis',
        )
      })
  })
}

describe('VisualTest Level 3', () => {
  beforeEach(() => {
    cy.on('uncaught:exception', () => false)
    cy.clearCookies()
    cy.clearLocalStorage()
    visitVisualTestLevel3()
  })

  it('shows a wider goal-choice menu for the disjunction branch selector', () => {
    clickGoal()

    goalChoiceMenu().should('be.visible')
    goalChoiceMenuShouldBeWiderThanGoal()
    goalChoiceOption('click_goal_right')
      .should('be.visible')
      .and('contain.text', 'Right')
      .and('contain.text', 'A')
      .and('contain.text', 'B')
      .then($option => {
        const optionWidth = $option.get(0)!.getBoundingClientRect().width
        expect(optionWidth).to.be.greaterThan(160)
      })
  })

  it('does not auto-complete when choosing the right disjunction branch', () => {
    clickGoal()
    chooseGoalOption('click_goal_right')

    lastPlayTacticShouldBe('click_goal_right')
    cy.get('.completion-banner-title').should('not.exist')
    goalCard().should($goal => {
      const goalText = $goal.attr('data-goal-text') ?? ''
      expect(goalText).to.contain('B')
      expect(goalText).not.to.contain('Z')
    })
  })

  it('makes the player complete the full proof across both Or branches', () => {
    clickGoal()
    chooseGoalOption('click_goal_right')
    lastPlayTacticShouldBe('click_goal_right')

    ensureOrAssumptionName().then(orHypName => {
      clickHypViaHarness(orHypName)
    })
    streamLabelShouldBe(1, 2)
    goalTextShouldContain('B')

    solveCurrentOrBranch()
    cy.get('.completion-banner-title').should('not.exist')
    focusRemainingOrBranch()

    solveCurrentOrBranch()

    cy.get('.completion-banner-title', { timeout: 60000 }).should('contain.text', 'Proof complete!')
    cy.get('.completion-banner-sub', { timeout: 60000 }).should('contain.text', 'All goals have been solved.')
    cy.get('[data-testid="proof-stream-leaf"][data-completed="true"]', { timeout: 60000 })
      .should('have.length', 2)

    playLogEntries().then(entries => {
      const tactics = entries.map(entry => entry.playTactic)
      expect(tactics[0]).to.equal('click_goal_right')
      expect(tactics.filter((tactic: string) => tactic === 'click_goal')).to.have.length.at.most(1)
      expect(tactics.filter((tactic: string) => tactic.startsWith('click_prop '))).to.have.length(1)
      expect(tactics.filter((tactic: string) => tactic === 'click_goal_left')).to.have.length(1)
      expect(tactics.filter((tactic: string) => tactic === 'click_goal_right')).to.have.length(2)
      expect(tactics.filter((tactic: string) => tactic.startsWith('drag_goal '))).to.have.length(2)
      expect(entries.every(entry => entry.succeeded === true)).to.equal(true)
    })
  })

  it('translates the completed visual proof to vanilla Lean', () => {
    clickGoal()
    chooseGoalOption('click_goal_right')
    lastPlayTacticShouldBe('click_goal_right')

    ensureOrAssumptionName().then(orHypName => {
      clickHypViaHarness(orHypName)
    })

    solveCurrentOrBranch()
    focusRemainingOrBranch()
    solveCurrentOrBranch()

    cy.get('.completion-banner-title', { timeout: 60000 }).should('contain.text', 'Proof complete!')

    playLogEntries().then(entries => {
      expect(entries.map(entry => entry.leanTactic)).to.deep.equal([
        'right',
        'intro h',
        'cases h',
        'right',
        'exact left',
        'left',
        'exact right',
      ])
    })

    cy.contains('button', 'View Proof').click()
    cy.get('.proof-steps-table tbody tr').should('have.length', 7)
    cy.get('.proof-steps-table tbody tr').then(rows => {
      const leanTactics = Array.from(rows).map(row => {
        const cells = row.querySelectorAll('td')
        return (cells[2]?.textContent ?? '').trim()
      })
      expect(leanTactics).to.deep.equal([
        'right',
        'intro h',
        'cases h',
        'right',
        'exact left',
        'left',
        'exact right',
      ])
    })
    cy.get('.proof-steps-table tbody td.lean-tactic')
      .should('not.contain.text', 'click_prop')
      .and('not.contain.text', 'drag_goal')
  })
})
