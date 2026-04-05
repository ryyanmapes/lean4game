import Lean

namespace GameServer

open Lean Meta

/-- Shared classification for direct goal clicks in the visual proof UI. -/
inductive ClickGoalKind where
  | completeByRfl
  | introVar
  | introProp
  | splitAnd

private def hasLeadingPropBinderReducing (target : Expr) : MetaM Bool := do
  let savedMCtx ← getMCtx
  try
    let (args, _, _) ← forallMetaTelescopeReducing target
    let result ←
      match args[0]? with
      | some arg =>
          let argType ← instantiateMVars (← inferType arg)
          isProp argType
      | none =>
          pure false
    setMCtx savedMCtx
    pure result
  catch ex =>
    setMCtx savedMCtx
    throw ex

/-- Recognize goals that can be handled by a direct click:
`rfl`-solvable equalities, forall binders, and proposition implications,
including reducible surface forms like `¬ P` and `a ≠ b`. -/
def clickGoalKind? (target : Expr) : MetaM (Option ClickGoalKind) := do
  let targetWhnf ← withReducible (whnf target)
  match targetWhnf with
  | .app (.app (.app (.const ``Eq _) _) lhs) rhs =>
      if ← withReducible (isDefEq lhs rhs) then
        pure <| some .completeByRfl
      else
        pure none
  | .app (.app (.const ``And _) _) _ =>
      pure <| some .splitAnd
  | .forallE _ domain _ _ =>
      if ← isProp domain then
        pure <| some .introProp
      else
        pure <| some .introVar
  | _ =>
      if ← hasLeadingPropBinderReducing target then
        pure <| some .introProp
      else
        pure none
