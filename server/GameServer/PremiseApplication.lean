import Lean

namespace GameServer

open Lean Meta

/--
Apply a proposition premise to a theorem/hypothesis while preserving any theorem binders
that were not determined by unification with the premise.

For example, applying `h : a ≠ 0` to
`mul_left_cancel : ∀ (a b c : Nat), a ≠ 0 → a * b = a * c → b = c`
produces a proof of
`∀ (b c : Nat), a * b = a * c → b = c`
instead of leaving `?b` and `?c` metavariables behind.
-/
private partial def buildPremiseApplicationFromAssignments
    (fnExpr currentType : Expr)
    (assignedArgs : Array Expr)
    (selectedIdx idx : Nat)
    (argExpr : Expr) : MetaM Expr := do
  if idx >= assignedArgs.size then
    return fnExpr

  let currentType ← withReducible (whnf currentType)
  match currentType with
  | .forallE binderName domain body binderInfo =>
      if idx == selectedIdx then
        buildPremiseApplicationFromAssignments
          (mkApp fnExpr argExpr)
          (body.instantiate1 argExpr)
          assignedArgs
          selectedIdx
          (idx + 1)
          argExpr
      else
        let assigned ← instantiateMVars assignedArgs[idx]!
        if assigned.hasMVar then
          withLocalDecl binderName binderInfo domain fun localExpr => do
            let bodyExpr ← buildPremiseApplicationFromAssignments
              (mkApp fnExpr localExpr)
              (body.instantiate1 localExpr)
              assignedArgs
              selectedIdx
              (idx + 1)
              argExpr
            mkLambdaFVars #[localExpr] bodyExpr
        else
          buildPremiseApplicationFromAssignments
            (mkApp fnExpr assigned)
            (body.instantiate1 assigned)
            assignedArgs
            selectedIdx
            (idx + 1)
            argExpr
  | _ =>
      return fnExpr

/-- Build the partially applied proof term for a theorem/hypothesis application in combining mode. -/
def mkPremiseApplication? (fnExpr fnType argExpr argType : Expr) : MetaM (Option Expr) := do
  let savedMCtx ← getMCtx
  try
    let (args, _, _) ← forallMetaTelescopeReducing fnType
    for i in [:args.size] do
      let checkpoint ← getMCtx
      let dom ← instantiateMVars (← inferType args[i]!)
      if (← isProp dom) && (← isDefEq dom argType) then
        let proof ← buildPremiseApplicationFromAssignments fnExpr fnType args i 0 argExpr
        let proof ← instantiateMVars proof
        if !proof.hasMVar then
          setMCtx savedMCtx
          return some proof
      setMCtx checkpoint
    setMCtx savedMCtx
    return none
  catch _ =>
    setMCtx savedMCtx
    return none

end GameServer
