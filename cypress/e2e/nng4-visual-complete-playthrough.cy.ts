import solutionFixture from '../fixtures/nng4-visual-solutions.json'
import { CompletePlaythroughDriver } from '../support/completePlaythroughDriver'
import { decodeAutosave } from '../../client/src/visual/autosaveStorage'

const LOAD_TIMEOUT = Number(Cypress.env('VISUAL_TIMEOUT') ?? 600_000)
const mountPath = Cypress.env('LEAN4GAME_MOUNT') ?? '/'
const dataPath = String(mountPath).replace(/index\.html\/?$/u, '')
const malformedNamePattern = /(?:_@|_internal|_hyg|^\?m(?:\.|$)|[†✝]|\uFFFD|Ã|Â|â)/u
// A completed player command should never leave a tactic placeholder or
// metavariable anywhere in either rendered proof log.
const incompleteProofLinePattern = /\?/u

interface ReferenceSolution {
  world: string
  level: number
  title: string
  visualSkip: boolean
  completionNeutral?: boolean
  source: string
  initialBinderNames: string[]
  commands: string[]
}

interface ProofAudit {
  completed: boolean
  processing: boolean
  proofBody: string
  coreProofBody: string
  interactiveProofBody: string
  coreLines: string[]
  interactiveLines: string[]
  visibleNames: string[]
  visibleTypes: string[]
}

interface VisualTestHarness {
  getProofAudit(): ProofAudit
  validateGeneratedProofs(): Promise<{
    coreCompleted: boolean
    interactiveCompleted: boolean
    coreError: string
    interactiveError: string
    coreProofBody: string
    interactiveProofBody: string
  }>
}

type VisualHarnessWindow = Cypress.AUTWindow & {
  __visualTestHarness?: VisualTestHarness
}

interface NameIssue {
  world: string
  level: number
  title: string
  source: string
  phase: string
  kind: 'name' | 'type'
  value: string
}

const allSolutions = solutionFixture.solutions as ReferenceSolution[]
const allPlayableSolutions = allSolutions
  .filter(solution => !solution.visualSkip && !solution.completionNeutral)
const allCompletionNeutralSolutions = allSolutions
  .filter(solution => !solution.visualSkip && solution.completionNeutral)
const allSkippedSolutions = allSolutions.filter(solution => solution.visualSkip)
const requestedWorld = String(Cypress.env('VISUAL_WORLD') ?? '')
const requestedLevel = Number(Cypress.env('VISUAL_LEVEL') ?? 0)
const requestedLimit = Number(Cypress.env('VISUAL_LIMIT') ?? 0)
const shardTotal = Math.max(1, Number(Cypress.env('VISUAL_SHARD_TOTAL') ?? 1))
const shardIndex = Number(Cypress.env('VISUAL_SHARD_INDEX') ?? 0)
const requestedSelection = Boolean(requestedWorld || requestedLevel || requestedLimit)
const selectedSolutions = allSolutions
  .filter(solution => !requestedWorld || solution.world === requestedWorld)
  .filter(solution => !requestedLevel || solution.level === requestedLevel)
  .slice(0, requestedLimit > 0 ? requestedLimit : undefined)
  .filter((_, index) => requestedSelection || index % shardTotal === shardIndex)
const playableSolutions = selectedSolutions
  .filter(solution => !solution.visualSkip && !solution.completionNeutral)
const completionNeutralSolutions = selectedSolutions
  .filter(solution => !solution.visualSkip && solution.completionNeutral)
const skippedSolutions = selectedSolutions.filter(solution => solution.visualSkip)
const recordedIssues = new Set<string>()

function levelUrl(solution: ReferenceSolution) {
  return levelPath(solution)
}

function levelPath(solution: ReferenceSolution) {
  return `/g/local/NNG4/world/${solution.world}/level/${solution.level}/visual`
}

/** Navigate the way a link click does, without reloading the Lean runtime.
 *  Routes are real paths now, so assigning the hash no longer moves the app. */
