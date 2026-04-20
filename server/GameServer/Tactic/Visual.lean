import Lean.Elab.Tactic.Basic
import Lean.Elab.Tactic.Conv
import Lean.Elab.Tactic.Rewrite
import Lean.Meta.Tactic.Refl
import Lean.Meta.Tactic.Assert
import Lean.Meta.Tactic.Rename
import Lean.Parser.Extension
import GameServer.GoalClick
import GameServer.PremiseApplication

namespace GameServer

open Lean Meta Elab Tactic

private def derivedTheoremPrefix : String := "THM_"
private def hiddenDerivedTheoremPrefix : String := "__hidden_THM_"

private def isDerivedTheoremName (name : Name) : Bool :=
  name.toString.startsWith derivedTheoremPrefix

private def isHiddenDerivedTheoremName (name : Name) : Bool :=
  name.toString.startsWith hiddenDerivedTheoremPrefix

private def theoremBaseFromName (name : Name) : String :=
  match name with
  | .str _ s =>
      if s.startsWith derivedTheoremPrefix then
        (s.drop derivedTheoremPrefix.length).toString
      else if s.startsWith hiddenDerivedTheoremPrefix then
        (s.drop hiddenDerivedTheoremPrefix.length).toString
      else
        s
  | _ =>
      let raw := name.toString
      if raw.startsWith derivedTheoremPrefix then
        (raw.drop derivedTheoremPrefix.length).toString
      else if raw.startsWith hiddenDerivedTheoremPrefix then
        (raw.drop hiddenDerivedTheoremPrefix.length).toString
      else
        raw

