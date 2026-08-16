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
    proofBody: string
    coreLines: string[]
    interactiveLines: string[]
  }
  getCurrentStreamSnapshot(): {
    streamId: string
    goalType: string
    hypTypes: Record<string, string>
  }
  getTransformStatus(): unknown
  getLastTransformRewriteDebug(): unknown
}

type HarnessWindow = Cypress.AUTWindow & {
  __visualTestHarness?: VisualHarness
  __visualTransientDisabledButtons?: string[]
  __visualUnmeasuredDockWasVisible?: boolean
  __visualDockFlashObserved?: boolean
  __visualDockFlashDetails?: Array<Record<string, unknown>>
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
  observedWindow.__visualDockFlashObserved = false
  observedWindow.__visualDockFlashDetails = []
  observedWindow.__visualStabilityObserver?.disconnect()
  let dockWasReady = false

  const inspectDock = (mutations: MutationRecord[] = []) => {
    const docks = win.document.querySelectorAll<HTMLElement>('.tr-transformation-overlay .tr-rule-dock')
    const recordFlash = (kind: string) => {
      observedWindow.__visualDockFlashObserved = true
      observedWindow.__visualDockFlashDetails?.push({
        kind,
        overlays: Array.from(win.document.querySelectorAll<HTMLElement>('.tr-transformation-overlay')).map(overlay => ({
          instance: overlay.dataset.transformInstance,
          connected: overlay.isConnected,
        })),
        docks: Array.from(docks).map(dock => ({
          ready: dock.dataset.layoutReady,
          visibility: getComputedStyle(dock).visibility,
          connected: dock.isConnected,
        })),
        mutations: mutations.slice(0, 6).map(mutation => ({
          type: mutation.type,
          attributeName: mutation.attributeName,
          target: mutation.target instanceof win.Element
            ? `${mutation.target.tagName}.${mutation.target.className}`
            : mutation.target.nodeName,
          added: mutation.addedNodes.length,
          removed: mutation.removedNodes.length,
        })),
        transformStatus: observedWindow.__visualTestHarness?.getTransformStatus(),
      })
    }
    if (dockWasReady && docks.length === 0) recordFlash('removed')
    for (const dock of docks) {
      const visible = getComputedStyle(dock).visibility !== 'hidden'
      if (dockWasReady && !visible) recordFlash('hidden')
      if (getComputedStyle(dock).visibility !== 'hidden' && dock.dataset.layoutReady !== 'true') {
        observedWindow.__visualUnmeasuredDockWasVisible = true
      }
      if (visible && dock.dataset.layoutReady === 'true') dockWasReady = true
    }
  }
  const observer = new win.MutationObserver(mutations => {
    inspectDock(mutations)
    for (const mutation of mutations) {
      if (mutation.type !== 'attributes' || mutation.attributeName !== 'disabled') continue
      const button = mutation.target
      if (!(button instanceof win.HTMLButtonElement) || !button.disabled) continue
      // Previous/next rule arrows disable normally when pagination reaches an
      // edge; that is availability, not the transient processing grey-out
      // this observer is intended to catch.
      if (button.classList.contains('tr-nav-btn')) continue
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

  it('keeps boundary navigation labels visible on disabled level buttons', () => {
    cy.visit(`${mountPath}#/g/local/NNG4/world/Implication/level/1/visual`)
    cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
    cy.get('.visual-header-prev-btn')
      .should('be.disabled')
      .and('contain.text', 'Previous level')
      .then($button => expect(Number.parseFloat(getComputedStyle($button[0]!).opacity)).to.be.lessThan(0.6))

    cy.visit(`${mountPath}#/g/local/NNG4/world/Implication/level/11/visual`)
    cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
    cy.get('.visual-header-next-btn')
      .should('be.disabled')
      .and('contain.text', 'Next level')
      .then($button => expect(Number.parseFloat(getComputedStyle($button[0]!).opacity)).to.be.lessThan(0.6))
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

  it('keeps dependent Implication hypotheses inside their initial quantified goal', () => {
    // Authored level 8 is displayed as Implication 7.
    cy.visit(`${mountPath}#/g/local/NNG4/world/Implication/level/8/visual`)
    cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT })
      .should('have.attr', 'data-goal-text')
      .then(text => {
        expect(text).to.match(/^∀\s*\(x y\s*:\s*ℕ\)/u)
        expect(text).to.match(/x\s*=\s*y\s*→\s*x\s*≠\s*y\s*→\s*False/u)
      })
    cy.get('[data-testid="hyp-card"][data-hyp-name="h1"]').should('not.exist')
    cy.get('[data-testid="hyp-card"][data-hyp-name="h2"]').should('not.exist')
  })

  it('compacts consecutive same-type forall binders on goals and theorem cards', () => {
    cy.visit(`${mountPath}#/g/local/NNG4/world/Implication/level/8/visual`)
    cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT })
      .should('have.attr', 'data-goal-text')
      .and('match', /^\u2200\s*\(x y\s*:\s*\u2115\)/u)

    visualHarness().then(harness => harness.copyTheoremToCanvas('MyNat.succ_inj'))
    cy.get('[data-testid="theorem-copy-card"][data-theorem-name="MyNat.succ_inj"] .statement-forall-footer')
      .should('be.visible')
      .invoke('text')
      .should(text => {
        expect(text.replace(/\s+/gu, ''), 'one compact forall group').to.equal('\u2200(ab:\u2115)')
      })
  })

  it('keeps the measured theorem dock mounted through an Advanced Addition commutativity rewrite', () => {
    cy.visit(`${mountPath}#/g/local/NNG4/world/AdvAddition/level/2/visual`)
    cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
    cy.window({ timeout: LOAD_TIMEOUT }).then({ timeout: LOAD_TIMEOUT }, async win => {
      const player = new CompletePlaythroughDriver(win)
      await player.prepareInitialBinders(['a', 'b', 'n'], 'intro h')
      await player.perform('intro h')
      // performRewriteOnSide opens h's transformation overlay through the
      // same double-click and theorem-card drag a player uses.
      observeTransformStability(win)
      await player.performRewriteOnSide('rw [add_comm n] at h', 'left', true)
      await new Promise(resolve => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve)))
    })
    cy.window().should(win => {
      expect((win as HarnessWindow).__visualDockFlashObserved, 'ready dock never disappears or becomes hidden')
        .to.equal(false)
      expect((win as HarnessWindow).__visualUnmeasuredDockWasVisible, 'unmeasured dock is never displayed')
        .to.equal(false)
    })
  })

  it('places newly generated long Implication hypotheses into non-overlapping grid slots', () => {
    cy.visit(`${mountPath}#/g/local/NNG4/world/Implication/level/11/visual`)
    cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
    cy.window({ timeout: LOAD_TIMEOUT }).then({ timeout: LOAD_TIMEOUT }, async win => {
      const player = new CompletePlaythroughDriver(win)
      await player.perform('intro h')
      await player.perform('rw [add_succ, add_succ, add_zero] at h')
      await player.perform('repeat apply succ_inj at h')
    })
    cy.get(
      '[data-testid="combining-canvas"] [data-testid="hyp-card"], [data-testid="combining-canvas"] [data-testid="theorem-copy-card"]',
      { timeout: LOAD_TIMEOUT },
    ).then($cards => {
      const cards = [...$cards].filter(card => getComputedStyle(card).visibility !== 'hidden')
      expect(cards.length, 'the repeated applications create a visible statement stack').to.be.greaterThan(3)
      const rectangles = cards.map(card => card.getBoundingClientRect())
      for (let left = 0; left < rectangles.length; left += 1) {
        for (let right = left + 1; right < rectangles.length; right += 1) {
          const a = rectangles[left]!
          const b = rectangles[right]!
          const overlapWidth = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
          const overlapHeight = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
          expect(overlapWidth * overlapHeight, `cards ${left + 1} and ${right + 1} do not overlap`).to.equal(0)
        }
      }
    })
  })

  it('keeps a branch selected when cases on False closes it and auto-switching is off', () => {
    cy.visit(`${mountPath}#/g/local/NNG4/world/AdvAddition/level/5/visual`)
    cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
    cy.window({ timeout: LOAD_TIMEOUT }).then({ timeout: LOAD_TIMEOUT }, async win => {
      const player = new CompletePlaythroughDriver(win)
      await player.prepareInitialBinders(['a', 'b'], 'cases b with d')
      await player.perform('cases b with d')
    })

    let baseStreamId = ''
    cy.window().then(win => {
      baseStreamId = (win as HarnessWindow).__visualTestHarness!.getCurrentStreamSnapshot().streamId
    })
    cy.get('[data-testid="stream-nav-next"]:not(:disabled)', { timeout: LOAD_TIMEOUT }).click()

    cy.window({ timeout: LOAD_TIMEOUT }).should(win => {
      const snapshot = (win as HarnessWindow).__visualTestHarness?.getCurrentStreamSnapshot()
      expect(snapshot?.streamId, 'player selected the still-live successor branch').not.to.equal(baseStreamId)
    }).then({ timeout: LOAD_TIMEOUT }, async win => {
      const player = new CompletePlaythroughDriver(win)
      await player.perform('intro h')
      await player.perform('rw [add_succ] at h')
      await player.perform('symm at h')
      await player.perform('apply zero_ne_succ at h')
    })
    cy.get('[data-testid="stream-nav-label"]', { timeout: LOAD_TIMEOUT })
      .invoke('attr', 'data-current-stream-id')
      .should('not.be.empty')
      .then(falseBranchId => {
        expect(falseBranchId, 'the selected live branch differs from the untouched branch')
          .not.to.equal(baseStreamId)
        cy.window({ timeout: LOAD_TIMEOUT }).then({ timeout: LOAD_TIMEOUT }, async win => {
          const player = new CompletePlaythroughDriver(win)
          await player.perform('cases h')
        })

        cy.window().should(win => {
          const harness = (win as HarnessWindow).__visualTestHarness!
          expect(harness.getProofAudit().completed, 'the untouched zero branch is still incomplete').to.equal(false)
        })
        // A completed selected branch is intentionally no longer interactive,
        // so inspect the proof graph and navigator that the player sees.
        cy.get('[data-testid="stream-nav-label"]')
          .should('have.attr', 'data-current-stream-id', falseBranchId)
        cy.get(`[data-testid="proof-stream-leaf"][data-stream-id="${falseBranchId}"]`)
          .should('have.attr', 'data-current', 'true')
          .and('have.attr', 'data-completed', 'true')
        cy.get(`[data-testid="proof-stream-leaf"][data-stream-id="${baseStreamId}"]`)
          .should('have.attr', 'data-completed', 'false')
      })
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
      // The current goal is itself False, so exact is the direct match. The
      // retired shortcut was only False-to-an-arbitrary-goal.
      await player.perform(`exact ${falseCard!.dataset.hypName}`)
    })

    cy.get('.proof-sidebar-tab').click()
    // Completing the proof leaves Core selected. A player has no reason to
    // click the already-active, partially obscured mode button just to inspect
    // the log; assert the visible state we actually depend on instead.
    cy.contains('.proof-sidebar-mode-btn', 'Core').should('have.class', 'active')
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
      .then($atomic => {
        const style = getComputedStyle($atomic[0]!)
        const cardStyle = getComputedStyle($atomic[0]!.closest('.statement-card')!)
        expect(style.color, 'atomic form uses the forall-footer grey')
          .to.equal(cardStyle.getPropertyValue('--visual-forall-footer').trim().replace(', .95)', ', 0.95)'))
        expect(style.textAlign, 'atomic form is centered').to.equal('center')
      })

    visualHarness().then(harness => harness.copyTheoremToCanvas('MyNat.le_refl'))
    cy.get('[data-testid="theorem-copy-card"][data-theorem-name="MyNat.le_refl"] .statement-atomic-form')
      .should('be.visible')
      .and('contain.text', '∃')

    cy.get('.theorem-tray-panel .tr-rule-page-cards', { timeout: LOAD_TIMEOUT }).then($row => {
      const cards = Array.from($row[0]!.querySelectorAll<HTMLElement>('[data-testid="theorem-tray-card"]'))
      expect(cards.length, 'theorem tray contains cards').to.be.greaterThan(0)
      const rowCenter = $row[0]!.getBoundingClientRect().top + $row[0]!.getBoundingClientRect().height / 2
      for (const card of cards) {
        const rect = card.getBoundingClientRect()
        expect(Math.abs(rect.top + rect.height / 2 - rowCenter), 'short theorem card is vertically centered')
          .to.be.lessThan(2)
        expect(getComputedStyle(card).borderTopColor, 'theorem outline is green')
          .to.equal('rgba(52, 211, 153, 0.4)')
      }
    })

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
      'Implication',
      10,
      'The symm tactic can be used to swap the sides of any equality.',
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

    openAndExpect(
      'LessOrEqual',
      10,
      'Hint:',
    )
    cy.contains('.goal-info.below', "Don't forget about the cases tactic!").should('not.exist')
    cy.get('.goal-info.below .visual-info-reveal-button')
      .should('be.visible')
      .and('have.attr', 'aria-expanded', 'false')
      .then($button => {
        expect(getComputedStyle($button[0]!).color, 'the reveal affordance is purple')
          .to.match(/rgb\((?:139, 92, 246|167, 139, 250|99, 102, 241)\)/u)
      })
      .click()
      .should('have.attr', 'aria-expanded', 'true')
    cy.contains('.goal-info.below', "Don't forget about the cases tactic!").should('be.visible')
    cy.get('.goal-info.below code').should('have.text', 'cases')
    cy.contains('.tr-tab-btn', 'Tactics', { timeout: LOAD_TIMEOUT }).click()
    cy.get('[data-tactic-name="exfalso"]').should('not.exist')

    openAndExpect(
      'AdvAddition',
      5,
      'The cases tactic allows you to split a variable into every form it could take.',
    )
    cy.get('.goal-info.below').within(() => {
      cy.get('code').then($codes => {
        expect([...$codes].map(code => code.textContent)).to.deep.equal(['cases', 'False', 'cases', 'False'])
      })
      cy.get('em').then($emphasis => {
        expect([...$emphasis].map(node => node.textContent)).to.deep.equal(['no', 'any'])
      })
    })
  })

  it('keeps the less-or-equal construction lesson above the theorem tray', () => {
    cy.visit(`${mountPath}#/g/local/NNG4/world/LessOrEqual/level/1/visual`)
    cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
    cy.contains(
      '.goal-info.below',
      'Double-click there-exists goals to enter Construction Mode.',
      { timeout: LOAD_TIMEOUT },
    ).should($info => {
      const tray = Cypress.$('#theorem-tray')[0]
      expect(tray, 'the fixed theorem tray exists').to.exist
      expect(
        $info[0]!.getBoundingClientRect().bottom,
        'the complete construction lesson stays above the fixed tray',
      ).to.be.lte(tray!.getBoundingClientRect().top)
    })
  })

  it('renders the induction octagon edges with one color and one-pixel thickness', () => {
    cy.visit(`${mountPath}#/g/local/NNG4/world/Addition/level/1/visual`)
    cy.get('[data-tactic-name="induction"]', { timeout: LOAD_TIMEOUT }).then($card => {
      const card = $card[0]!
      const cardStyle = getComputedStyle(card)
      const bevelStyle = getComputedStyle(card, '::after')
      const bevelColor = bevelStyle.backgroundColor
      const dangerBorder = cardStyle.getPropertyValue('--visual-danger-border').trim()
      const normalizeColor = (value: string) => value
        .replace(/\s+/gu, '')
        .replace(/([,(])\./gu, (_match, prefix: string) => `${prefix}0.`)

      expect(cardStyle.borderTopWidth, 'native border retains one-pixel layout').to.equal('1px')
      expect(cardStyle.borderTopColor, 'native border does not double the straight edges')
        .to.equal('rgba(0, 0, 0, 0)')
      expect(normalizeColor(bevelColor), 'all octagon edges use the tactic border color')
        .to.contain(normalizeColor(dangerBorder))
      expect(cardStyle.clipPath, 'octagon uses the larger 16-pixel corner taper').to.contain('16px')
      expect(bevelStyle.paddingTop, 'masked edge has the same one-pixel width on every segment').to.equal('1px')
      expect(bevelStyle.webkitMaskComposite, 'the center is cut out of the border overlay').to.match(/xor|exclude/u)
    })

    cy.get('[data-tactic-name="induction"]').then($card => {
      const neutral = getComputedStyle($card[0]!, '::after').backgroundColor
      $card[0]!.classList.add('visual-emphasize')
      const highlighted = getComputedStyle($card[0]!, '::after').backgroundColor
      expect(highlighted, 'corner and straight octagon edges adopt the highlight').not.to.equal(neutral)
      expect(highlighted, 'highlighted edge includes the emphasis purple').to.contain('167, 139, 250')
      $card[0]!.classList.remove('visual-emphasize')
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
      .then($card => {
        const style = getComputedStyle($card[0]!)
        expect(
          style.getPropertyValue('--bevel-border-color').trim(),
          'the same purple target color drives every straight and cut-corner edge',
        ).to.equal(style.getPropertyValue('--visual-drop-target-border').trim())
        const colorProbe = $card[0]!.ownerDocument.createElement('span')
        colorProbe.style.color = style.getPropertyValue('--visual-drop-target-border').trim()
        $card[0]!.ownerDocument.body.appendChild(colorProbe)
        const resolvedTargetColor = getComputedStyle(colorProbe).color
        colorProbe.remove()
        expect(getComputedStyle($card[0]!, '::after').backgroundColor)
          .to.equal(resolvedTargetColor)
      })
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

      const tutorial = map.querySelector<SVGGraphicsElement>('[data-world-id="Tutorial"] .world-circle')
      expect(tutorial, 'Tutorial root world').to.exist
      const tutorialRect = tutorial!.getBoundingClientRect()
      expect(
        Math.abs(tutorialRect.left + tutorialRect.width / 2 - (mapRect.left + mapRect.width / 2)),
        'the first world is horizontally centred',
      ).to.be.at.most(3)

      const tutorialTitle = map.querySelector<HTMLElement>('[data-world-id="Tutorial"] .world-title')
      expect(tutorialTitle, 'Tutorial world label').to.exist
      expect(parseFloat(getComputedStyle(tutorialTitle!).fontSize), 'world labels remain legible').to.be.at.least(14)
    })
  })

  it('keeps Addition 3 rewrites on the manually selected stream', () => {
    cy.viewport(390, 844)
    cy.visit(`${mountPath}#/g/local/NNG4/world/Addition/level/3/visual`)
    cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')

    cy.window({ timeout: LOAD_TIMEOUT }).then({ timeout: LOAD_TIMEOUT }, async win => {
      const player = new CompletePlaythroughDriver(win)
      await player.prepareInitialBinders(['a', 'b'], 'induction b with d hd')
      await player.perform('induction b with d hd')
    })

    cy.get('.mobile-page-link.graph-link', { timeout: LOAD_TIMEOUT }).click()
    cy.get('.mobile-graph-page.open [data-testid="proof-stream-leaf"][data-completed="false"]', {
      timeout: LOAD_TIMEOUT,
    }).should('have.length', 2).eq(1).click({ force: true })
    cy.get('.mobile-graph-page.open .mobile-side-return-link').click()

    cy.window({ timeout: LOAD_TIMEOUT }).should(win => {
      const snapshot = (win as HarnessWindow).__visualTestHarness?.getCurrentStreamSnapshot()
      expect(snapshot?.goalType, 'the player-selected successor branch')
        .to.match(/a\s*\+\s*succ\s*\(?\s*d\s*\)?\s*=\s*succ\s*\(?\s*d\s*\)?\s*\+\s*a/u)
    }).then({ timeout: LOAD_TIMEOUT }, async win => {
      const player = new CompletePlaythroughDriver(win)
      await player.performRewriteOnSide('rw [add_succ]', 'left')
    })

    cy.window({ timeout: LOAD_TIMEOUT }).should(win => {
      const harness = (win as HarnessWindow).__visualTestHarness
      const snapshot = harness?.getCurrentStreamSnapshot()
      const audit = harness?.getProofAudit()
      expect(snapshot?.goalType, 'add_succ rewrites the selected successor goal')
        .to.match(/succ\s*\(?\s*a\s*\+\s*d\s*\)?/u)
      expect(audit?.proofBody, 'the backend command rotates to the selected live stream')
        .to.match(/rotate_left\s+drag_rw_lhs\s+\[(?:MyNat\.)?add_succ\]/u)
      expect(audit?.coreLines.filter(line => line.includes('?')), 'Core tactics are valid').to.deep.equal([])
      expect(audit?.interactiveLines.filter(line => line.includes('?')), 'interaction tactics are valid').to.deep.equal([])
    })
  })

  it('does not show a green goal when completion metadata has no restorable proof', () => {
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
      .should('not.have.class', 'solved')
      .then($goal => {
        const style = getComputedStyle($goal[0]!)
        expect(style.borderColor, 'unrestored goal retains its normal incomplete border').to.equal('rgb(234, 179, 8)')
        expect(style.boxShadow, 'unrestored goal retains its incomplete glow').to.contain('234, 179, 8')
      })
    cy.get('.visual-header').should('not.have.class', 'completed')
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
      await player.performRewriteOnSide('rw [\u2190 add_zero]', 'left', true)
    })

    cy.window().should(win => {
      const harness = (win as HarnessWindow).__visualTestHarness
      const audit = harness?.getProofAudit()
      expect(audit?.processing, 'rewrite has finished').to.equal(false)
      expect(
        audit?.completed,
        `rewrite alone does not complete the visual level; debug=${JSON.stringify(harness?.getLastTransformRewriteDebug())}`,
      ).to.equal(false)
      expect(
        (win as HarnessWindow).__visualUnmeasuredDockWasVisible,
        'rewrite dock is hidden until its final pagination and height are measured',
      ).to.equal(false)
      expect(
        (win as HarnessWindow).__visualTransientDisabledButtons,
        'processing does not visually disable otherwise-available buttons',
      ).to.deep.equal([])
      expect(
        (win as HarnessWindow).__visualDockFlashObserved,
        `the ready rewrite dock remains mounted and visible; details=${JSON.stringify(
          (win as HarnessWindow).__visualDockFlashDetails,
        )}`,
      ).to.equal(false)
    })
    cy.get('.tr-transformation-overlay .tr-expr-wrapper').should('contain.text', 'x').and('contain.text', '0')
    cy.get('.tr-transformation-overlay .tr-static-label').should('contain.text', '=').and('contain.text', 'x + 0')

    cy.window().should(win => {
      const coreLines = (win as HarnessWindow).__visualTestHarness?.getProofAudit().coreLines ?? []
      expect(coreLines.some(line => line.startsWith('rw_nth ')), 'scoped rewrite uses compact rw_nth')
        .to.equal(true)
      expect(coreLines.some(line => line.trim() === 'conv =>'), 'Core pane has no multiline conv block')
        .to.equal(false)
    })

    cy.get('.tr-transformation-overlay .tr-back-btn').click()
    cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT })
      .should('be.visible')
      .and('not.have.class', 'solved')
      .and('have.attr', 'data-goal-text')
      .and('match', /x\s*\+\s*0\s*=\s*x\s*\+\s*0/u)
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
