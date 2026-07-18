#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const [fullExportsPath, externExportsPath, outputPath, entryModule, ...remainingArgs] = process.argv.slice(2)
const nativeSeparator = remainingArgs.indexOf('--native-c')
const sourceRoots = nativeSeparator === -1 ? remainingArgs : remainingArgs.slice(0, nativeSeparator)
const nativeSources = nativeSeparator === -1 ? [] : remainingArgs.slice(nativeSeparator + 1)
if (!fullExportsPath || !externExportsPath || !outputPath || !entryModule || sourceRoots.length === 0) {
  console.error('Usage: gen-visual-wasm-exports.mjs <full-exports> <extern-exports> <output> <entry-module> <source-root>... [--native-c <generated.c>...]')
  process.exit(2)
}

function stripLeanComments(source) {
  let result = ''
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]
    const next = source[i + 1]
    if (depth > 0) {
      if (ch === '/' && next === '-') {
        depth += 1
        result += '  '
        i += 1
      } else if (ch === '-' && next === '/') {
        depth -= 1
        result += '  '
        i += 1
      } else {
        result += ch === '\n' || ch === '\r' ? ch : ' '
      }
      continue
    }
    if (!inString && ch === '/' && next === '-') {
      depth = 1
      result += '  '
      i += 1
      continue
    }
    if (!inString && ch === '-' && next === '-') {
      while (i < source.length && source[i] !== '\n') {
        result += ' '
        i += 1
      }
      if (i < source.length) result += source[i]
      continue
    }
    if (inString) {
      result += ch === '\n' || ch === '\r' ? ch : ' '
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      result += ' '
      continue
    }
    result += ch
  }
  return result
}

function importsOf(source) {
  const imports = []
  for (const line of stripLeanComments(source).split(/\r?\n/u)) {
    const match = line.trim().match(/^(?:public\s+)?(?:meta\s+)?import\s+(?:all\s+)?(\S+)/u)
    if (match) imports.push(match[1])
  }
  return imports
}

const sourceByModule = new Map()
function visit(root, dir = root) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) visit(root, full)
    else if (entry.isFile() && entry.name.endsWith('.lean')) {
      const relative = path.relative(root, full).replaceAll('\\', '/')
      sourceByModule.set(relative.replace(/\.lean$/u, '').replaceAll('/', '.'), full)
    }
  }
}
for (const root of sourceRoots) visit(path.resolve(root))

const closure = new Set()
const stack = [entryModule, 'Init']
while (stack.length > 0) {
  const moduleName = stack.pop()
  if (closure.has(moduleName)) continue
  closure.add(moduleName)
  const sourcePath = sourceByModule.get(moduleName)
  if (!sourcePath) {
    console.error(`Missing Lean source for imported module ${moduleName}`)
    process.exit(1)
  }
  for (const imported of importsOf(fs.readFileSync(sourcePath, 'utf8'))) stack.push(imported)
}

const initializer = moduleName => `_initialize_${moduleName.replaceAll('.', '_')}`
// Lake prefixes native symbols with the package name.  The package and root
// namespace are both `GameServer`, so its generated C initializers contain the
// prefix twice (for example initialize_GameServer_GameServer_Tactic_Visual).
const linkedInitializer = moduleName => moduleName.startsWith('GameServer.')
  ? `_initialize_GameServer_${moduleName.replaceAll('.', '_')}`
  : initializer(moduleName)
const retainedInitializers = new Set([...closure].map(initializer))
const fullExports = fs.readFileSync(fullExportsPath, 'utf8').split(/\r?\n/u).filter(Boolean)
const requiredExterns = new Set(fs.readFileSync(externExportsPath, 'utf8').split(/\r?\n/u).filter(Boolean))
const nativeInitializers = new Set()
for (const sourcePath of nativeSources) {
  const source = fs.readFileSync(sourcePath, 'utf8')
  for (const match of source.matchAll(/\b(initialize_[A-Za-z0-9_]+)\s*\(/gmu)) {
    nativeInitializers.add(`_${match[1]}`)
  }
}
const exports = fullExports.filter(symbol =>
  symbol.startsWith('_initialize_')
    ? retainedInitializers.has(symbol)
    : !symbol.startsWith('_l_') || requiredExterns.has(symbol))

for (const moduleName of closure) {
  const symbol = initializer(moduleName)
  const nativeInitializer = [...nativeInitializers].find(candidate =>
    candidate.endsWith(`_${moduleName.replaceAll('.', '_')}`))
  if (!fullExports.includes(symbol) && !moduleName.startsWith('GameServer.') && !nativeInitializer) {
    console.error(`Full export list has no initializer for ${moduleName} (${symbol})`)
    process.exit(1)
  }
  if (nativeInitializer && !exports.includes(nativeInitializer)) exports.push(nativeInitializer)
}

// The purpose-built native GameServer objects are linked alongside Lean's archives.
// `Visual.c` already contains the generated bodies of its imported Lean
// modules (including Tactic.Click), so linking those objects separately would
// define every imported symbol twice.
for (const moduleName of [
  'GameServer.GoalClick',
  'GameServer.PremiseApplication',
  'GameServer.Browser.ProofProbe',
  entryModule,
]) {
  const symbol = linkedInitializer(moduleName)
  if (!exports.includes(symbol)) exports.push(symbol)
}

// Lake package functions use an `lp_<package>_...` prefix and are absent from
// Lean's standard-library export manifest. Export every LEAN_EXPORT function
// in the purpose-linked GameServer objects so the IR interpreter can resolve
// their native bodies through dlsym.
for (const sourcePath of nativeSources) {
  const source = fs.readFileSync(sourcePath, 'utf8')
  for (const match of source.matchAll(/^LEAN_EXPORT[^\n(]*\s([A-Za-z_][A-Za-z0-9_]*)\s*\(/gmu)) {
    const symbol = `_${match[1]}`
    if (!exports.includes(symbol)) exports.push(symbol)
  }
}

fs.writeFileSync(outputPath, `${exports.join('\n')}\n`)
console.log(`Visual runtime closure: ${closure.size} modules; ${exports.length} WebAssembly exports`)