private def tryTactic (stx : TSyntax `tactic) : TacticM Bool := do
  let savedState ← saveState
  try
    evalTactic stx
    return true
  catch _ =>
    restoreState savedState
    return false

private def tryRewrite (h : Syntax) (symm : Bool) : TacticM Bool := do
  let savedState ← saveState
  try
    rewriteTarget h symm
    return true
  catch _ =>
    restoreState savedState
    return false

private def tryRewriteAt (target : Ident) (h : Ident) (symm : Bool) : TacticM Bool := do
  let savedState ← saveState
  try
    if symm then
      evalTactic (← `(tactic| rw [← $h] at $target:ident))
    else
      evalTactic (← `(tactic| rw [$h:ident] at $target:ident))
    return true
  catch _ =>
    restoreState savedState
    return false

/-- Returns true if `type` (after whnf) is, or is universally quantified over, an `Iff`. -/
private def typeIsIff (type : Expr) : MetaM Bool := do
  let type ← whnf type
  match type with
  | .app (.app (.const ``Iff _) _) _ => pure true
  | .forallE _ _ _ _ =>
    forallTelescopeReducing type fun _ body => do
      let body ← whnf body
      match body with
      | .app (.app (.const ``Iff _) _) _ => pure true
      | _ => pure false
  | _ => pure false

private def resolveGlobalConstName? (name : Name) : MetaM (Option Name) := do
  try
    let resolvedNames ← resolveGlobalConst (mkIdent name)
    pure resolvedNames[0]?
  catch _ =>
    pure none

private def resolveNamedExprAndType (id : Ident) : TacticM (Expr × Expr) := do
  withMainContext do
    match (← getLCtx).findFromUserName? id.getId with
    | some decl =>
      pure (mkFVar decl.fvarId, decl.type)
    | none =>
      Term.withSynthesize do
        let expr ← Term.elabTerm id.raw none true
        if expr.hasSyntheticSorry then
          throwAbortTactic
        let exprType ← inferType expr
        pure (expr, exprType)

private def resolveNamedExprAndTypePreservingForalls (id : Ident) : TacticM (Expr × Expr) := do
  withMainContext do
    match (← getLCtx).findFromUserName? id.getId with
    | some decl =>
      pure (mkFVar decl.fvarId, decl.type)
    | none =>
      if let some resolvedName ← resolveGlobalConstName? id.getId then
        let expr ← mkConstWithFreshMVarLevels resolvedName
        pure (expr, (← inferType expr))
      else
        Term.withSynthesize do
          let expr ← Term.elabTerm id.raw none true
          if expr.hasSyntheticSorry then
            throwAbortTactic
          let exprType ← inferType expr
          pure (expr, exprType)

private def replaceNamedExprWithProof (id : Ident) (proof : Expr) : TacticM Unit := do
  withMainContext do
    let mvarId ← getMainGoal
    match (← getLCtx).findFromUserName? id.getId with
    | some decl =>
      let result ← mvarId.replace decl.fvarId proof
      replaceMainGoal [result.mvarId]
    | none =>
      let (_, mvarId) ← mvarId.note id.getId proof
      replaceMainGoal [mvarId]

private def freshUserName (base : String) : TacticM Name := withMainContext do
  let lctx ← getLCtx
  let mut idx := 0
  let mut candidate := Name.mkSimple base
  while lctx.findFromUserName? candidate |>.isSome do
    idx := idx + 1
    candidate := Name.mkSimple s!"{base}{idx}"
  pure candidate

private def freshDerivedTheoremName (base : String) : TacticM Name := do
  let base := if base.isEmpty then "theorem" else base
  freshUserName s!"{derivedTheoremPrefix}{base}"

private def freshHiddenDerivedTheoremName (base : String) : TacticM Name := do
  let base := if base.isEmpty then "theorem" else base
  freshUserName s!"{hiddenDerivedTheoremPrefix}{base}"

private def freshSplitResultName (decl : LocalDecl) (base : String) : TacticM Name := do
  if isDerivedTheoremName decl.userName then
    freshDerivedTheoremName base
  else
    freshUserName base

private inductive VisualStatementKind where
  | provided
  | theorem
  deriving DecidableEq

private structure ResolvedVisualOperand where
  ident : Ident
  expr : Expr
  type : Expr
  rawType : Expr
  localDecl? : Option LocalDecl
  kind : VisualStatementKind
  theoremBase : String

private structure PremiseApplicationResult where
  proof : Expr
  functionOperand : ResolvedVisualOperand
  argumentOperand : ResolvedVisualOperand

private def resolveVisualOperand (id : Ident) (preserveForalls : Bool := false) :
    TacticM ResolvedVisualOperand := withMainContext do
  let localDecl? := (← getLCtx).findFromUserName? id.getId
  let (expr, rawType) ←
    if preserveForalls then
      resolveNamedExprAndTypePreservingForalls id
    else
      resolveNamedExprAndType id
  let kind :=
    match localDecl? with
    | some decl =>
        if isDerivedTheoremName decl.userName then
          .theorem
        else
          .provided
    | none =>
        .theorem
  pure {
    ident := id
    expr
    type := rawType
    rawType
    localDecl?
    kind
    theoremBase := theoremBaseFromName id.getId
  }

private def premiseApplicationBetween?
    (a b : ResolvedVisualOperand) : TacticM (Option PremiseApplicationResult) := do
  if let some proof ← mkPremiseApplication? a.expr a.type b.expr b.type then
    return some { proof, functionOperand := a, argumentOperand := b }
  if let some proof ← mkPremiseApplication? b.expr b.type a.expr a.type then
    return some { proof, functionOperand := b, argumentOperand := a }
  pure none

private def theoremOperandForKind
    (a b : ResolvedVisualOperand) : Option ResolvedVisualOperand :=
  if a.kind == .theorem then
    some a
  else if b.kind == .theorem then
    some b
  else
    none

private def theoremResultBase
    (result : PremiseApplicationResult) (a b : ResolvedVisualOperand) : String :=
  if result.functionOperand.kind == .theorem then
    result.functionOperand.theoremBase
  else
    match theoremOperandForKind a b with
    | some operand => operand.theoremBase
    | none => theoremBaseFromName result.functionOperand.ident.getId

private def hideDerivedTheoremIfLocal (id : Ident) : TacticM Unit := withMainContext do
  let some decl := (← getLCtx).findFromUserName? id.getId
    | return
  if !isDerivedTheoremName decl.userName || isHiddenDerivedTheoremName decl.userName then
    return
  let mvarId ← getMainGoal
  let hiddenName ← freshHiddenDerivedTheoremName (theoremBaseFromName decl.userName)
  let mvarId ← mvarId.rename decl.fvarId hiddenName
  replaceMainGoal [mvarId]

private def applyPremiseApplicationPolicy
    (a b : ResolvedVisualOperand) (result : PremiseApplicationResult) : TacticM Unit := do
  match a.kind, b.kind with
  | .provided, .provided =>
      let freshName ← freshUserName "h"
      replaceNamedExprWithProof (mkIdent freshName) result.proof
  | .theorem, .provided
  | .provided, .theorem =>
      match theoremOperandForKind a b with
      | some theoremOperand =>
          match theoremOperand.localDecl? with
          | some _ =>
              replaceNamedExprWithProof theoremOperand.ident result.proof
          | none =>
              let freshName ← freshDerivedTheoremName (theoremResultBase result a b)
              replaceNamedExprWithProof (mkIdent freshName) result.proof
      | none =>
          let freshName ← freshUserName "h"
          replaceNamedExprWithProof (mkIdent freshName) result.proof
  | .theorem, .theorem =>
      let freshName ← freshDerivedTheoremName (theoremResultBase result a b)
      replaceNamedExprWithProof (mkIdent freshName) result.proof

/-- If `type` is `A ↔ B`, project `expr : A ↔ B` through `.mp` or `.mpr` to
    produce a function of type `A → B` (forward) or `B → A` (reverse). Returns
    `none` if the type is not an `Iff`. -/
private def iffProject? (expr type : Expr) (isReverse : Bool) : MetaM (Option (Expr × Expr)) := do
  match type with
  | .app (.app (.const ``Iff _) lhs) rhs =>
    let proj := if isReverse then ``Iff.mpr else ``Iff.mp
    -- `Iff.mp : ∀ {a b : Prop}, (a ↔ b) → a → b`
    -- `Iff.mpr : ∀ {a b : Prop}, (a ↔ b) → b → a`
    let fn := mkApp3 (mkConst proj) lhs rhs expr
    let fnType ←
      if isReverse then mkArrow rhs lhs
      else mkArrow lhs rhs
    pure (some (fn, fnType))
  | _ => pure none

private def projectIffOperand (operand : ResolvedVisualOperand) (isReverse : Bool) :
    TacticM ResolvedVisualOperand := do
  let operandTypeWhnf ← whnf operand.rawType
  match (← iffProject? operand.expr operandTypeWhnf isReverse) with
  | some (expr, projectedType) =>
      pure { operand with expr, type := projectedType }
  | none =>
      pure operand

syntax (name := drag_to) "drag_to" ("←")? ident ident : tactic

@[tactic drag_to] def evalDragTo : Tactic := fun stx => do
  let isRev := !stx[1].isNone
  let a : Ident := ⟨stx[2]⟩
  let b : Ident := ⟨stx[3]⟩
  withMainContext do
    let aRaw ← resolveVisualOperand a
    let bRaw ← resolveVisualOperand b
    let aProjected ← projectIffOperand aRaw isRev
    let bProjected ← projectIffOperand bRaw isRev

    if let some result ← premiseApplicationBetween? aProjected bProjected then
      applyPremiseApplicationPolicy aRaw bRaw result
      return

    -- Rewrite fallback: if either side is an iff (possibly forall-quantified),
    -- try using it to rewrite the other hypothesis.
    if ← typeIsIff aRaw.rawType then
      if ← tryRewriteAt b a isRev then return
      if ← tryRewriteAt b a (!isRev) then return
    if ← typeIsIff bRaw.rawType then
      if ← tryRewriteAt a b isRev then return
      if ← tryRewriteAt a b (!isRev) then return

    throwError "drag_to: cannot combine '{a.getId}' and '{b.getId}'\n\
      {a.getId} : {aRaw.rawType}\n  {b.getId} : {bRaw.rawType}"

/-- `drag_apply fn arg` — apply theorem/hypothesis `fn` to hypothesis `arg` as a
    prop premise. The visual result is chosen by statement kind rather than drag
    direction, so theorem-vs-assumption interactions behave the same whichever
    card the player drags first. -/
syntax (name := drag_apply) "drag_apply" ident ident : tactic

@[tactic drag_apply] def evalDragApply : Tactic := fun stx => do
  let fn  : Ident := ⟨stx[1]⟩
  let arg : Ident := ⟨stx[2]⟩
  withMainContext do
    let fnOperand ← resolveVisualOperand fn true
    let argOperand ← resolveVisualOperand arg
    if let some result ← premiseApplicationBetween? fnOperand argOperand then
      applyPremiseApplicationPolicy fnOperand argOperand result
      return
    throwError "drag_apply: '{fn.getId}' has no prop argument matching '{arg.getId}'\n\
      {fn.getId} : {fnOperand.rawType}\n  {arg.getId} : {argOperand.rawType}"

syntax (name := delete_theorem) "delete_theorem" ident : tactic

@[tactic delete_theorem] def evalDeleteTheorem : Tactic := fun stx => do
  let h : Ident := ⟨stx[1]⟩
  withMainContext do
    let some decl := (← getLCtx).findFromUserName? h.getId
      | throwError "delete_theorem: '{h.getId}' is not a local theorem"
    if !isDerivedTheoremName decl.userName || isHiddenDerivedTheoremName decl.userName then
      throwError "delete_theorem: '{h.getId}' is not a visible derived theorem"
    hideDerivedTheoremIfLocal h

/-- `specialize_forall_as newName src binder value` partially applies the theorem or
    hypothesis `src` at the named binder `binder := value`, preserving any remaining
    binders in the resulting proof and introducing it as `newName`. -/
syntax (name := specialize_forall_as) "specialize_forall_as" ident ident ident term : tactic

@[tactic specialize_forall_as] def evalSpecializeForallAs : Tactic := fun stx => do
  let newName : Ident := ⟨stx[1]⟩
  let src : Ident := ⟨stx[2]⟩
  let binder : Ident := ⟨stx[3]⟩
  let valueStx := stx[4]
  withMainContext do
    let (srcExpr, srcType) ← resolveNamedExprAndTypePreservingForalls src
    let some binderDomain ← binderDomainByName? srcType binder.getId
      | throwError "specialize_forall_as: '{src.getId}' has no binder named '{binder.getId}'\n\
          {src.getId} : {srcType}"
    let valueExpr ← Term.withSynthesize do
      let valueExpr ← Term.elabTerm valueStx (some binderDomain) true
      if valueExpr.hasSyntheticSorry then
        throwAbortTactic
      pure valueExpr
    let valueType ← inferType valueExpr
    if let some proof ← mkNamedBinderApplication? srcExpr srcType binder.getId valueExpr valueType then
      replaceNamedExprWithProof newName proof
      return
    throwError "specialize_forall_as: cannot specialize '{src.getId}' at '{binder.getId}' with {valueExpr}\n\
      {src.getId} : {srcType}"

syntax (name := drag_goal) "drag_goal" ("←")? ident : tactic

@[tactic drag_goal] def evalDragGoal : Tactic := fun stx => do
  let isRev := !stx[1].isNone
  let h : Ident := ⟨stx[2]⟩
  withMainContext do
    let (_, hTypeRaw) ← resolveNamedExprAndType h
    let hType ← whnf hTypeRaw
    let goal ← whnf (← getMainTarget)

    -- False hypothesis closes any goal via exfalso
    if hType == .const ``False [] then
      evalTactic (← `(tactic| exact False.elim $h))
      return

    -- Iff (possibly forall-quantified): try rewriting in the requested direction.
    if ← typeIsIff hTypeRaw then
      if ← tryRewrite h.raw isRev then return
      if ← tryRewrite h.raw (!isRev) then return
      if let .app (.app (.const ``Iff _) _) _ := hType then
        if isRev then
          if ← tryTactic (← `(tactic| apply Iff.mpr $h)) then return
        else
          if ← tryTactic (← `(tactic| apply Iff.mp $h)) then return

    if ← isDefEq hType goal then
      evalTactic (← `(tactic| exact $h))
      return

    if let .app (.app (.app (.const ``Eq _) _) _) _ := hType then
      if ← tryRewrite h.raw isRev then return
      if ← tryRewrite h.raw (!isRev) then return

    -- Let Lean's own `apply` drive higher-order matching for implications and
    -- quantified theorems. Trying to compare a raw `forall` body against the
    -- goal here can hit unexpected bound variables (e.g. `Nat.zero_le`).
    if ← tryTactic (← `(tactic| apply $h)) then return

    throwError "drag_goal: '{h.getId}' cannot be used here.\n\
      {h.getId} : {hTypeRaw}\n  goal : {← getMainTarget}"

