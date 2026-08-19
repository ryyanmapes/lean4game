import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..', '..')
const levelsRoot = path.join(repoRoot, 'NNG4', 'Game', 'Levels')
const outputPath = path.join(repoRoot, 'lean4game', 'cypress', 'fixtures', 'nng4-visual-solutions.json')
const shippedWorlds = new Set([
  'Tutorial',
  'Addition',
  'Multiplication',
  'Power',
  'Implication',
  'AdvAddition',
  'LessOrEqual',
  'AdvMultiplication',
])

const tacticStart = /^(?:induction|cases|intro|repeat\s+(?:rw|apply)|rw|rfl|exact|apply|nth_rewrite|symm|tauto|exfalso|use|have|left|right|contrapose!?|decide|simp(?:_add)?|trivial|revert|positivity|xyzzy)\b/u

function indentation(line) {
  return line.length - line.trimStart().length
}

function stripBullet(line) {
  return line.trim().replace(/^·\s*/u, '')
}

function stripLineComment(line) {
  const index = line.indexOf('--')
  return (index === -1 ? line : line.slice(0, index)).trim()
}

function hasUnclosedString(line) {
  let quoteCount = 0
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"' && line[index - 1] !== '\\') quoteCount += 1
  }
  return quoteCount % 2 === 1
}

function extractMainSolution(source, sourcePath) {
  const lines = source.split(/\r?\n/u)
  const statementStart = lines.findIndex(line => /\bStatement\b/u.test(line))
  const statementIndex = statementStart === -1
    ? -1
    : lines.findIndex((line, index) => index >= statementStart && /:=\s*by\s*$/u.test(line))
  if (statementIndex === -1) {
    throw new Error(`No Statement ... := by block in ${sourcePath}`)
  }

  const commands = []
  let skippedBranchIndent = null
  let skippingHintString = false

  for (let index = statementIndex + 1; index < lines.length; index += 1) {
    const rawLine = lines[index]
    if (rawLine.trim() && indentation(rawLine) === 0) break

    const indent = indentation(rawLine)
    const line = stripBullet(rawLine)
    if (!line || line.startsWith('--')) continue

    if (skippingHintString) {
      if (hasUnclosedString(line)) skippingHintString = false
      continue
    }

    if (skippedBranchIndent !== null) {
      if (indent > skippedBranchIndent) continue
      skippedBranchIndent = null
    }

    if (line === 'Branch') {
      skippedBranchIndent = indent
      continue
    }
    if (/^Hint\b/u.test(line)) {
      skippingHintString = hasUnclosedString(line)
      continue
    }

    const command = stripLineComment(line)
    if (tacticStart.test(command)) commands.push(command)
  }

  if (commands.length === 0) {
    throw new Error(`No main-solution tactics extracted from ${sourcePath}`)
  }
  if (commands.some(command => command === 'sorry' || command.includes('?'))) {
    throw new Error(`Incomplete tactic extracted from ${sourcePath}: ${commands.join(' | ')}`)
  }
  return commands
}

function extractInitialBinderNames(source, sourcePath) {
  const statement = /\bStatement\b[\s\S]*?:=\s*by\b/u.exec(source)?.[0]
  if (!statement) throw new Error(`No Statement declaration in ${sourcePath}`)
  const names = []
  for (const match of statement.matchAll(/\(([\p{L}_][\p{L}\p{N}_'\s]*)\s*:/gu)) {
    names.push(...match[1].trim().split(/\s+/u))
  }
  return names
}

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const children = await Promise.all(entries.map(entry => {
    const child = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(child) : [child]
  }))
  return children.flat()
}

async function buildSolutions() {
  const files = (await walk(levelsRoot))
    .filter(file => /[\\/]L\d[^\\/]*\.lean$/u.test(file))
    .filter(file => shippedWorlds.has(path.relative(levelsRoot, file).split(path.sep)[0]))
    .sort()

  const solutions = []
  for (const file of files) {
    const source = await fs.readFile(file, 'utf8')
    const world = /\bWorld\s+"([^"]+)"/u.exec(source)?.[1]
    const level = Number(/\bLevel\s+(\d+)/u.exec(source)?.[1])
    const title = /\bTitle\s+"([^"]+)"/u.exec(source)?.[1]
    if (!world || !Number.isInteger(level) || !title) continue
    if (!shippedWorlds.has(world)) continue

    solutions.push({
      world,
      level,
      title,
      visualSkip: /^\s*VisualSkipLevel\s*$/mu.test(source),
      completionNeutral: /^\s*CompletionNeutral\s*$/mu.test(source),
      source: path.relative(repoRoot, file).replaceAll(path.sep, '/'),
      initialBinderNames: extractInitialBinderNames(source, file),
      commands: extractMainSolution(source, file),
    })
  }

  solutions.sort((left, right) =>
    left.world.localeCompare(right.world) || left.level - right.level
  )
  return solutions
}

const solutions = await buildSolutions()
const serialized = `${JSON.stringify({ generatedFrom: 'NNG4/Game/Levels', solutions }, null, 2)}\n`

if (process.argv.includes('--write')) {
  await fs.writeFile(outputPath, serialized)
  console.log(`Wrote ${solutions.length} NNG4 reference solutions to ${outputPath}`)
} else {
  const current = await fs.readFile(outputPath, 'utf8').catch(() => '')
  if (current !== serialized) {
    console.error(`Reference solution fixture is stale. Run:\n  node ${path.relative(process.cwd(), fileURLToPath(import.meta.url))} --write`)
    process.exitCode = 1
  } else {
    console.log(`Verified ${solutions.length} NNG4 reference solutions`)
  }
}
