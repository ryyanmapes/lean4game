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

edit('Game/Tactic/LabelAttr.lean', () =>
  'public import Lean.Meta.Tactic.Simp.Attr\n\n' +
  'open Lean Meta\n\n' +
  '/-- Simp set used by the Natural Numbers Game evaluator. -/\n' +
  'builtin_initialize myNatDecideSimpExtension : SimpExtension ←\n' +
  '  registerSimpAttr `MyNat_decide "Natural Numbers Game evaluation theorem"\n')

edit('Game/MyNat/Definition.lean', source => source
  .replace(/^import Game\.Tactic\.LabelAttr.*\r?\n/m, '')
  .replace(/^@\[MyNat_decide\]\r?\n/gm, ''))
edit('Game/MyNat/Addition.lean', source => source
  .replace('@[simp, MyNat_decide]', '@[simp]')
  .replace(/^@\[MyNat_decide\]\r?\n/gm, ''))
for (const file of ['Game/MyNat/Multiplication.lean', 'Game/MyNat/Power.lean']) {
  edit(file, source => source.replace(/^@\[MyNat_decide\]\r?\n/gm, ''))
}
edit('Game/Tactic/Decide.lean', () => `import Game.MyNat.Power

theorem ofNat_succ : (OfNat.ofNat (Nat.succ n) : MyNat) =
    MyNat.succ (OfNat.ofNat n) := _root_.rfl

macro "decide" : tactic => \`(tactic|(
  try simp only [MyNat.ofNat, MyNat.toNat, MyNat.zero_eq_0, ofNat_succ,
    MyNat.add_zero, MyNat.add_succ, MyNat.mul_zero, MyNat.mul_succ,
    MyNat.pow_zero, MyNat.pow_succ]
  try decide
))
`)

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

const browserTacticImports = `meta import Lean.Elab.Tactic.Induction
meta import Game.Tactic.FromMathlib
meta import Game.Tactic.Induction
meta import Game.Tactic.Cases
meta import Game.Tactic.Rfl
meta import Game.Tactic.Rw
meta import Game.Tactic.Use
meta import Game.Tactic.Xyzzy
meta import Game.Tactic.SimpAdd
meta import Game.Tactic.BrowserTauto
meta import Game.Tactic.BrowserNthRewrite`

for (const file of fs.readdirSync(path.join(root, 'Game'), { recursive: true })) {
  if (typeof file !== 'string' || !file.endsWith('.lean')) continue
  const relativePath = path.join('Game', file)
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8')
  if (/^import Game\.Metadata\r?$/m.test(source)) {
    edit(relativePath, source => source.replace(
      /^import Game\.Metadata\r?$/m,
      `meta import Game.Metadata
${browserTacticImports}`,
    ))
  }
}

// Meta elaborators do not propagate through the ordinary import chain from one
// level to the next in Lean 4.33. Give every authored level a direct edge to
// the same compact tactic surface. This does not enlarge the import closure:
// the modules were already dependencies of Game.Metadata.
for (const file of fs.readdirSync(path.join(root, 'Game', 'Levels'), { recursive: true })) {
  if (typeof file !== 'string' || !file.endsWith('.lean')) continue
  const relativePath = path.join('Game', 'Levels', file)
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8')
  if (!/^\s*Statement\b/m.test(source) || source.includes(browserTacticImports)) continue
  edit(relativePath, source => `${browserTacticImports}\n${source}`)
}

