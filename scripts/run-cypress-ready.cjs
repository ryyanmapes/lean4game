const { spawn } = require('node:child_process')
const path = require('node:path')
const waitOn = require('wait-on')

const args = process.argv.slice(2)
const baseUrl = new URL(process.env.CYPRESS_BASE_URL || 'http://127.0.0.1:3000')

function httpGetResource(pathname) {
  const target = new URL(pathname, baseUrl)
  return `http-get://${target.host}${target.pathname}${target.search}`
}

const resources = [
  httpGetResource('/'),
  httpGetResource('/data/g/test/TestGame/game.json'),
  httpGetResource('/data/g/local/VisualTest/game.json'),
]

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
