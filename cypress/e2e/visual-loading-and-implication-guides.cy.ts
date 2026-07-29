const LOAD_TIMEOUT = Number(Cypress.env('VISUAL_TIMEOUT') ?? 600_000)
const mountPath = Cypress.env('LEAN4GAME_MOUNT') ?? '/lean4game/index.html'

type VisualHarness = {
  openHypTransform(hypName: string): void
  getTransformStatus(): {
    isOpen: boolean
    targetKind: 'goal' | 'hyp' | null
  }
  rewriteHypInTransform(
    theoremName: string,
    workingSide?: 'left' | 'right',
    path?: number[],
    isReverse?: boolean,
  ): Promise<void>
}

type HarnessWindow = Cypress.AUTWindow & {
  __visualTestHarness?: VisualHarness
}

function levelUrl(level: number) {
  return `${mountPath}#/g/local/NNG4/world/Implication/level/${level}/visual`
}

describe('Visual loading progress and Implication guidance', () => {
  it('shows real loading status and places Implication 1 guidance below its arrow', () => {
    cy.visit(levelUrl(1))
    cy.get('[role="progressbar"]', { timeout: 30_000 })
      .should('be.visible')
      .and('have.attr', 'aria-label')
      .and('match', /Lean|level|game|snapshot|runtime/i)

    cy.get('[data-testid="visual-proof-page"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
    cy.contains('.hyp-goal-info', 'exactly matches the goal').should('be.visible')

    cy.get('[data-hyp-name="h1"]').then($hyp => {
      const hypRect = $hyp[0]!.getBoundingClientRect()
      cy.get('[data-testid="goal-card"]').then($goal => {
        const goalRect = $goal[0]!.getBoundingClientRect()
        cy.get('.hyp-goal-info').then($info => {
          const infoRect = $info[0]!.getBoundingClientRect()
          expect(
            infoRect.top,
            'instruction text sits well below the hypothesis-to-goal arrow',
          ).to.be.greaterThan(Math.max(
            hypRect.top + hypRect.height / 2,
            goalRect.top + goalRect.height / 2,
          ) + 44)
        })
      })
    })
  })

  it('anchors the Implication 2 transformation hint below h and hides it after h changes', () => {
    cy.visit(levelUrl(2))
    cy.get('[data-testid="visual-proof-page"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
    cy.contains(
      '.hyp-info',
      'You can enter hypotheses in Transformation Mode by double-clicking them.',
    ).should('be.visible')

    cy.get('[data-hyp-name="h"]').then($hyp => {
      const hypRect = $hyp[0]!.getBoundingClientRect()
      cy.get('.hyp-info').then($info => {
        expect(
          $info[0]!.getBoundingClientRect().top,
          'transformation hint is below h',
        ).to.be.greaterThan(hypRect.bottom + 45)
      })
    })

    cy.window().then(win => {
      const harness = (win as HarnessWindow).__visualTestHarness
      expect(harness, 'visual player test bridge').to.exist
      harness!.openHypTransform('h')
    })
    cy.window().should(win => {
      expect(
        (win as HarnessWindow).__visualTestHarness?.getTransformStatus(),
        'hypothesis transformation is open',
      ).to.include({ isOpen: true, targetKind: 'hyp' })
    })
    cy.window().then(async win => {
      const harness = (win as HarnessWindow).__visualTestHarness!
      await harness!.rewriteHypInTransform('zero_add', 'left', [])
    })

    cy.contains(
      '.hyp-info',
      'You can enter hypotheses in Transformation Mode by double-clicking them.',
    ).should('not.exist')
  })
})
