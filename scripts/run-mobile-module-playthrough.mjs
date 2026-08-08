#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const [baseUrl, outputName = 'mobile-module-playthrough'] = process.argv.slice(2)
if (!baseUrl) {
  console.error('usage: run-mobile-module-playthrough.mjs <base-url> [output-name]')
  process.exit(2)
}

const executablePath = process.env.CHROME_PATH
if (!executablePath) throw new Error('CHROME_PATH is required')

const loadTimeout = Number(process.env.VISUAL_TIMEOUT ?? 600_000)
const expectCrossOriginIsolated = process.env.EXPECT_CROSS_ORIGIN_ISOLATED !== 'false'
const fixture = JSON.parse(await fs.readFile('cypress/fixtures/nng4-visual-solutions.json', 'utf8'))
const solutions = fixture.solutions.filter(solution => !solution.visualSkip)
const malformedNamePattern = /(?:_@|_internal|_hyg|^\?m(?:\.|$)|[†✝]|\uFFFD|Ãƒ|Ã‚|Ã¢)/u
const outputDir = 'cypress/results'
const output = path.join(outputDir, `${outputName}.json`)
const results = {
  baseUrl,
  startedAt: new Date().toISOString(),
  expectedLevels: 66,
  completedLevels: 0,
  crossOriginIsolated: false,
  sharedArrayBufferAvailable: false,
  canonicalRoutePreserved: true,
  malformedNames: [],
  levels: [],
  browserErrors: [],
}

if (solutions.length !== results.expectedLevels) {
  throw new Error(`expected ${results.expectedLevels} playable levels, found ${solutions.length}`)
}

async function persist() {
  await fs.mkdir(outputDir, { recursive: true })
  await fs.writeFile(output, `${JSON.stringify(results, null, 2)}\n`)
}

function levelHash(solution) {
  return `#/g/local/NNG4/world/${solution.world}/level/${solution.level}/visual`
}

async function waitForLevel(page, solution) {
  await page.waitForFunction(
    (world, level) => {
      const proof = document.querySelector('[data-testid="visual-proof-page"]')
      const goal = document.querySelector('[data-testid="goal-card"]')
      return proof?.getAttribute('data-world-id') === world
        && proof?.getAttribute('data-level-id') === String(level)
        && goal !== null
        && window.__visualTestHarness
        && !window.__visualTestHarness.getProofAudit().processing
    },
    { timeout: loadTimeout },
    solution.world,
    solution.level,
  )
}

async function audit(page, solution, phase) {
  await page.waitForFunction(
    () => window.__visualTestHarness && !window.__visualTestHarness.getProofAudit().processing,
    { timeout: loadTimeout },
  )
  const state = await page.evaluate(() => ({
    audit: window.__visualTestHarness.getProofAudit(),
    location: window.location.href,
  }))
  const incompleteCore = state.audit.coreLines.filter(line => line.includes('?'))
  const incompleteInteractive = state.audit.interactiveLines.filter(line => line.includes('?'))
  if (incompleteCore.length || incompleteInteractive.length) {
    throw new Error(`${solution.world} ${solution.level} has incomplete proof text after ${phase}`)
  }
  if (/\bsorry\b/u.test(state.audit.proofBody)) {
    throw new Error(`${solution.world} ${solution.level} contains sorry after ${phase}`)
  }
  for (const [kind, values] of [
    ['name', state.audit.visibleNames],
    ['type', state.audit.visibleTypes],
  ]) {
    for (const value of values) {
      if (!malformedNamePattern.test(value)) continue
      results.malformedNames.push({
        world: solution.world,
        level: solution.level,
        title: solution.title,
        phase,
        kind,
        value,
      })
    }
  }
  if (new URL(state.location).searchParams.has('mobileModules')) {
    results.canonicalRoutePreserved = false
    throw new Error(`obsolete mobileModules selector appeared at ${solution.world} ${solution.level}`)
  }
  return state.audit
}

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  protocolTimeout: loadTimeout,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--js-flags=--wasm-lazy-compilation --max-old-space-size=4096',
  ],
})

