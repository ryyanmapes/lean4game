import Lean.Meta.Basic
import Lean.Meta.InferType
import Lean.Meta.SynthInstance

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

  -- The proposition itself may be a definition such as `Not`. The binder
  -- search below uses `forallMetaTelescopeReducing`, so build the application
  -- at the same transparency level; otherwise a matched `h : a = b` can leave
  -- `notProof : a ≠ b` unapplied.
  let currentType ← whnf currentType
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

/-- Match theorem premises against a displayed hypothesis.

    Prefer the surface-shape matcher because it gives stable assignments for the
    theorem's still-implicit data binders. When the printed shapes differ, fall
    back to Lean's definitional equality: applying `A → B` to an `A` is ordinary
    function application even when one occurrence is printed as `1` and the other
    as `succ 0` (or `x + 1` and `succ x`). -/
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

private def unfoldVisibleNot (type : Expr) : MetaM Expr := do
  let type ← instantiateMVars type
  -- Full transparency is needed specifically at the proposition head:
  -- `Not` is printed as notation but is opaque to reducible WHNF in current
  -- Lean releases. WHNF does not descend into equality/arithmetic operands,
  -- so it cannot silently simplify the expressions the player sees.
  withTransparency .all (whnf type.consumeMData)

private def isVisibleNegation (type : Expr) : Bool :=
  match type.consumeMData with
  | .forallE _ _ body _ => body.consumeMData == .const ``False []
  | _ => false

private def visiblePropPremiseMatches (domain argType : Expr) : MetaM Bool := do
  let checkpoint ← getMCtx
  try
    -- `forallMetaTelescopeReducing` can expose the theorem premise's head
    -- definition (notably `Not`) while the local hypothesis retains the
    -- surface constant. Normalize both heads at the same transparency before
    -- doing the structural visibility check. This still does not simplify
    -- arguments such as arithmetic expressions, so hidden rewrites remain
    -- unavailable until the player performs them.
    let domain ← unfoldVisibleNot domain
    let argType ← unfoldVisibleNot argType
    -- `x ≠ y` and its fully displayed `x = y → False` form are the same
    -- visible proposition even though the generated arrow's binder metadata
    -- is not guaranteed to match source-written arrow metadata.
    if isVisibleNegation domain && isVisibleNegation argType then
      let compatible ← isDefEq domain argType
      if compatible then return true
      setMCtx checkpoint
      return false
    if ← visibleExprMatches domain argType then
      if ← isDefEq domain argType then return true
    setMCtx checkpoint
    -- Surface matching intentionally does not unfold arithmetic or numeral
    -- notation. Such unfolding is nevertheless part of Lean's type equality,
    -- so it must not prevent a proposition from being used as a premise.
    return ← isDefEq domain argType
  catch _ =>
    setMCtx checkpoint
    return false

/-- Return the domain of the named binder in `fnType`, after accounting for dependencies
    on earlier binders. -/
def binderDomainByName? (fnType : Expr) (binderName : Name) : MetaM (Option Expr) := do
  return (← findBinderIndexAndDomain? fnType binderName).map Prod.snd

/-- Lean's pretty-printer disambiguates a binder that collides with a local name by
    displaying (for example) `b` as `b_1`. The binder stored in the expression is still
    named `b`, so accept that display-only suffix after first trying the exact name. -/
private def unsuffixedPrettyBinderName? (binderName : Name) : Option Name := do
  let parts := binderName.toString.splitOn "_"
  let suffix :: baseRev := parts.reverse | none
  if baseRev.isEmpty || suffix.isEmpty || suffix.toNat?.isNone then none
  else some (Name.mkSimple (String.intercalate "_" baseRev.reverse))

/-- Resolve an exact binder name or its pretty-printer collision alias, returning the
    actual expression binder name together with its domain. -/
def resolveBinderName? (fnType : Expr) (binderName : Name) : MetaM (Option (Name × Expr)) := do
  if let some domain ← binderDomainByName? fnType binderName then
    return some (binderName, domain)
  let some fallbackName := unsuffixedPrettyBinderName? binderName | return none
  return (← binderDomainByName? fnType fallbackName).map fun domain => (fallbackName, domain)

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

/-- Locate the proposition binder consumed by a displayed premise.  The index counts
    every binder exposed by `@theorem`, including implicit data and instance binders,
    so callers can build an explicit application with inference holes before the
    supplied proof. -/
def premiseBinderIndex? (fnType argType : Expr) : MetaM (Option Nat) := do
  let savedMCtx ← getMCtx
  try
    let (args, _, _) ← forallMetaTelescopeReducing fnType
    for i in [:args.size] do
      let checkpoint ← getMCtx
      let dom ← instantiateMVars (← inferType args[i]!)
      if ← visiblePropPremiseMatches dom argType then
        setMCtx savedMCtx
        return some i
      setMCtx checkpoint
    setMCtx savedMCtx
    return none
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
      -- `isProp` can return false for a negation whose data parameter is
      -- still a metavariable, even though the binder is visibly a
      -- proposition (`?x ≠ 0`). The structural matcher already rejects data
      -- binders such as `Nat`, so let it classify every binder directly.
      if ← visiblePropPremiseMatches dom argType then
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
