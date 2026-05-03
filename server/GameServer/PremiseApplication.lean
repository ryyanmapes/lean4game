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
private partial def buildApplicationFromAssignments
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
        buildApplicationFromAssignments
          (mkApp fnExpr argExpr)
          (body.instantiate1 argExpr)
          assignedArgs
          selectedIdx
          (idx + 1)
          argExpr
      else
        let assigned ← instantiateMVars assignedArgs[idx]!
        if assigned.hasMVar then
          let domain ← instantiateMVars domain
          if binderInfo == .instImplicit then
            if let some inst ← synthInstance? domain then
              buildApplicationFromAssignments
                (mkApp fnExpr inst)
                (body.instantiate1 inst)
                assignedArgs
                selectedIdx
                (idx + 1)
                argExpr
            else
              withLocalDecl binderName binderInfo domain fun localExpr => do
                let bodyExpr ← buildApplicationFromAssignments
                  (mkApp fnExpr localExpr)
                  (body.instantiate1 localExpr)
                  assignedArgs
                  selectedIdx
                  (idx + 1)
                  argExpr
                mkLambdaFVars #[localExpr] bodyExpr
          else
            withLocalDecl binderName binderInfo domain fun localExpr => do
              let bodyExpr ← buildApplicationFromAssignments
                (mkApp fnExpr localExpr)
                (body.instantiate1 localExpr)
                assignedArgs
                selectedIdx
                (idx + 1)
                argExpr
              mkLambdaFVars #[localExpr] bodyExpr
        else
          buildApplicationFromAssignments
            (mkApp fnExpr assigned)
            (body.instantiate1 assigned)
            assignedArgs
            selectedIdx
            (idx + 1)
            argExpr
  | _ =>
      return fnExpr

private partial def findBinderIndexAndDomain?
    (fnType : Expr) (targetBinder : Name) (idx : Nat := 0) :
    MetaM (Option (Nat × Expr)) := do
  let fnType ← withReducible (whnf fnType)
  match fnType with
  | .forallE binderName domain body binderInfo =>
      if binderName == targetBinder then
        pure (some (idx, domain))
      else
        withLocalDecl binderName binderInfo domain fun localExpr =>
          findBinderIndexAndDomain? (body.instantiate1 localExpr) targetBinder (idx + 1)
  | _ =>
      pure none

private def mkBinderApplicationFromAssignedArgs?
    (fnExpr fnType : Expr) (assignedArgs : Array Expr) (selectedIdx : Nat) (argExpr : Expr) :
    MetaM (Option Expr) := do
  if selectedIdx >= assignedArgs.size then
    return none
  let proof ← buildApplicationFromAssignments fnExpr fnType assignedArgs selectedIdx 0 argExpr
  let proof ← instantiateMVars proof
  if proof.hasMVar then
    return none
  return some proof

private def mkBinderApplicationAtIndex?
    (fnExpr fnType : Expr) (selectedIdx : Nat) (argExpr : Expr) :
    MetaM (Option Expr) := do
  let (args, _, _) ← forallMetaTelescopeReducing fnType
  mkBinderApplicationFromAssignedArgs? fnExpr fnType args selectedIdx argExpr

/-- Match theorem premises against the displayed hypothesis shape before allowing
    definitional equality to finish the type check. This keeps Visual Lean from
    applying a theorem through hidden reductions the player has not made yet. -/
