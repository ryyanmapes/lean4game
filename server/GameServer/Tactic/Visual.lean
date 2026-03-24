import Lean.Elab.Tactic.Basic
import Lean.Elab.Tactic.Conv
import Lean.Elab.Tactic.Rewrite
import Lean.Meta.Tactic.Refl
import Lean.Meta.Tactic.Assert
import Lean.Parser.Extension
import GameServer.GoalClick

namespace GameServer

open Lean Meta Elab Tactic

private def tryTactic (stx : TSyntax `tactic) : TacticM Bool := do
  let savedState ← saveState
  try
    evalTactic stx
    return true
  catch _ =>
    restoreState savedState
    return false

private def tryTacticString (src : String) : TacticM Bool := do
  let env ← getEnv
  match Lean.Parser.runParserCategory env `tactic src with
  | .error _ =>
    return false
  | .ok stx =>
    tryTactic (⟨stx⟩ : TSyntax `tactic)

private def tryRewrite (h : Syntax) (symm : Bool) : TacticM Bool := do
  let savedState ← saveState
  try
    rewriteTarget h symm
    return true
  catch _ =>
    restoreState savedState
    return false

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

private def mkPremiseApplication? (fnExpr fnType argExpr argType : Expr) : TacticM (Option Expr) := do
  withMainContext do
    let savedMCtx ← getMCtx
    try
      let (args, _, _) ← forallMetaTelescopeReducing fnType
      for i in [:args.size] do
        let dom ← instantiateMVars (← inferType args[i]!)
        if (← isProp dom) && (← isDefEq dom argType) then
          let mut app := fnExpr
          for j in [:i] do
            app := mkApp app args[j]!
          app := mkApp app argExpr
          let _ ← inferType app
          let applied ← instantiateMVars app
          if applied.hasMVar then
            continue
          setMCtx savedMCtx
          return some applied
      setMCtx savedMCtx
      return none
    catch _ =>
      setMCtx savedMCtx
      return none

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

syntax (name := drag_to) "drag_to" ident ident : tactic

@[tactic drag_to] def evalDragTo : Tactic := fun stx => do
  let a : Ident := ⟨stx[1]⟩
  let b : Ident := ⟨stx[2]⟩
  withMainContext do
    let (aExpr, aTypeRaw) ← resolveNamedExprAndType a
    let (bExpr, bTypeRaw) ← resolveNamedExprAndType b
    let aType ← whnf aTypeRaw
    let bType ← whnf bTypeRaw

    if let some proof ← mkPremiseApplication? bExpr bType aExpr aType then
      replaceNamedExprWithProof a proof
      return

    if let some proof ← mkPremiseApplication? aExpr aType bExpr bType then
      replaceNamedExprWithProof b proof
      return

    throwError "drag_to: cannot combine '{a.getId}' and '{b.getId}'\n\
      {a.getId} : {aTypeRaw}\n  {b.getId} : {bTypeRaw}"

syntax (name := drag_goal) "drag_goal" ident : tactic

@[tactic drag_goal] def evalDragGoal : Tactic := fun stx => do
  let h : Ident := ⟨stx[1]⟩
  withMainContext do
    let (_, hTypeRaw) ← resolveNamedExprAndType h
    let hType ← whnf hTypeRaw
    let goal ← whnf (← getMainTarget)

    if ← isDefEq hType goal then
      evalTactic (← `(tactic| exact $h))
      return

    if let .forallE _ _ body _ := hType then
      if ← isDefEq body goal then
        evalTactic (← `(tactic| apply $h))
        return

    if let .app (.app (.app (.const ``Eq _) _) _) _ := hType then
      if ← tryRewrite h.raw false then return
      if ← tryRewrite h.raw true then return

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

private def freshUserName (base : String) : TacticM Name := withMainContext do
  let lctx ← getLCtx
  let mut idx := 0
  let mut candidate := Name.mkSimple base
  while lctx.findFromUserName? candidate |>.isSome do
    idx := idx + 1
    candidate := Name.mkSimple s!"{base}{idx + 1}"
  pure candidate

private def mkConvRwScript (hName : Name) (symm : Bool) (sideIsRhs : Bool) (path : List Nat) : String :=
  let rwTerm := if symm then s!"← {hName}" else s!"{hName}"
  let sideLine := if sideIsRhs then "rhs" else "lhs"
  let argSteps := path.map (fun k => s!"arg {k}")
  let steps := sideLine :: (argSteps ++ [s!"rewrite [{rwTerm}]"])
  "conv => { " ++ String.intercalate "; " steps ++ " }"

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

private def rewriteEqualitySide
    (mvarId : MVarId) (target : Expr) (h : Ident) (symm : Bool)
    (sideIsRhs : Bool) (path : List Nat) : TacticM EqualitySideRewriteResult := withMainContext do
  match target with
  | .app (.app (.app (.const ``Eq _) _) lhsExpr) rhsExpr =>
    if sideIsRhs then
      let rwRes ← focusedRewriteExpr mvarId rhsExpr path h symm
      let α ← inferType rhsExpr
      let motive ← withLocalDeclD `_ α fun x => do
        let body ← mkEq lhsExpr x
        mkLambdaFVars #[x] body
      let targetNew ← mkEq lhsExpr rwRes.eNew
      let eqProof ← mkCongrArg motive rwRes.eqProof
      pure { targetNew, eqProof, mvarIds := rwRes.mvarIds }
    else
      let rwRes ← focusedRewriteExpr mvarId lhsExpr path h symm
      let α ← inferType lhsExpr
      let motive ← withLocalDeclD `_ α fun x => do
        let body ← mkEq x rhsExpr
        mkLambdaFVars #[x] body
      let targetNew ← mkEq rwRes.eNew rhsExpr
      let eqProof ← mkCongrArg motive rwRes.eqProof
      pure { targetNew, eqProof, mvarIds := rwRes.mvarIds }
  | _ =>
    throwError "drag_rw: selected target is not an equality"

private def tryFocusedRewrite (h : Ident) (symm : Bool) (sideIsRhs : Bool) (path : List Nat) : TacticM Bool := do
  let savedState ← saveState
  try
    let mvarId ← getMainGoal
    let target ← mvarId.getType
    let rwRes ← rewriteEqualitySide mvarId target h symm sideIsRhs path
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
      let rwRes ← rewriteEqualitySide mvarId targetDecl.type h symm sideIsRhs path
      replaceHypPreservingTarget mvarId targetDecl.fvarId rwRes.targetNew rwRes.eqProof rwRes.mvarIds
      pure true
  catch _ =>
    restoreState savedState
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
      | last :: _ => some <| (s!"{last.dropRight 1}").splitOn "," |>.filterMap String.toNat?
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
          unless ← isProp domain do
            throwError "click_goal: only proposition implications can be introduced by clicking.\n\
              goal : {goal}"
          throwError "click_goal: current goal is not directly clickable.\n\
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

syntax (name := click_prop) "click_prop" ident : tactic

@[tactic click_prop] def evalClickProp : Tactic := fun stx => do
  let h : Ident := ⟨stx[1]⟩
  withMainContext do
    let hDecl ← ((← getLCtx).findFromUserName? h.getId).getDM
      (throwError "click_prop: unknown identifier '{h.getId}'")
    let hType ← whnf hDecl.type
    match hType with
    | .app (.app (.const ``And _) _) _ =>
      let h1 : Ident := mkIdent (← freshUserName "left")
      let h2 : Ident := mkIdent (← freshUserName "right")
      evalTactic (← `(tactic| have $h1 := And.left $h))
      evalTactic (← `(tactic| have $h2 := And.right $h))
      evalTactic (← `(tactic| clear $h))
    | .app (.app (.const ``Or _) _) _ =>
      evalTacticString s!"cases {h.getId}"
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

example (P Q : Prop) (h : P ∧ Q) : P := by
  click_prop h
  exact left

example (P Q : Prop) (hp : P) (hq : Q) : P ∧ Q := by
  click_goal
  exact hp
  exact hq

example (P Q R : Prop) (h : P ∨ Q) (hp : P → R) (hq : Q → R) : R := by
  click_prop h
  · rename_i hp'
    exact hp hp'
  · rename_i hq'
    exact hq hq'

example (P Q : Prop) (h : P) : P ∨ Q := by
  click_goal_left
  exact h

example (P Q : Prop) (h : Q) : P ∨ Q := by
  click_goal_right
  exact h

example : 0 + 0 = 0 := by
  drag_rw_lhs [Nat.add_zero]
  click_goal

example : 0 ≠ 1 := by
  click_goal
  cases h

end Regression

end GameServer
