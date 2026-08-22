import { CompletePlaythroughDriver } from '../support/completePlaythroughDriver'

const LOAD_TIMEOUT = Number(Cypress.env('VISUAL_TIMEOUT') ?? 600_000)
const mountPath = Cypress.env('LEAN4GAME_MOUNT') ?? '/lean4game/index.html'

interface VisualHarness {
  dragHypToHyp(sourceName: string, targetName: string): Promise<void>
  getProofAudit(): {
    completed: boolean
    processing: boolean
    coreLines: string[]
    interactiveLines: string[]
  }
}

type HarnessWindow = Cypress.AUTWindow & { __visualTestHarness?: VisualHarness }

function visualHarness() {
  return cy.window({ timeout: LOAD_TIMEOUT }).then(win => {
    const harness = (win as HarnessWindow).__visualTestHarness
    expect(harness).to.exist
    return harness as VisualHarness
  })
}

function openLastIncompleteBranch() {
  cy.get('[data-testid="proof-stream-leaf"][data-completed="false"]', { timeout: LOAD_TIMEOUT })
    .last()
    .then(leaf => {
      const streamId = leaf.attr('data-stream-id')
      expect(streamId, 'incomplete proof leaf stream id').to.be.a('string').and.not.be.empty
      cy.wrap(leaf).click({ force: true })
      cy.get(
        `[data-testid="proof-stream-leaf"][data-stream-id="${CSS.escape(streamId!)}"]`,
        { timeout: LOAD_TIMEOUT },
      ).should('have.attr', 'data-current', 'true')
      cy.get(
        `[data-testid="goal-card"][data-stream-id="${CSS.escape(streamId!)}"]`,
        { timeout: LOAD_TIMEOUT },
      ).should('be.visible')
    })
}

describe('LessOrEqual level 8 goal choices', () => {
  it('keeps the induction warning after y is introduced before inducting x', () => {
    cy.viewport(1440, 900)
    cy.visit(`${mountPath}#/g/local/NNG4/world/LessOrEqual/level/8/visual`)
    cy.get('[data-testid="visual-proof-page"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
    cy.contains('.goal-info', "Induct after ONLY 'x' is introduced").should('be.visible')

    cy.window({ timeout: LOAD_TIMEOUT }).then({ timeout: LOAD_TIMEOUT }, async win => {
      const player = new CompletePlaythroughDriver(win)
      const x = await player.introduceOneForall()
      await player.introduceOneForall()
      await player.inductVisibleVariable(x)
    })

    cy.contains('.goal-info', "Induct after ONLY 'x' is introduced").should('be.visible')
  })

  it('keeps the branch live after dragging a variable onto the forall induction hypothesis', () => {
    cy.viewport(1440, 900)
    cy.visit(`${mountPath}#/g/local/NNG4/world/LessOrEqual/level/8/visual`)
    cy.get('[data-testid="visual-proof-page"]', { timeout: LOAD_TIMEOUT }).should('be.visible')

    cy.window({ timeout: LOAD_TIMEOUT }).then({ timeout: LOAD_TIMEOUT }, async win => {
      const player = new CompletePlaythroughDriver(win)
      const x = await player.introduceOneForall()
      await player.inductVisibleVariable(x)
    })
    openLastIncompleteBranch()
    cy.get('[data-testid="hyp-card"][data-hyp-name="hd"]', { timeout: LOAD_TIMEOUT }).should('be.visible')

    visualHarness().then(harness => harness.dragHypToHyp('d', 'hd'))
    visualHarness().then(harness => {
      expect(harness.getProofAudit().completed, 'forall specialization does not solve the goal').to.equal(false)
    })
    cy.get('[data-testid="proof-stream-leaf"][data-current="true"]')
      .should('have.attr', 'data-completed', 'false')
  })

  it('lets the player choose the right side in the final induction branch', () => {
    cy.viewport(1440, 900)
    cy.visit(`${mountPath}#/g/local/NNG4/world/LessOrEqual/level/8/visual`)
    cy.get('[data-testid="visual-proof-page"]', { timeout: LOAD_TIMEOUT }).should('be.visible')

    cy.window({ timeout: LOAD_TIMEOUT }).then({ timeout: LOAD_TIMEOUT }, async win => {
      const player = new CompletePlaythroughDriver(win)
      // Follow the lesson literally: click once to introduce only the first
      // binder, then drag induction onto that new variable.
      const x = await player.introduceOneForall()
      await player.inductVisibleVariable(x)
    })
    openLastIncompleteBranch()

    cy.window({ timeout: LOAD_TIMEOUT }).then({ timeout: LOAD_TIMEOUT }, async win => {
      const player = new CompletePlaythroughDriver(win)
      const y = await player.introduceOneForall()
      await player.inductVisibleVariable(y)
    })
    openLastIncompleteBranch()

    cy.get('[data-testid="goal-card"]')
      .should('have.attr', 'data-goal-text')
      .and('include', '∨')
    cy.get('[data-testid="goal-card"]').click()
    cy.get('[data-testid="goal-choice-option"][data-play-tactic="click_goal_right"]')
      .should('be.visible')
      .click()

    cy.window({ timeout: 60_000 }).should(win => {
      const audit = (win as HarnessWindow).__visualTestHarness!.getProofAudit()
      expect(audit.processing, 'right-side specialization finishes').to.equal(false)
      expect(audit.interactiveLines.at(-1)).to.equal('click_goal_right')
      expect(audit.coreLines.at(-1)).to.equal('right')
    })
    cy.get('[data-testid="goal-card"]')
      .should('have.attr', 'data-goal-text')
      .and('not.include', '∨')
  })
})
