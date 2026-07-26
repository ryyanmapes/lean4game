import { defineConfig } from "cypress";
import { promises as fs } from "node:fs";
import path from "node:path";

export default defineConfig({
  numTestsKeptInMemory: 0,
  experimentalMemoryManagement: true,
  video: false,
  e2e: {
    setupNodeEvents(on, config) {
      let visualNameIssues: unknown[] = []
      const reportPath = path.resolve('cypress/results/visual-name-audit.json')

      on('before:run', () => {
        visualNameIssues = []
      })
      on('before:browser:launch', (browser, launchOptions) => {
        if (browser.family === 'chromium') {
          // The release runtime is an unusually large WASM module. A fresh
          // Cypress Chrome profile has no compiled-code cache, so eagerly
          // compiling every function can spend the entire test timeout before
          // the worker emits its first ready event.
          launchOptions.args.push('--js-flags=--wasm-lazy-compilation --max-old-space-size=4096')
          launchOptions.args.push('--enable-features=SharedArrayBuffer,SharedArrayBufferOnDesktop')
        }
        return launchOptions
      })
      on('task', {
        recordVisualNameIssues(issues: unknown[]) {
          visualNameIssues.push(...issues)
          return null
        },
        async writeVisualNameAudit() {
          await fs.mkdir(path.dirname(reportPath), { recursive: true })
          await fs.writeFile(reportPath, `${JSON.stringify(visualNameIssues, null, 2)}\n`)
          return { path: reportPath, count: visualNameIssues.length }
        },
      })
      on('after:run', async () => {
        await fs.mkdir(path.dirname(reportPath), { recursive: true })
        await fs.writeFile(reportPath, `${JSON.stringify(visualNameIssues, null, 2)}\n`)
      })
      return config
    },
    baseUrl: 'http://localhost:3000'
  },
});
