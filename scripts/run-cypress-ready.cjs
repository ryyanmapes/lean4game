const { spawn } = require('node:child_process')
const path = require('node:path')
const waitOn = require('wait-on')

const args = process.argv.slice(2)
const baseUrl = new URL(process.env.CYPRESS_BASE_URL || 'http://127.0.0.1:3000')

function httpGetResource(pathname) {
  const target = new URL(pathname, baseUrl)
  return `http-get://${target.host}${target.pathname}${target.search}`
}

const defaultPaths = [
  '/lean4game/index.html',
  '/lean4game/data/g/test/TestGame/game.json',
  '/lean4game/data/g/local/VisualTest/game.json',
  '/lean4game/data/g/local/NNG4/game.json',
]
const configuredPaths = process.env.CYPRESS_READY_PATHS
  ?.split(',')
  .map(value => value.trim())
  .filter(Boolean)
const resources = (configuredPaths?.length ? configuredPaths : defaultPaths)
  .map(httpGetResource)

async function waitForValidJsonResources(paths, timeout = 240000) {
  const jsonPaths = paths.filter(pathname => new URL(pathname, baseUrl).pathname.endsWith('.json'))
  const deadline = Date.now() + timeout
  let lastError

  while (Date.now() < deadline) {
    try {
      for (const pathname of jsonPaths) {
        const target = new URL(pathname, baseUrl)
        const response = await fetch(target, { signal: AbortSignal.timeout(5000) })
        if (!response.ok) throw new Error(`${target} returned HTTP ${response.status}`)
        const body = await response.text()
        JSON.parse(body)
      }
      return
    } catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }

  throw new Error(`Timed out waiting for valid JSON prerequisites: ${jsonPaths.join(', ')}`, {
    cause: lastError,
  })
}

async function main() {
  try {
    await waitOn({
      resources,
      delay: 1000,
      interval: 1000,
      timeout: 240000,
      tcpTimeout: 1000,
      window: 1000,
      validateStatus: status => status >= 200 && status < 300,
    })
    // Vite's history fallback can return index.html with status 200 while the
    // relay behind `/data` is still starting. Do not launch Cypress until the
    // game-data prerequisites are parseable JSON, or the first visit will
    // fail with "Unexpected token '<'" and retry against the wrong response.
    await waitForValidJsonResources(configuredPaths?.length ? configuredPaths : defaultPaths)
  } catch (error) {
    console.error('Timed out waiting for Cypress prerequisites:', resources)
    console.error(error)
    process.exit(1)
  }

  const runnerPath = path.join(__dirname, 'run-cypress.cjs')
  const child = spawn(process.execPath, [runnerPath, ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    windowsHide: false,
  })

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? 1)
  })

  child.on('error', (error) => {
    console.error(`Failed to launch Cypress via ${runnerPath}:`, error)
    process.exit(1)
  })
}

main()
