import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const repoRoot = path.resolve(import.meta.dirname, '..')
const tsc = path.join(
  repoRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsc.cmd' : 'tsc',
)

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    ...options,
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run(tsc, [
  'client/src/visual/browserProof.ts',
  '--module', 'es2022',
  '--target', 'es2022',
  '--moduleResolution', 'node',
  '--outDir', 'tmp-browser-proof-tests',
  '--skipLibCheck',
  '--esModuleInterop',
], { shell: process.platform === 'win32' })

run(process.execPath, ['--test', 'client/test/browserProof.test.mjs'])