private partial def visibleExprMatches (pattern actual : Expr) : MetaM Bool := do
  let pattern ← instantiateMVars pattern
  let actual ← instantiateMVars actual
  let pattern := pattern.consumeMData
  let actual := actual.consumeMData
  match pattern with
  | .mvar mvarId =>
      if let some assigned ← getExprMVarAssignment? mvarId then
        visibleExprMatches assigned actual
      else
        mvarId.assign actual
        pure true
  | .app patternFn patternArg =>
      match actual with
      | .app actualFn actualArg =>
          if !(← visibleExprMatches patternFn actualFn) then
            pure false
          else
            visibleExprMatches patternArg actualArg
      | _ => pure false
  | .forallE binderName patternDomain patternBody binderInfo =>
      match actual with
      | .forallE _ actualDomain actualBody actualBinderInfo =>
          if binderInfo != actualBinderInfo then
            pure false
          else if !(← visibleExprMatches patternDomain actualDomain) then
            pure false
          else
            let actualDomain ← instantiateMVars actualDomain
            withLocalDecl binderName binderInfo actualDomain fun localExpr =>
              visibleExprMatches (patternBody.instantiate1 localExpr) (actualBody.instantiate1 localExpr)
      | _ => pure false
  | .lam binderName patternDomain patternBody binderInfo =>
      match actual with
      | .lam _ actualDomain actualBody actualBinderInfo =>
          if binderInfo != actualBinderInfo then
            pure false
          else if !(← visibleExprMatches patternDomain actualDomain) then
            pure false
          else
            let actualDomain ← instantiateMVars actualDomain
            withLocalDecl binderName binderInfo actualDomain fun localExpr =>
              visibleExprMatches (patternBody.instantiate1 localExpr) (actualBody.instantiate1 localExpr)
      | _ => pure false
  | .letE binderName patternType patternValue patternBody nondep =>
      match actual with
      | .letE _ actualType actualValue actualBody actualNondep =>
          if nondep != actualNondep then
            pure false
          else if !(← visibleExprMatches patternType actualType) then
            pure false
          else if !(← visibleExprMatches patternValue actualValue) then
            pure false
          else
            let actualType ← instantiateMVars actualType
            let actualValue ← instantiateMVars actualValue
            withLetDecl binderName actualType actualValue fun localExpr =>
              visibleExprMatches (patternBody.instantiate1 localExpr) (actualBody.instantiate1 localExpr)
      | _ => pure false
  | .proj patternTypeName patternIdx patternStruct =>
      match actual with
      | .proj actualTypeName actualIdx actualStruct =>
          pure (patternTypeName == actualTypeName && patternIdx == actualIdx) <&&>
            visibleExprMatches patternStruct actualStruct
      | _ => pure false
  | .const patternName _ =>
      match actual with
      | .const actualName _ => pure (patternName == actualName)
      | _ => pure false
  | .fvar patternId =>
      match actual with
      | .fvar actualId => pure (patternId == actualId)
      | _ => pure false
  | .bvar patternIdx =>
      match actual with
      | .bvar actualIdx => pure (patternIdx == actualIdx)
      | _ => pure false
  | .sort _ =>
      match actual with
      | .sort _ => pure true
      | _ => pure false
  | .lit patternLit =>
      match actual with
      | .lit actualLit => pure (patternLit == actualLit)
      | _ => pure false
  | .mdata _ patternExpr =>
      visibleExprMatches patternExpr actual

private def visiblePropPremiseMatches (domain argType : Expr) : MetaM Bool := do
  let checkpoint ← getMCtx
  try
    if !(← visibleExprMatches domain argType) then
      setMCtx checkpoint
      return false
    if !(← isDefEq domain argType) then
      setMCtx checkpoint
      return false
    return true
  catch _ =>
    setMCtx checkpoint
    return false

/-- Return the domain of the named binder in `fnType`, after accounting for dependencies
    on earlier binders. -/
def binderDomainByName? (fnType : Expr) (binderName : Name) : MetaM (Option Expr) := do
  return (← findBinderIndexAndDomain? fnType binderName).map Prod.snd

/-- Apply a theorem/hypothesis to a named binder argument while preserving any remaining
    unresolved binders as explicit/implicit lambdas in the resulting term. -/
def mkNamedBinderApplication?
    (fnExpr fnType : Expr) (binderName : Name) (argExpr argType : Expr) :
    MetaM (Option Expr) := do
  let savedMCtx ← getMCtx
  try
    let some (selectedIdx, binderDomain) ← findBinderIndexAndDomain? fnType binderName
      | setMCtx savedMCtx
        return none
    if !(← isDefEq binderDomain argType) then
      setMCtx savedMCtx
      return none
    let some proof ← mkBinderApplicationAtIndex? fnExpr fnType selectedIdx argExpr
      | setMCtx savedMCtx
        return none
    setMCtx savedMCtx
    return some proof
  catch _ =>
    setMCtx savedMCtx
    return none

/-- Build the partially applied proof term for a theorem/hypothesis application in combining mode. -/
def mkPremiseApplication? (fnExpr fnType argExpr argType : Expr) : MetaM (Option Expr) := do
  let savedMCtx ← getMCtx
  try
    let (args, _, _) ← forallMetaTelescopeReducing fnType
    for i in [:args.size] do
      let checkpoint ← getMCtx
      let dom ← instantiateMVars (← inferType args[i]!)
      if (← isProp dom) && (← visiblePropPremiseMatches dom argType) then
        if let some proof ← mkBinderApplicationFromAssignedArgs? fnExpr fnType args i argExpr then
          setMCtx savedMCtx
          return some proof
      setMCtx checkpoint
    setMCtx savedMCtx
    return none
  catch _ =>
    setMCtx savedMCtx
    return none

end GameServer