let page
try {
  page = await browser.newPage()
  await page.evaluateOnNewDocument(() => { window.Cypress = {} })
  const session = await page.createCDPSession()
  await session.send('Network.enable')
  await session.send('Network.setCacheDisabled', { cacheDisabled: true })
  page.on('pageerror', error => results.browserErrors.push(String(error)))
  page.on('error', error => results.browserErrors.push(`page crashed: ${String(error)}`))
  page.on('console', message => {
    if (message.type() === 'error') results.browserErrors.push(message.text())
  })

  const first = solutions[0]
  const target = `${baseUrl.replace(/\/$/u, '')}/lean4game/index.html${levelHash(first)}`
  const coldStarted = performance.now()
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: loadTimeout })
  await waitForLevel(page, first)
  results.coldReadyMs = performance.now() - coldStarted
  const browserIsolation = await page.evaluate(() => ({
    crossOriginIsolated: window.crossOriginIsolated,
    sharedArrayBufferAvailable: typeof SharedArrayBuffer !== 'undefined',
  }))
  results.crossOriginIsolated = browserIsolation.crossOriginIsolated
  results.sharedArrayBufferAvailable = browserIsolation.sharedArrayBufferAvailable
  if (results.crossOriginIsolated !== expectCrossOriginIsolated) {
    throw new Error(
      `expected crossOriginIsolated=${expectCrossOriginIsolated}, got ${results.crossOriginIsolated}`,
    )
  }

  for (let solutionIndex = 0; solutionIndex < solutions.length; solutionIndex += 1) {
    const solution = solutions[solutionIndex]
    const levelStarted = performance.now()
    if (solutionIndex > 0) {
      await page.evaluate(hash => { window.location.hash = hash }, levelHash(solution))
      await waitForLevel(page, solution)
    }
    await audit(page, solution, 'initial state')

    for (let commandIndex = 0; commandIndex < solution.commands.length; commandIndex += 1) {
      const command = solution.commands[commandIndex]
      await page.evaluate(async playerCommand => {
        await window.__visualTestHarness.runPlayerTactic(playerCommand)
      }, command)
      await audit(page, solution, `step ${commandIndex + 1}: ${command}`)
    }

    const completedAudit = await audit(page, solution, 'completed proof')
    if (!completedAudit.completed) {
      throw new Error(`${solution.world} ${solution.level} did not complete`)
    }
    if (!completedAudit.coreLines.length || !completedAudit.interactiveLines.length) {
      throw new Error(`${solution.world} ${solution.level} produced an empty proof log`)
    }

    results.levels.push({
      world: solution.world,
      level: solution.level,
      title: solution.title,
      commands: solution.commands.length,
      elapsedMs: performance.now() - levelStarted,
      coreProofBody: completedAudit.coreProofBody,
    })
    results.completedLevels += 1
    await persist()
  }

  if (results.malformedNames.length) {
    throw new Error(`found ${results.malformedNames.length} malformed Lean names`)
  }

  const last = results.levels.at(-1)
  await page.evaluate(() => {
    window.__mobileValidationOpenedUrl = ''
    window.open = url => {
      window.__mobileValidationOpenedUrl = String(url)
      return null
    }
    const sidebar = document.querySelector('.proof-sidebar')
    if (sidebar && !sidebar.classList.contains('open')) {
      document.querySelector('.proof-sidebar-tab')?.click()
    }
  })
  await page.waitForFunction(() => document.querySelector('.proof-sidebar')?.classList.contains('open'))
  await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('button'))
      .find(candidate => candidate.textContent?.includes('Export to classic mode'))
    if (!button) throw new Error('Export to classic mode button is missing')
    button.click()
  })
  await page.waitForFunction(() => Boolean(window.__mobileValidationOpenedUrl))
  const classicTarget = await page.evaluate(() => window.__mobileValidationOpenedUrl)
  if (new URL(classicTarget).searchParams.has('mobileModules')) {
    throw new Error('classic export introduced the obsolete mobileModules selector')
  }
  await page.goto(classicTarget, { waitUntil: 'domcontentloaded', timeout: loadTimeout })
  await page.waitForSelector('#local-classic-proof.local-wasm-code-editor', { visible: true, timeout: loadTimeout })
  await page.waitForFunction(
    () => document.querySelector('.local-classic-status')?.textContent?.includes('Proof complete'),
    { timeout: loadTimeout },
  )
  const classicProof = await page.$eval('#local-classic-proof', element => element.value)
  if (classicProof !== last.coreProofBody) throw new Error('classic export did not use the Core proof')
  results.classicExportValidated = true
  results.finishedAt = new Date().toISOString()
  results.cdpHeap = await session.send('Runtime.getHeapUsage')
  await persist()
  console.log(JSON.stringify({ output, completedLevels: results.completedLevels, coldReadyMs: results.coldReadyMs }, null, 2))
} catch (error) {
  results.error = error instanceof Error ? error.stack ?? error.message : String(error)
  results.finishedAt = new Date().toISOString()
  if (page) {
    try {
      results.failurePage = await page.evaluate(() => ({
        location: window.location.href,
        bodyText: document.body?.innerText.slice(-6000),
        workerStatus: window.__leanWorkerStatus,
        proofAudit: window.__visualTestHarness?.getProofAudit(),
      }))
      await fs.mkdir(outputDir, { recursive: true })
      await page.screenshot({ path: path.join(outputDir, `${outputName}-failure.png`), fullPage: true })
    } catch (diagnosticError) {
      results.browserErrors.push(`diagnostic collection failed: ${String(diagnosticError)}`)
    }
  }
  await persist()
  throw error
} finally {
  await browser.close()
}
