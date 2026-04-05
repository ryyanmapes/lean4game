import GameServer.EnvExtensions
import GameServer.GoalClick
import GameServer.InteractiveGoal
import GameServer.Hints
import GameServer.PremiseApplication
import I18n

open Lean
open Server
open Widget
open RequestM
open Meta
open Std

/-! ## GameGoal -/

namespace GameServer

structure FVarBijection where
  forward : HashMap FVarId FVarId
  backward : HashMap FVarId FVarId

instance : EmptyCollection FVarBijection := ⟨{},{}⟩

def FVarBijection.insert (bij : FVarBijection) (a b : FVarId) : FVarBijection :=
  ⟨bij.forward.insert a b, bij.backward.insert b a⟩

def FVarBijection.insert? (bij : FVarBijection) (a b : FVarId) : Option FVarBijection :=
  let a' := bij.forward.get? a
  let b' := bij.forward.get? b
  if (a' == none || a' == some b) && (b' == none || b' == some a)
  then some $ bij.insert a b
  else none

/-- Checks if `pattern` and `e` are equal up to FVar identities. -/
partial def matchExpr (pattern : Expr) (e : Expr) (bij : FVarBijection := {}) : Option FVarBijection :=
  match pattern, e with
  | .bvar i1, .bvar i2 => if i1 == i2 then bij else none
  | .fvar i1, .fvar i2 => bij.insert? i1 i2
  | .mvar _, .mvar _ => bij
  | .sort _u1, .sort _u2 => bij -- TODO?
  | .const n1 _ls1, .const n2 _ls2 =>
    if n1 == n2 then bij else none -- && (← (ls1.zip ls2).allM fun (l1, l2) => Meta.isLevelDefEq l1 l2)
  | .app f1 a1, .app f2 a2 =>
    some bij
      |> (Option.bind · (fun bij => matchExpr f1 f2 bij))
      |> (Option.bind · (fun bij => matchExpr a1 a2 bij))
  | .lam _ t1 b1 _, .lam _ t2 b2 _ =>
    some bij
      |> (Option.bind · (fun bij => matchExpr t1 t2 bij))
      |> (Option.bind · (fun bij => matchExpr b1 b2 bij))
  | .forallE _ t1 b1 _, .forallE _ t2 b2 _ =>
    some bij
      |> (Option.bind · (fun bij => matchExpr t1 t2 bij))
      |> (Option.bind · (fun bij => matchExpr b1 b2 bij))
  | .letE _ t1 v1 b1 _, .letE _ t2 v2 b2 _ =>
    some bij
      |> (Option.bind · (fun bij => matchExpr t1 t2 bij))
      |> (Option.bind · (fun bij => matchExpr v1 v2 bij))
      |> (Option.bind · (fun bij => matchExpr b1 b2 bij))
  | .lit l1, .lit l2 =>
    if l1 == l2 then bij else none
  | .proj i1 n1 e1, .proj i2 n2 e2 =>
    if i1 == i2 && n1 == n2 then matchExpr e1 e2 bij else none
  -- ignore mdata:
  | .mdata _ pattern', _ =>
    matchExpr pattern' e bij
  | _, .mdata _ e' =>
    matchExpr pattern e' bij
  | _, _ => none

/-- Check if each fvar in `patterns` has a matching fvar in `fvars` -/
def matchDecls (patterns : Array Expr) (fvars : Array Expr) (strict := true) (initBij : FVarBijection := {}) : MetaM (Option FVarBijection) := do
  -- We iterate through the array backwards hoping that this will find us faster results
  -- TODO: implement backtracking
  let mut bij := initBij
  for i in [:patterns.size] do
    let pattern := patterns[patterns.size - i - 1]!
    if bij.forward.contains pattern.fvarId! then
      continue
    for j in [:fvars.size] do
      let fvar := fvars[fvars.size - j - 1]!
      if bij.backward.contains fvar.fvarId! then
        continue

      if let some bij' := matchExpr
          (← instantiateMVars $ ← inferType pattern)
          (← instantiateMVars $ ← inferType fvar) bij then
        -- usedFvars := usedFvars.set! (fvars.size - j - 1) true
        bij := bij'.insert pattern.fvarId! fvar.fvarId!
        break
    if ! bij.forward.contains pattern.fvarId! then return none

  if !strict || fvars.all (fun fvar => bij.backward.contains fvar.fvarId!)
  then return some bij
  else return none

open Meta in
/-- Find all hints whose trigger matches the current goal -/
def findHints (goal : MVarId) (level : GameLevel) : MetaM (Array GameHint) := do
  goal.withContext do
    let hints ← level.hints.filterMapM fun hint => do
      openAbstractCtxResult hint.goal fun hintFVars hintGoal => do
        if let some fvarBij := matchExpr (← instantiateMVars $ hintGoal) (← instantiateMVars $ ← inferType $ mkMVar goal)
        then

          -- NOTE: This code for `hintFVarsNames` is also duplicated in the
          -- "Statement" command, where `hint.rawText` is created. They need to be matching.
          -- NOTE: This is a bit a hack of somebody who does not know how meta-programming works.
          -- All we want here is a list of `userNames` for the `FVarId`s in `hintFVars`...
          -- and we wrap them in `«{}»` here since I don't know how to do it later.
          let mut hintFVarsNames : Array Expr := #[]
          for fvar in hintFVars do
            let name₁ ← fvar.fvarId!.getUserName
            hintFVarsNames := hintFVarsNames.push <| Expr.fvar ⟨s!"«\{{name₁}}»"⟩

          let lctx := (← goal.getDecl).lctx -- the player's local context
          if let some bij ← matchDecls hintFVars lctx.getFVars
            (strict := hint.strict) (initBij := fvarBij)
          then
            let userFVars := hintFVars.map fun v => bij.forward.getD v.fvarId! v.fvarId!
            -- Evaluate the text in the player's context to get the new variable names.
            let text := (← evalHintMessage hint.text) (userFVars.map Expr.fvar)
            let ctx := {env := ← getEnv, mctx := ← getMCtx, lctx := lctx, opts := {}}
            let text ← (MessageData.withContext ctx text).toString

            -- Here we map the goal's variable names to the player's variable names.
            let mut varNames : Array <| Name × Name := #[]
            for (fvar₁, fvar₂) in bij.forward.toArray do
              -- get the `userName` of the fvar in the opened local context of the hint.
              let name₁ ← fvar₁.getUserName
              -- get the `userName` in the player's local context.
              let name₂ := (lctx.get! fvar₂).userName
              varNames := varNames.push (name₁, name₂)

            return some {
              text := text,
              hidden := hint.hidden,
              rawText := hint.rawText,
              varNames := varNames }

          else return none
        else
          return none
    return hints

def filterUnsolvedGoal (a : Array InteractiveDiagnostic) :
    Array InteractiveDiagnostic :=
  a.filter (fun d => match d.message with
  | .append ⟨(.tag (.expr (.text x)) _) :: _⟩ => x != "unsolved goals"
  | _ => true)

