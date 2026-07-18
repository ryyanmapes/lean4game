import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(process.argv[2] ?? '../NNG4')
const scriptDir = path.dirname(fileURLToPath(import.meta.url))

function edit(relativePath, transform) {
  const file = path.join(root, relativePath)
  const before = fs.readFileSync(file, 'utf8')
  const after = transform(before)
  if (after === before) {
    throw new Error(`NNG4 compatibility migration made no change to ${relativePath}`)
  }
  fs.writeFileSync(file, after)
  console.log(`migrated ${relativePath}`)
}

function replace(relativePath, from, to) {
  edit(relativePath, source => {
    if (!source.includes(from)) {
      throw new Error(`Expected text not found in ${relativePath}: ${from}`)
    }
    return source.replace(from, to)
  })
}

function add(relativePath, source) {
  const file = path.join(root, relativePath)
  if (fs.existsSync(file)) {
    throw new Error(`Expected browser-only file to be absent: ${relativePath}`)
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, source)
  console.log(`added ${relativePath}`)
}

// Algorithm World is intentionally absent from the browser edition. It is not
// a proof prerequisite of Advanced Addition; that level's Implication import
// already supplies every declaration its proof uses. Keeping these umbrella
// imports would retain nine unused level environments in every browser worker.
edit('Game.lean', source =>
  source.replace(/^import Game\.Levels\.Algorithm\r?\n/m, ''))
edit('Game/Levels/AdvAddition/L01add_right_cancel.lean', source =>
  source.replace(/^import Game\.Levels\.Algorithm\r?\n/m, ''))

// Lean 4.33 separates executable elaborators from ordinary declarations.
// NNG's tactic modules are imported through Game.Metadata, so make that hop
// explicitly meta-public; otherwise their syntax is visible in a level while
// the associated tactic handler is absent (reported misleadingly as
// `unknown tactic`, first seen for the game's deliberately weakened `rfl`).
edit('Game/Metadata.lean', source => {
  const migrated = source.replace(
    /^import (Game\.Tactic\.[A-Za-z0-9_.]+)\r?$/gm,
    'public meta import $1',
  )
  if (!migrated.includes('public meta import Game.Tactic.Rfl') ||
      !migrated.includes('public meta import Game.Tactic.Rw')) {
    throw new Error('Failed to expose NNG tactic elaborators through Game.Metadata')
  }
  return migrated
})

for (const file of fs.readdirSync(path.join(root, 'Game'), { recursive: true })) {
  if (typeof file !== 'string' || !file.endsWith('.lean')) continue
  const relativePath = path.join('Game', file)
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8')
  if (/^import Game\.Metadata\r?$/m.test(source)) {
    edit(relativePath, source => source.replace(
      /^import Game\.Metadata\r?$/m,
      'meta import Game.Metadata',
    ))
  }
}

// lean-i18n imports Lake only to rediscover the current package/module name
// while producing translation metadata. Both browser games build their main
// library as `Game`; making that build-time fact explicit removes Lake's
// native-only manifest loader from the runtime import closure.
edit('.lake/packages/i18n/I18n/Utils.lean', source => {
  const start = source.indexOf('/-- Read the name of the current package')
  const end = source.indexOf('open System in')
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('Expected lean-i18n manifest helper block not found')
  }
  const helpers = `/-- Browser games in this build use the Lake package name \`Game\`. -/
def getProjectName : IO Name := pure \`Game

/-- The corresponding main Lean module is also \`Game\`. -/
def getCurrentModule : IO Name := pure \`Game

`
  return (source.slice(0, start) + helpers + source.slice(end))
    .replace('import Lake.Load.Manifest', 'import Lean')
})

