#!/usr/bin/env node

// Prepares a throwaway copy of the Natural Numbers Video Game (NNVG) for the
// browser runtime, after its game data has been generated from the original
// sources. CI runs it on an ephemeral checkout; never run it on a working copy.
//
//   node scripts/retarget-nnvg-browser-runtime.mjs ../NNVG [--module-system]
//
// NNVG's Lake package and its modules are both called `Game`, like NNG4's. The
// browser runtime links some of NNG4's `Game.*` modules into lean.wasm, and
// Lean finds a module's native code by package and module name, so an NNVG
// module of the same name would run NNG4's code. The browser copy therefore
// becomes package `NNVG` with modules `NNVG.*`, and its module bundle can sit
// beside NNG4's in one worker without any file in common.
//
// Without `--module-system` the result still builds with stock Lean 4.28
// against the unconverted GameServer, which checks the rename, the browser
// command stubs and the rewritten proofs locally.

import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const moduleSystem = args.includes('--module-system')
const root = path.resolve(args.find(arg => !arg.startsWith('--')) ?? '../NNVG')

function leanFiles(input) {
  const files = []
  for (const entry of fs.readdirSync(input, { withFileTypes: true })) {
    const child = path.join(input, entry.name)
    if (entry.isDirectory()) files.push(...leanFiles(child))
    else if (entry.isFile() && entry.name.endsWith('.lean')) files.push(child)
  }
  return files
}

const gameRoot = path.join(root, 'Game.lean')
const oldTree = path.join(root, 'Game')
const newTree = path.join(root, 'NNVG')
if (!fs.existsSync(gameRoot) || !fs.existsSync(oldTree) || fs.existsSync(newTree)) {
  throw new Error(`Expected an unretargeted NNVG checkout at ${root}`)
}

// The world files Game.lean imports are exactly the playable game.
const worlds = [...fs.readFileSync(gameRoot, 'utf8').matchAll(/^import Game\.(Levels\.[A-Za-z0-9_.]+)\s*$/gmu)]
  .map(match => `NNVG.${match[1]}`)
if (worlds.length === 0) throw new Error('Game.lean imports no worlds')

// Game.lean only holds the game's map and settings, which reach the browser as
// JSON; its `Dependency` command has no browser counterpart.
fs.rmSync(gameRoot)
fs.renameSync(oldTree, newTree)

const lakefile = path.join(root, 'lakefile.toml')
const lakeBefore = fs.readFileSync(lakefile, 'utf8')
const lakeAfter = lakeBefore
  .replace(/^name = "Game"$/mu, 'name = "NNVG"')
  .replace(/^defaultTargets = \["Game"\]$/mu, 'defaultTargets = ["NNVG"]')
  .replace(/^(\[\[lean_lib\]\]\r?\nname = )"Game"$/mu, '$1"NNVG"')
if ((lakeAfter.match(/"NNVG"/gu) ?? []).length !== 3) {
  throw new Error('Could not rename the NNVG package and library in lakefile.toml')
}
fs.writeFileSync(lakefile, lakeAfter)

// Macros the game defines, which level proofs use. The browser compiler keeps
// an imported macro's parser but not its expander across a module boundary
// (as NNG4's induction macro showed), so the build-only copy of each proof
// gets the exact core syntax the macro expands to. Players' own `induction` and
// `cases` commands still go through the macros, imported by the runtime facade.
const tacticModules = ['NNVG.MyNat.Induction', 'NNVG.Tactic.BrowserCasesCore', 'NNVG.Tactic.Cases', 'NNVG.Tactic.Xyzzy']