syntax (name := drag_rw)
  "drag_rw" "[" ("←")? ident "]" ("on" ("lhs" <|> "rhs"))? ("at" "[" num,* "]")? : tactic
syntax (name := drag_rw_rhs) "drag_rw_rhs" "[" ("←")? ident "]" : tactic
syntax (name := drag_rw_lhs) "drag_rw_lhs" "[" ("←")? ident "]" : tactic
syntax (name := drag_rw_rhs_at) "drag_rw_rhs_at" "[" ("←")? ident "]" "[" num,* "]" : tactic
syntax (name := drag_rw_lhs_at) "drag_rw_lhs_at" "[" ("←")? ident "]" "[" num,* "]" : tactic
syntax (name := drag_rw_hyp_rhs) "drag_rw_hyp_rhs" ident "[" ("←")? ident "]" : tactic
syntax (name := drag_rw_hyp_lhs) "drag_rw_hyp_lhs" ident "[" ("←")? ident "]" : tactic
syntax (name := drag_rw_hyp_rhs_at) "drag_rw_hyp_rhs_at" ident "[" ("←")? ident "]" "[" num,* "]" : tactic
syntax (name := drag_rw_hyp_lhs_at) "drag_rw_hyp_lhs_at" ident "[" ("←")? ident "]" "[" num,* "]" : tactic

