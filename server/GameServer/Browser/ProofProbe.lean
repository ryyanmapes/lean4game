import Lean.Elab.Tactic.Basic
import GameServer.GoalClick

/-!
A compact, browser-only proof-state probe.

The persistent WASM host elaborates an ordinary Lean theorem and appends the
`browser_report_state` tactic.  This module serializes the live metavariable
context before elaboration discards it, avoiding any parsing of Lean's printed
`unsolved goals` diagnostic and avoiding the full editable-document server.
-/

namespace GameServer.Browser

open Lean Meta Elab Tactic

def proofStateMarker : String := "__VISUAL_LEAN_STATE_V1__"

private def codeJson (text : String) : Json :=
  Json.mkObj [("text", toJson text)]

private def directClickJson (playTactic tooltip : String)
    (streamSplit : Bool := false) : Json :=
  Json.mkObj [
    ("playTactic", toJson playTactic),
    ("tooltip", toJson tooltip),
    ("streamSplit", toJson streamSplit),
    ("options", toJson (#[] : Array Json))
  ]

private partial def exprTreeJson (e : Expr) : MetaM Json := do
  let e := e.consumeMData
  if let .app (.app (.app (.const ``OfNat.ofNat _) _) (.lit (.natVal n))) _ := e then
    return Json.mkObj [("tag", "lit"), ("n", toJson n)]
  match e with
  | .lit (.natVal n) =>
      return Json.mkObj [("tag", "lit"), ("n", toJson n)]
  | .fvar id =>
      let name := match (<- getLCtx).find? id with
        | some decl => decl.userName.toString
        | none => id.name.toString
      return Json.mkObj [("tag", "fvar"), ("name", toJson name)]
  | .const name _ =>
      return Json.mkObj [("tag", "const"), ("name", toJson name.toString)]
  | .app fn arg =>
      return Json.mkObj [
        ("tag", "app"),
        ("func", <- exprTreeJson fn),
        ("arg", <- exprTreeJson arg)
      ]
  | _ =>
      return Json.mkObj [("tag", "other"), ("pp", toJson (<- ppExpr e).pretty)]

private def equalityJson? (e : Expr) : MetaM (Option Json) := do
  let e <- instantiateMVars e
  match e.consumeMData with
  | .app (.app (.app (.const ``Eq _) _) lhs) rhs =>
      let saved <- getMCtx
      let isRefl <- withReducible (isDefEq lhs rhs)
      setMCtx saved
      return some <| Json.mkObj [
        ("lhs", <- exprTreeJson lhs),
        ("rhs", <- exprTreeJson rhs),
        ("isRefl", toJson isRefl)
      ]
  | _ => return none

private def existsJson? (e : Expr) : MetaM (Option Json) := do
  let e <- whnf (<- instantiateMVars e)
  match e.consumeMData with
  | .app (.app (.const ``Exists _) _) pred =>
      lambdaTelescope pred fun fvars body => do
        let some fvar := fvars[0]? | return none
        let decl <- fvar.fvarId!.getDecl
        return some <| Json.mkObj [
          ("varName", toJson decl.userName.toString),
          ("body", toJson (<- ppExpr body).pretty)
        ]
  | _ => return none

private def reductionForms (e : Expr) : MetaM (Array String) := do
  let original := (<- ppExpr e).pretty.trimAscii.toString
  let mut forms : Array String := #[]
  let mut current := (<- instantiateMVars e).consumeMData
  for _ in [:8] do
    let next := (<- instantiateMVars (<- withReducible (whnf current))).consumeMData
    if next == current then break
    let rendered := (<- ppExpr next).pretty.trimAscii.toString
    if !rendered.isEmpty && rendered != original && !forms.contains rendered then
      forms := forms.push rendered
    current := next
  return forms

private def goalClickJson? (goal : MVarId) : MetaM (Option Json) := goal.withContext do
  let target <- goal.getType
  match <- GameServer.clickGoalKind? target with
  | some .completeByRfl =>
      return some <| directClickJson "click_goal" "Click to complete"
  | some .introVar =>
      let tooltip := if (<- GameServer.boundedComparisonIntroInfo? target).isSome then
        "Click to introduce variable and assumption"
      else
        "Click to introduce variable"
      return some <| directClickJson "click_goal" tooltip
  | some .introProp =>
      return some <| directClickJson "click_goal" "Click to introduce assumption"
  | some .splitAnd =>
      return some <| directClickJson "click_goal" "Click to split conjunction" true
  | none =>
      let target <- withReducible (whnf target)
      match target with
      | .app (.app (.const ``Or _) lhs) rhs =>
          return some <| Json.mkObj [
            ("tooltip", toJson "Choose which side to prove"),
            ("options", toJson #[
              Json.mkObj [
                ("label", "Left"),
                ("playTactic", "click_goal_left"),
                ("previewText", toJson (<- ppExpr lhs).pretty)
              ],
              Json.mkObj [
                ("label", "Right"),
                ("playTactic", "click_goal_right"),
                ("previewText", toJson (<- ppExpr rhs).pretty)
              ]
            ])
          ]
      | _ => return none

private def hypClickJson? (name : String) (type : Expr) : MetaM (Option Json) := do
  let reduced <- withReducible (whnf type)
  match reduced with
  | .app (.app (.const ``And _) _) _ =>
      return some <| directClickJson s!"click_prop {name}" "Click to split conjunction"
  | .app (.app (.const ``Or _) _) _ =>
      return some <| directClickJson s!"click_prop {name}" "Click to split into cases" true
  | .app (.app (.const ``Exists _) _) _ =>
      return some <| directClickJson s!"click_prop {name}" "Click to introduce witness and condition"
  | _ =>
      let fullyReduced <- whnf type
      match fullyReduced with
      | .app (.app (.const ``Exists _) _) _ =>
          return some <| directClickJson s!"click_prop {name}" "Click to introduce witness and condition"
      | _ => return none

private def hypJson (decl : LocalDecl) : MetaM Json := do
  let type <- instantiateMVars decl.type
  let name := decl.userName.toString
  let value? <- match decl with
    | .ldecl _ _ _ _ value _ _ => pure <| some (<- ppExpr value).pretty
    | _ => pure none
  return Json.mkObj [
    ("names", toJson #[name]),
    ("playName", toJson name),
    ("fvarIds", toJson #[decl.fvarId.name.toString]),
    ("type", codeJson (<- ppExpr type).pretty),
    ("val", toJson (value?.map codeJson)),
    ("isInstance", toJson decl.binderInfo.isInstImplicit),
    ("isType", toJson type.isSort),
    ("isAssumption", toJson (<- isProp type)),
    ("equalityTree", toJson (<- equalityJson? type)),
    ("reductionForms", toJson (<- reductionForms type)),
    ("clickAction", toJson (<- hypClickJson? name type))
  ]

private def goalJson (goal : MVarId) : MetaM Json := goal.withContext do
  let decl <- goal.getDecl
  let target <- instantiateMVars decl.type
  let mut hyps : Array Json := #[]
  for localDecl in decl.lctx do
    unless localDecl.isAuxDecl || localDecl.isImplementationDetail do
      hyps := hyps.push (<- hypJson localDecl)
  let userName? := if decl.userName.isAnonymous then none else some decl.userName.toString
  return Json.mkObj [
    ("goal", Json.mkObj [
      ("hyps", toJson hyps),
      ("type", codeJson (<- ppExpr target).pretty),
      ("userName", toJson userName?),
      ("goalPrefix", toJson "|- "),
      ("mvarId", toJson goal.name.toString),
      ("reductionForms", toJson (<- reductionForms target)),
      ("clickAction", toJson (<- goalClickJson? goal))
    ]),
    ("hints", toJson (#[] : Array Json)),
    ("equalityTree", toJson (<- equalityJson? target)),
    ("existsInfo", toJson (<- existsJson? target)),
    ("reductionForms", toJson (<- reductionForms target))
  ]

syntax (name := browser_report_state) "browser_report_state" : tactic

@[tactic browser_report_state] def evalBrowserReportState : Tactic := fun _ => withMainContext do
  let payload <- goalJson (<- getMainGoal)
  logInfo m!"{proofStateMarker}{payload.compress}"

end GameServer.Browser
