#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.argv[2] ?? '../NNG4')

function leanFiles(input) {
  const files = []
  for (const entry of fs.readdirSync(input, { withFileTypes: true })) {
    const child = path.join(input, entry.name)
    if (entry.isDirectory()) files.push(...leanFiles(child))
    else if (entry.isFile() && entry.name.endsWith('.lean')) files.push(child)
  }
  return files
}

let changed = 0
for (const file of [path.join(root, 'Game.lean'), ...leanFiles(path.join(root, 'Game'))]) {
  const before = fs.readFileSync(file, 'utf8')
  let after = before
    .replace(
      /^([ \t]*(?:public[ \t]+)?(?:meta[ \t]+)?import[ \t]+)GameServer\.Commands[ \t]*$/gmu,
      '$1GameServer.Browser.Commands',
    )
    .replace(
      /^([ \t]*(?:public[ \t]+)?(?:meta[ \t]+)?import[ \t]+)GameServer[ \t]*$/gmu,
      '$1GameServer.Browser',
    )
  const relative = path.relative(root, file).replaceAll('\\', '/')
  if (relative.startsWith('Game/Levels/') && /^\s*Statement\b/m.test(after) &&
      !/^meta import GameServer\.Browser\.Commands$/m.test(after)) {
    if (!/^module\r?$/m.test(after)) {
      throw new Error(`Expected module header before browser retarget: ${relative}`)
    }
    after = after.replace(
      /^module\r?\n/,
      matched => `${matched}\nmeta import GameServer.Browser.Commands\nmeta import Lean.Elab.Tactic.Induction\n`,
    )
  }
  if (after !== before) {
    fs.writeFileSync(file, after)
    changed++
    console.log(`retargeted ${path.relative(root, file)}`)
  }
}

if (changed === 0) {
  throw new Error('No NNG4 GameServer runtime imports were retargeted')
}
console.log(`Retargeted ${changed} NNG4 modules to the browser command surface.`)
