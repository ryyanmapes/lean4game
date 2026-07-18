import Lean

/-!
Small browser-safe implementation of the propositional `tauto` tactic used by
the Natural Number Game.  It avoids Mathlib.Tactic.Tauto's large runtime
closure, which is not ABI-safe in the purpose-linked Cauli WASM interpreter.

The tactic collects the atomic propositions in the target and local context,
splits classically on each, then lets Lean's built-in simplifier construct the
kernel proof in every truth-table branch.  NNG's authored uses have only a few
atoms; the cap keeps a malformed player script from allocating an exponential
number of browser goals.
-/

open Lean Elab Tactic Meta

private meta def isLogicalConnective (e : Expr) : Option (Array Expr) :=
  if e.isAppOfArity ``And 2 || e.isAppOfArity ``Or 2 || e.isAppOfArity ``Iff 2 then
    some e.getAppArgs
  else if e.isAppOfArity ``Not 1 then
    some e.getAppArgs
  else
    none

private meta partial def collectAtoms (e : Expr) (atoms : Array Expr := #[]) : MetaM (Array Expr) := do
  let e ← whnf e
  match isLogicalConnective e with
  | some args => args.foldlM (fun atoms arg => collectAtoms arg atoms) atoms
  | none => match e with
    | .forallE _ domain body _ =>
      if (← isProp domain) && !body.hasLooseBVars then
        collectAtoms body (← collectAtoms domain atoms)
      else if atoms.any (fun atom => atom == e) then
        pure atoms
      else
        pure (atoms.push e)
    | _ =>
      if !(← isProp e) || e.isAppOfArity ``True 0 || e.isAppOfArity ``False 0 then
        pure atoms
      else if atoms.any (fun atom => atom == e) then
        pure atoms
      else
        pure (atoms.push e)

/-- Solve a small classical propositional goal by exhaustive case analysis. -/
elab "tauto" : tactic => withMainContext do
  let goal ← getMainGoal
  let mut atoms ← collectAtoms (← goal.getType)
  for localDecl in (← getLCtx) do
    if !localDecl.isImplementationDetail then
      atoms ← collectAtoms localDecl.type atoms
  if atoms.size > 12 then
    throwError "tauto: this browser-safe implementation supports at most 12 atomic propositions"
  for atom in atoms do
    let atomStx ← Lean.PrettyPrinter.delab atom
    evalTactic (← `(tactic| all_goals by_cases h : $atomStx))
  evalTactic (← `(tactic| all_goals simp_all))