private def visibleArityForConst (name : Name) : Option Nat :=
  match name with
  | ``HAdd.hAdd | ``HMul.hMul | ``HSub.hSub | ``HDiv.hDiv => some 2
  | _ => none

private def navigateToSubterm (e : Expr) (path : List Nat) : MetaM Expr := do
  match path with
  | [] => pure e
  | k :: rest =>
    let e' ← withReducible (whnf e)
    let flat := e'.getAppArgs
    let head := e'.getAppFn.constName?
    let va :=
      match head >>= visibleArityForConst with
      | some v => v
      | none => 1
    let idx := flat.size - va + k - 1
    if h : idx < flat.size then
      navigateToSubterm flat[idx] rest
    else
      throwError "drag_rw: path position {k} out of range (node has {va} visible children)"

private def parsePathNode (numsNode : Syntax) : List Nat :=
  numsNode.getArgs.toList.filterMap Syntax.isNatLit?

private def evalTacticString (src : String) : TacticM Unit := do
  let env ← getEnv
  match Lean.Parser.runParserCategory env `tactic src with
  | .ok stx =>
    let stx : TSyntax `tactic := ⟨stx⟩
    evalTactic stx
  | .error err =>
    throwError "{err}"

private def visibleFVarIds (lctx : LocalContext) : Std.HashSet FVarId := Id.run do
  let mut ids : Std.HashSet FVarId := {}
  for localDecl in lctx do
    if !localDecl.isImplementationDetail then
      ids := ids.insert localDecl.fvarId
  ids

