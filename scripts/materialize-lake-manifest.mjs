#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const manifestPath = process.argv[2] ?? 'lake-manifest.json'
const root = path.dirname(path.resolve(manifestPath))
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const packagesDir = path.resolve(root, manifest.packagesDir ?? '.lake/packages')

fs.mkdirSync(packagesDir, { recursive: true })

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit' })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

for (const pkg of manifest.packages ?? []) {
  if (pkg.type === 'path') {
    const target = path.resolve(root, pkg.dir)
    if (!fs.existsSync(target)) {
      console.error(`Missing path dependency for ${pkg.name}: ${target}`)
      process.exit(1)
    }
    continue
  }
  if (pkg.type !== 'git') {
    console.error(`Unsupported Lake package type for ${pkg.name}: ${pkg.type}`)
    process.exit(1)
  }

  const target = path.join(packagesDir, pkg.name)
  if (!fs.existsSync(target)) {
    run('git', ['clone', '--no-checkout', pkg.url, target], root)
  }

  run('git', ['fetch', '--tags', '--force', 'origin', pkg.rev], target)
  run('git', ['checkout', '--force', pkg.rev], target)
  run('git', ['clean', '-fdx'], target)
}