-- TODO: no need to have `RequestM`, just anything where `mut` works
/-- Add custom diagnostics about whether the level is completed. -/
def completionDiagnostics (goalCount : Nat) (prevGoalCount : Nat) (completed : Bool)
    (completedWithWarnings : Bool) (pos : Lsp.Position)
    (startDiags : Array InteractiveDiagnostic := #[]) :
    RequestM <| Array InteractiveDiagnostic := do
  let mut out : Array InteractiveDiagnostic := startDiags
  if goalCount == 0 then
    if completed then
      out := out.push {
        -- TODO: marking these with `t!` has the implication that every game
        -- needs to translate these messages again,
        -- but cannot think of another option
        -- that would not involve manually adding them somewhere in the translation files.
        message := .text t!"level completed! 🎉"
        range := {
          start := pos
          «end» := pos
          }
        severity? := Lsp.DiagnosticSeverity.information }
    else if completedWithWarnings then
      out := out.push {
        message := .text t!"level completed with warnings… 🎭"
        range := {
          start := pos
          «end» := pos
          }
        severity? := Lsp.DiagnosticSeverity.information }
    else
      pure ()
  else if goalCount < prevGoalCount then
    -- If there is any errors, goals might vanish without being 'solved'
    -- so showing the message "intermediate goal solved" would be confusing.
    if (¬ (filterUnsolvedGoal startDiags).any (·.severity? == some .error)) then
      out := out.push {
        message := .text t!"intermediate goal solved! 🎉"
        range := {
          start := pos
          «end» := pos
          }
        severity? := Lsp.DiagnosticSeverity.information
      }

  return out

private def trimStr (s : String) : String :=
  if s.startsWith " " then s!"{s.drop 1}" else s

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
    let fn := e'.getAppFn
    let va : Nat :=
      match fn.constName? >>= visibleArityForConst with
      | some v => v
      | none   => 1
    if k == 0 || k > va then
      throwError "drag_rw annotation: path position {k} out of range (node has {va} visible children)"
    let idx := flat.size - va + k - 1
    if h : idx < flat.size then
      navigateToSubterm flat[idx] rest
    else
      throwError "drag_rw annotation: path position {k} out of range (node has {va} visible children)"

private def parsePathNode (numsNode : Syntax) : List Nat :=
  numsNode.getArgs.toList.filterMap Syntax.isNatLit?

private structure ParsedDragRw where
  theoremStx : Syntax
  theoremName : Name
  reverse : Bool
  sideIsRhs : Bool
  path : Option (List Nat)
  source : String

private structure ParsedDragRwHyp where
  targetHypName : Name
  theoremStx : Syntax
  theoremName : Name
  reverse : Bool
  sideIsRhs : Bool
  path : Option (List Nat)
  source : String

private structure ParsedDragTo where
  sourceName : Name
  targetName : Name
  source : String

private structure ParsedDragGoal where
  hypName : Name
  source : String

private def parseDragTo? (src : String) : CoreM (Option ParsedDragTo) := do
  let src := src.trimAscii.toString
  let env ← getEnv
  match Lean.Parser.runParserCategory env `tactic src with
  | .error _ => pure none
  | .ok raw =>
    if !src.startsWith "drag_to " then
      return none
    let args := raw.getArgs
    let sourceStx := args[1]!
    let targetStx := args[2]!
    pure <| some {
      sourceName := (⟨sourceStx⟩ : Ident).getId
      targetName := (⟨targetStx⟩ : Ident).getId
      source := src
    }

private def parseDragGoal? (src : String) : CoreM (Option ParsedDragGoal) := do
  let src := src.trimAscii.toString
  let env ← getEnv
  match Lean.Parser.runParserCategory env `tactic src with
  | .error _ => pure none
  | .ok raw =>
    if !src.startsWith "drag_goal " then
      return none
    let hypStx := raw.getArgs[1]!
    pure <| some {
      hypName := (⟨hypStx⟩ : Ident).getId
      source := src
    }

private def parseDragRw? (src : String) : CoreM (Option ParsedDragRw) := do
  let src := src.trimAscii.toString
  let env ← getEnv
  match Lean.Parser.runParserCategory env `tactic src with
  | .error _ => pure none
  | .ok raw =>
    let args := raw.getArgs
    let mk (sideIsRhs : Bool) (path : Option (List Nat)) : Option ParsedDragRw :=
      let theoremStx := args[3]!
      some {
        theoremStx
        theoremName := (⟨theoremStx⟩ : Ident).getId
        reverse := !args[2]!.isNone
        sideIsRhs
        path
        source := src
      }
    if src.startsWith "drag_rw_rhs_at [" then
      pure <| mk true (some (parsePathNode args[6]!))
    else if src.startsWith "drag_rw_lhs_at [" then
      pure <| mk false (some (parsePathNode args[6]!))
    else if src.startsWith "drag_rw_rhs [" && src.endsWith "]" then
      pure <| mk true none
    else if src.startsWith "drag_rw_lhs [" && src.endsWith "]" then
      pure <| mk false none
    else
      pure none

private def parseDragRwHyp? (src : String) : CoreM (Option ParsedDragRwHyp) := do
  let src := src.trimAscii.toString
  let env ← getEnv
  match Lean.Parser.runParserCategory env `tactic src with
  | .error _ => pure none
  | .ok raw =>
    let args := raw.getArgs
    let mk (sideIsRhs : Bool) (path : Option (List Nat)) : Option ParsedDragRwHyp :=
      let targetHypStx := args[1]!
      let theoremStx := args[4]!
      some {
        targetHypName := (⟨targetHypStx⟩ : Ident).getId
        theoremStx
        theoremName := (⟨theoremStx⟩ : Ident).getId
        reverse := !args[3]!.isNone
        sideIsRhs
        path
        source := src
      }
    if src.startsWith "drag_rw_hyp_rhs_at " then
      pure <| mk true (some (parsePathNode args[7]!))
    else if src.startsWith "drag_rw_hyp_lhs_at " then
      pure <| mk false (some (parsePathNode args[7]!))
    else if src.startsWith "drag_rw_hyp_rhs " then
      pure <| mk true none
    else if src.startsWith "drag_rw_hyp_lhs " then
      pure <| mk false none
    else
      pure none

private def convAnnotationForParsed (rw : ParsedDragRw) : String :=
  let theoremText := if rw.reverse then s!"← {rw.theoremName}" else s!"{rw.theoremName}"
  match rw.path with
  | none => s!"rw [{theoremText}]"
  | some path =>
    let side := if rw.sideIsRhs then "rhs" else "lhs"
    let lines := ["conv =>", s!"  {side}"] ++ path.map (fun step => s!"  arg {step}") ++ [s!"  rw [{theoremText}]"]
    String.intercalate "\n" lines

private def annotationForParsedHyp (rw : ParsedDragRwHyp) : String :=
  let theoremText := if rw.reverse then s!"← {rw.theoremName}" else s!"{rw.theoremName}"
  match rw.path with
  | none =>
    s!"rw [{theoremText}] at {rw.targetHypName}"
  | some path =>
    let side := if rw.sideIsRhs then "rhs" else "lhs"
    let pathLines := path.map (fun step => s!"  arg {step}")
    let lines :=
      [s!"conv at {rw.targetHypName} =>", s!"  {side}"] ++ pathLines ++ [s!"  rw [{theoremText}]"]
    String.intercalate "\n" lines

private partial def countPatternOccurrences (e pattern : Expr) : MetaM Nat := do
  let savedMctx ← getMCtx
  let isMatch ← isDefEq e pattern
  setMCtx savedMctx
  let selfCount := if isMatch then 1 else 0
  match e.consumeMData with
  | .app f a =>
    return selfCount + (← countPatternOccurrences f pattern) + (← countPatternOccurrences a pattern)
  | .lam _ t b _ =>
    return selfCount + (← countPatternOccurrences t pattern) + (← countPatternOccurrences b pattern)
  | .forallE _ t b _ =>
    return selfCount + (← countPatternOccurrences t pattern) + (← countPatternOccurrences b pattern)
  | .letE _ t v b _ =>
    return selfCount + (← countPatternOccurrences t pattern) + (← countPatternOccurrences v pattern) + (← countPatternOccurrences b pattern)
  | .proj _ _ s =>
    return selfCount + (← countPatternOccurrences s pattern)
  | .mdata _ s =>
    return selfCount + (← countPatternOccurrences s pattern)
  | _ =>
    return selfCount

private def formatRwArg (s : String) : String :=
  if s.any Char.isWhitespace || s.contains '(' || s.contains ')' || s.contains '+' || s.contains '*' ||
      s.contains '-' || s.contains '/' || s.contains '='
  then s!"({s})"
  else s

private def resolveGlobalConstName? (name : Name) : MetaM (Option Name) := do
  try
    let resolvedNames ← resolveGlobalConst (mkIdent name)
    pure resolvedNames[0]?
  catch _ =>
    pure none

private def rwAnnotationForParsed? (rw : ParsedDragRw) (goal : MVarId) : MetaM (Option String) := goal.withContext do
  let savedMctx ← getMCtx
  try
    let target ← goal.getType
    let some (_, lhsExpr, rhsExpr) ← matchEq? target | return none
    let sideExpr := if rw.sideIsRhs then rhsExpr else lhsExpr
    let selectedExpr ← navigateToSubterm sideExpr (rw.path.getD [])

    let theoremType ←
      match (← getLCtx).findFromUserName? rw.theoremName with
      | some decl => pure decl.type
      | none =>
        let some resolvedName ← resolveGlobalConstName? rw.theoremName
          | return none
        let constExpr ← mkConstWithFreshMVarLevels resolvedName
        inferType constExpr

    let (mvars, binderInfos, body) ← forallMetaTelescopeReducing theoremType
    let some (_, lhsPat, rhsPat) ← matchEq? body
      | setMCtx savedMctx
        return none
    let fromPat := if rw.reverse then rhsPat else lhsPat
    unless ← isDefEq selectedExpr fromPat do
      setMCtx savedMctx
      return none
    let fromPat ← instantiateMVars fromPat
    if fromPat.hasMVar then
      setMCtx savedMctx
      return none

    let mut explicitArgs : Array String := #[]
    for i in [:mvars.size] do
      if binderInfos[i]!.isExplicit then
        let arg ← instantiateMVars mvars[i]!
        if arg.hasMVar then
          setMCtx savedMctx
          return none
        let argFmt ← ppExpr arg
        explicitArgs := explicitArgs.push (formatRwArg argFmt.pretty)

    setMCtx savedMctx
    let occs ← countPatternOccurrences target fromPat
    if occs != 1 then
      return none

    let theoremText :=
      let base := if rw.reverse then s!"← {rw.theoremName}" else s!"{rw.theoremName}"
      if explicitArgs.isEmpty then base else base ++ " " ++ String.intercalate " " explicitArgs.toList
    return some s!"rw [{theoremText}]"
  catch _ =>
    setMCtx savedMctx
    return none

private def rwAnnotationForParsedHyp? (rw : ParsedDragRwHyp) (goal : MVarId) : MetaM (Option String) := goal.withContext do
  let savedMctx ← getMCtx
  try
    let some decl := (← getLCtx).findFromUserName? rw.targetHypName | return none
    let target := decl.type
    let some (_, lhsExpr, rhsExpr) ← matchEq? target | return none
    let sideExpr := if rw.sideIsRhs then rhsExpr else lhsExpr
    let selectedExpr ← navigateToSubterm sideExpr (rw.path.getD [])

    let theoremType ←
      match (← getLCtx).findFromUserName? rw.theoremName with
      | some theoremDecl => pure theoremDecl.type
      | none =>
        let some resolvedName ← resolveGlobalConstName? rw.theoremName
          | return none
        let constExpr ← mkConstWithFreshMVarLevels resolvedName
        inferType constExpr

    let (mvars, binderInfos, body) ← forallMetaTelescopeReducing theoremType
    let some (_, lhsPat, rhsPat) ← matchEq? body
      | setMCtx savedMctx
        return none
    let fromPat := if rw.reverse then rhsPat else lhsPat
    unless ← isDefEq selectedExpr fromPat do
      setMCtx savedMctx
      return none
    let fromPat ← instantiateMVars fromPat
    if fromPat.hasMVar then
      setMCtx savedMctx
      return none

    let mut explicitArgs : Array String := #[]
    for i in [:mvars.size] do
      if binderInfos[i]!.isExplicit then
        let arg ← instantiateMVars mvars[i]!
        if arg.hasMVar then
          setMCtx savedMctx
          return none
        let argFmt ← ppExpr arg
        explicitArgs := explicitArgs.push (formatRwArg argFmt.pretty)

    setMCtx savedMctx
    let occs ← countPatternOccurrences target fromPat
    if occs != 1 then
      return none

    let theoremText :=
      let base := if rw.reverse then s!"← {rw.theoremName}" else s!"{rw.theoremName}"
      if explicitArgs.isEmpty then base else base ++ " " ++ String.intercalate " " explicitArgs.toList
    return some s!"rw [{theoremText}] at {rw.targetHypName}"
  catch _ =>
    setMCtx savedMctx
    return none

private def dragToAnnotationForParsed? (drag : ParsedDragTo) (goal : MVarId) :
    MetaM (Option String) := goal.withContext do
  let resolveNamedExprAndType? := fun name => do
    match (← getLCtx).findFromUserName? name with
    | some decl => pure (some (mkFVar decl.fvarId, decl.type, true))
    | none =>
      let some resolvedName ← resolveGlobalConstName? name | return none
      let constExpr ← mkConstWithFreshMVarLevels resolvedName
      pure (some (constExpr, (← inferType constExpr), false))
  let some (sourceExpr, sourceTypeRaw, sourceIsLocal) ← resolveNamedExprAndType? drag.sourceName | return none
  let some (targetExpr, targetTypeRaw, targetIsLocal) ← resolveNamedExprAndType? drag.targetName | return none
  let sourceType ← whnf sourceTypeRaw
  let targetType ← whnf targetTypeRaw

  let mkPremiseReplacement? := fun _ implicationExpr implicationType premiseName premiseExpr premiseType premiseIsLocal => do
    let some applied ← GameServer.mkPremiseApplication? implicationExpr implicationType premiseExpr premiseType
      | return none
    let appText ← ppExpr applied
    if premiseIsLocal then
      -- Lean 4 no longer supports `apply ... at ...`; shadow the premise name instead.
      return some s!"have {premiseName} := {appText.pretty}"
    else
      return some s!"have := {appText.pretty}"

  if let some ann ← mkPremiseReplacement? drag.targetName targetExpr targetType drag.sourceName sourceExpr sourceType sourceIsLocal then
    return some ann

  if let some ann ← mkPremiseReplacement? drag.sourceName sourceExpr sourceType drag.targetName targetExpr targetType targetIsLocal then
    return some ann

  return none

private def dragGoalAnnotationForParsed? (drag : ParsedDragGoal) (goal : MVarId) :
    MetaM (Option String) := goal.withContext do
  let hypTypeRaw ←
    match (← getLCtx).findFromUserName? drag.hypName with
    | some decl => pure (some decl.type)
    | none =>
      let some resolvedName ← resolveGlobalConstName? drag.hypName | return none
      let constExpr ← mkConstWithFreshMVarLevels resolvedName
      pure (some (← inferType constExpr))
  let some hypTypeRaw := hypTypeRaw | return none
  let hypType ← whnf hypTypeRaw
  let goalType ← whnf (← goal.getType)

  if ← isDefEq hypType goalType then
    return some s!"exact {drag.hypName}"

  if let .forallE _ _ body _ := hypType then
    if ← isDefEq body goalType then
      return some s!"apply {drag.hypName}"

  if let .app (.app (.app (.const ``Eq _) _) lhsExpr) rhsExpr := hypType then
    let lhsOccs ← countPatternOccurrences goalType lhsExpr
    if lhsOccs == 1 then
      return some s!"rw [{drag.hypName}]"
    let rhsOccs ← countPatternOccurrences goalType rhsExpr
    if rhsOccs == 1 then
      return some s!"rw [← {drag.hypName}]"

  return none

/-- Extract the first payload between `[` and `]` after splitting on `[`. -/
private def bracketPayload? (part : String) : Option String :=
  match part.splitOn "]" with
  | payload :: _ => some (trimStr payload)
  | _ => none

/-- Render explicit drag rewrite commands as Lean tactics for the proof panel. -/
private def convAnnotationForDragRw? (src : String) : Option String :=
  let mkRw := fun inner => some s!"rw [{inner}]"
  let mkConv := fun side inner rawPath =>
    let steps := rawPath.splitOn "," |>.map trimStr |>.filter (fun step => !step.isEmpty)
    let lines := ["conv =>", s!"  {side}"] ++ steps.map (fun step => s!"  arg {step}") ++ [s!"  rw [{inner}]"]
    some <| String.intercalate "\n" lines
  if src.startsWith "drag_rw_rhs_at [" then
    match src.splitOn "[" with
    | _ :: theoremPart :: pathPart :: _ =>
      match bracketPayload? theoremPart, bracketPayload? pathPart with
      | some inner, some rawPath => mkConv "rhs" inner rawPath
      | _, _ => none
    | _ => none
  else if src.startsWith "drag_rw_lhs_at [" then
    match src.splitOn "[" with
    | _ :: theoremPart :: pathPart :: _ =>
      match bracketPayload? theoremPart, bracketPayload? pathPart with
      | some inner, some rawPath => mkConv "lhs" inner rawPath
      | _, _ => none
    | _ => none
  else if src.startsWith "drag_rw_rhs [" && src.endsWith "]" then
    mkRw (s!"{(src.drop 13).dropRight 1}")
  else if src.startsWith "drag_rw_lhs [" && src.endsWith "]" then
    mkRw (s!"{(src.drop 13).dropRight 1}")
  else
    none

private def freshUserName (base : String) : MetaM Name := do
  let lctx ← getLCtx
  let mut idx := 0
  let mut candidate := Name.mkSimple base
  while lctx.findFromUserName? candidate |>.isSome do
    idx := idx + 1
    candidate := Name.mkSimple s!"{base}{idx}"
  pure candidate

private def clickGoalAnnotation? (goal : MVarId) : MetaM (Option String) := goal.withContext do
  let target ← goal.getType
  let targetWhnf ← withReducible (whnf target)
  match ← clickGoalKind? target with
  | some .completeByRfl =>
      pure (some "rfl")
  | some .introVar =>
      match targetWhnf with
      | .forallE binderName domain _ _ =>
          if ← isProp domain then
            pure (some "intro")
          else if binderName.isAnonymous then
            pure (some "intro")
          else
            let nextName ← freshUserName binderName.toString
            pure <| some s!"intro {nextName}"
      | _ =>
          pure (some "intro")
  | some .introProp =>
      let hName ← freshUserName "h"
      pure <| some s!"intro {hName}"
  | some .splitAnd =>
      pure (some "constructor")
  | _ =>
      pure none

private def clickPropAnnotation? (goal : MVarId) (hypName : Name) : MetaM (Option String) := goal.withContext do
  let some decl := (← getLCtx).findFromUserName? hypName | return none
  let hypType ← withReducible (whnf decl.type)
  match hypType with
  | .app (.app (.const ``And _) _) _ =>
      let h1 ← freshUserName "left"
      let h2 ← freshUserName "right"
      pure <| some s!"have {h1} := And.left {hypName}; have {h2} := And.right {hypName}; clear {hypName}"
  | .app (.app (.const ``Or _) _) _ =>
      pure <| some s!"cases {hypName}"
  | _ =>
      pure none

/-- Derive a `StepAnnotation` from a raw proof-step source string.
    - `drag_rw_rhs [h]`                → `rw [h]`
    - `drag_rw_rhs_at [h] [1,2]`       → conv-style annotation
    - legacy `drag_rw [h] at [...]`    → annotation with `leanTactic := none`
    - other `drag_*`                   → annotation with `leanTactic := none`
    - anything else                    → no annotation -/
private def annotateFromSourceSimple (source : String) : Option StepAnnotation :=
  let src := source.trimAscii.toString
  if let some convSrc := convAnnotationForDragRw? src then
    some { playTactic := src, leanTactic := some convSrc }
  -- Legacy path-based rewrite without explicit side — leanTactic deferred
  else if src.startsWith "drag_rw [" && (src.splitOn "] at [").length > 1 then
    some { playTactic := src, leanTactic := none }
  -- Simple rewrite: drag_rw [h] or drag_rw [← h]
  else if src.startsWith "drag_rw [" && src.endsWith "]" then
    let inner := (src.drop 9).dropRight 1   -- content between the brackets, e.g. "h" or "← h"
    some { playTactic := src, leanTactic := some s!"rw [{inner}]" }
  else if src.startsWith "drag_" then
    some { playTactic := src, leanTactic := none }
  else if src == "click_goal_left" then
    some { playTactic := src, leanTactic := some "left" }
  else if src == "click_goal_right" then
    some { playTactic := src, leanTactic := some "right" }
  else
    none

private partial def parseFocusedPlayTactic? (source : String) :
    Option (List (String × String) × String) :=
  let rec loop (src : String) (focusedCasesRev : List (String × String)) :
      Option (List (String × String) × String) :=
    let src := src.trimAscii.toString
    let prefix? :=
      if src.startsWith "case' " then
        some ("case'", 6)
      else if src.startsWith "case " then
        some ("case", 5)
      else
        none
    if prefix?.isNone then
      if src.isEmpty then none else some (focusedCasesRev.reverse, src)
    else
      let (keyword, prefixLen) := prefix?.get!
      let rest := (src.drop prefixLen).toString
      let parts := rest.splitOn "=>"
      match parts with
      | [] => none
      | caseName :: innerParts =>
          if innerParts.isEmpty then
            none
          else
            let caseName : String := caseName.trimAscii.toString
            let inner := (String.intercalate "=>" innerParts).trimAscii.toString
            if caseName.isEmpty || inner.isEmpty then
              none
            else
              loop inner ((keyword, caseName) :: focusedCasesRev)
  loop source []

private def rewrapFocusedAnnotation
    (originalSource : String) (focusedCases : List (String × String))
    (annotation? : Option StepAnnotation) :
    Option StepAnnotation :=
  annotation?.map fun annotation =>
    let leanTactic? :=
      match annotation.leanTactic with
      | some leanTactic =>
          some <|
            focusedCases.foldr
              (fun (wrapper, caseName) inner => s!"{wrapper} {caseName} => {inner}")
              leanTactic
      | none => none
    { annotation with playTactic := originalSource, leanTactic := leanTactic? }

private def annotateFromSource (source : String) (goalBefore? : Option MVarId := none) :
    MetaM (Option StepAnnotation) := do
  let source := source.trimAscii.toString
  let (focusedCases, innerSource) :=
    match parseFocusedPlayTactic? source with
    | some (focusedCases, innerSource) => (focusedCases, innerSource)
    | none => ([], source)
  let annotation? ←
    try
      match goalBefore? with
      | some goal =>
        if let some rw := (← parseDragRw? innerSource) then
          let leanTactic? ←
            match rw.path with
            | some _ =>
              match ← rwAnnotationForParsed? rw goal with
              | some rwSrc => pure (some rwSrc)
              | none => pure (some (convAnnotationForParsed rw))
            | none =>
              pure (some (convAnnotationForParsed rw))
          pure <| some { playTactic := innerSource, leanTactic := leanTactic? }
        else if let some rw := (← parseDragRwHyp? innerSource) then
          let leanTactic? ←
            match rw.path with
            | some _ =>
              match ← rwAnnotationForParsedHyp? rw goal with
              | some rwSrc => pure (some rwSrc)
              | none => pure (some (annotationForParsedHyp rw))
            | none =>
              pure (some (annotationForParsedHyp rw))
          pure <| some { playTactic := innerSource, leanTactic := leanTactic? }
        else if let some drag := (← parseDragTo? innerSource) then
          let leanTactic? ← dragToAnnotationForParsed? drag goal
          pure <| some { playTactic := innerSource, leanTactic := leanTactic? }
        else if let some drag := (← parseDragGoal? innerSource) then
          let leanTactic? ← dragGoalAnnotationForParsed? drag goal
          pure <| some { playTactic := innerSource, leanTactic := leanTactic? }
        else if innerSource == "click_goal" then
          let leanTactic? ← clickGoalAnnotation? goal
          pure <| some { playTactic := innerSource, leanTactic := leanTactic? }
        else if innerSource == "click_goal_left" then
          pure <| some { playTactic := innerSource, leanTactic := some "left" }
        else if innerSource == "click_goal_right" then
          pure <| some { playTactic := innerSource, leanTactic := some "right" }
        else if innerSource.startsWith "click_prop " then
          let leanTactic? ← clickPropAnnotation? goal (Name.mkSimple (innerSource.drop 11).toString)
          pure <| some { playTactic := innerSource, leanTactic := leanTactic? }
        else
          pure (annotateFromSourceSimple innerSource)
      | none =>
        pure (annotateFromSourceSimple innerSource)
    catch _ =>
      pure (annotateFromSourceSimple innerSource)
  pure <| rewrapFocusedAnnotation source focusedCases annotation?

/-- Fold a `Nat.succ`/`Nat.zero` constructor chain (already in WHNF) back to a numeric
    literal.  Used after `withReducible (whnf e)` to collapse `succ(succ(0))` to `.lit 2`
    when the expression was already in that form in the source (e.g. the rhs of
    `two_eq_succ_succ`).  We do NOT fold `OfNat.ofNat` applications here; those are
    handled up-front in `exprToTree` so that a numeral like `2` is kept as `.lit 2`
    without ever being unfolded. -/
private def natLitFromSuccChain? : Expr → Option Nat
  | .lit (.natVal n)              => some n
  | .const ``Nat.zero _           => some 0
  | .app (.const ``Nat.succ _) a  => natLitFromSuccChain? a >>= (some ∘ (· + 1))
  -- Also fold OfNat.ofNat when it appears inside a succ-chain (e.g. succ(OfNat.ofNat _ 3 _))
  -- in case withReducible whnf didn't unfold it and the up-front check below was bypassed.
  | .app (.app (.app (.const ``OfNat.ofNat _) _) (.lit (.natVal n))) _ => some n
  | _                             => none

private def prettyExprString (e : Expr) : MetaM String := do
  return (← ppExpr e).pretty.trimAscii.toString

private def parenthesize (s : String) : String :=
  if s.startsWith "(" && s.endsWith ")" then s else s!"({s})"

private def implicationToFalseDomain? : Expr → Option Expr
  | .forallE _ domain body _ =>
      match body.consumeMData with
      | .const ``False _ => some domain
      | _ => none
  | _ => none

private def tooltipVariantsForExpr (e : Expr) : MetaM (Array String) := do
  match implicationToFalseDomain? (e.consumeMData) with
  | some domain =>
      let domainStr ← prettyExprString domain
      let wrapped := parenthesize domainStr
      pure #[s!"¬ {wrapped}", s!"{wrapped} → False"]
  | none =>
      pure #[← prettyExprString e]

private def pushReductionForm (forms : Array String) (original form : String) : Array String :=
  let form := form.trimAscii.toString
  if form.isEmpty || form == original || forms.contains form then
    forms
  else
    forms.push form

private def maxReductionTooltipSteps : Nat := 8

private def reductionFormsForExpr (e : Expr) : MetaM (Array String) := do
  let original ← prettyExprString e
  let mut forms : Array String := #[]
  let mut current ← instantiateMVars e
  current := current.consumeMData
  for _ in [:maxReductionTooltipSteps] do
    for form in (← tooltipVariantsForExpr current) do
      forms := pushReductionForm forms original form
    let next ← whnf current
    let next ← instantiateMVars next
    let next := next.consumeMData
    if next == current then
      break
    current := next
  pure forms

/-- Walk an `Expr` and convert to `ExprTree`, preserving the surface-level form of the
    expression as closely as possible — matching what NNG4's non-visual infoview shows.

    Key design decisions:
    - `OfNat.ofNat _ n _` is recognised up-front (before any reduction) and returned as
      `.lit n`.  This keeps numeric literals like `2` as `.lit 2` without unfolding them
      into their `succ`-chain representation, mirroring how `ppExpr` displays them.
    - After the up-front literal check we call `withReducible (whnf e)`.  Using reducible
      transparency (rather than the default semireducible/transparent level) matches the
      same reducibility level as NNG4's `rfl` tactic.  Concretely this means that
      `succ(succ(0))` and `2` are kept as distinct trees — just as `rfl` cannot close
      `2 = succ(succ(0))` in NNG4.
    - `natLitFromSuccChain?` is still applied after the reducible whnf so that an
      expression that was already a `succ`-chain in the source (e.g. the rhs of
      `two_eq_succ_succ`) is folded back to a numeric literal. -/
partial def exprToTree (e : Expr) : MetaM ExprTree := do
  -- Strip metadata wrappers first so that all subsequent pattern matches see the
  -- bare expression.  Sub-expressions can carry MData (e.g. source positions or
  -- display hints) that would otherwise prevent the OfNat.ofNat check below from
  -- firing when `exprToTree` is called recursively on an argument.
  let e := e.consumeMData
  -- Recognise `@OfNat.ofNat _ n _` before any reduction so that numeric literals
  -- (e.g. `2 : MyNat`) are serialised as `.lit n` without being unfolded.
  if let .app (.app (.app (.const ``OfNat.ofNat _) _) (.lit (.natVal n))) _ := e then
    return .lit n
  -- Also handle a bare `Expr.lit` (shouldn't appear at top level in practice, but safe).
  if let .lit (.natVal n) := e then return .lit n
  -- Reduce at reducible transparency only, matching NNG4's `rfl` behaviour.
  let e ← withReducible (whnf e)
  if let some n := natLitFromSuccChain? e then return .lit n
  match e with
  | .lit (.natVal n) => return .lit n
  | .fvar id         =>
      -- Use the local context directly rather than `id.getDecl`, which throws for
      -- fvars that are outside the goal's local context (e.g. typeclass instance fvars
      -- that `withReducible whnf` no longer unfolds to their concrete implementation).
      match (← getLCtx).find? id with
      | some decl => return .fvar decl.userName.toString
      | none      => return .other (← ppExpr e).pretty
  | .const name _    => return .const name.toString
  | .app f a         => return .app (← exprToTree f) (← exprToTree a)
  | _                => return .other (← ppExpr e).pretty

/-- If `e` is `@Eq α lhs rhs`, return an `EqualityTree` with both sides serialized.
    `isRefl` is true when `lhs` and `rhs` are reducibly definitionally equal (goal is `rfl`
    under `withReducible`, matching NNG4's custom `rfl` tactic). -/
def tryEqualityTree (e : Expr) : MetaM (Option EqualityTree) := do
  match e.consumeMData with
  | .app (.app (.app (.const ``Eq _) _) lhs) rhs =>
      let lhsTree ← exprToTree lhs
      let rhsTree ← exprToTree rhs
      let isRefl  ← withReducible (isDefEq lhs rhs)
      return some { lhs := lhsTree, rhs := rhsTree, isRefl }
  | _ => return none

private def isReflexiveEqualityProp (e : Expr) : MetaM Bool := do
  let e ← withReducible (whnf e)
  match e.consumeMData with
  | .app (.app (.app (.const ``Eq _) _) lhs) rhs =>
      withReducible (isDefEq lhs rhs)
  | _ =>
      pure false

private def isReflexiveEqualityImplication (e : Expr) : MetaM Bool := do
  match e.consumeMData with
  | .forallE _ domain _ _ =>
      if !(← isProp domain) then
        return false
      isReflexiveEqualityProp domain
  | _ =>
      pure false

/-- If `e` is (or unfolds to) `@Exists α (fun x => body)`, return the bound variable name and
    a pretty-printed body string.  Uses default-transparency `whnf` so that definitions like
    `Nat.le` (which is `∃ k, n + k = m` in NNG4) are unfolded even if not `@[reducible]`. -/
private def tryExistsInfoFromExpr (e : Expr) : MetaM (Option ExistsInfo) := do
  match e.consumeMData with
  | .app (.app (.const ``Exists _) _) pred =>
      Meta.lambdaTelescope pred fun fvars body => do
        match fvars[0]? with
        | none => return none
        | some fvar =>
            let varName := (← fvar.fvarId!.getDecl).userName.toString
            let bodyStr := (← ppExpr body).pretty
            return some { varName, body := bodyStr }
  | _ => return none

def tryExistsInfo (e : Expr) : MetaM (Option ExistsInfo) := do
  if let some info ← tryExistsInfoFromExpr e then return some info
  tryExistsInfoFromExpr (← whnf e)

private def directClickAction (playTactic tooltip : String) : ClickAction :=
  { playTactic? := some playTactic, tooltip? := some tooltip }

private def splitClickAction (playTactic tooltip : String) : ClickAction :=
  { playTactic? := some playTactic, tooltip? := some tooltip, streamSplit? := some true }

private def goalClickAction? (goal : MVarId) : MetaM (Option ClickAction) := goal.withContext do
  let target ← goal.getType
  match ← clickGoalKind? target with
  | some .completeByRfl =>
      pure <| some (directClickAction "click_goal" "Click to complete")
  | some .introVar =>
      pure <| some (directClickAction "click_goal" "Click to introduce variable")
  | some .introProp =>
      pure <| some (directClickAction "click_goal" "Click to introduce assumption")
  | some .splitAnd =>
      pure <| some (splitClickAction "click_goal" "Click to split conjunction")
  | _ =>
      let targetWhnf ← withReducible (whnf target)
      match targetWhnf with
      | .app (.app (.const ``Or _) lhs) rhs =>
          pure <| some {
            tooltip? := some "Choose which side to prove"
            options := #[
              {
                label := "Left"
                playTactic := "click_goal_left"
                previewText? := some (← ppExpr lhs).pretty
              },
              {
                label := "Right"
                playTactic := "click_goal_right"
                previewText? := some (← ppExpr rhs).pretty
              }
            ]
          }
      | _ =>
          pure none

private def hypClickAction? (hypName : String) (fvarId : FVarId) : MetaM (Option ClickAction) := do
  let hypTypeExpr ← inferType (.fvar fvarId)
  let hypType ← withReducible (whnf hypTypeExpr)
  match hypType with
  | .app (.app (.const ``And _) _) _ =>
      pure <| some (directClickAction s!"click_prop {hypName}" "Click to split conjunction")
  | .app (.app (.const ``Or _) _) _ =>
      pure <| some (splitClickAction s!"click_prop {hypName}" "Click to split into cases")
  | _ =>
      if ← isReflexiveEqualityImplication hypType then
        pure <| some (directClickAction s!"click_prop {hypName}" "Click to specialize with rfl")
      else
        -- For existentials, also try default-transparency whnf so that non-reducible definitions
        -- that expand to `∃ x, P x` (e.g. `MyNat.le`) are detected.
        let hypTypeFull ← whnf hypTypeExpr
        match hypTypeFull with
        | .app (.app (.const ``Exists _) _) _ =>
            pure <| some (directClickAction s!"click_prop {hypName}" "Click to introduce witness and condition")
        | _ =>
            if ← isReflexiveEqualityImplication hypTypeFull then
              pure <| some (directClickAction s!"click_prop {hypName}" "Click to specialize with rfl")
            else
              pure none

private def interactiveGoalWithHintsForGoal (levelId : LevelId) (goal : MVarId) :
    MetaM InteractiveGoalWithHints := do
  let some level ← getLevel? levelId
    | throwError "Level not found"
  let hints ← findHints goal level
  let interactiveGoal ← goalToInteractive goal
  -- Populate equalityTree? for hyps and the goal itself.
  -- Both must be inside `goal.withContext` so that the MetaM local context
  -- contains the goal's fvars when `exprToTree` calls `withReducible (whnf ·)`.
  let (interactiveGoalWithTrees, goalTree, goalExistsInfo, goalReductionForms) ← goal.withContext do
    let mut hypsWithTrees : Array InteractiveHypothesisBundle := #[]
    for hypBundle in interactiveGoal.hyps do
      let fvarIds := hypBundle.fvarIds
      let count := Nat.min hypBundle.names.size fvarIds.size
      if count == 0 then
        hypsWithTrees := hypsWithTrees.push {
          hypBundle with
          equalityTree? := none
          reductionForms := #[]
          clickAction? := none
        }
      else
        for i in [:count] do
          let name := hypBundle.names[i]!
          let fvarId := fvarIds[i]!
          let eqTree ← tryEqualityTree (← inferType (.fvar fvarId))
          let reductionForms ← reductionFormsForExpr (← inferType (.fvar fvarId))
          let clickAction ← hypClickAction? name fvarId
          hypsWithTrees := hypsWithTrees.push {
            hypBundle with
            names := #[name]
            fvarIds := #[fvarId]
            equalityTree? := eqTree
            reductionForms := reductionForms
            clickAction? := clickAction
          }
    let goalTree ← tryEqualityTree (← goal.getType)
    let goalExistsInfo ← tryExistsInfo (← goal.getType)
    let goalReductionForms ← reductionFormsForExpr (← goal.getType)
    let goalClickAction ← goalClickAction? goal
    return ({ interactiveGoal with
      hyps := hypsWithTrees
      reductionForms := goalReductionForms
      clickAction? := goalClickAction
    }, goalTree, goalExistsInfo, goalReductionForms)
  return {
    goal := interactiveGoalWithTrees
    hints := hints
    equalityTree? := goalTree
    existsInfo? := goalExistsInfo
    reductionForms := goalReductionForms
  }

private def interactiveGoalsWithHintsForMVars (levelId : LevelId) (goalMvars : List MVarId) :
    MetaM (List InteractiveGoalWithHints) :=
  goalMvars.mapM (interactiveGoalWithHintsForGoal levelId)

structure ProofStateParams extends Lsp.PlainGoalParams where
  worldId: String
  levelId: Nat
  deriving FromJson, ToJson

private structure ProofLineSource where
  startPos : String.Pos.Raw
  endPos : String.Pos.Raw
  source : String
  deriving Inhabited

private def proofLineGoalPos (text : Lean.FileMap) (lineInfo : ProofLineSource) : String.Pos.Raw := Id.run do
  let mut pos := lineInfo.startPos
  let mut lastNonWhitespace := lineInfo.startPos
  while pos < lineInfo.endPos do
    let nextPos := pos.next text.source
    if !(pos.get text.source).isWhitespace then
      lastNonWhitespace := nextPos
    pos := nextPos
  return lastNonWhitespace

/-- Request that returns the goals at the end of each line of the tactic proof
plus the diagnostics (i.e. warnings/errors) for the proof.
 -/
def getProofState (p : ProofStateParams) : RequestM (RequestTask (Option ProofState)) := do
  let doc ← readDoc
  let rc ← readThe RequestContext
  let text := doc.meta.text

  bindTaskCostly doc.cmdSnaps.waitAll fun (snaps, _) => do
    mapTaskCostly doc.reporter fun () => do
      let some game := rc.initParams.rootUri?
        | return none
      let levelId := {game := game, world := p.worldId, level := p.levelId}
      let mut steps : Array <| InteractiveGoalsWithHints := #[]
      let mut diag : Array InteractiveDiagnostic ← doc.diagnosticsRef.get

      -- Level is completed if there are no errors or warnings
      let completedWithWarnings : Bool := ¬ diag.any (·.severity? == some .error)
      let completed : Bool := completedWithWarnings ∧ ¬ diag.any (·.severity? == some .warning)

      let mut intermediateGoalCount := 0

      let positionsWithSource : Array ProofLineSource := Id.run do
        let mut res := #[]
        for i in [0:text.positions.size] do
          --TODO(ALEX): Generalize for other start positions
          let PROOF_START_LINE := 2
          if i < PROOF_START_LINE then continue -- skip problem statement
          -- for some reason, the client expects an empty tactic in the beginning
          if i == PROOF_START_LINE then
            res := res.push {
              startPos := text.positions[i]!
              endPos := text.positions[i]!
              source := ""
            }
          if i >= text.positions.size - 2 then continue -- skip final linebreak
          let source : String :=
            Substring.Raw.toString ⟨text.source, text.positions[i]!, text.positions[i + 1]!⟩
          if source.trimAscii.isEmpty then continue -- skip empty lines
          res := res.push {
            startPos := text.positions[i]!
            endPos := text.positions[i + 1]!
            source := source
          }
        return res

      -- Drop the last position as we ensured that there is always a newline at the end
      for (lineInfo, i) in positionsWithSource.zipIdx do
        -- iterate over all steps in the proof and get the goals and hints at each position
        let pos := lineInfo.endPos
        let goalPos := proofLineGoalPos text lineInfo
        let source := lineInfo.source

        -- diags are labeled in Lsp-positions, which differ from the lean-internal
        -- positions by `1`.
        let lspPosAt := text.utf8PosToLspPos pos

        let diagsAtPos : Array InteractiveDiagnostic :=
          -- `+1` for getting the errors after the line.
          match i with
          | 0 =>
            -- `lspPosAt` is `(0, 0)`
            diag.filter (fun d => d.range.start == lspPosAt )
          | i' + 1 =>
            diag.filter (fun d =>
              ((text.utf8PosToLspPos <| (positionsWithSource[i']!).endPos) ≤ d.range.start) ∧
              d.range.start < lspPosAt )

        let diagsAtPos := filterUnsolvedGoal diagsAtPos


        let some snap := snaps.find? (fun snap => snap.endPos >= goalPos)
          | panic! "No snap found"
        let goalsAtEndResult := snap.infoTree.goalsAt? doc.meta.text goalPos
        let goalsAtStartResult := snap.infoTree.goalsAt? doc.meta.text lineInfo.startPos
        let endResultsAfter := goalsAtEndResult.filter (fun result => result.useAfter)
        let startResultsAfter := goalsAtStartResult.filter (fun result => result.useAfter)
        let sourceTrimmed := source.trimAscii.toString
        let prefersStartAfterFallback :=
          sourceTrimmed.startsWith "drag_rw" || sourceTrimmed.startsWith "drag_rw_hyp"
        let goalsAtPreferredResult :=
          if prefersStartAfterFallback then
            match endResultsAfter with
            | _ :: _ => endResultsAfter
            | [] =>
                match startResultsAfter with
                | _ :: _ => startResultsAfter
                | [] =>
                    match goalsAtEndResult with
                    | _ :: _ => goalsAtEndResult
                    | [] => goalsAtStartResult
          else
            match endResultsAfter with
            | _ :: _ => endResultsAfter
            | [] =>
                match goalsAtEndResult with
                | _ :: _ => goalsAtEndResult
                | [] =>
                    match startResultsAfter with
                    | _ :: _ => startResultsAfter
                    | [] => goalsAtStartResult
        let annotateUsingResult := fun goalsAtResult => do
          match goalsAtResult.getLast? with
          | some { ctxInfo := ci, tacticInfo := tacticInfo, .. } =>
              let ciBefore := { ci with mctx := tacticInfo.mctxBefore }
              ciBefore.runMetaM {} do
                annotateFromSource source tacticInfo.goalsBefore.head?
          | none =>
              pure none
        let endAnnotation ← annotateUsingResult goalsAtEndResult
        let startAnnotation ← annotateUsingResult goalsAtStartResult
        let annotation :=
          match endAnnotation, startAnnotation with
          | some primary, some fallback =>
              if primary.leanTactic.isSome || fallback.leanTactic.isNone then
                some primary
              else
                some fallback
          | some primary, none =>
              some primary
          | none, some fallback =>
              some fallback
          | none, none =>
              annotateFromSourceSimple source
        if let goalsAtResult@(_ :: _) := goalsAtPreferredResult then
          let goalsAtPos' : List <| List InteractiveGoalWithHints ← goalsAtResult.mapM
            fun { ctxInfo := ci, tacticInfo := tacticInfo, useAfter := useAfter, .. } => do
              -- TODO: What does this function body do?
              -- let ciAfter := { ci with mctx := ti.mctxAfter }
              let ci := if useAfter then
                  { ci with mctx := tacticInfo.mctxAfter }
                else
                  { ci with mctx := tacticInfo.mctxBefore }
              -- compute the interactive goals
              let goalMvars : List MVarId ← ci.runMetaM {} do
                return if useAfter then tacticInfo.goalsAfter else tacticInfo.goalsBefore

              ci.runMetaM {} do
                interactiveGoalsWithHintsForMVars levelId goalMvars
          let goalsAtPos : Array InteractiveGoalWithHints := ⟨goalsAtPos'.foldl (· ++ ·) []⟩
          let focusedGoals ←
            match goalsAtResult.getLast? with
            | some { ctxInfo := ci, tacticInfo := tacticInfo, useAfter := useAfter, .. } =>
                let ci := if useAfter then
                    { ci with mctx := tacticInfo.mctxAfter }
                  else
                    { ci with mctx := tacticInfo.mctxBefore }
                let goalMvars : List MVarId ← ci.runMetaM {} do
                  return if useAfter then tacticInfo.goalsAfter else tacticInfo.goalsBefore
                let focusedGoals : List InteractiveGoalWithHints ← ci.runMetaM {} do
                  interactiveGoalsWithHintsForMVars levelId goalMvars
                pure focusedGoals.toArray
            | none =>
                pure #[]

          let diagsAtPos ← completionDiagnostics goalsAtPos.size intermediateGoalCount
            completed completedWithWarnings lspPosAt diagsAtPos

          intermediateGoalCount := goalsAtPos.size

          steps := steps.push {
            goals := goalsAtPos
            focusedGoals := focusedGoals
            command := source
            diags := diagsAtPos
            line := some lspPosAt.line
            column := some lspPosAt.character
            annotation? := annotation
          }
        else
          -- No goals present
          steps := steps.push {
            goals := #[]
            focusedGoals := #[]
            command := source
            diags := diagsAtPos
            line := some lspPosAt.line
            column := none
            annotation? := annotation
          }

      -- Filter out the "unsolved goals" message
      diag := filterUnsolvedGoal diag

      let lastPos := text.utf8PosToLspPos positionsWithSource.back!.endPos
      let remainingDiags : Array InteractiveDiagnostic :=
        diag.filter (fun d => lastPos ≤ d.range.start)

      let completedWithWarnings := completedWithWarnings ∧ intermediateGoalCount == 0
      let completed := completed ∧ intermediateGoalCount == 0

      return some {
        steps := steps,
        diagnostics := remainingDiags,
        completed := completed,
        completedWithWarnings := completedWithWarnings,
        lastPos := lastPos.line
      }

open RequestM in

-- The editor apparently uses this
def getInteractiveGoals (p : Lsp.PlainGoalParams) : RequestM (RequestTask (Option <| InteractiveGoals)) := do
  let doc ← readDoc
  -- let rc ← readThe RequestContext
  let text := doc.meta.text
  let hoverPos := text.lspPosToUtf8Pos p.position
  -- TODO: I couldn't find a good condition to find the correct snap. So we are looking
  -- for the first snap with goals here:
  withWaitFindSnap doc (fun s => ¬ (s.infoTree.goalsAt? doc.meta.text hoverPos).isEmpty)
    (notFoundX := return none) fun snap => do
      if let rs@(_ :: _) := snap.infoTree.goalsAt? doc.meta.text hoverPos then
        let goals : List <| Array InteractiveGoal ← rs.mapM fun { ctxInfo := ci, tacticInfo := ti, useAfter := useAfter, .. } => do
          let ciAfter := { ci with mctx := ti.mctxAfter }
          let ci := if useAfter then ciAfter else { ci with mctx := ti.mctxBefore }
          -- compute the interactive goals
          let goals ← ci.runMetaM {} do
            return List.toArray <| if useAfter then ti.goalsAfter else ti.goalsBefore
          let goals ← ci.runMetaM {} do
             goals.mapM fun goal => do
              -- let hints ← findHints goal doc.meta rc.initParams
              return ← goalToInteractive goal
          -- compute the goal diff
          -- let goals ← ciAfter.runMetaM {} (do
          --     try
          --       Widget.diffInteractiveGoals useAfter ti goals
          --     catch _ =>
          --       -- fail silently, since this is just a bonus feature
          --       return goals
          -- )
          return goals
        return some <| ⟨goals.foldl (· ++ ·) #[]⟩
      else
        return none

end GameServer



@[server_rpc_method]
def Game.getInteractiveGoals (p : Lsp.PlainGoalParams) : RequestM (RequestTask (Option Widget.InteractiveGoals)) :=
  FileWorker.getInteractiveGoals p

@[server_rpc_method]
def Game.getProofState (p : GameServer.ProofStateParams) : RequestM (RequestTask (Option GameServer.ProofState)) :=
  GameServer.getProofState p
