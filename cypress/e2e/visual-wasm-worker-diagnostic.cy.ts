describe('Visual Lean WASM worker startup', () => {
  it('reaches worker_ready', { defaultCommandTimeout: 300_000 }, () => {
    cy.visit('/')
    cy.window().then({ timeout: 210000 }, win => new Cypress.Promise<void>((resolve, reject) => {
      const events: string[] = []
      const worker = new win.Worker('/lean-worker-persistent.worker.js?assetBase=%2Fvisual-lean%2Fruntime&v=nng4-browser-v2&memoryMB=1536')
      const timer = win.setTimeout(() => {
        worker.terminate()
        reject(new Error(`worker startup timeout; isolated=${win.crossOriginIsolated}; events=${events.join(' | ')}`))
      }, 120000)
      worker.onmessage = event => {
        const msg = event.data ?? {}
        events.push(`${msg.type}${msg.data ? `: ${msg.data}` : ''}`)
        if (msg.type === 'worker_boot') worker.postMessage({ type: 'load_library', files: [] })
        else if (msg.type === 'library_received') worker.postMessage({ type: 'start_worker' })
        else if (msg.type === 'worker_ready') {
          win.clearTimeout(timer)
          worker.terminate()
          resolve()
        } else if (msg.type === 'error') {
          win.clearTimeout(timer)
          worker.terminate()
          reject(new Error(`worker error; isolated=${win.crossOriginIsolated}; events=${events.join(' | ')}`))
        }
      }
      worker.onerror = event => {
        win.clearTimeout(timer)
        reject(new Error(`worker exception: ${event.message}; isolated=${win.crossOriginIsolated}; events=${events.join(' | ')}`))
      }
    }))
  })

  it.skip('runs click_goal before and after an incomplete proof in one persistent worker', () => {
    cy.visit('/visual-lean-diagnostic.html')
    cy.title({ timeout: 600_000 }).should('eq', 'Visual Lean diagnostic: passed')
    cy.get('#log').should('contain.text', 'snapshot_loaded')
    cy.get('#log').should('contain.text', 'compile_result')
    cy.get('#log').should('not.contain.text', 'Lean WASM terminated while checking the proof')
  })
})
