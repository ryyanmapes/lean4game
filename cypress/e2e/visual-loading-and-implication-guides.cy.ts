const LOAD_TIMEOUT = Number(Cypress.env('VISUAL_TIMEOUT') ?? 600_000)
const mountPath = Cypress.env('LEAN4GAME_MOUNT') ?? '/lean4game/index.html'

type VisualHarness = {
  getCurrentStreamSnapshot(): {
    hypTypes: Record<string, string>
  }
  getTransformStatus(): {
    isOpen: boolean
    targetKind: 'goal' | 'hyp' | null
  }
}

type HarnessWindow = Cypress.AUTWindow & {
  __visualTestHarness?: VisualHarness
}

function clickVisibleTransformRule(label: string, remainingPages = 20): Cypress.Chainable<void> {
  return cy.get('body').then($body => {
    const rule = $body.find(`.tr-rule-dock:visible [data-rule-label="${label}"]`).get(0)
    if (rule) {
      cy.wrap(rule).click()
      return
    }
    if (remainingPages <= 0) {
      throw new Error(`Could not find visible transformation rule "${label}"`)
    }
    cy.get('.tr-rule-dock:visible .tr-nav-btn[aria-label="Next rule"]')
      .should('not.be.disabled')
      .click()
    clickVisibleTransformRule(label, remainingPages - 1)
  })
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
    cy.get('[role="progressbar"]').then($bar => {
      const rect = $bar[0]!.getBoundingClientRect()
      expect(rect.width, 'footer loading bar is wide').to.be.greaterThan(500)
      expect(
        $bar[0]!.ownerDocument.defaultView!.innerHeight - rect.bottom,
        'loading bar is anchored near the bottom of the viewport',
      ).to.be.lessThan(70)
      expect(Number($bar.attr('aria-valuenow')), 'loading progress is determinate')
        .to.be.within(0, 100)
    })
    cy.get('.visual-loading-text').should($text => {
      expect($text.text()).to.match(/Lean|snapshot|modules|level|game|runtime/i)
    })

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
        const infoRect = $info[0]!.getBoundingClientRect()
        expect(
          infoRect.top,
          'transformation hint is below h',
        ).to.be.greaterThan(hypRect.bottom + 45)
        cy.get('.visual-instruction-arrow polygon').then($head => {
          const tip = ($head.attr('points') ?? '').split(' ')[0]!.split(',').map(Number)
          expect(tip[1], 'arrowhead points back toward h').to.be.lessThan(infoRect.top)
          expect(tip[1], 'arrowhead ends immediately below h').to.be.closeTo(hypRect.bottom + 8, 2)
        })
      })
    })

    cy.get('[data-hyp-name="h"]').dblclick()
    cy.window().should(win => {
      expect(
        (win as HarnessWindow).__visualTestHarness?.getTransformStatus(),
        'hypothesis transformation is open',
      ).to.include({ isOpen: true, targetKind: 'hyp' })
    })
    clickVisibleTransformRule('zero_add')
    cy.window().should(win => {
      const h = (win as HarnessWindow).__visualTestHarness!.getCurrentStreamSnapshot().hypTypes.h
      expect(h).to.match(/^0\s*\+\s*x\s*=\s*y\s*\+\s*2$/)
    })

    cy.contains(
      '.hyp-info',
      'You can enter hypotheses in Transformation Mode by double-clicking them.',
    ).should('not.exist')
  })

  it('opens playable Implication 5 without the removed revert tactic and spaces its note', () => {
    // Authored level 6 is displayed as level 5 because authored level 5 is skipped.
    cy.visit(levelUrl(6))
    cy.get('[data-testid="visual-proof-page"]', { timeout: LOAD_TIMEOUT }).should('be.visible')

    cy.contains('.tr-tab-btn', 'Tactics').should('be.visible').click()
    cy.contains('.tr-tab-btn.active', 'Tactics').should('be.visible')
    cy.get('[data-tactic-name="revert"]').should('not.exist')

    cy.contains('.goal-info', 'Note that this process can be undone').within(() => {
      cy.get('br').should('have.length.at.least', 2)
      cy.contains('This will be important to perform induction over two variables!')
        .should('not.exist')
    })
  })
})
