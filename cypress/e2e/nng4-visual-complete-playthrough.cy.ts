import solutionFixture from '../fixtures/nng4-visual-solutions.json'

const LOAD_TIMEOUT = Number(Cypress.env('VISUAL_TIMEOUT') ?? 600_000)
const mountPath = Cypress.env('LEAN4GAME_MOUNT') ?? '/lean4game/index.html'
const malformedNamePattern = /(?:_@|_internal|_hyg|^\?m(?:\.|$)|[†✝]|\uFFFD|Ã|Â|â)/u
// A completed player command should never leave a tactic placeholder or
// metavariable anywhere in either rendered proof log.
const incompleteProofLinePattern = /\?/u

interface ReferenceSolution {
  world: string
  level: number
  title: string
  visualSkip: boolean
  source: string
  commands: string[]
}

interface ProofAudit {
  completed: boolean
  processing: boolean
  proofBody: string
  coreProofBody: string
  coreLines: string[]
  interactiveLines: string[]
  visibleNames: string[]
  visibleTypes: string[]
}

interface VisualTestHarness {
  runPlayerTactic(command: string): Promise<void>
  getProofAudit(): ProofAudit
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

const allPlayableSolutions = (solutionFixture.solutions as ReferenceSolution[])
  .filter(solution => !solution.visualSkip)
const requestedWorld = String(Cypress.env('VISUAL_WORLD') ?? '')
const requestedLevel = Number(Cypress.env('VISUAL_LEVEL') ?? 0)
const requestedLimit = Number(Cypress.env('VISUAL_LIMIT') ?? 0)
const playableSolutions = allPlayableSolutions
  .filter(solution => !requestedWorld || solution.world === requestedWorld)
  .filter(solution => !requestedLevel || solution.level === requestedLevel)
  .slice(0, requestedLimit > 0 ? requestedLimit : undefined)
const recordedIssues = new Set<string>()

function levelUrl(solution: ReferenceSolution) {
  return `${mountPath}#/g/local/NNG4/world/${solution.world}/level/${solution.level}/visual`
}

function levelHash(solution: ReferenceSolution) {
  return `#/g/local/NNG4/world/${solution.world}/level/${solution.level}/visual`
}

function visualHarness() {
  return cy.window({ timeout: LOAD_TIMEOUT })
    .should(win => {
      expect((win as VisualHarnessWindow).__visualTestHarness, 'visual player test bridge').to.exist
    })
    .then(win => (win as VisualHarnessWindow).__visualTestHarness!)
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
    if (issues.length > 0) cy.task('recordVisualNameIssues', issues)
    return audit
  })
}

describe('complete Visual Lean NNG4 player playthrough', { testIsolation: false }, () => {
  let applicationStarted = false

  before(() => {
    Cypress.config('defaultCommandTimeout', LOAD_TIMEOUT)
    Cypress.config('requestTimeout', LOAD_TIMEOUT)
    expect(allPlayableSolutions, 'all currently shipped Visual Lean levels').to.have.length(66)
    expect(playableSolutions, 'selected Visual Lean levels').not.to.have.length(0)
    cy.clearCookies()
    cy.clearLocalStorage()
  })

  for (const solution of playableSolutions) {
    it(`${solution.world} ${solution.level}: ${solution.title}`, () => {
      cy.viewport(1920, 1080)
      if (!applicationStarted) {
        cy.visit(levelUrl(solution))
        applicationStarted = true
      } else {
        cy.window().then(win => {
          win.location.hash = levelHash(solution)
        })
      }
      cy.get('[data-testid="visual-proof-page"]', { timeout: LOAD_TIMEOUT })
        .should('be.visible')
        .and('have.attr', 'data-world-id', solution.world)
        .and('have.attr', 'data-level-id', String(solution.level))
      cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
      auditProofState(solution, 'initial state')

      solution.commands.forEach((command, index) => {
        visualHarness().then(harness => harness.runPlayerTactic(command))
        auditProofState(solution, `step ${index + 1}: ${command}`)
      })

      auditProofState(solution, 'completed visual proof').then(audit => {
        expect(audit.completed, `${solution.world} ${solution.level} completes visually`).to.equal(true)
        expect(audit.coreLines, 'Core proof log is populated').not.to.deep.equal([])
        expect(audit.interactiveLines, 'Interactive proof log is populated').not.to.deep.equal([])

        cy.get('.proof-sidebar', { timeout: LOAD_TIMEOUT }).then(sidebar => {
          if (!sidebar.hasClass('open')) {
            cy.wrap(sidebar).find('.proof-sidebar-tab').click()
          }
        })
        cy.get('.proof-sidebar').should('have.class', 'open')
        cy.window().then(win => {
          cy.stub(win, 'open').as('openClassic')
        })
        cy.contains('button', 'Export to classic mode', { timeout: LOAD_TIMEOUT })
          .scrollIntoView()
          .should('be.visible')
          .click()

        cy.get('@openClassic').should('have.been.calledOnce').then(openClassic => {
          const [target, browsingContext, features] =
            (openClassic as unknown as { getCall(index: number): { args: unknown[] } }).getCall(0).args
          expect(browsingContext).to.equal('_blank')
          expect(features).to.include('noopener')
          cy.visit(String(target))
        })
        cy.get('#local-classic-proof', { timeout: LOAD_TIMEOUT })
          .should('have.class', 'local-wasm-code-editor')
          .and('be.visible')
          .should('have.value', audit.coreProofBody)
        cy.get('.local-classic-status', { timeout: LOAD_TIMEOUT })
          .should('contain.text', 'Proof complete')
          .and('have.class', 'is-complete')
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
