import Lean.Widget.InteractiveGoal
import Lean.Widget.InteractiveDiagnostic
import Lean.Data.Lsp.Diagnostics

/-!
This file contains the custom data structures use by the server.

Some of them overwrite built-in structures from Lean.

In particular, the structures from `Lean.Widget.InteractiveGoal` are duplicated with
the following extension:

* `isAssumption?` in `InteractiveHypothesisBundle`: stores if a hypothesis is of type `Prop`.

NOTE: Changes here need to be reflected in  the corresponding `interface` in `rcp_api.ts`
on the client-side.
-/

open Lean Server Widget

namespace GameServer

/-- A serializable expression tree matching Lean's `Expr` shape after `whnf`.
    Used to send the parsed structure of equality goals/hyps to the frontend. -/
inductive ExprTree where
  | lit   (n : Nat)                          : ExprTree  -- numeric literal
  | fvar  (name : String)                    : ExprTree  -- free variable / hypothesis
  | const (name : String)                    : ExprTree  -- global constant (Nat.succ, HAdd.hAdd …)
  | app   (func : ExprTree) (arg : ExprTree) : ExprTree  -- function application
  | other (pp : String)                      : ExprTree  -- fallback: pretty-printed string
  deriving Repr

private partial def exprTreeToJson : ExprTree → Json
  | .lit n    => Json.mkObj [("tag", "lit"),   ("n",    toJson n)]
  | .fvar s   => Json.mkObj [("tag", "fvar"),  ("name", toJson s)]
  | .const s  => Json.mkObj [("tag", "const"), ("name", toJson s)]
  | .app f a  => Json.mkObj [("tag", "app"),   ("func", exprTreeToJson f), ("arg", exprTreeToJson a)]
  | .other s  => Json.mkObj [("tag", "other"), ("pp",   toJson s)]

instance : ToJson ExprTree := ⟨exprTreeToJson⟩

private partial def exprTreeFromJson (j : Json) : Except String ExprTree := do
  let tag : String ← fromJson? (← j.getObjVal? "tag")
  match tag with
  | "lit"   => return .lit   (← fromJson? (← j.getObjVal? "n"))
  | "fvar"  => return .fvar  (← fromJson? (← j.getObjVal? "name"))
  | "const" => return .const (← fromJson? (← j.getObjVal? "name"))
  | "app"   => return .app   (← exprTreeFromJson (← j.getObjVal? "func"))
                              (← exprTreeFromJson (← j.getObjVal? "arg"))
  | "other" => return .other (← fromJson? (← j.getObjVal? "pp"))
  | _       => throw s!"ExprTree: unknown tag '{tag}'"

instance : FromJson ExprTree := ⟨exprTreeFromJson⟩

/-- Both sides of an equality proposition, serialized as ExprTree.
    `isRefl` is true when lhs and rhs are definitionally equal (provable by `rfl`). -/
structure EqualityTree where
  lhs    : ExprTree
  rhs    : ExprTree
  isRefl : Bool
  deriving FromJson, ToJson

/-- One backend-provided click choice for the visual proof UI. -/
structure ClickActionOption where
  label : String
  playTactic : String
  previewText? : Option String := none
  deriving FromJson, ToJson

/-- Backend-driven click behavior for a visual goal or hypothesis card. -/
structure ClickAction where
  playTactic? : Option String := none
  tooltip? : Option String := none
  streamSplit? : Option Bool := none
  options : Array ClickActionOption := #[]
  deriving FromJson, ToJson

/-- Extend the interactive hypothesis bundle with an option to distinguish
"assumptions" from "objects". "Assumptions" are hypotheses of type `Prop`. -/
-- @[inherit_doc Lean.Widget.InteractiveHypothesisBundle]
structure InteractiveHypothesisBundle extends Lean.Widget.InteractiveHypothesisBundle where
  /-- The hypothesis's type is of type `Prop` -/
  isAssumption? : Option Bool := none
  /-- If the hypothesis type is `lhs = rhs`, the parsed equality tree (else none). -/
  equalityTree? : Option EqualityTree := none
  /-- Backend-rendered forms obtained only from reducible unfolding, shown in the
      visual proof UI on right-click. -/
  reductionForms : Array String := #[]
  /-- If present, clicking this hypothesis should trigger the corresponding visual action. -/
  clickAction? : Option ClickAction := none