function navigateWithinApp(win: Cypress.AUTWindow, path: string) {
  win.history.pushState({}, '', path)
  win.dispatchEvent(new win.PopStateEvent('popstate'))
}

function auditProofState(solution: ReferenceSolution, phase: string) {
  return cy.window({ timeout: LOAD_TIMEOUT })
    .should(win => {
      const harness = (win as VisualHarnessWindow).__visualTestHarness
      expect(harness, 'visual player test bridge').to.exist
      expect(
        harness?.getProofAudit().processing,
        `${solution.world} ${solution.level} is idle after ${phase}`,
      ).to.equal(false)
    })
    .then(win => {
    const audit = (win as VisualHarnessWindow).__visualTestHarness!.getProofAudit()
    expect(
      audit.coreLines.filter(line => incompleteProofLinePattern.test(line)),
      `${solution.world} ${solution.level} Core log has no incomplete ? entries after ${phase}`,
    ).to.deep.equal([])
    expect(
      audit.interactiveLines.filter(line => incompleteProofLinePattern.test(line)),
      `${solution.world} ${solution.level} Interactive log has no incomplete ? entries after ${phase}`,
    ).to.deep.equal([])
    expect(audit.proofBody, `${solution.world} ${solution.level} proof has no sorry`).not.to.match(/\bsorry\b/u)

    const issues: NameIssue[] = []
    for (const [kind, values] of [
      ['name', audit.visibleNames],
      ['type', audit.visibleTypes],
    ] as const) {
      for (const value of values) {
        if (!malformedNamePattern.test(value)) continue
        const issue = {
          world: solution.world,
          level: solution.level,
          title: solution.title,
          source: solution.source,
          phase,
          kind,
          value,
        }
        const key = JSON.stringify(issue)
        if (!recordedIssues.has(key)) {
          recordedIssues.add(key)
          issues.push(issue)
        }
      }
    }
    if (issues.length === 0) return audit
    // Returning a synchronous audit after queuing cy.task makes Cypress abort
    // the level before the final name audit can report the actual malformed
    // value. Keep the task in the command chain and preserve the audit result.
    return cy.task('recordVisualNameIssues', issues).then(() => audit)
  })
}

