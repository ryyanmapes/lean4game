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

function migrate(file) {
  const source = fs.readFileSync(file, 'utf8')
  if (/^\s*module\s*(?:\/\/.*)?$/m.test(source)) return false

  const hadFinalNewline = source.endsWith('\n')
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  if (hadFinalNewline) lines.pop()

  let lastImport = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*public\s+(?:meta\s+)?import\s+/.test(lines[i])) {
      lastImport = i
    } else if (/^(\s*)(meta\s+)?import\s+/.test(lines[i])) {
      lines[i] = lines[i].replace(/^(\s*)((?:meta\s+)?)import\s+/, '$1public $2import ')
      lastImport = i
    }
  }

  if (lastImport < 0) {
    lastImport = lines.findIndex(line => /^\s*prelude\s*$/.test(line))
  }

  lines.splice(lastImport + 1, 0, '', 'public section', '')
  const migrated = `module\n\n${lines.join('\n')}${hadFinalNewline ? '\n' : ''}`
  fs.writeFileSync(file, migrated)
  return true
}

const inputs = process.argv.slice(2)
if (inputs.length === 0) {
  console.error('Usage: enable-browser-module-system.mjs <file-or-directory>...')
  process.exit(2)
}

let changed = 0
for (const input of inputs) {
  for (const file of leanFiles(input)) {
    if (migrate(file)) changed++
  }
}

console.log(`Enabled the Lean module system in ${changed} legacy source files.`)
