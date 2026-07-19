#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.argv[2] ?? '../NNG4')

// `Game.Metadata` is the server application's catalogue: it pulls in level
// documentation and the native GameServer command stack.  Browser levels get
// that catalogue from gamedata JSON, so retaining it in their import closure
// both wastes memory and initializes code that is not linked into the compact
// WASM runtime.  This facade preserves the declarations and player-facing
// tactics needed to typecheck an authored proof, without that server payload.
const browserMetadata = `module

public import Game.MyNat.Definition
public meta import GameServer.Browser.Commands
public meta import Lean.Elab.Tactic.Induction
`

const browserMetadataPath = path.join(root, 'Game', 'Browser', 'Metadata.lean')
fs.mkdirSync(path.dirname(browserMetadataPath), { recursive: true })
fs.writeFileSync(browserMetadataPath, browserMetadata)

// Keep one stable import header for the lifetime of the browser worker.  The
// eight world aggregators expose every declaration used by the playable NNG
// (Algorithm World is intentionally omitted), while the direct meta imports
// retain the original player-facing tactic implementations.  Baking this
// module into the snapshot lets arbitrary level navigation reuse one Lean
// environment instead of dynamically importing a different level each time.
const browserRuntime = `module

public import Game.Levels.Tutorial
public import Game.Levels.Addition
public import Game.Levels.Multiplication
public import Game.Levels.Power
public import Game.Levels.Implication
public import Game.Levels.AdvAddition
public import Game.Levels.LessOrEqual
public import Game.Levels.AdvMultiplication
public meta import GameServer.Browser.Commands
public meta import Lean.Elab.Tactic.Induction
public meta import Game.Tactic.FromMathlib
public meta import Game.Tactic.Induction
public meta import Game.Tactic.Cases
public meta import Game.Tactic.Rfl
public meta import Game.Tactic.Rw
public meta import Game.Tactic.Use
public meta import Game.Tactic.Xyzzy
public meta import Game.Tactic.SimpAdd
public meta import Game.Tactic.BrowserTauto
public meta import Game.Tactic.BrowserNthRewrite
`

const browserRuntimePath = path.join(root, 'Game', 'Browser', 'Runtime.lean')
fs.writeFileSync(browserRuntimePath, browserRuntime)

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
  if (relative.startsWith('Game/Levels/')) {
    after = after.replace(
      /^([ \t]*(?:public[ \t]+)?(?:meta[ \t]+)?import[ \t]+)Game\.Metadata[ \t]*$/gmu,
      '$1Game.Browser.Metadata',
    )
  }
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