private def renameNewestCaseHyp
    (goal : MVarId) (originalFVarIds : Std.HashSet FVarId) (newName : Name) :
    MetaM MVarId := goal.withContext do
  let mut candidate? : Option FVarId := none
  for localDecl in ← getLCtx do
    if localDecl.isImplementationDetail || originalFVarIds.contains localDecl.fvarId then
      continue
    candidate? := some localDecl.fvarId
  match candidate? with
  | some fvarId =>
      goal.rename fvarId newName
  | none =>
      throwTacticEx `click_prop goal
        "failed to locate the new case hypothesis after splitting this disjunction"

private def mkConvRwScript (hName : Name) (symm : Bool) (sideIsRhs : Bool) (path : List Nat) : String :=
  let rwTerm := if symm then s!"← {hName}" else s!"{hName}"
  let sideLine := if sideIsRhs then "rhs" else "lhs"
  let argSteps := path.map (fun k => s!"arg {k}")
  let steps := sideLine :: (argSteps ++ [s!"rewrite [{rwTerm}]"])
  "conv => { " ++ String.intercalate "; " steps ++ " }"

private def mkConvRwHypScript
    (targetHyp : Name) (hName : Name) (symm : Bool) (sideIsRhs : Bool) (path : List Nat) : String :=
  let rwTerm := if symm then s!"← {hName}" else s!"{hName}"
  let sideLine := if sideIsRhs then "rhs" else "lhs"
  let argSteps := path.map (fun k => s!"arg {k}")
  let steps := sideLine :: (argSteps ++ [s!"rewrite [{rwTerm}]"])
  s!"conv at {targetHyp} => " ++ "{ " ++ String.intercalate "; " steps ++ " }"

private def mkAppPrefix (fn : Expr) (args : Array Expr) (upto : Nat) : Expr :=
  (List.range upto).foldl (fun acc j => mkApp acc args[j]!) fn

private partial def applyCongrFunArgs (eqProof : Expr) (args : Array Expr) (start : Nat) : MetaM Expr := do
  if h : start < args.size then
    let eqProof' ← mkCongrFun eqProof args[start]
    applyCongrFunArgs eqProof' args (start + 1)
  else
    pure eqProof

private def instantiateRewriteTheoremAtExpr (e : Expr) (h : Ident) (symm : Bool) :
    TacticM Expr := do
  Term.withSynthesize <| withMainContext do
    let baseThm ← Term.elabTerm h.raw none true
    if baseThm.hasSyntheticSorry then
      throwAbortTactic
    let theoremType ← inferType baseThm
    let (args, _, body) ← forallMetaTelescopeReducing theoremType
    if let some (_, lhsPat, rhsPat) ← matchEq? body then
      let fromPat := if symm then rhsPat else lhsPat
      unless ← isDefEq e fromPat do
        throwErrorAt h "drag_rw: '{h.getId}' does not match the selected subterm"
    let mut argsApplied := #[]
    for arg in args do
      argsApplied := argsApplied.push (← instantiateMVars arg)
    instantiateMVars (mkAppN baseThm argsApplied)

private def rewriteAtExpr (mvarId : MVarId) (e thm : Expr) (stx : Syntax) (symm : Bool) :
    TacticM RewriteResult := do
  let mvarCounterSaved := (← getMCtx).mvarCounter
  unless ← occursCheck mvarId thm do
    throwErrorAt stx "Occurs check failed: Expression{indentExpr thm}\ncontains the goal {Expr.mvar mvarId}"
  let r ← mvarId.rewrite e thm symm
  let mctx ← getMCtx
  let mvarIds := r.mvarIds.filter fun newMVarId => (mctx.getDecl newMVarId |>.index) >= mvarCounterSaved
  pure { r with mvarIds }

private structure FocusedRewriteResult where
  eNew : Expr
  eqProof : Expr
  mvarIds : List MVarId

private structure EqualitySideRewriteResult where
  targetNew : Expr
  eqProof : Expr
  mvarIds : List MVarId

private def binaryRelationInfo? (target : Expr) : MetaM (Option (Expr × Array Expr × Nat × Nat)) := do
  let target := target.consumeMData
  let fn := target.getAppFn
  let args := target.getAppArgs
  let some headName := fn.constName? | return none
  let visibleArity? :=
    match headName with
    | ``Eq => some 2
    | ``LT.lt => some 2
    | ``LE.le => some 2
    | _ => none
  let some visibleArity := visibleArity? | return none
  if args.size < visibleArity then return none
  let lhsIdx := args.size - visibleArity
  let rhsIdx := lhsIdx + 1
  return some (fn, args, lhsIdx, rhsIdx)

private def replaceGoalPreservingTarget (mvarId : MVarId) (targetNew eqProof : Expr)
    (extraGoals : List MVarId) : TacticM Unit := do
  let goalNew ← mvarId.replaceTargetEq targetNew eqProof
  replaceMainGoal (goalNew :: extraGoals)

private def replaceHypPreservingTarget (mvarId : MVarId) (fvarId : FVarId)
    (targetNew eqProof : Expr) (extraGoals : List MVarId) : TacticM Unit := do
  let result ← mvarId.replaceLocalDecl fvarId targetNew eqProof
  replaceMainGoal (result.mvarId :: extraGoals)

private partial def focusedRewriteExpr
    (mvarId : MVarId) (e : Expr) (path : List Nat) (h : Ident) (symm : Bool) :
    TacticM FocusedRewriteResult := withMainContext do
  match path with
  | [] =>
    let thm ← instantiateRewriteTheoremAtExpr e h symm
    let r ← rewriteAtExpr mvarId e thm h.raw symm
    pure { eNew := r.eNew, eqProof := r.eqProof, mvarIds := r.mvarIds }
  | k :: rest =>
    let e' ← withReducible (whnf e)
    let flat := e'.getAppArgs
    let fn := e'.getAppFn
    if flat.isEmpty then
      throwError "drag_rw: path position {k} out of range (node has 0 visible children)"
    let head := fn.constName?
    let va :=
      match head >>= visibleArityForConst with
      | some v => v
      | none => 1
    if k == 0 || k > va then
      throwError "drag_rw: path position {k} out of range (node has {va} visible children)"
    let idx := flat.size - va + k - 1
    if hIdx : idx < flat.size then
      let child := flat[idx]
      let childRw ← focusedRewriteExpr mvarId child rest h symm
      let argsNew := flat.set! idx childRw.eNew
      let eNew := mkAppN fn argsNew
      let fnPrefix := mkAppPrefix fn flat idx
      let eqProof0 ← mkCongrArg fnPrefix childRw.eqProof
      let eqProof ← applyCongrFunArgs eqProof0 flat (idx + 1)
      pure { eNew, eqProof, mvarIds := childRw.mvarIds }
    else
      throwError "drag_rw: path position {k} out of range (node has {va} visible children)"

private def rewriteTargetRelationSide
    (mvarId : MVarId) (target : Expr) (h : Ident) (symm : Bool)
    (sideIsRhs : Bool) (path : List Nat) : TacticM EqualitySideRewriteResult := withMainContext do
  let some (fn, args, lhsIdx, rhsIdx) ← binaryRelationInfo? target
    | throwError "drag_rw: selected target is not a supported binary relation"
  let lhsExpr := args[lhsIdx]!
  let rhsExpr := args[rhsIdx]!
  let focusIdx := if sideIsRhs then rhsIdx else lhsIdx
  let focusExpr := if sideIsRhs then rhsExpr else lhsExpr
  let rwRes ← focusedRewriteExpr mvarId focusExpr path h symm
  let α ← inferType focusExpr
  let targetNewArgs := args.set! focusIdx rwRes.eNew
  let targetNew := mkAppN fn targetNewArgs
  let motive ← withLocalDeclD `_ α fun x => do
    let body := mkAppN fn (args.set! focusIdx x)
    mkLambdaFVars #[x] body
  let eqProof ← mkCongrArg motive rwRes.eqProof
  pure { targetNew, eqProof, mvarIds := rwRes.mvarIds }

private def tryFocusedRewrite (h : Ident) (symm : Bool) (sideIsRhs : Bool) (path : List Nat) : TacticM Bool := do
  let savedState ← saveState
  try
    let mvarId ← getMainGoal
    let target ← mvarId.getType
    let rwRes ← rewriteTargetRelationSide mvarId target h symm sideIsRhs path
    replaceGoalPreservingTarget mvarId rwRes.targetNew rwRes.eqProof rwRes.mvarIds
    pure true
  catch _ =>
    restoreState savedState
    let savedState' ← saveState
    try
      evalTacticString (mkConvRwScript h.getId symm sideIsRhs path)
      return true
    catch _ =>
      restoreState savedState'
      return false

private def tryFocusedRewriteHyp
    (targetHyp : Ident) (h : Ident) (symm : Bool) (sideIsRhs : Bool) (path : List Nat) :
    TacticM Bool := do
  let savedState ← saveState
  try
    let mvarId ← getMainGoal
    withMainContext do
      let targetDecl ← ((← getLCtx).findFromUserName? targetHyp.getId).getDM
        (throwError "drag_rw: unknown identifier '{targetHyp.getId}'")
      let rwRes ← rewriteTargetRelationSide mvarId targetDecl.type h symm sideIsRhs path
      replaceHypPreservingTarget mvarId targetDecl.fvarId rwRes.targetNew rwRes.eqProof rwRes.mvarIds
      pure true
  catch _ =>
    restoreState savedState
    let savedState' ← saveState
    try
      evalTacticString (mkConvRwHypScript targetHyp.getId h.getId symm sideIsRhs path)
      return true
    catch _ =>
      restoreState savedState'
      return false