// Cauli's executable module boundary retains the parser for the imported NNG
// induction macro but not its macro expander. Retarget only the temporary
// browser-build copy of authored proof lines to Lean's equivalent core syntax.
// Branch headers without bodies deliberately leave both goals for the bullets
// already present in the original level source.
let rewrittenInductionFiles = 0
for (const file of fs.readdirSync(path.join(root, 'Game', 'Levels'), { recursive: true })) {
  if (typeof file !== 'string' || !file.endsWith('.lean')) continue
  const relativePath = path.join('Game', 'Levels', file)
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8')
  if (!/^\s*Statement\b/m.test(source)) continue
  const generalizing = /^([ \t]+)induction[ \t]+([A-Za-z_][A-Za-z0-9_']*)[ \t]+with[ \t]+([A-Za-z_][A-Za-z0-9_']*|_)[ \t]+([A-Za-z_][A-Za-z0-9_']*|_)[ \t]+generalizing[ \t]+([A-Za-z_][A-Za-z0-9_' ]*)[ \t]*$/gm
  const ordinary = /^([ \t]+)induction[ \t]+([A-Za-z_][A-Za-z0-9_']*)[ \t]+with[ \t]+([A-Za-z_][A-Za-z0-9_']*|_)[ \t]+([A-Za-z_][A-Za-z0-9_']*|_)[ \t]*$/gm
  const migrated = source
    .replace(generalizing, (_line, indent, target, n, ih, xs) =>
      `${indent}induction ${target} using MyNat.rec' generalizing ${xs.trim()} with\n` +
      `${indent}| zero\n${indent}| succ ${n} ${ih}`)
    .replace(ordinary, (_line, indent, target, n, ih) =>
      `${indent}induction ${target} using MyNat.rec' with\n` +
      `${indent}| zero\n${indent}| succ ${n} ${ih}`)
  if (migrated === source) continue
  edit(relativePath, () => migrated)
  rewrittenInductionFiles++
}
if (rewrittenInductionFiles === 0) {
  throw new Error('No authored NNG induction proof lines were retargeted')
}
console.log(`Retargeted induction proofs in ${rewrittenInductionFiles} NNG level files.`)

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
    .replace(/^def ofNat/m, '@[expose]\ndef ofNat')
    .replace(/^def toNat/m, '@[expose]\ndef toNat')
    .replace(
      'theorem zero_eq_0 : MyNat.zero = 0 := rfl',
      'theorem zero_eq_0 : MyNat.zero = 0 := by change MyNat.zero = MyNat.zero; rfl',
    )
  if (!exposed.includes('@[expose]\ndef ofNat') ||
      !exposed.includes('@[expose]\ndef toNat')) {
    throw new Error('Failed to expose the NNG numeral conversion definitions')
  }
  return exposed
})

edit('Game/Tactic/Rfl.lean', () => `public meta import Lean.Elab.Tactic.ElabTerm

namespace MyNat

open Lean.Parser.Tactic

/-!
Browser-safe form of NNG's deliberately weakened \`rfl\`. It accepts only
equality and iff reflexivity and elaborates under reducible transparency, just
like the original handler, but needs no separately initialized tactic closure.
-/
macro "rfl" : tactic =>
  \`(tactic| with_reducible first | exact Eq.refl _ | exact Iff.rfl)

end MyNat
`)
edit('Game/Tactic/Rw.lean', () => `public meta import Lean.Elab.Tactic.Rewrite

namespace MyNat

open Lean.Parser.Tactic

/-! Browser-safe spelling of the NNG rewrite tactic. The authored tactic is
deliberately identical to Lean's core \`rewrite\`; a macro preserves that exact
behavior without a separately initialized tactic handler. -/
macro "rw" rules:rwRuleSeq loc:(location)? : tactic =>
  \`(tactic| rewrite $rules:rwRuleSeq $[$loc:location]?)

end MyNat
`)

// NNG uses `use` only to provide witnesses for existential goals. Preserve
// its player-facing comma-separated syntax with Lean's core `refine`, avoiding
// Mathlib.Tactic.Use and its large initializer closure.
edit('Game/Tactic/Use.lean', () => `public meta import Lean.Elab.Tactic.Basic

open Lean Parser Tactic

syntax (name := MyNat.useSyntax) "use " term,+ : tactic

macro_rules
  | \`(tactic| use $args:term,*) => \`(tactic| refine ⟨$args,*, ?_⟩)
`)

// The magic tactic is a tiny axiom-backed macro; importing the `Lean`
// umbrella for it retained the entire language server in every NNG worker.
edit('Game/Tactic/Xyzzy.lean', () => `public meta import Lean.Elab.Tactic.Basic

universe u

@[never_extract]
axiom xyzzyAxiom (α : Sort u) (synthetic := false) : α

macro "xyzzy" : tactic => \`(tactic| exact @xyzzyAxiom _ false)
`)
replace(
  'Game/Tactic/Ne.lean',
  '@[delab app.Not] def delab_not_mem',
  '@[delab app.Not] meta def delab_not_mem',
)

