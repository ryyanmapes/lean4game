#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

function leanFiles(input) {
  const stat = fs.statSync(input)
  if (stat.isFile()) return input.endsWith('.lean') ? [input] : []

  const files = []
  for (const entry of fs.readdirSync(input, { withFileTypes: true })) {
    const child = path.join(input, entry.name)
    if (entry.isDirectory()) files.push(...leanFiles(child))
    else if (entry.isFile() && entry.name.endsWith('.lean')) files.push(child)
  }
  return files
}

function migrate(file, meta) {
  const source = fs.readFileSync(file, 'utf8')
  // Modern module headers may carry compiler/shake directives in a trailing
  // comment (and the exact directive grammar evolves with Lean). Recognize
  // the command token itself instead of trying to validate the whole line;
  // otherwise we can accidentally prepend a second `module` command.
  if (/^\s*module(?=\s|\/\/|$)/m.test(source)) return false

  const hadFinalNewline = source.endsWith('\n')
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  if (hadFinalNewline) lines.pop()

  let lastImport = -1
  for (let i = 0; i < lines.length; i++) {
    if (meta && /^(\s*)public\s+import\s+/.test(lines[i])) {
      lines[i] = lines[i].replace(/^(\s*)public\s+import\s+/, '$1public meta import ')
      lastImport = i
    } else if (/^\s*public\s+(?:meta\s+)?import\s+/.test(lines[i])) {
      lastImport = i
    } else if (/^(\s*)(meta\s+)?import\s+/.test(lines[i])) {
      const modifier = meta ? 'public meta import ' : 'public import '
      lines[i] = lines[i].replace(/^(\s*)(?:meta\s+)?import\s+/, `$1${modifier}`)
      lastImport = i
    }
  }

  if (lastImport < 0) {
    lastImport = lines.findIndex(line => /^\s*prelude\s*$/.test(line))
  }

  lines.splice(lastImport + 1, 0, '', meta ? 'public meta section' : 'public section', '')
  const migrated = `module\n\n${lines.join('\n')}${hadFinalNewline ? '\n' : ''}`
  fs.writeFileSync(file, migrated)
  return true
}

const args = process.argv.slice(2)
const meta = args[0] === '--meta'
const inputs = meta ? args.slice(1) : args
if (inputs.length === 0) {
  console.error('Usage: enable-browser-module-system.mjs [--meta] <file-or-directory>...')
  process.exit(2)
}

let changed = 0
for (const input of inputs) {
  for (const file of leanFiles(input)) {
    if (migrate(file, meta)) changed++
  }
}

console.log(`Enabled the Lean ${meta ? 'meta ' : ''}module system in ${changed} legacy source files.`)