// GameServer imports the I18n umbrella only for translated user-facing text
// and for the developer-only template command.  Its real persistent
// environment extensions are the first NNG dependency whose generated IR
// reaches an unsupported `unreachable` body in the purpose-linked WASM
// compiler.  The browser edition deliberately ships English game data, so a
// small source-compatible layer is both sufficient and keeps translations out
// of the formal proof/runtime closure.
edit('.lake/packages/i18n/I18n.lean', () => `public import Lean

open Lean

/-- Browser games retain their authored English text without collecting PO entries. -/
def _root_.String.markForTranslation [Monad m] [MonadEnv m] [MonadLog m] [AddMessageContext m]
    [MonadOptions m] (_s : String) : m Unit := pure ()

/-- Browser games retain their authored English text without a translation lookup. -/
def _root_.String.translate [Monad m] [MonadEnv m] [MonadLog m] [AddMessageContext m]
    [MonadOptions m] (s : String) : m String := pure s

/-- English-only counterpart of lean-i18n's translated string syntax. -/
syntax:max "t!" interpolatedStr(term) : term

/-- English-only counterpart of lean-i18n's translated message-data syntax. -/
syntax:max "mt!" interpolatedStr(term) : term

macro_rules
  | \`(t! $interpStr) => \`(s! $interpStr)
  | \`(mt! $interpStr) => \`(m! $interpStr)

namespace I18n

/-- Translation templates are a build-authoring concern, not a browser runtime concern. -/
def createTemplate : Lean.Elab.Command.CommandElabM Unit := pure ()

end I18n
`)

// Mathlib's `tauto` implementation brings a large independent module closure
// whose initializer is not ABI-safe in Cauli's purpose-linked WASM interpreter.
// Retain the player-facing tactic name with a compact truth-table elaborator
// that asks Lean's own simplifier to construct and check every proof branch.
add('Game/Tactic/BrowserTauto.lean', fs.readFileSync(
  path.join(scriptDir, 'browser-tauto.lean'),
  'utf8',
))
replace(
  'Game/Tactic/FromMathlib.lean',
  'import Mathlib.Tactic.Tauto',
  'import Game.Tactic.BrowserTauto',
)

// Preserve the original tactic in authored levels and player scripts. It is
// exactly Lean's core occurrence-filtered rewrite, so a tiny syntax shim is
// sufficient and avoids Mathlib.Tactic.NthRewrite's runtime closure.
add('Game/Tactic/BrowserNthRewrite.lean', fs.readFileSync(
  path.join(scriptDir, 'browser-nth-rewrite.lean'),
  'utf8',
))
replace(
  'Game/Tactic/FromMathlib.lean',
  'import Mathlib.Tactic.NthRewrite',
  'import Game.Tactic.BrowserNthRewrite',
)

// Lean 4.33's module system does not unfold ordinary definitions across a
// module boundary. Numeral reduction is intentionally part of NNG's kernel
// computation, so expose precisely these two small recursive conversions.
edit('Game/MyNat/Definition.lean', source => {
  const exposed = source
    .replace(/@\[MyNat_decide\]\r?\ndef ofNat/, '@[MyNat_decide, expose]\ndef ofNat')
    .replace(/@\[MyNat_decide\]\r?\ndef toNat/, '@[MyNat_decide, expose]\ndef toNat')
    .replace(
      'theorem zero_eq_0 : MyNat.zero = 0 := rfl',
      'theorem zero_eq_0 : MyNat.zero = 0 := by change MyNat.zero = MyNat.zero; rfl',
    )
  if (!exposed.includes('@[MyNat_decide, expose]\ndef ofNat') ||
      !exposed.includes('@[MyNat_decide, expose]\ndef toNat')) {
    throw new Error('Failed to expose the NNG numeral conversion definitions')
  }
  return exposed
})

replace(
  'Game/Tactic/Rfl.lean',
  'def Lean.MVarId.iffRefl',
  'meta def Lean.MVarId.iffRefl',
)
replace(
  'Game/Tactic/Rfl.lean',
  'import Lean.Meta.Tactic.Refl',
  'public meta import Lean.Meta.Tactic.Refl\npublic meta import Lean.Meta.Tactic.Util',
)
replace(
  'Game/Tactic/Rfl.lean',
  'import Lean.Elab.Tactic.Basic',
  'public meta import Lean.Elab.Tactic.Basic\n\nnoncomputable section',
)
replace(
  'Game/Tactic/Rfl.lean',
  '@[tactic MyNat.rfl] def evalRfl',
  '@[tactic MyNat.rfl] meta def evalRfl',
)
replace(
  'Game/Tactic/Rw.lean',
  'import Lean.Elab.Tactic.Rewrite',
  'public meta import Lean.Elab.Tactic.Rewrite',
)
replace(
  'Game/Tactic/Rw.lean',
  '@[tactic MyNat.rewriteSeq] def evalRewriteSeq',
  '@[tactic MyNat.rewriteSeq] meta def evalRewriteSeq',
)
replace(
  'Game/Tactic/Ne.lean',
  '@[delab app.Not] def delab_not_mem',
  '@[delab app.Not] meta def delab_not_mem',
)

