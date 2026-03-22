#!/usr/bin/env node
// Cross-platform sequential npm-script runner.
// Usage: node scripts/run-sequential.cjs script1 script2 ...
const { execSync } = require('child_process')
for (const script of process.argv.slice(2)) {
  execSync(`npm run ${script}`, { stdio: 'inherit', shell: true })
}