private def evalDragRwCore (h : Ident) (isRev : Bool) (sideOpt : Option Bool) (pathOpt : Option (List Nat)) : TacticM Unit := do
  match pathOpt with
  | none =>
    match sideOpt with
    | some sideIsRhs =>
      if ← tryFocusedRewrite h isRev sideIsRhs [] then return
      if ← tryFocusedRewrite h (!isRev) sideIsRhs [] then return
    | none =>
      if ← tryRewrite h.raw isRev then return
      if ← tryRewrite h.raw (!isRev) then return
    throwError "drag_rw: '{h.getId}' does not match any subterm in the goal.\n\
      goal : {← getMainTarget}"
  | some path =>
    match sideOpt with
    | some sideIsRhs =>
      if ← tryFocusedRewrite h isRev sideIsRhs path then return
    | none =>
      if ← tryFocusedRewrite h isRev true path then return
      if ← tryFocusedRewrite h isRev false path then return
    throwError "drag_rw: '{h.getId}' does not match the subterm at path {path} in the goal.\n\
      goal : {← getMainTarget}"

@[tactic drag_rw] def evalDragRw : Tactic := fun stx => do
  let src := stx.reprint.getD ""
  let rev := stx[2]
  let h : Ident := ⟨stx[3]⟩
  let isRev := !rev.isNone
  let sideOpt :=
    if (src.splitOn " on lhs").length > 1 then some false
    else if (src.splitOn " on rhs").length > 1 then some true
    else none
  let pathOpt :=
    if (src.splitOn " at [").length > 1 then
      let tail := src.splitOn " at ["
      match tail.reverse with
      | last :: _ => some <| (last.dropEnd 1).toString.splitOn "," |>.filterMap String.toNat?
      | _ => none
    else
      none
  evalDragRwCore h isRev sideOpt pathOpt

@[tactic drag_rw_rhs] def evalDragRwRhs : Tactic := fun stx => do
  let rev := stx[2]
  let h : Ident := ⟨stx[3]⟩
  evalDragRwCore h (!rev.isNone) (some true) none

@[tactic drag_rw_lhs] def evalDragRwLhs : Tactic := fun stx => do
  let rev := stx[2]
  let h : Ident := ⟨stx[3]⟩
  evalDragRwCore h (!rev.isNone) (some false) none

@[tactic drag_rw_rhs_at] def evalDragRwRhsAt : Tactic := fun stx => do
  let rev := stx[2]
  let h : Ident := ⟨stx[3]⟩
  let path := parsePathNode stx[6]
  evalDragRwCore h (!rev.isNone) (some true) (some path)

@[tactic drag_rw_lhs_at] def evalDragRwLhsAt : Tactic := fun stx => do
  let rev := stx[2]
  let h : Ident := ⟨stx[3]⟩
  let path := parsePathNode stx[6]
  evalDragRwCore h (!rev.isNone) (some false) (some path)

private def evalDragRwHypCore
    (targetHyp : Ident) (h : Ident) (isRev : Bool) (sideOpt : Option Bool)
    (pathOpt : Option (List Nat)) : TacticM Unit := do
  match pathOpt with
  | none =>
    match sideOpt with
    | some sideIsRhs =>
      if ← tryFocusedRewriteHyp targetHyp h isRev sideIsRhs [] then return
      if ← tryFocusedRewriteHyp targetHyp h (!isRev) sideIsRhs [] then return
    | none =>
      pure ()
    throwError "drag_rw: '{h.getId}' does not match any subterm in '{targetHyp.getId}'."
  | some path =>
    match sideOpt with
    | some sideIsRhs =>
      if ← tryFocusedRewriteHyp targetHyp h isRev sideIsRhs path then return
    | none =>
      pure ()
    throwError "drag_rw: '{h.getId}' does not match the subterm at path {path} in '{targetHyp.getId}'."

@[tactic drag_rw_hyp_rhs] def evalDragRwHypRhs : Tactic := fun stx => do
  let targetHyp : Ident := ⟨stx[1]⟩
  let rev := stx[3]
  let h : Ident := ⟨stx[4]⟩
  evalDragRwHypCore targetHyp h (!rev.isNone) (some true) none

@[tactic drag_rw_hyp_lhs] def evalDragRwHypLhs : Tactic := fun stx => do
  let targetHyp : Ident := ⟨stx[1]⟩
  let rev := stx[3]
  let h : Ident := ⟨stx[4]⟩
  evalDragRwHypCore targetHyp h (!rev.isNone) (some false) none

@[tactic drag_rw_hyp_rhs_at] def evalDragRwHypRhsAt : Tactic := fun stx => do
  let targetHyp : Ident := ⟨stx[1]⟩
  let rev := stx[3]
  let h : Ident := ⟨stx[4]⟩
  let path := parsePathNode stx[7]
  evalDragRwHypCore targetHyp h (!rev.isNone) (some true) (some path)

@[tactic drag_rw_hyp_lhs_at] def evalDragRwHypLhsAt : Tactic := fun stx => do
  let targetHyp : Ident := ⟨stx[1]⟩
  let rev := stx[3]
  let h : Ident := ⟨stx[4]⟩
  let path := parsePathNode stx[7]
  evalDragRwHypCore targetHyp h (!rev.isNone) (some false) (some path)

syntax (name := click_goal) "click_goal" : tactic