// These tactics used to copy private Lean elaborator internals. Keep the exact
// commands taught by the game, but delegate to mathlib's maintained public
// compatibility tactics instead.
edit('Game/Tactic/Induction.lean', () => `public import Game.MyNat.Definition
public import Mathlib.Tactic.Cases

namespace MyNat

/-- Induction principle which prints the base case as an NNG numeral. -/
@[expose] def rec' {P : ℕ → Prop} (zero : P 0)
    (succ : (n : ℕ) → P n → P (MyNat.succ n)) : (t : ℕ) → P t
  | .zero => zero
  | .succ n => succ n (rec' zero succ n)

end MyNat

open Lean Parser Tactic

/-- Lean-3-style induction syntax used throughout the Natural Number Game.
Every binder is colGt-bounded so longest-match parsing cannot swallow the
next line's tactic as a binder name. -/
macro "induction " target:Parser.Tactic.elimTarget " with " n:(colGt binderIdent) ih:(colGt binderIdent) : tactic =>
  \`(tactic| induction' $target using MyNat.rec' with $n $ih)

macro "induction " target:Parser.Tactic.elimTarget " with " n:(colGt binderIdent) ih:(colGt binderIdent)
    " generalizing " generalized:(colGt ident) : tactic =>
  \`(tactic| induction' $target using MyNat.rec' with $n $ih generalizing $generalized)
`)

edit('Game/Tactic/Cases.lean', () => `public import Game.MyNat.Definition
public import Mathlib.Tactic.Cases

namespace MyNat

/-- Case principle which prints the base case as an NNG numeral. -/
@[expose] def casesOn' {P : ℕ → Sort u} : (t : ℕ) → P 0 →
    ((a : ℕ) → P (MyNat.succ a)) → P t
  | .zero, base, _ => base
  | .succ n, _, step => step n

end MyNat

open Lean Parser Tactic

/-- Lean-3-style cases syntax used throughout the Natural Number Game.
Every binder is colGt-bounded: without it, \`cases b with d\` followed by a
tactic line like \`intro h\` lets longest-match parsing feed \`intro\` to the
two-binder overload as the second binder name (seen in AdvAddition L05). -/
macro "cases " target:Parser.Tactic.elimTarget : tactic =>
  \`(tactic| cases' $target)

macro "cases " target:Parser.Tactic.elimTarget " with"
    name:(colGt binderIdent) : tactic =>
  \`(tactic| cases' $target with $name <;> try rw [MyNat.zero_eq_0] at *)

macro "cases " target:Parser.Tactic.elimTarget " with"
    first:(colGt binderIdent) second:(colGt binderIdent) : tactic =>
  \`(tactic| cases' $target with $first $second)
`)

// This mathlib revision is a few commits newer than the exact Cauli pre-release
// compiler. Avoid an elaboration inference regression in one elementary proof;
// the replacement has the same theorem and kernel proof content.
edit('.lake/packages/mathlib/Mathlib/Logic/Basic.lean', source => {
  const pattern = /(theorem rec_heq_of_heq[\s\S]*?\(e : a = b\)[^\n]*?) :=\n  eqRec_heq_iff\.mpr h/
  if (!pattern.test(source)) {
    throw new Error('Expected rec_heq_of_heq proof not found in pinned mathlib')
  }
  return source.replace(pattern, '$1 := by\n  cases e\n  exact h')
})

edit('Game/MyNat/PeanoAxioms.lean', source => {
  const exposed = source
    .replace(/\bdef pred\b/, '@[expose] def pred')
    .replace(/\bdef is_zero\b/, '@[expose] def is_zero')
  if (!exposed.includes('@[expose] def pred') ||
      !exposed.includes('@[expose] def is_zero')) {
    throw new Error('Failed to expose the NNG Peano helper definitions')
  }
  return exposed
})

edit('Game/MyNat/LE.lean', source => {
  const exposed = source
    .replace(/\bdef le\b/, '@[expose] def le')
    .replace('instance : LE MyNat', '@[expose] instance : LE MyNat')
  if (!exposed.includes('@[expose] def le') ||
      !exposed.includes('@[expose] instance : LE MyNat')) {
    throw new Error('Failed to expose the NNG less-than-or-equal definition')
  }
  return exposed
})
