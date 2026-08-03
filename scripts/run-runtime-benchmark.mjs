#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const [baseUrl, variant, sampleCountText = '3'] = process.argv.slice(2)
if (!baseUrl || !variant) {
  console.error('usage: run-runtime-benchmark.mjs <base-url> <variant> [samples]')
  process.exit(2)
}

const executablePath = process.env.CHROME_PATH
if (!executablePath) throw new Error('CHROME_PATH is required')
const sampleCount = Number(sampleCountText)
const loadTimeout = 600_000
const commands = [
  'induction n with d hd',
  'rw [add_zero]',
  'rfl',
  'rw [add_succ]',
  'rw [hd]',
  'rfl',
]
const target = `${baseUrl}/lean4game/index.html?mobileModules=1#/g/local/NNG4/world/Addition/level/1/visual`
const results = []
const output = path.join('cypress/results', `runtime-benchmark-${variant}.json`)
let failed = false

for (let sample = 1; sample <= sampleCount; sample += 1) {
  let page
  const browserErrors = []
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--js-flags=--wasm-lazy-compilation --max-old-space-size=4096',
    ],
  })
  try {
    page = await browser.newPage()
    // The existing Cypress suite exposes its player bridge only when this
    // marker is present. Set the same marker before React evaluates so this
    // top-level, cross-origin-isolated transport exercises identical actions.
    await page.evaluateOnNewDocument(() => { window.Cypress = {} })
    const session = await page.createCDPSession()
    await session.send('Network.enable')
    await session.send('Network.setCacheDisabled', { cacheDisabled: true })
    page.on('pageerror', error => browserErrors.push(String(error)))
    page.on('error', error => browserErrors.push(`page crashed: ${String(error)}`))
    page.on('console', message => {
      if (message.type() === 'error') browserErrors.push(message.text())
    })

    const started = performance.now()
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: loadTimeout })
    await page.waitForSelector('[data-testid="visual-proof-page"]', { visible: true, timeout: loadTimeout })
    await page.waitForSelector('[data-testid="goal-card"]', { visible: true, timeout: loadTimeout })
    const coldReadyMs = performance.now() - started
    const actionMs = []

    for (let index = 0; index < commands.length; index += 1) {
      const command = commands[index]
      const actionStarted = performance.now()
      await page.evaluate(async playerCommand => {
        const harness = window.__visualTestHarness
        if (!harness) throw new Error('visual player test bridge is missing')
        await harness.runPlayerTactic(playerCommand)
      }, command)
      await page.waitForFunction(
        minimum => window.__visualTestHarness?.getProofAudit().coreLines.length >= minimum,
        { timeout: 60_000 },
        index + 1,
      )
      actionMs.push({ command, elapsedMs: performance.now() - actionStarted })
    }

    const pageState = await page.evaluate(() => ({
      completed: window.__visualTestHarness?.getProofAudit().completed ?? false,
      crossOriginIsolated: window.crossOriginIsolated,
      wasmLinearMemoryBytes: window.__leanRuntimeMemoryBytes,
    }))
    if (!pageState.completed) throw new Error('benchmark proof did not complete')
    const heap = await session.send('Runtime.getHeapUsage')
    results.push({
      variant,
      sample,
      coldReadyMs,
      actionMs,
      ...pageState,
      cdpHeap: heap,
      browserErrors,
    })
  } catch (error) {
    failed = true
    let pageState
    if (page) {
      try {
        pageState = await page.evaluate(() => ({
          location: window.location.href,
          title: document.title,
          readyState: document.readyState,
          crossOriginIsolated: window.crossOriginIsolated,
          wasmLinearMemoryBytes: window.__leanRuntimeMemoryBytes,
          bodyText: document.body?.innerText.slice(-6000),
        }))
        await fs.mkdir('cypress/results', { recursive: true })
        await page.screenshot({
          path: path.join('cypress/results', `runtime-benchmark-${variant}-failure.png`),
          fullPage: true,
        })
      } catch (diagnosticError) {
        browserErrors.push(`diagnostic collection failed: ${String(diagnosticError)}`)
      }
    }
    results.push({
      variant,
      sample,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
      pageState,
      browserErrors,
    })
    break
  } finally {
    await browser.close()
  }
}

await fs.mkdir('cypress/results', { recursive: true })
await fs.writeFile(output, `${JSON.stringify(results, null, 2)}\n`)
console.log(JSON.stringify({ output, results }, null, 2))
if (failed) process.exitCode = 1