// These tactics used to copy private Lean elaborator internals. Keep the exact
// commands taught by the game, but delegate to mathlib's maintained public
// compatibility tactics instead.
edit('Game/Tactic/Induction.lean', () => `public import Game.MyNat.Definition
public meta import Lean.Elab.Tactic.Induction

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
macro "induction " target:Parser.Tactic.elimTarget " with " n:(colGt ident) ih:(colGt ident) : tactic =>
  \`(tactic| induction $target using MyNat.rec' with
    | zero
    | succ $n $ih)

macro "induction " target:Parser.Tactic.elimTarget " with " "_" "_" : tactic =>
  \`(tactic| induction $target using MyNat.rec' with
    | zero
    | succ _ _)

macro "induction " target:Parser.Tactic.elimTarget " with " n:(colGt ident) ih:(colGt ident)
    " generalizing " generalized:(colGt ident)+ : tactic =>
  \`(tactic| induction $target using MyNat.rec' generalizing $generalized* with
    | zero
    | succ $n $ih)
`)

add('Game/Tactic/BrowserCasesCore.lean', `module

prelude
public meta import Lean.Elab.Tactic.Induction
public meta import Batteries.Data.List.Basic
public meta import Batteries.Lean.Expr
import all Lean.Elab.Tactic.Induction

public meta section

namespace Game.Browser.Cases

open Lean Meta Elab Elab.Tactic

private def getAltNumFields (elimInfo : ElimInfo) (altName : Name) : TermElabM Nat := do
  for altInfo in elimInfo.altsInfo do
    if altInfo.name == altName then
      return altInfo.numFields
  throwError "unknown alternative name '{altName}'"

private def evalNames (elimInfo : ElimInfo) (alts : Array ElimApp.Alt) (withArg : Syntax)
    (numEqs := 0) (toClear : Array FVarId := #[])
    (toTag : Array (Ident × FVarId) := #[]) : TermElabM (Array MVarId) := do
  let mut names : List Syntax := withArg[1].getArgs |>.toList
  let mut subgoals := #[]
  for { name := altName, mvarId := g, .. } in alts do
    let numFields ← getAltNumFields elimInfo altName
    let (altVarNames, names') := names.splitAtD numFields (Unhygienic.run \`(_))
    names := names'
    let (fvars, g) ← g.introN numFields <| altVarNames.map (getNameOfIdent' ·[0])
    let some (g, subst) ← Cases.unifyEqs? numEqs g {} | pure ()
    let g ← liftM <| toClear.foldlM (·.tryClear) g
    g.withContext do
      for (stx, fvar) in toTag do
        Term.addLocalVarInfo stx (subst.get fvar)
      for fvar in fvars, stx in altVarNames do
        (subst.get fvar).addLocalVarInfoForBinderIdent ⟨stx⟩
    subgoals := subgoals.push g
  pure subgoals

/-- Browser-safe Lean-3-style cases syntax without Mathlib's runtime initializer. -/
elab "nng_cases' " tgts:(Parser.Tactic.elimTarget,+)
    usingArg:((" using " ident)?)
    withArg:((" with" (ppSpace colGt binderIdent)+)?) : tactic => do
  let (targets, toTag) ← elabElimTargets tgts.1.getSepArgs
  let g :: gs ← getUnsolvedGoals | throwNoGoalsToBeSolved
  g.withContext do
    let elimInfo ← getElimNameInfo usingArg targets (induction := false)
    let targets ← addImplicitTargets elimInfo targets
    let result ← withRef tgts <| ElimApp.mkElimApp elimInfo targets (← g.getTag)
    let elimArgs := result.elimApp.getAppArgs
    let targets ← elimInfo.targetsPos.mapM (instantiateMVars elimArgs[·]!)
    let motive := elimArgs[elimInfo.motivePos]!
    let g ← generalizeTargetsEq g (← inferType motive) targets
    let (targetsNew, g) ← g.introN targets.size
    g.withContext do
      ElimApp.setMotiveArg g motive.mvarId! targetsNew
      g.assign result.elimApp
      let subgoals ← evalNames elimInfo result.alts withArg
        (numEqs := targets.size) (toClear := targetsNew) (toTag := toTag)
      setGoals <| subgoals.toList ++ gs

end Game.Browser.Cases
`)