deriving RpcEncodable

-- duplicated but with custom `InteractiveHypothesisBundle`
@[inherit_doc Lean.Widget.InteractiveGoalCore]
structure InteractiveGoalCore where
  hyps : Array InteractiveHypothesisBundle
  type : CodeWithInfos
  ctx : WithRpcRef Elab.ContextInfo

-- duplicated but with custom `InteractiveGoalCore`
@[inherit_doc Lean.Widget.InteractiveGoal]
structure InteractiveGoal extends InteractiveGoalCore where
  userName? : Option String
  goalPrefix : String
  mvarId : MVarId
  isInserted? : Option Bool := none
  isRemoved? : Option Bool := none
  /-- Backend-rendered forms obtained only from reducible unfolding, shown in the
      visual proof UI on right-click. -/
  reductionForms : Array String := #[]
  /-- If present, clicking this goal should trigger the corresponding visual action. -/
  clickAction? : Option ClickAction := none
deriving RpcEncodable

-- duplicated with custom `InteractiveGoalCore`
@[inherit_doc Lean.Widget.InteractiveTermGoal]
structure InteractiveTermGoal extends InteractiveGoalCore where
  range : Lsp.Range
  term : WithRpcRef Elab.TermInfo
deriving RpcEncodable

/-- A hint in the game at the corresponding goal. -/
structure GameHint where
  /-- The text with the variable names already inserted.

  Note: This is in theory superfluous and will be completely replaced by `rawText`. We just left
  it in for debugging for now. -/
  text : String
  /-- Flag whether the hint should be hidden initially. -/
  hidden : Bool
  /-- The text with the variables not inserted yet. -/
  rawText : String
  /-- The assignment of variable names in the `rawText` to the ones the player used. -/
  varNames : Array <| Name × Name
deriving FromJson, ToJson

/-- Bundled `InteractiveGoal` together with an array of hints that apply at this stage. -/
structure InteractiveGoalWithHints where
  goal : InteractiveGoal
  /-- Extended the `InteractiveGoal` by an array of hints at that goal. -/
  hints : Array GameHint
  /-- If the goal type is `lhs = rhs`, the parsed equality tree (else none). -/
  equalityTree? : Option EqualityTree := none
  /-- Backend-rendered forms obtained only from reducible unfolding, shown in the
      visual proof UI on right-click. -/
  reductionForms : Array String := #[]
deriving RpcEncodable

/-- Records which visual interaction produced a proof step and which standard tactic
    Lean resolved it to.  Present only for `drag_*` steps; absent for hand-typed tactics. -/
structure StepAnnotation where
  /-- The play tactic as sent by the frontend, e.g. `"drag_to h h2"`. -/
  playTactic : String
  /-- The standard Lean tactic that was actually executed, e.g. `"specialize h2 h"`.
      Currently always `none`; reserved for a future annotation pass. -/
  leanTactic : Option String := none
deriving FromJson, ToJson

structure InteractiveGoalsWithHints where
  goals : Array InteractiveGoalWithHints
  /-- The exact local goals produced by the focused tactic application at this line.
      This can differ from `goals`, which is the flattened visible proof state. -/
  focusedGoals : Array InteractiveGoalWithHints := #[]
  /-- The content of the line evaluated. -/
  command : String
  diags : Array InteractiveDiagnostic := default
  line : Option Nat -- only for debugging
  column : Option Nat -- only for debugging
  /-- Present for drag_* steps; absent for hand-typed tactics. -/
  annotation? : Option StepAnnotation := none

deriving RpcEncodable

instance : Inhabited InteractiveGoalsWithHints := ⟨default, default, default, default, none, none, none⟩

/-- Collected goals throughout the proof. Used for communication with the game client. -/
structure ProofState where
  /-- goals after each line. includes the hints. -/
  steps : Array <| InteractiveGoalsWithHints
  /-- diagnostics contains all errors and warnings.

  TODO: I think they contain information about which line they belong to. Verify this.
  -/
  diagnostics : Array InteractiveDiagnostic := default
  /-- Whether the level is considered solved. -/
  completed : Bool
  completedWithWarnings : Bool
  lastPos : Nat -- only for debugging
deriving RpcEncodable