@[tactic click_goal] def evalClickGoal : Tactic := fun _ => withMainContext do
  let goal ← getMainTarget
  let goalWhnf ← withReducible (whnf goal)
  match ← clickGoalKind? goal with
  | some .completeByRfl =>
      liftMetaTactic fun mvarId => withReducible do
        mvarId.refl
        pure []
  | some .introVar =>
      if let some (binderBase, hypBase) ← boundedComparisonIntroInfo? goal then
        let binderName ←
          if binderBase.isAnonymous then pure none
          else some <$> freshUserName binderBase.toString
        let hypName ← freshUserName hypBase.toString
        match binderName with
        | some binderName =>
            evalTacticString s!"intro {binderName}"
            evalTacticString s!"intro {hypName}"
        | none =>
            evalTacticString "intro"
            evalTacticString s!"intro {hypName}"
      else
        match goalWhnf with
        | .forallE binderName domain _ _ =>
            if ← isProp domain then
              evalTacticString "intro"
            else if binderName.isAnonymous then
              evalTacticString "intro"
            else
              let nextName ← freshUserName binderName.toString
              evalTacticString s!"intro {nextName}"
        | _ =>
            evalTacticString "intro"
  | some .introProp =>
      let hName ← freshUserName "h"
      evalTacticString s!"intro {hName}"
  | some .splitAnd =>
      evalTactic (← `(tactic| constructor))
  | _ =>
      match goalWhnf with
      | .app (.app (.app (.const ``Eq _) _) lhsExpr) rhsExpr =>
          unless ← withReducible (isDefEq lhsExpr rhsExpr) do
            throwError "click_goal: goal is an equality but not solvable by `rfl`.\n\
              goal : {goal}"
          throwError "click_goal: current goal is not directly clickable.\n\
            goal : {goal}"
      | .forallE _ domain _ _ =>
          if ← isProp domain then
            throwError "click_goal: proposition implication could not be introduced.\n\
              goal : {goal}"
          throwError "click_goal: forall goal could not be introduced.\n\
            goal : {goal}"
      | _ =>
          throwError "click_goal: current goal is not directly clickable.\n\
            goal : {goal}"

private def leftRightMeta (name : Name) (idx max : Nat) (goal : MVarId) : MetaM (List MVarId) := do
  goal.withContext do
    goal.checkNotAssigned name
    let target ← goal.getType'
    matchConstInduct target.getAppFn
      (fun _ => throwTacticEx `constructor goal "target is not an inductive datatype")
      fun ival us => do
        unless ival.ctors.length == max do
          throwTacticEx `constructor goal
            s!"{name} target applies for inductive types with exactly two constructors"
        let ctor := ival.ctors[idx]!
        goal.apply <| mkConst ctor us

syntax (name := click_goal_left) "click_goal_left" : tactic
syntax (name := click_goal_right) "click_goal_right" : tactic

@[tactic click_goal_left] def evalClickGoalLeft : Tactic := fun _ =>
  liftMetaTactic (leftRightMeta `left 0 2)

@[tactic click_goal_right] def evalClickGoalRight : Tactic := fun _ =>
  liftMetaTactic (leftRightMeta `right 1 2)

private def isReflexiveEqualityProp (e : Expr) : MetaM Bool := do
  let e ← withReducible (whnf e)
  if let some (_, lhsExpr, rhsExpr) ← matchEq? e.consumeMData then
    withReducible (isDefEq lhsExpr rhsExpr)
  else
    pure false

syntax (name := click_prop) "click_prop" ident : tactic

@[tactic click_prop] def evalClickProp : Tactic := fun stx => do
  let h : Ident := ⟨stx[1]⟩
  withMainContext do
    let hDecl ← ((← getLCtx).findFromUserName? h.getId).getDM
      (throwError "click_prop: unknown identifier '{h.getId}'")
    let hType ← whnf hDecl.type
    match hType with
    | .app (.app (.const ``And _) _) _ =>
      let h1 : Ident := mkIdent (← freshSplitResultName hDecl "left")
      let h2 : Ident := mkIdent (← freshSplitResultName hDecl "right")
      evalTactic (← `(tactic| have $h1 := And.left $h))
      evalTactic (← `(tactic| have $h2 := And.right $h))
      evalTactic (← `(tactic| clear $h))
    | .app (.app (.const ``Or _) _) _ =>
      let originalFVarIds := visibleFVarIds (← getLCtx)
      let h1 : Ident := mkIdent (← freshSplitResultName hDecl "left")
      let h2 : Ident := mkIdent (← freshSplitResultName hDecl "right")
      evalTacticString s!"cases {h.getId}"
      match ← getGoals with
      | goalLeft :: goalRight :: rest =>
          let goalLeft ← liftMetaMAtMain fun _ =>
            renameNewestCaseHyp goalLeft originalFVarIds h1.getId
          let goalRight ← liftMetaMAtMain fun _ =>
            renameNewestCaseHyp goalRight originalFVarIds h2.getId
          setGoals (goalLeft :: goalRight :: rest)
      | _ =>
          throwError "click_prop: expected two goals after splitting '{h.getId}'"
    | .app (.app (.const ``Exists _) _) pred =>
      -- Introduce the witness and condition from ∃ x, P x using `have ⟨v, hv⟩ := h; clear h`.
      -- This is pure core Lean 4: names are fixed up-front (no inaccessible-name issues).
      let binderName := match pred with
        | .lam n _ _ _ => n
        | _ => `w
      let varIdent  : Ident := mkIdent (← freshUserName binderName.toString)
      let condIdent : Ident := mkIdent (← freshUserName "h")
      evalTactic (← `(tactic| have ⟨$varIdent, $condIdent⟩ := $h))
      evalTactic (← `(tactic| clear $h))
    | .forallE _ domain _ _ =>
      if (← isProp domain) && (← isReflexiveEqualityProp domain) then
        evalTactic (← `(tactic| specialize $h rfl))
      else
        throwError "click_prop: '{h.getId}' cannot be decomposed\n\
          {h.getId} : {hDecl.type}"
    | _ =>
      throwError "click_prop: '{h.getId}' cannot be decomposed\n\
        {h.getId} : {hDecl.type}"