edit('Game/Tactic/Cases.lean', () => `public import Game.MyNat.Definition
public meta import Game.Tactic.BrowserCasesCore

namespace MyNat

/-- Case principle which prints the base case as an NNG numeral. -/
@[expose] def casesOn' {P : ℕ → Sort u} : (t : ℕ) → P 0 →
    ((a : ℕ) → P (MyNat.succ a)) → P t
  | .zero, base, _ => base
  | .succ n, _, step => step n

end MyNat

/- Implementation moved to BrowserCasesCore so private Lean imports do not
conflict with this module's public MyNat surface.

public meta section

namespace Game.Browser.Cases

open Lean Meta Elab Elab.Tactic

private def getAltNumFields (elimInfo : ElimInfo) (altName : Name) : TermElabM Nat := do
  for altInfo in elimInfo.altsInfo do
    if altInfo.name == altName then
      return altInfo.numFields
  throwError "unknown alternative name '{altName}'"

private def evalNames (elimInfo : ElimInfo) (alts : Array ElimApp.Alt) (withArg : Syntax)
    (numEqs := 0) (toClear : Array FVarId := #[])
    (toTag : Array (Ident × FVarId) := #[]) : TermElabM (Array MVarId) := do
  let mut names : List Syntax := withArg[1].getArgs |>.toList
  let mut subgoals := #[]
  for { name := altName, mvarId := g, .. } in alts do
    let numFields ← getAltNumFields elimInfo altName
    let (altVarNames, names') := names.splitAtD numFields (Unhygienic.run \`(_))
    names := names'
    let (fvars, g) ← g.introN numFields <| altVarNames.map (getNameOfIdent' ·[0])
    let some (g, subst) ← Cases.unifyEqs? numEqs g {} | pure ()
    let g ← liftM <| toClear.foldlM (·.tryClear) g
    g.withContext do
      for (stx, fvar) in toTag do
        Term.addLocalVarInfo stx (subst.get fvar)
      for fvar in fvars, stx in altVarNames do
        (subst.get fvar).addLocalVarInfoForBinderIdent ⟨stx⟩
    subgoals := subgoals.push g
  pure subgoals

/-- Browser-safe Lean-3-style cases syntax without Mathlib's runtime initializer. -/
elab "nng_cases' " tgts:(Parser.Tactic.elimTarget,+)
    usingArg:((" using " ident)?)
    withArg:((" with" (ppSpace colGt binderIdent)+)?) : tactic => do
  let (targets, toTag) ← elabElimTargets tgts.1.getSepArgs
  let g :: gs ← getUnsolvedGoals | throwNoGoalsToBeSolved
  g.withContext do
    let elimInfo ← getElimNameInfo usingArg targets (induction := false)
    let targets ← addImplicitTargets elimInfo targets
    let result ← withRef tgts <| ElimApp.mkElimApp elimInfo targets (← g.getTag)
    let elimArgs := result.elimApp.getAppArgs
    let targets ← elimInfo.targetsPos.mapM (instantiateMVars elimArgs[·]!)
    let motive := elimArgs[elimInfo.motivePos]!
    let g ← generalizeTargetsEq g (← inferType motive) targets
    let (targetsNew, g) ← g.introN targets.size
    g.withContext do
      ElimApp.setMotiveArg g motive.mvarId! targetsNew
      g.assign result.elimApp
      let subgoals ← evalNames elimInfo result.alts withArg
        (numEqs := targets.size) (toClear := targetsNew) (toTag := toTag)
      setGoals <| subgoals.toList ++ gs

end Game.Browser.Cases
-/

open Lean Parser Tactic

/-- Lean-3-style cases syntax used throughout the Natural Number Game.
Every binder is colGt-bounded: without it, \`cases b with d\` followed by a
tactic line like \`intro h\` lets longest-match parsing feed \`intro\` to the
two-binder overload as the second binder name (seen in AdvAddition L05). -/
macro "cases " target:Parser.Tactic.elimTarget : tactic =>
  \`(tactic| nng_cases' $target)

macro "cases " target:Parser.Tactic.elimTarget " with"
    name:(colGt binderIdent) : tactic =>
  \`(tactic| nng_cases' $target with $name <;> try rw [MyNat.zero_eq_0] at *)

macro "cases " target:Parser.Tactic.elimTarget " with"
    first:(colGt binderIdent) second:(colGt binderIdent) : tactic =>
  \`(tactic| nng_cases' $target with $first $second)
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