// Lean's own `cases` elaborator needs private induction-elaborator bodies that
// the browser compiler leaves out: in lean.wasm a `cases` corrupts the heap
// (NNG4 hit the same and has its own `nng_cases'`). So the browser's `cases`,
// a player's and Visual Lean's own, is this one, built on Lean's public
// `MVarId.cases` and linked into lean.wasm (build-browser-lean-libs.yml). It
// imports only Lean, as a natively linked module must. The zero case reads `0`,
// like the game's `cases_eliminator` makes it natively.
const browserCasesCore = `import Lean.Elab.Tactic.Basic
import Lean.Meta.Tactic.Cases
import Lean.Meta.Tactic.Rename

open Lean Meta Elab Tactic

/-- Lean-3-style \`cases\` from Lean's public cases primitive, for the browser. -/
elab "nnvg_cases' " target:ident
    withArg:((" with" (ppSpace colGt binderIdent)+)?) : tactic => do
  let g :: gs ← getUnsolvedGoals | throwNoGoalsToBeSolved
  g.withContext do
    let some localDecl := (← getLCtx).findFromUserName? target.getId
      | throwErrorAt target "unknown local variable '{target.getId}'"
    let results ← g.cases localDecl.fvarId
    let mut names : List Syntax := withArg.raw[1]!.getArgs |>.toList
    let mut subgoals := #[]
    for result in results do
      let mut goal := result.mvarId
      for field in result.fields do
        if let nameStx :: rest := names then
          names := rest
          goal ← goal.rename field.fvarId! (getNameOfIdent' nameStx[0])
      subgoals := subgoals.push goal
    setGoals <| subgoals.toList ++ gs
`
const browserCasesMacros = `/-- \`zero_eq_0\` turns the zero case of a browser \`cases\` into \`0\`. -/
theorem MyNat.zero_eq_0 : MyNat.zero = 0 := rfl

open Lean Parser Tactic

/-- \`cases n with d\` splits the goal into the case \`n = 0\` and the case \`n = S d\`. -/
macro "cases " target:ident : tactic => \`(tactic| nnvg_cases' $target)

macro "cases " target:ident " with" name:(colGt binderIdent) : tactic =>
  \`(tactic| nnvg_cases' $target with $name <;> try rewrite [MyNat.zero_eq_0] at *)

macro "cases " target:ident " with" first:(colGt binderIdent) second:(colGt binderIdent) : tactic =>
  \`(tactic| nnvg_cases' $target with $first $second)
`
const ident = String.raw`[A-Za-z_][A-Za-z0-9_'!?₀-₉]*`
const inductionLine = new RegExp(String.raw`^([ \t]+)induction[ \t]+(${ident})[ \t]+with[ \t]+(${ident})[ \t]+(${ident})[ \t]*$`, 'gmu')
const casesLine = new RegExp(String.raw`^([ \t]+)cases[ \t]+(${ident})[ \t]+with[ \t]+(${ident})[ \t]*$`, 'gmu')
const xyzzyLine = /^([ \t]+)xyzzy[ \t]*$/gmu

const casesCorePath = path.join(newTree, 'Tactic', 'BrowserCasesCore.lean')
if (fs.existsSync(casesCorePath)) throw new Error('NNVG already has a Tactic/BrowserCasesCore.lean')
fs.writeFileSync(casesCorePath, browserCasesCore)