function assertCompletedProofRestores(solution: ReferenceSolution, completedAudit: ProofAudit) {
  const autosaveKey = `visual-proof-autosave/g/local/NNG4/${solution.world}/${solution.level}`
  // Saves are stored gzipped; read them the way the app does. Checking the
  // decoded contents also proves the compression is lossless on real proofs,
  // not only on the synthetic payload the unit round trip uses.
  cy.window({ timeout: LOAD_TIMEOUT })
    .then({ timeout: LOAD_TIMEOUT }, async win => {
      const deadline = Date.now() + LOAD_TIMEOUT
      let stored: { session?: Record<string, unknown> } | null = null
      do {
        const raw = win.localStorage.getItem(autosaveKey) ?? ''
        if (raw !== '') {
          stored = await decodeAutosave(raw) as { session?: Record<string, unknown> } | null
          const session = stored?.session as {
            canvasState?: { completed?: boolean }
            proofSteps?: unknown[]
            proofBody?: string
          } | undefined
          if (
            session?.canvasState?.completed === true &&
            (session.proofSteps?.length ?? 0) > 0 &&
            session.proofBody === completedAudit.proofBody
          ) return stored
        }
        await new Cypress.Promise(resolve => setTimeout(resolve, 100))
      } while (Date.now() < deadline)
      return stored
    })
    .then(stored => {
      const session = stored?.session as {
        canvasState?: { completed?: boolean }
        proofSteps?: unknown[]
        proofBody?: string
      } | undefined
      expect(session?.canvasState?.completed, 'completed canvas reached autosave').to.equal(true)
      expect(session?.proofSteps, 'completed proof steps reached autosave').to.have.length.greaterThan(0)
      expect(session?.proofBody, 'completed proof body reached autosave').to.equal(completedAudit.proofBody)
    })
  cy.get('[data-testid="goal-card"]')
    .should('have.class', 'solved')
    .and('have.class', 'just-solved')

  // Leave the route completely, then reopen it as a returning player. This
  // exercises persistence and Lean revalidation, not merely React state.
  cy.window().then(win => { navigateWithinApp(win, '/g/local/NNG4/visual') })
  cy.get('[data-testid="visual-world-map"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
  cy.window().then(win => { navigateWithinApp(win, levelPath(solution)) })
  cy.get('[data-testid="visual-proof-page"]', { timeout: LOAD_TIMEOUT })
    .should('be.visible')
    .and('have.attr', 'data-world-id', solution.world)
    .and('have.attr', 'data-level-id', String(solution.level))

  auditProofState(solution, 'restored completed proof').then(restoredAudit => {
    expect(restoredAudit.completed, 'reopened proof remains Lean-complete').to.equal(true)
    expect(restoredAudit.proofBody, 'reopened interactive proof is restored').to.equal(completedAudit.proofBody)
    expect(restoredAudit.coreProofBody, 'reopened Core proof is restored').to.equal(completedAudit.coreProofBody)
  })
  cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT })
    .should('be.visible')
    .and('have.class', 'solved')
    .and('not.have.class', 'just-solved')
    .then($goal => {
      const style = getComputedStyle($goal[0]!)
      expect(style.animationName, 'restored completion does not replay the solve animation').to.equal('none')
      expect(style.borderColor, 'restored completed goal has no yellow border').not.to.equal('rgb(234, 179, 8)')
      expect(style.boxShadow, 'restored completed goal has no yellow glow').not.to.contain('234, 179, 8')
    })
  cy.get('.visual-header').should('have.class', 'completed')
  cy.get('.tr-controls .active-undo[aria-label="Undo"]', { timeout: LOAD_TIMEOUT })
    .should('be.visible')
    .and('have.attr', 'aria-disabled', 'false')
}

