import Lean

namespace GameServer

open Lean Meta

/-- Shared classification for direct goal clicks in the visual proof UI. -/
inductive ClickGoalKind where
  | completeByRfl
  | introVar
  | introProp
  | splitAnd

private def isComparisonPropForVar (fvar : Expr) (prop : Expr) : MetaM Bool := do
  let fvar := fvar.consumeMData
  let prop ← instantiateMVars prop
  let prop ← withReducible (whnf prop)
  let fn := prop.getAppFn
  let args := prop.getAppArgs
  if args.size < 2 then
    return false
  let some fnName := fn.constName? | return false
  if fnName != ``LT.lt && fnName != ``LE.le then
    return false
  let lhs? := args[args.size - 2]?
  let rhs? := args[args.size - 1]?
  match lhs?, rhs? with
  | some lhs, some rhs =>
      pure (lhs.consumeMData == fvar || rhs.consumeMData == fvar)
  | _, _ =>
      pure false

/-- Detect a leading non-propositional binder immediately followed by a comparison
hypothesis involving the freshly introduced variable, such as `∀ a > 0, ...`
or `∀ a ≤ b, ...`. Returns suggested base names for the variable and generated
hypothesis. -/
def boundedComparisonIntroInfo? (target : Expr) : MetaM (Option (Name × Name)) := do
  let targetWhnf ← withReducible (whnf target)
  match targetWhnf with
  | .forallE binderName domain body binderInfo =>
      if (← isProp domain) || binderName.isAnonymous then
        pure none
      else
        withLocalDecl binderName binderInfo domain fun fvar => do
          let body ← withReducible (whnf (body.instantiate1 fvar))
          match body with
          | .forallE _ propDomain _ _ =>
              if !(← isProp propDomain) || !(← isComparisonPropForVar fvar propDomain) then
                pure none
              else
                pure <| some (binderName, Name.mkSimple s!"h{binderName.toString}")
          | _ =>
              pure none
  | _ =>
      pure none

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
literal reflexive equalities, forall binders, and proposition implications,
including reducible surface forms like `¬ P` and `a ≠ b`. -/
def clickGoalKind? (target : Expr) : MetaM (Option ClickGoalKind) := do
  match target.consumeMData with
  | .app (.app (.app (.const ``Eq _) _) lhs) rhs =>
      if lhs.consumeMData == rhs.consumeMData then
        pure <| some .completeByRfl
      else
        pure none
  | _ =>
      let targetWhnf ← withReducible (whnf target)
      match targetWhnf with
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