let rewrittenProofLines = 0
let retargeted = 0
for (const file of leanFiles(newTree)) {
  const relative = path.relative(root, file).replaceAll('\\', '/')
  const before = fs.readFileSync(file, 'utf8')
  let after = before
    .replace(/^(import[ \t]+)Game\./gmu, '$1NNVG.')
    .replace(/^(import[ \t]+)GameServer[ \t]*$/gmu, '$1GameServer.Browser')
    .replace(/^(import[ \t]+)GameServer\.Commands[ \t]*$/gmu, '$1GameServer.Browser.Commands')
  if (relative === 'NNVG/Tactic/Xyzzy.lean') {
    // The `Lean` umbrella would put the whole language server in every worker.
    after = after.replace(/^import Lean[ \t]*$/mu, 'import Lean.Elab.Tactic.Basic')
  }
  if (relative === 'NNVG/Tactic/Cases.lean') {
    // The game's `cases n with d` macro gives way to the browser's three forms.
    const macro = after.indexOf('macro (name := MyNat.casesWith)')
    const doc = after.lastIndexOf('/--', macro)
    if (macro < 0 || doc < 0 || !/^import NNVG\.MyNat\.Definition$/mu.test(after)) {
      throw new Error('NNVG/Tactic/Cases.lean no longer has the expected import and cases macro')
    }
    after = after.slice(0, doc)
      .replace(/^import NNVG\.MyNat\.Definition$/mu, '$&\nimport NNVG.Tactic.BrowserCasesCore') +
      browserCasesMacros
  }
  const level = relative.startsWith('NNVG/Levels/') && /^\s*Statement\b/mu.test(after)
  if (level) {
    after = after
      .replace(inductionLine, (_line, indent, target, d, hd) => {
        rewrittenProofLines++
        return `${indent}induction ${target} with\n${indent}| zero => ?_\n${indent}| S ${d} ${hd} => ?_`
      })
      .replace(casesLine, (_line, indent, target, d) => {
        rewrittenProofLines++
        return `${indent}cases ${target} with\n${indent}| zero => ?_\n${indent}| S ${d} => ?_`
      })
      .replace(xyzzyLine, (_line, indent) => {
        rewrittenProofLines++
        // The macro's `@xyzzyAxiom _ false`, but `synthetic` is left to its
        // default: the browser command stubs make `false` a keyword.
        return `${indent}exact xyzzyAxiom _`
      })
  }
  if (moduleSystem) after = toModule(after, level, relative)
  if (after !== before) {
    fs.writeFileSync(file, after)
    retargeted++
  }
}

if (rewrittenProofLines === 0) throw new Error('No NNVG induction or cases proof lines were rewritten')

// One stable import header for every NNVG level in the browser: the worlds give
// every theorem a level proves, the meta imports the tactics a player uses.
const runtimeImports = [
  ...worlds.map(world => `public import ${world}`),
  'public meta import GameServer.Browser.Commands',
  'public meta import Lean.Elab.Tactic.Induction',
  ...tacticModules.map(module => `public meta import ${module}`),
]
const runtime = moduleSystem
  ? `module\n\n${runtimeImports.join('\n')}\n`
  : `${runtimeImports.map(line => line.replace(/^public (?:meta )?import /u, 'import ')).join('\n')}\n`
fs.mkdirSync(path.join(newTree, 'Browser'), { recursive: true })
fs.writeFileSync(path.join(newTree, 'Browser', 'Runtime.lean'), runtime)
fs.writeFileSync(
  path.join(root, 'NNVG.lean'),
  moduleSystem ? 'module\n\npublic import NNVG.Browser.Runtime\n' : 'import NNVG.Browser.Runtime\n',
)

console.log(`Retargeted ${retargeted} NNVG modules (${rewrittenProofLines} proof lines) to package NNVG` +
  `${moduleSystem ? ' in the module system' : ''}; runtime facade imports ${worlds.length} worlds.`)

// Lean's module system, as the browser compiler needs for IR. Every definition
// stays exposed, as without modules: levels unfold numerals and `≤` defined in
// other files. Levels also import the command stubs and tactics at the meta
// level, which elaborating their commands and proofs needs.
function toModule(source, level, relative) {
  if (/^module\b/mu.test(source.split(/\r?\n/u).slice(0, 20).join('\n'))) return source
  const tacticModule = tacticModules.includes(relative.replace(/\.lean$/u, '').replaceAll('/', '.'))
  const lines = source.replace(/\r\n/gu, '\n').split('\n')
  let lastImport = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^import[ \t]+/u.test(lines[i])) {
      // A tactic module's Lean imports serve its macro, so they are meta.
      const lean = /^import[ \t]+Lean\./u.test(lines[i])
      lines[i] = lines[i].replace(/^import[ \t]+/u, tacticModule && lean ? 'public meta import ' : 'public import ')
      lastImport = i
    }
  }
  const metaImports = level
    ? ['meta import GameServer.Browser.Commands', 'meta import Lean.Elab.Tactic.Induction',
       ...tacticModules.map(module => `meta import ${module}`)]
    : tacticModule ? ['public meta import Lean.Elab.Tactic.Induction'] : []
  lines.splice(lastImport + 1, 0, ...metaImports, '', '@[expose] public section', '')
  return `module\n\n${lines.join('\n')}`
}
