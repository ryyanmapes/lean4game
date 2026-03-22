#!/usr/bin/env node
// Cross-platform helper: run a command in a specific directory.
// Usage: node scripts/run-in-dir.cjs <dir> <command> [args...]
const { execSync } = require('child_process')
const [dir, ...cmd] = process.argv.slice(2)
execSync(cmd.join(' '), { cwd: dir, stdio: 'inherit', shell: true })
