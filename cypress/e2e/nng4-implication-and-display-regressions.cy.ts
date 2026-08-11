import {
  CompletePlaythroughDriver,
  sortPlayLogEntries,
} from '../support/completePlaythroughDriver'

const mountPath = Cypress.env('LEAN4GAME_MOUNT') ?? '/'
const LOAD_TIMEOUT = Number(Cypress.env('VISUAL_TIMEOUT') ?? 600_000)
const requestedRegressions = String(Cypress.env('VISUAL_REGRESSION') ?? '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean)

interface VisualHarness {
  copyTheoremToCanvas(theoremName: string): void
  getProofAudit(): {
    completed: boolean
    processing: boolean
    coreLines: string[]
    interactiveLines: string[]
  }
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
    expect(audit?.coreLines.filter(line => line.includes('?')), 'Core tactics are valid').to.deep.equal([])
    expect(audit?.interactiveLines.filter(line => line.includes('?')), 'interaction tactics are valid').to.deep.equal([])
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
    if (
      requestedRegressions.length > 0
      && !requestedRegressions.some(regression => this.currentTest.title.includes(regression))
    ) this.skip()
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

  it('applies zero-ne-succ from a hypothesis and restores its workspace copy on undo', () => {
    cy.visit(`${mountPath}#/g/local/NNG4/world/Implication/level/9/visual`)
    cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')

    cy.window({ timeout: LOAD_TIMEOUT }).then({ timeout: LOAD_TIMEOUT }, async win => {
      const player = new CompletePlaythroughDriver(win)
      await player.perform('intro h')
      await player.perform('rw [one_eq_succ_zero] at h')

      const copy = await player.placeTheoremCopy('zero_ne_succ')
      const originalPosition = { left: copy.style.left, top: copy.style.top }

      await player.applyTheoremCopyToHypothesis('zero_ne_succ', 'h', 'hypothesis-to-theorem')
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
    cy.get('[data-testid="goal-card"]').click()
    cy.get('[data-testid="goal-card"] .statement-atomic-form', { timeout: LOAD_TIMEOUT })
      .should('be.visible')
      .and('contain.text', '∃')

    visualHarness().then(harness => harness.copyTheoremToCanvas('MyNat.le_refl'))
    cy.get('[data-testid="theorem-copy-card"][data-theorem-name="MyNat.le_refl"] .statement-atomic-form')
      .should('be.visible')
      .and('contain.text', '∃')

    cy.visit(`${mountPath}#/g/local/NNG4/world/LessOrEqual/level/5/visual`)
    cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
    visualHarness().then(harness => harness.copyTheoremToCanvas('MyNat.le_trans'))
    cy.get('[data-testid="theorem-copy-card"][data-theorem-name="MyNat.le_trans"]')
      .should('not.have.descendants', '.statement-atomic-form')
      .and('have.class', 'theorem-card-break-after-label')
      .find('.statement-card-main > .proposition')
      .should($proposition => {
        expect(getComputedStyle($proposition[0]!).flexBasis, 'proposition starts after the label').to.equal('100%')
      })

  })

  it('shows the requested level lesson labels and retires the induction reminder', () => {
    const openAndExpect = (world: string, level: number, text: string) => {
      cy.visit(`${mountPath}#/g/local/NNG4/world/${world}/level/${level}/visual`)
      cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
      cy.contains('.goal-info.below', text, { timeout: LOAD_TIMEOUT }).should('be.visible')
    }

    openAndExpect(
      'Implication',
      3,
      'Try solving this level both by dragging h1 onto h2, and dragging h2 onto the goal.',
    )
    openAndExpect(
      'LessOrEqual',
      4,
      'Click there-exists hypotheses to name a variable fulfilling the condition.',
    )
    openAndExpect(
      'LessOrEqual',
      7,
      "Click an 'or' hypothesis to split into two branches",
    )
    cy.get('.goal-info.below').should($info => {
      const style = getComputedStyle($info[0]!)
      expect(style.scrollbarWidth, 'lesson scrollbar is visibly styled').to.equal('thin')
      expect(style.scrollbarGutter, 'lesson layout reserves stable room for its scrollbar').to.contain('stable')
    })

    openAndExpect(
      'LessOrEqual',
      8,
      "Induct after only 'a' is introduced to get a more general inductive hypothesis.",
    )
    let introducedName = ''
    cy.window({ timeout: LOAD_TIMEOUT }).then({ timeout: LOAD_TIMEOUT }, async win => {
      introducedName = await new CompletePlaythroughDriver(win).introduceOneForall()
    })
    cy.contains('.goal-info.below', "Induct after only 'a' is introduced").should('be.visible')
    cy.window({ timeout: LOAD_TIMEOUT }).then({ timeout: LOAD_TIMEOUT }, async win => {
      await new CompletePlaythroughDriver(win).inductVisibleVariable(introducedName)
    })
    cy.contains('.goal-info.below', "Induct after only 'a' is introduced").should('not.exist')
  })

  it('keeps the less-or-equal construction lesson above the theorem tray', () => {
    cy.visit(`${mountPath}#/g/local/NNG4/world/LessOrEqual/level/1/visual`)
    cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
    cy.contains(
      '.goal-info.below',
      'Double-click there-exists goals to enter Construction Mode.',
      { timeout: LOAD_TIMEOUT },
    ).should('exist').then($info => {
      cy.get('#theorem-tray').then($tray => {
        expect(
          $info[0]!.getBoundingClientRect().bottom,
          'the complete construction lesson stays above the fixed tray',
        ).to.be.lte($tray[0]!.getBoundingClientRect().top)
      })
    })
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
      expect(cardStyle.clipPath, 'octagon uses the larger 16-pixel corner taper').to.contain('16px')
      expect(
        bevel,
        '45-degree bands use sqrt(2) CSS pixels so their perpendicular stroke is one pixel',
      ).to.contain('1.414px')
      expect(bevel, 'old half-pixel fading corner stroke is absent').not.to.contain('0.5px')
    })

    cy.get('[data-tactic-name="induction"]').then($card => {
      const rect = $card[0]!.getBoundingClientRect()
      const pointer = { pointerId: 27, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 }
      cy.wrap($card).trigger('pointerdown', {
        ...pointer,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        force: true,
      })
      cy.get('body').trigger('pointermove', {
        ...pointer,
        clientX: rect.left + rect.width / 2 + 12,
        clientY: rect.top + rect.height / 2 + 12,
        force: true,
      })
    })
    cy.get('[data-testid="hyp-card"][data-hyp-name="n"]')
      .should('have.class', 'potential-drop-target')
    cy.get('[data-testid="goal-card"]')
      .should('not.have.class', 'potential-drop-target')
    cy.get('body').trigger('pointerup', {
      pointerId: 27,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 0,
      clientX: 1,
      clientY: 1,
      force: true,
    })
  })

  it('renders cases as an octagonal variable tactic', () => {
    cy.visit(`${mountPath}#/g/local/NNG4/world/AdvAddition/level/6/visual`)
    cy.contains('.tr-tab-btn', 'Tactics', { timeout: LOAD_TIMEOUT }).click()
    cy.get('[data-tactic-name="cases"]', { timeout: LOAD_TIMEOUT })
      .should('be.visible')
      .and('have.class', 'variable-only-tactic')
      .then($card => {
        expect(getComputedStyle($card[0]!).clipPath, 'cases uses the variable octagon').to.contain('16px')
      })
  })

  it('uses the wider phone world-map layout without horizontal scrolling', () => {
    cy.viewport(390, 844)
    cy.visit(`${mountPath}#/g/local/NNG4/visual`)
    cy.get('[data-testid="visual-world-map"]', { timeout: LOAD_TIMEOUT }).should($map => {
      const map = $map[0]!
      const mapRect = map.getBoundingClientRect()
      const circles = Array.from(map.querySelectorAll<SVGGraphicsElement>('.world-circle, .level-circle, .ending-world-hollow'))
      const left = Math.min(...circles.map(circle => circle.getBoundingClientRect().left))
      const right = Math.max(...circles.map(circle => circle.getBoundingClientRect().right))
      expect((right - left) / mapRect.width, 'world tree occupies most of the phone width').to.be.greaterThan(0.55)
      expect(map.scrollWidth, 'zoom does not reintroduce horizontal panning').to.be.at.most(map.clientWidth + 2)
    })
  })

  it('renders a revisited completed goal with only the green solved glow', () => {
    cy.visit(`${mountPath}#/g/local/NNG4/world/LessOrEqual/level/1/visual`, {
      onBeforeLoad(win) {
        win.localStorage.setItem('game_progress', JSON.stringify({
          games: {
            'g/local/nng4': {
              inventory: [],
              difficulty: 2,
              readIntro: true,
              data: {
                LessOrEqual: {
                  readIntro: true,
                  1: { code: '', selections: [], completed: true, help: [] },
                },
              },
            },
          },
        }))
      },
    })
    cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT })
      .should('have.class', 'solved')
      .then($goal => {
        const style = getComputedStyle($goal[0]!)
        expect(style.borderColor, 'completed goal border is green').not.to.equal('rgb(234, 179, 8)')
        expect(style.boxShadow, 'completed goal has no yellow warning glow').not.to.contain('234, 179, 8')
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
    cy.get('[data-testid="proof-actions-toggle"]').should($toggle => {
      expect(getComputedStyle($toggle[0]!).userSelect, 'hamburger is not text-selectable').to.equal('none')
    })
    cy.get('[data-testid="proof-actions-menu"]').should('be.visible')
    cy.get('[data-testid="proof-action-copy"]').should('be.visible').click()
    cy.get('[data-testid="proof-actions-menu"]').should('not.be.visible')
    cy.get('[data-testid="proof-actions-toggle"]').click()
    cy.get('[data-testid="proof-action-export-classic"]')
      .should('be.visible')
      .and('contain.text', 'Export to classic mode')
  })
})
