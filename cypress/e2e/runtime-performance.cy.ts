const LOAD_TIMEOUT = Number(Cypress.env('VISUAL_TIMEOUT') ?? 600_000)
const mountPath = Cypress.env('LEAN4GAME_MOUNT') ?? '/lean4game/index.html?mobileModules=1'
const variant = String(Cypress.env('BENCHMARK_VARIANT') ?? 'unknown')

type BenchmarkHarness = {
  runPlayerTactic(command: string): Promise<void>
  getProofAudit(): { completed: boolean; coreLines: string[] }
}

type BenchmarkWindow = Cypress.AUTWindow & {
  __visualTestHarness?: BenchmarkHarness
  __leanRuntimeMemoryBytes?: number
  performance: Performance & {
    measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>
  }
}

describe(`Visual Lean runtime performance (${variant})`, () => {
  it('measures cold readiness, proof actions, and page memory', () => {
    cy.viewport(1280, 720)
    cy.clearCookies()
    cy.clearLocalStorage()
    let coldStart = 0
    cy.then(() => { coldStart = performance.now() })
    cy.visit(`${mountPath}#/g/local/NNG4/world/Addition/level/1/visual`)
    cy.get('[data-testid="visual-proof-page"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
    cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')

    const commands = [
      'induction n with d hd',
      'rw [add_zero]',
      'rfl',
      'rw [add_succ]',
      'rw [hd]',
      'rfl',
    ]
    const result: {
      variant: string
      crossOriginIsolated: boolean
      coldReadyMs: number
      actionMs: Array<{ command: string; elapsedMs: number }>
      memoryBytes?: number
      wasmLinearMemoryBytes?: number
      cdpHeap?: {
        usedSize: number
        totalSize: number
        embedderHeapUsedSize: number
        backingStorageSize: number
      }
      completed?: boolean
    } = {
      variant,
      crossOriginIsolated: false,
      coldReadyMs: 0,
      actionMs: [],
    }

    cy.then(() => { result.coldReadyMs = performance.now() - coldStart })

    cy.window().then(win => {
      const benchmarkWin = win as BenchmarkWindow
      result.crossOriginIsolated = benchmarkWin.crossOriginIsolated
      expect(benchmarkWin.__visualTestHarness, 'visual player test bridge').to.exist
    })
    commands.forEach((command, index) => {
      let started = 0
      cy.window().then(async win => {
        const harness = (win as BenchmarkWindow).__visualTestHarness
        expect(harness, 'visual player test bridge').to.exist
        started = performance.now()
        await harness!.runPlayerTactic(command)
      })
      // The RPC promise resolves before React publishes the reconciled stream.
      // Include that user-visible update in the timing and do not start the
      // next command against a stale harness closure.
      cy.window().should(win => {
        const audit = (win as BenchmarkWindow).__visualTestHarness?.getProofAudit()
        expect(audit?.coreLines.length, `proof log after ${command}`).to.be.at.least(index + 1)
      }).then(() => {
        result.actionMs.push({ command, elapsedMs: performance.now() - started })
      })
    })
    cy.window().then(async win => {
      const benchmarkWin = win as BenchmarkWindow
      const harness = benchmarkWin.__visualTestHarness
      expect(harness, 'visual player test bridge').to.exist
      result.completed = harness!.getProofAudit().completed
      result.wasmLinearMemoryBytes = benchmarkWin.__leanRuntimeMemoryBytes
      expect(result.completed, 'benchmark proof completes').to.equal(true)
      if (benchmarkWin.performance.measureUserAgentSpecificMemory) {
        try {
          result.memoryBytes = (await benchmarkWin.performance.measureUserAgentSpecificMemory()).bytes
        } catch {
          // Some headless Chromium builds expose the API but disable collection.
        }
      }
    }).then(async () => {
      try {
        result.cdpHeap = await Cypress.automation('remote:debugger:protocol', {
          command: 'Runtime.getHeapUsage',
        }) as typeof result.cdpHeap
      } catch {
        // Retain timings on browsers that do not expose this CDP command.
      }
    }).then(() => cy.task('writeRuntimeBenchmark', result).then(summary => {
      cy.log(JSON.stringify({ ...result, output: summary }))
    }))
  })
})