describe('complete Visual Lean NNG4 player playthrough', { testIsolation: false }, () => {
  let applicationStarted = false
  let player: CompletePlaythroughDriver

  before(() => {
    Cypress.config('defaultCommandTimeout', LOAD_TIMEOUT)
    Cypress.config('requestTimeout', LOAD_TIMEOUT)
    expect(allSolutions, 'every shipped level has a reference solution').to.have.length(70)
    expect(allPlayableSolutions, 'ordinary Visual Lean player levels').to.have.length(66)
    expect(allCompletionNeutralSolutions, 'completion-neutral Visual Lean levels').to.have.length(1)
    expect(allSkippedSolutions, 'explicit VisualSkipLevel entries').to.have.length(3)
    expect(shardIndex, 'shard index is in range').to.be.within(0, shardTotal - 1)
    expect(selectedSolutions, 'selected level inventory').not.to.have.length(0)
    cy.clearCookies()
    cy.clearLocalStorage()
  })

  afterEach(function () {
    // Every level is independently expensive because it is checked by Lean.
    // Once one player interaction fails, stop this spec so CI reports that
    // actionable failure instead of waiting through the remaining levels.
    if (this.currentTest?.state === 'failed') Cypress.stop()
  })

  for (const solution of playableSolutions) {
    it(`${solution.world} ${solution.level}: ${solution.title}`, () => {
      // Exercise the same responsive layout and visible branch controls used
      // by phone players. The shared driver deliberately switches to a live
      // sibling and back after every split, then explicitly selects the next
      // unfinished branch after completing one.
      cy.viewport(390, 844)
      if (!applicationStarted) {
        cy.visit(levelUrl(solution), {
          onBeforeLoad(win) {
            win.localStorage.setItem('visual_auto_branch_switch', 'false')
          },
        })
        applicationStarted = true
      } else {
        cy.window().then(win => {
          navigateWithinApp(win, levelPath(solution))
        })
      }
      cy.get('[data-testid="visual-proof-page"]', { timeout: LOAD_TIMEOUT })
        .should('be.visible')
        .and('have.attr', 'data-world-id', solution.world)
        .and('have.attr', 'data-level-id', String(solution.level))
      cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
      auditProofState(solution, 'initial state')

      cy.window().then(win => {
        player = new CompletePlaythroughDriver(win)
        return player.prepareInitialBinders(solution.initialBinderNames, solution.commands[0] ?? '')
      })

      solution.commands.forEach((command, index) => {
        cy.then(() => {
          Cypress.log({ name: 'player gesture', message: command })
          return player.perform(command)
        })
        auditProofState(solution, `step ${index + 1}: ${command}`)
      })

      auditProofState(solution, 'completed visual proof').then(audit => {
        expect(
          audit.completed,
          `${solution.world} ${solution.level} completes visually; audit=${JSON.stringify(audit)}`,
        ).to.equal(true)
        expect(audit.coreLines, 'Core proof log is populated').not.to.deep.equal([])
        expect(audit.interactiveLines, 'Interactive proof log is populated').not.to.deep.equal([])
        cy.window({ timeout: LOAD_TIMEOUT }).then({ timeout: LOAD_TIMEOUT }, async win => {
          const generated = await (win as VisualHarnessWindow).__visualTestHarness!.validateGeneratedProofs()
          expect(
            generated.coreCompleted,
            `${solution.world} ${solution.level} generated Core proof completes in classic Lean:\n${generated.coreProofBody}\n${generated.coreError}`,
          ).to.equal(true)
          expect(
            generated.coreProofBody,
            `${solution.world} ${solution.level} classic-visible Core proof has no hidden initial revert`,
          ).not.to.match(/^revert\b/u)
          expect(
            generated.interactiveCompleted,
            `${solution.world} ${solution.level} generated Interaction proof completes in classic Lean:\n${generated.interactiveProofBody}\n${generated.interactiveError}`,
          ).to.equal(true)
        })
        assertCompletedProofRestores(solution, audit)
        // Focused diagnostic runs must not turn their selected level into the
        // synthetic "last level" and exercise an unrelated classic export.
        // The unfiltered 66-level playthrough still validates the handoff on
        // the actual final playable level.
        if (solution !== allPlayableSolutions.at(-1)) return

        cy.get('body').then(body => {
          const mobileProofLink = body.find<HTMLButtonElement>('button[aria-label="Open proof"]')
          if (mobileProofLink.length > 0 && mobileProofLink.is(':visible')) {
            cy.wrap(mobileProofLink).click()
            cy.get('.mobile-proof-page').should('have.class', 'open')
            return
          }
          cy.get('.proof-sidebar', { timeout: LOAD_TIMEOUT }).then(sidebar => {
            if (!sidebar.hasClass('open')) {
              cy.wrap(sidebar).find('.proof-sidebar-tab').click()
            }
          })
          cy.get('.proof-sidebar').should('have.class', 'open')
        })
        cy.window().then(win => {
          cy.stub(win, 'open').as('openClassic')
        })
        cy.get('[data-testid="proof-actions-toggle"]', { timeout: LOAD_TIMEOUT })
          .should('be.visible')
          .click()
        cy.contains('button', 'Export to classic mode', { timeout: LOAD_TIMEOUT })
          .scrollIntoView()
          .should('be.visible')
          .click()

        // Export the Interaction log as well. Only the Core body was ever
        // handed off here, so a broken Interaction export could not be seen.
        cy.contains('.proof-sidebar-mode-btn', 'Interactive').click()
        cy.get('[data-testid="proof-actions-toggle"]', { timeout: LOAD_TIMEOUT })
          .should('be.visible')
          .click()
        cy.contains('button', 'Export to classic mode', { timeout: LOAD_TIMEOUT })
          .scrollIntoView()
          .should('be.visible')
          .click()

        cy.get('@openClassic').should('have.been.calledTwice').then(openClassic => {
          const calls = openClassic as unknown as { getCall(index: number): { args: unknown[] } }
          const exported = [audit.coreProofBody, audit.interactiveProofBody]
          const targets: string[] = []
          for (const [index, expectedBody] of exported.entries()) {
            const mode = index === 0 ? 'Core' : 'Interaction'
            const [target, browsingContext, features] = calls.getCall(index).args
            expect(browsingContext).to.equal('_blank')
            expect(features).to.include('noopener')
            const handoffMatch = /[?&]visualHandoff=([^&]+)/u.exec(String(target))
            expect(handoffMatch, `${mode} classic-mode URL contains a proof handoff token`)
              .not.to.equal(null)
            targets.push(String(target))
            cy.window().then(win => {
              const handoff = JSON.parse(
                win.localStorage.getItem(`visual-proof-handoff/${decodeURIComponent(handoffMatch![1])}`) ?? 'null',
              )
              expect(handoff?.proofBody, `exported ${mode} classic proof body`).to.equal(expectedBody)
            })
          }
          // Both handoffs must open a classic level that Lean reports solved.
          for (const [index, target] of targets.entries()) {
            const mode = index === 0 ? 'Core' : 'Interaction'
            cy.visit(target)
            if (mountPath.includes('/lean4game/')) {
              cy.get('#local-classic-proof', { timeout: LOAD_TIMEOUT })
                .should('have.class', 'local-wasm-code-editor')
                .and('be.visible')
                .should('have.value', exported[index])
              cy.get('.local-classic-status', { timeout: LOAD_TIMEOUT })
                .should('contain.text', 'Proof complete')
                .and('have.class', 'is-complete')
            } else {
              cy.location('search', { timeout: LOAD_TIMEOUT }).should('include', 'visualHandoff=')
              cy.get('.exercise-panel .exercise', { timeout: LOAD_TIMEOUT }).should('be.visible')
            }
            cy.log(`${mode} export solved the classic level`)
          }
        })
      })
    })
  }

  for (const solution of completionNeutralSolutions) {
    it(`${solution.world} ${solution.level}: ${solution.title} (completion-neutral contract)`, () => {
      cy.viewport(390, 844)
      cy.visit(levelUrl(solution))
      applicationStarted = true
      cy.get('[data-testid="visual-proof-page"]', { timeout: LOAD_TIMEOUT })
        .should('be.visible')
        .and('have.attr', 'data-world-id', solution.world)
        .and('have.attr', 'data-level-id', String(solution.level))
      cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
      cy.contains('.visual-info-callout', 'Good luck!').should('be.visible')
      cy.request(`${dataPath}data/g/local/NNG4/game.json`).then(response => {
        expect(response.body.completionNeutralLevels[solution.world]).to.include(solution.level)
      })
      auditProofState(solution, 'completion-neutral initial state')
    })
  }

  for (const solution of skippedSolutions) {
    it(`${solution.world} ${solution.level}: ${solution.title} (VisualSkipLevel contract)`, () => {
      cy.request(`${dataPath}data/g/local/NNG4/game.json`).then(response => {
        expect(response.body.skippedLevels[solution.world], 'server publishes the explicit skip').to.include(solution.level)
      })
      cy.request(`${dataPath}data/g/local/NNG4/level__${solution.world}__${solution.level}.json`).then(response => {
        expect(response.body.title).to.equal(solution.title)
      })
    })
  }

  it('flags no malformed Lean-generated names across the playthrough', () => {
    cy.task('writeVisualNameAudit').then((result: { path: string; count: number }) => {
      expect(
        result.count,
        `weird Lean names were written to ${result.path}`,
      ).to.equal(0)
    })
  })

  after(() => {
    cy.task('writeVisualNameAudit')
  })
})
