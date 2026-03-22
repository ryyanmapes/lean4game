#!/usr/bin/env node
// Cross-platform relay start: compile TypeScript, then run nodemon from relay/.
const { execSync, spawn } = require('child_process')

// Step 1: compile relay TypeScript
execSync('tsc -b ./relay', { stdio: 'inherit', shell: true })

// Step 2: run nodemon from the relay directory
const env = { ...process.env, NODE_ENV: 'development' }
const child = spawn(
  'nodemon',
  ['-e', 'mjs', '--exec', 'node ./dist/src/index.js'],
  { cwd: 'relay', stdio: 'inherit', shell: true, env }
)
child.on('exit', (code) => process.exit(code ?? 0))
