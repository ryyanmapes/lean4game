import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.argv[2] ?? '../NNG4')

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

/-- Lean-3-style induction syntax used throughout the Natural Number Game. -/
macro "induction " target:Parser.Tactic.elimTarget " with " n:binderIdent ih:binderIdent : tactic =>
  \`(tactic| induction' $target using MyNat.rec' with $n $ih)

macro "induction " target:Parser.Tactic.elimTarget " with " n:binderIdent ih:binderIdent
    " generalizing " vars:ident* : tactic =>
  \`(tactic| induction' $target using MyNat.rec' with $n $ih generalizing $vars*)
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

/-- Lean-3-style cases syntax used throughout the Natural Number Game. -/
macro "cases " target:Parser.Tactic.elimTarget : tactic =>
  \`(tactic| cases' $target)

macro "cases " target:Parser.Tactic.elimTarget " with " name:binderIdent : tactic =>
  \`(tactic| cases' $target with $name)

macro "cases " target:Parser.Tactic.elimTarget " with " first:binderIdent second:binderIdent : tactic =>
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