section Regression

private theorem add_zero_local (a : Nat) : a + 0 = a := by
  simp

example (y : Nat) : y + 2 = (y + 0) + 2 := by
  drag_rw_lhs_at [← add_zero_local] [1]
  rfl

example (y : Nat) : y + 2 = y + 2 := by
  fail_if_success drag_rw_lhs_at [add_zero_local] [1]
  rfl

example (y : Nat) (h : (y + 0) + 2 = y + 2) : y + 2 = y + 2 := by
  drag_rw_hyp_lhs_at h [add_zero_local] [1]
  exact h

example (n : Nat) : n = n := by
  click_goal

example (P : Prop) : P → P := by
  click_goal
  exact h

example (P : Nat → Prop) (h : ∀ a > 0, P a) : ∀ a > 0, P a := by
  click_goal
  exact h a ha

example (P Q : Prop) (h : P ∧ Q) : P := by
  click_prop h
  exact left

example (P Q : Prop) (hp : P) (hq : Q) : P ∧ Q := by
  click_goal
  exact hp
  exact hq

example (P Q R : Prop) (h : P ∨ Q) (hp : P → R) (hq : Q → R) : R := by
  click_prop h
  · exact hp left
  · exact hq right

example (a : Nat) (B : Prop) (h : (a = a) → B) : B := by
  click_prop h
  exact h

example (P Q : Prop) (h : P) : P ∨ Q := by
  click_goal_left
  exact h

example (P Q : Prop) (h : Q) : P ∨ Q := by
  click_goal_right
  exact h

example : 0 + 0 = 0 := by
  fail_if_success click_goal
  drag_rw_lhs [Nat.add_zero]
  click_goal

example (y : Nat) : 5 * (y + 1) = 5 * y + 5 * 1 := by
  drag_rw_lhs [Nat.mul_add]
  rfl

example : 0 ≠ 1 := by
  click_goal
  cases h

example (P Q : Prop) (h : False) : P ∧ Q := by
  drag_goal h

example (n : Nat) (h : False) : n = 42 := by
  drag_goal h

private theorem flipEqLocal (x y : Nat) : x = y → y = x := by
  intro h
  exact h.symm

example (x y : Nat) (h : x = y) : y = x := by
  drag_to flipEqLocal h
  exact THM_flipEqLocal

private theorem addEqSelfLocal (x y : Nat) : x + y = x → y = y := by
  intro _
  rfl

example (x y : Nat) (h : x + y = x) : y = y := by
  drag_to addEqSelfLocal h
  exact THM_addEqSelfLocal

example (P Q : Prop) (hpq : P → Q) (hp : P) : Q := by
  drag_to hpq hp
  exact h

private theorem propBinderLocal {a b : Nat} : a = a → b = b → True := by
  intro _ _
  trivial

example (x y : Nat) (hx : x = x) (hy : y = y) : True := by
  drag_apply propBinderLocal hx
  exact THM_propBinderLocal hy

example (x y : Nat) (hx : x = x) (hy : y = y) : True := by
  specialize_forall_as h propBinderLocal a x
  exact h hx hy

example (src : ∀ {a b : Nat}, a = a → b = b → True) (x y : Nat)
    (hx : x = x) (hy : y = y) : True := by
  specialize_forall_as h src a x
  exact h hx hy

private theorem instChainLocal [Inhabited Nat] {a : Nat} : a = a → 0 = 0 := by
  intro _
  rfl

private theorem zeroEqToTrueLocal : 0 = 0 → True := by
  intro _
  trivial

private theorem propCollisionLocal {a b : Nat} : a = a → b = 0 → True := by
  intro _ _
  trivial

example (x : Nat) (hx : x = x) : True := by
  drag_apply instChainLocal hx
  drag_apply zeroEqToTrueLocal THM_instChainLocal
  exact THM_zeroEqToTrueLocal

example (x y : Nat) (hy : y = y) : True := by
  have hx : x = x := rfl
  have hy' : y = y := hy
  drag_apply propCollisionLocal hx
  drag_apply propCollisionLocal hy'
  exact THM_propCollisionLocal1 rfl

example (P Q : Prop) (hpq : P → Q) (hp : P) : Q := by
  have THM_local : P → Q := hpq
  drag_to hp THM_local
  exact THM_local

example (P Q : Prop) (hpq : P → Q) (hp : P) : Q := by
  have THM_f : P → Q := hpq
  have THM_p : P := hp
  drag_to THM_f THM_p
  exact THM_f1

example (y : Nat) : 0 <= y ∨ True := by
  click_goal_left
  drag_goal Nat.zero_le

-- Iff: drag_goal forward uses .mp, reverse uses .mpr
example (P Q : Prop) (h : P ↔ Q) (hp : P) : Q := by
  drag_goal h
  exact hp

example (P Q : Prop) (h : P ↔ Q) (hq : Q) : P := by
  drag_goal ← h
  exact hq

example (P Q : Prop) (h : P ↔ Q) (hp : P) : Q := by
  drag_to h hp
  exact h1

example (P Q : Prop) (h : P ↔ Q) (hq : Q) : P := by
  drag_to ← h hq
  exact h1

-- Forall-quantified iff theorem: use `rw` path.
private theorem iffThmLocal (a b : Nat) : a + 0 = b ↔ a = b := by
  simp

example (a b : Nat) : a = b → a + 0 = b := by
  intro h
  drag_goal iffThmLocal
  exact h

example (a b : Nat) (h : a + 0 = b) : a = b := by
  drag_to iffThmLocal h
  exact h

example (P Q : Prop) (hpq : P → Q) (hp : P) : Q := by
  have THM_keep : P → Q := hpq
  drag_to THM_keep hp
  delete_theorem THM_keep
  exact hpq hp

end Regression

end GameServer
