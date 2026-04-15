#!/usr/bin/env node
// Windows-specific start script. Bypasses node_modules/.bin shims entirely
// (which require bash + Unix utilities on PATH - unreliable on Windows).
// Spawns server / relay / client concurrently with labeled output.
const { spawn } = require('child_process')
const path = require('path')

// Step 1: free port 8080 (equivalent of prestart).
require('./ensure-port-8080-free.cjs')

// Resolve node_modules/.bin paths - on Windows we want the .cmd shims
// invoked via cmd.exe, which DO work (they don't depend on Unix utils).
const binDir = path.join(__dirname, '..', 'node_modules', '.bin')
const viteBin = path.join(binDir, 'vite.cmd')
const nodemonBin = path.join(binDir, 'nodemon.cmd')
const tscBin = path.join(binDir, 'tsc.cmd')

const COLORS = {
  server: '\x1b[34m', // blue
  relay: '\x1b[33m', // yellow
  client: '\x1b[32m', // green
  reset: '\x1b[0m',
}

function prefixLines(label, data) {
  const color = COLORS[label] || ''
  const lines = data.toString().split(/\r?\n/)
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  for (const line of lines) {
    process.stdout.write(`${color}[${label}]${COLORS.reset} ${line}\n`)
  }
}

function run(label, cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true, // uses cmd.exe on Windows
    ...opts,
  })
  child.stdout.on('data', (d) => prefixLines(label, d))
  child.stderr.on('data', (d) => prefixLines(label, d))
  child.on('exit', (code) => {
    process.stdout.write(`${COLORS[label] || ''}[${label}]${COLORS.reset} exited with code ${code}\n`)
  })
  return child
}

// server: lake -R build (from ./server)
run('server', 'lake', ['-R', 'build'], {
  cwd: path.join(__dirname, '..', 'server'),
})

// relay: tsc -b ./relay, then nodemon watching ./relay/dist/src/index.js
// We do this inline to avoid depending on the start-relay.cjs shim chain.
const relay = spawn(`"${tscBin}"`, ['-b', './relay'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: true,
})
relay.stdout.on('data', (d) => prefixLines('relay', d))
relay.stderr.on('data', (d) => prefixLines('relay', d))
relay.on('exit', (code) => {
  if (code !== 0) {
    prefixLines('relay', `tsc failed (code ${code}), skipping nodemon.\n`)
    return
  }
  run('relay', `"${nodemonBin}"`, ['-e', 'mjs', '--exec', '"node ./dist/src/index.js"'], {
    cwd: path.join(__dirname, '..', 'relay'),
    env: { ...process.env, NODE_ENV: 'development' },
  })
})

// client: bind to Cypress' expected port and fail fast if it is unavailable.
run('client', `"${viteBin}"`, ['--host', '--port', '3000', '--strictPort'], {
  env: { ...process.env, NODE_ENV: 'development' },
})

// Clean shutdown on Ctrl+C.
process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
