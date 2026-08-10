import {
  CompletePlaythroughDriver,
  sortPlayLogEntries,
} from '../support/completePlaythroughDriver'

const mountPath = Cypress.env('LEAN4GAME_MOUNT') ?? '/'
const LOAD_TIMEOUT = 600000
const requestedRegression = String(Cypress.env('VISUAL_REGRESSION') ?? '')

interface VisualHarness {
  copyTheoremToCanvas(theoremName: string): void
  getProofAudit(): { completed: boolean; processing: boolean }
}

type HarnessWindow = Cypress.AUTWindow & {
  __visualTestHarness?: VisualHarness
  __visualTransientDisabledButtons?: string[]
  __visualUnmeasuredDockWasVisible?: boolean
  __visualStabilityObserver?: MutationObserver
}
type PlayerGesture = string | { rewrite: string; side: 'left' | 'right' }

function visualHarness() {
  return cy.window({ timeout: 60_000 }).then(win => {
    const harness = (win as HarnessWindow).__visualTestHarness
    expect(harness, 'visual player test bridge').to.exist
    return harness!
  })
}

function performPlayerGestures(commands: PlayerGesture[]) {
  cy.window({ timeout: LOAD_TIMEOUT }).then({ timeout: LOAD_TIMEOUT }, async win => {
    const player = new CompletePlaythroughDriver(win)
    for (const command of commands) {
      if (typeof command === 'string') await player.perform(command)
      else await player.performRewriteOnSide(command.rewrite, command.side)
    }
  })
  cy.window().should(win => {
    const audit = (win as HarnessWindow).__visualTestHarness?.getProofAudit()
    expect(audit?.processing, 'visual proof is idle').to.equal(false)
    expect(audit?.completed, 'visual proof is complete').to.equal(true)
    expect(audit?.coreLines.some(line => line.includes('?')), 'Core tactics are valid').to.equal(false)
    expect(audit?.interactiveLines.some(line => line.includes('?')), 'interaction tactics are valid').to.equal(false)
  })
}

function observeTransformStability(win: Cypress.AUTWindow) {
  const observedWindow = win as HarnessWindow
  observedWindow.__visualTransientDisabledButtons = []
  observedWindow.__visualUnmeasuredDockWasVisible = false
  observedWindow.__visualStabilityObserver?.disconnect()

  const inspectDock = () => {
    for (const dock of win.document.querySelectorAll<HTMLElement>('.tr-transformation-overlay .tr-rule-dock')) {
      if (getComputedStyle(dock).visibility !== 'hidden' && dock.dataset.layoutReady !== 'true') {
        observedWindow.__visualUnmeasuredDockWasVisible = true
      }
    }
  }
  const observer = new win.MutationObserver(mutations => {
    inspectDock()
    for (const mutation of mutations) {
      if (mutation.type !== 'attributes' || mutation.attributeName !== 'disabled') continue
      const button = mutation.target
      if (!(button instanceof win.HTMLButtonElement) || !button.disabled) continue
      if (!button.closest('.tr-overlay') || button.getAttribute('aria-disabled') !== 'true') continue
      observedWindow.__visualTransientDisabledButtons?.push(
        button.getAttribute('aria-label') ?? button.title ?? button.className,
      )
    }
  })
  observer.observe(win.document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['disabled', 'style', 'data-layout-ready'],
  })
  observedWindow.__visualStabilityObserver = observer
  inspectDock()
}

function playImplicationChain(sourceType: string, targetType: string) {
  cy.visit(`${mountPath}#/g/local/VisualTest/world/Prototype/level/1/visual`)
  cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')

  cy.window({ timeout: LOAD_TIMEOUT }).then({ timeout: LOAD_TIMEOUT }, async win => {
    const player = new CompletePlaythroughDriver(win)
    await player.perform('intro premise')
    await player.perform('intro implication')
    await player.combineVisiblePropositions(sourceType, targetType, 'Q')
    await player.solveGoalWithVisibleProposition('Q')
  })
  cy.window().should(win => {
    const audit = (win as HarnessWindow).__visualTestHarness?.getProofAudit()
    expect(audit?.processing, 'visual proof is idle').to.equal(false)
    expect(audit?.completed, 'visual proof is complete').to.equal(true)
  })
}

