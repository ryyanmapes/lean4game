const { spawn } = require('node:child_process')
const path = require('node:path')

const args = process.argv.slice(2)
const cypressPackageJson = require.resolve('cypress/package.json')
const cypressBin = path.join(path.dirname(cypressPackageJson), 'bin', 'cypress')
const env = { ...process.env }

// Some shells/IDEs export this globally, which makes Electron start in
// "run as node" mode and causes Cypress to exit immediately.
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(process.execPath, [cypressBin, ...args], {
  cwd: process.cwd(),
  env,
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
  const relBin = path.relative(process.cwd(), cypressBin)
  console.error(`Failed to launch Cypress via ${relBin}:`, error)
  process.exit(1)
})
