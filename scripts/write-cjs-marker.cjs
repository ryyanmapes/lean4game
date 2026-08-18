#!/usr/bin/env node
// The unit-test builds land in tmp-* directories inside this package, whose
// package.json declares "type": "module". Node would therefore load a
// --module commonjs build as ESM and fail on `exports`/`require`. Scope those
// directories back to CommonJS so the builds load regardless of checkout state.
// Usage: node scripts/write-cjs-marker.cjs <dir>
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const dir = process.argv[2]
if (!dir) {
  console.error('usage: node scripts/write-cjs-marker.cjs <dir>')
  process.exit(1)
}
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, 'package.json'), '{\n  "type": "commonjs"\n}\n')