describe('NNG4 implication and definition display regressions', () => {
  beforeEach(function () {
    if (requestedRegression && !this.currentTest.title.includes(requestedRegression)) this.skip()
    cy.on('uncaught:exception', error => {
      if (Cypress.env('VISUAL_DEBUG_UNCAUGHT')) throw error
      return false
    })
    cy.clearCookies()
    cy.clearLocalStorage()
  })

  it('observes the newest player action across per-level play logs', () => {
    const additionOneRewrite = { timestamp: 100, playTactic: 'drag_rw_lhs [hd]' }
    const additionFourRewrite = { timestamp: 400, playTactic: 'drag_rw_lhs [hd]' }
    const additionThreeRewrite = { timestamp: 300, playTactic: 'drag_rw_rhs [add_succ]' }

    // localStorage returns keys in insertion order, so flattening their arrays
    // can put the newest current-level action before an older prior-level one.
    const flattenedByKeyOrder = [additionFourRewrite, additionOneRewrite, additionThreeRewrite]
    expect(sortPlayLogEntries(flattenedByKeyOrder).at(-1)).to.equal(additionFourRewrite)
  })

  it('applies zero-ne-one through player theorem and tactic drags', () => {
    cy.visit(`${mountPath}#/g/local/NNG4/world/Implication/level/10/visual`)
    cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')

    performPlayerGestures(['symm', 'exact zero_ne_one'])
  })

  it('keeps post-intro-world forall binders in the clickable goal and removes revert', () => {
    cy.visit(`${mountPath}#/g/local/NNG4/world/Implication/level/7/visual`)
    cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT })
      .should('be.visible')
      .and('have.attr', 'data-goal-text')
      .and('match', /^∀/u)
    cy.get('[data-testid="hyp-card"][data-hyp-name="x"]').should('not.exist')
    cy.get('[data-tactic-name="revert"]').should('not.exist')

    cy.get('[data-testid="goal-card"]').click()
    cy.get('[data-testid="hyp-card"][data-hyp-name="x"]', { timeout: LOAD_TIMEOUT })
      .should('be.visible')
      .and('have.class', 'variable-card')
  })

  it('applies zero-ne-succ in either drag direction and restores its workspace copy on undo', () => {
    cy.visit(`${mountPath}#/g/local/NNG4/world/Implication/level/9/visual`)
    cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')

    cy.window({ timeout: LOAD_TIMEOUT }).then({ timeout: LOAD_TIMEOUT }, async win => {
      const player = new CompletePlaythroughDriver(win)
      await player.perform('intro h')
      await player.perform('rw [one_eq_succ_zero] at h')
      const copy = await player.placeTheoremCopy('zero_ne_succ')
      const originalPosition = { left: copy.style.left, top: copy.style.top }

      await player.applyTheoremCopyToHypothesis('zero_ne_succ', 'h', 'theorem-to-hypothesis')
      expect(win.document.querySelector('[data-testid="hyp-card"][data-hyp-type="False"]')).to.exist
      await player.undoLastPlayerStep()

      const restored = win.document.querySelector<HTMLElement>(
        '[data-testid="theorem-copy-card"][data-theorem-name$="zero_ne_succ"]',
      )
      expect(restored, 'undo restores the consumed theorem copy').to.exist
      expect({ left: restored!.style.left, top: restored!.style.top }).to.deep.equal(originalPosition)

      await player.applyTheoremCopyToHypothesis('zero_ne_succ', 'h', 'hypothesis-to-theorem')
      const falseCard = win.document.querySelector<HTMLElement>(
        '[data-testid="hyp-card"][data-hyp-type="False"]',
      )
      expect(falseCard, 'the reverse drag direction also derives False').to.exist
      await player.perform(`exact ${falseCard!.dataset.hypName}`)
    })

    cy.get('.proof-sidebar-tab').click()
    cy.contains('.proof-sidebar-mode-btn', 'Core').click()
    cy.get('.proof-sidebar-step.unknown').should('not.exist')
    cy.get('.proof-sidebar-step-text').last().invoke('text').should(text => {
      expect(text).to.match(/^exact\s/u)
      expect(text).not.to.contain('exfalso')
    })
  })

  for (const [description, sourceType, targetType] of [
    ['premise onto implication', 'P', 'P → Q'],
    ['implication onto premise', 'P → Q', 'P'],
  ] as const) {
    it(`applies generic A and A-to-B cards by dragging ${description}`, () => {
      playImplicationChain(sourceType, targetType)
    })
  }

  it('shows the definitionally expanded form on a less-or-equal theorem card', () => {
    cy.visit(`${mountPath}#/g/local/NNG4/world/LessOrEqual/level/2/visual`)
    cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')

    visualHarness().then(harness => harness.copyTheoremToCanvas('MyNat.le_refl'))
    cy.get('[data-testid="theorem-copy-card"][data-theorem-name="MyNat.le_refl"] .statement-atomic-form')
      .should('be.visible')
      .and('contain.text', '∃')

  })

  it('renders the induction octagon edges with one color and one-pixel thickness', () => {
    cy.visit(`${mountPath}#/g/local/NNG4/world/Addition/level/1/visual`)
    cy.get('[data-tactic-name="induction"]', { timeout: LOAD_TIMEOUT }).then($card => {
      const card = $card[0]!
      const cardStyle = getComputedStyle(card)
      const bevelStyle = getComputedStyle(card, '::after')
      const bevel = bevelStyle.backgroundImage
      const dangerBorder = cardStyle.getPropertyValue('--visual-danger-border').trim()
      const normalizeColor = (value: string) => value
        .replace(/\s+/gu, '')
        .replace(/([,(])\./gu, (_match, prefix: string) => `${prefix}0.`)

      expect(cardStyle.borderTopWidth, 'native border retains one-pixel layout').to.equal('1px')
      expect(cardStyle.borderTopColor, 'native border does not double the straight edges')
        .to.equal('rgba(0, 0, 0, 0)')
      expect(normalizeColor(bevel), 'all octagon edges use the tactic border color')
        .to.contain(normalizeColor(dangerBorder))
      expect(cardStyle.clipPath, 'octagon uses the larger one-rem corner taper').to.contain('1rem')
      expect(
        bevel,
        '45-degree bands use sqrt(2) CSS pixels so their perpendicular stroke is one pixel',
      ).to.contain('1.414px')
      expect(bevel, 'old half-pixel fading corner stroke is absent').not.to.contain('0.5px')
    })
  })

  it('rewrites the selected x to x + 0 with reverse add_zero', () => {
    cy.visit(`${mountPath}#/g/local/NNG4/world/LessOrEqual/level/1/visual`)
    cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')

    // Select the left-hand side of `x = x + 0` with the visual arrow control,
    // then drag reverse add_zero directly onto the displayed `x`, as a player
    // does. Lean's `rw` tactic may close the resulting reflexive goal itself,
    // but visual mode must still show that intermediate goal and wait for the
    // player's explicit goal click.
    cy.window({ timeout: LOAD_TIMEOUT }).then({ timeout: LOAD_TIMEOUT }, async win => {
      const player = new CompletePlaythroughDriver(win)
      await player.perform('use 0')
      observeTransformStability(win)
      await player.performRewriteOnSide('rw [\u2190 add_zero]', 'left')
    })

    cy.window().should(win => {
      const audit = (win as HarnessWindow).__visualTestHarness?.getProofAudit()
      expect(audit?.processing, 'rewrite has finished').to.equal(false)
      expect(audit?.completed, 'rewrite alone does not complete the visual level').to.equal(false)
      expect(
        (win as HarnessWindow).__visualUnmeasuredDockWasVisible,
        'rewrite dock is hidden until its final pagination and height are measured',
      ).to.equal(false)
      expect(
        (win as HarnessWindow).__visualTransientDisabledButtons,
        'processing does not visually disable otherwise-available buttons',
      ).to.deep.equal([])
    })
    cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT })
      .should('be.visible')
      .and('not.have.class', 'solved')

    performPlayerGestures(['rfl'])

    cy.get('.proof-sidebar-tab').click()
    cy.get('.proof-sidebar-copy-btn').should('not.exist')
    cy.get('.proof-sidebar-classic-btn').should('not.exist')
    cy.get('[data-testid="proof-actions-toggle"]').click()
    cy.get('[data-testid="proof-actions-menu"]').should('be.visible')
    cy.get('[data-testid="proof-action-copy"]').should('be.visible').click()
    cy.get('[data-testid="proof-actions-menu"]').should('not.be.visible')
    cy.get('[data-testid="proof-actions-toggle"]').click()
    cy.get('[data-testid="proof-action-export-classic"]')
      .should('be.visible')
      .and('contain.text', 'Export to classic mode')
  })
})
