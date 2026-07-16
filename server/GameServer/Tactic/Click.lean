import Lean.Elab.Tactic.Basic
import Lean.Meta.Tactic.Intro
import Lean.Meta.Tactic.Refl
import GameServer.GoalClick

namespace GameServer

open Lean Meta Elab Tactic

private def freshUserName (base : String) : TacticM Name := withMainContext do
  let lctx ← getLCtx
  let mut idx := 0
  let mut candidate := Name.mkSimple base
  while lctx.findFromUserName? candidate |>.isSome do
    idx := idx + 1
    candidate := Name.mkSimple s!"{base}{idx}"
  pure candidate

/-- Introduce one binder without round-tripping through the tactic parser.
The direct meta operation is both smaller and safe in the synchronous browser
frontend, where recursively invoking `evalTactic` from a custom elaborator can
lose the replacement goal. -/
private def introGoalAs (name : Name) : TacticM Unit :=
  liftMetaTactic fun mvarId => do
    let (_, nextGoal) ← mvarId.intro name
    pure [nextGoal]

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
            introGoalAs binderName
            introGoalAs hypName
        | none =>
            introGoalAs (← freshUserName "a")
            introGoalAs hypName
      else
        match goalWhnf with
        | .forallE binderName domain _ _ =>
            if ← isProp domain then
              introGoalAs (← freshUserName "h")
            else if binderName.isAnonymous then
              introGoalAs (← freshUserName "a")
            else
              let nextName ← freshUserName binderName.toString
              introGoalAs nextName
        | _ =>
            introGoalAs (← freshUserName "a")
  | some .introProp =>
      let hName ← freshUserName "h"
      introGoalAs hName
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

end GameServer
