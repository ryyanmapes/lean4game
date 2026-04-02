/**
 *  @fileOverview Defines the interface for the communication with the server.
 *
 * This file is based on `vscode-lean4/vscode-lean4/src/rpcApi.ts`
 */
import type { Range } from 'vscode-languageserver-protocol';
import type { ContextInfo, FVarId, CodeWithInfos, MVarId } from '@leanprover/infoview-api';
import { InteractiveDiagnostic, TermInfo } from '@leanprover/infoview/*';
import type { Diagnostic } from 'vscode-languageserver-protocol';

/** Mirrors `GameServer.ExprTree` from Structures.lean. */
export type ExprTree =
  | { tag: 'lit';   n: number }
  | { tag: 'fvar';  name: string }
  | { tag: 'const'; name: string }
  | { tag: 'app';   func: ExprTree; arg: ExprTree }
  | { tag: 'other'; pp: string }

/** Mirrors `GameServer.EqualityTree` from Structures.lean.
 *  `isRefl` is true when lhs and rhs are definitionally equal (provable by rfl). */
export interface EqualityTree {
  lhs: ExprTree;
  rhs: ExprTree;
  isRefl: boolean;
}

/** Mirrors `GameServer.ExistsInfo` from Structures.lean.
 *  Populated when the goal type (possibly after unfolding) is `∃ x, P x`. */
export interface ExistsInfo {
  varName: string;
  body: string;
}

export interface ClickActionOption {
  label: string;
  playTactic: string;
  previewText?: string;
}

export interface ClickAction {
  playTactic?: string;
  tooltip?: string;
  streamSplit?: boolean;
  options: ClickActionOption[];
}

export interface InteractiveHypothesisBundle {
  /** The pretty names of the variables in the bundle. Anonymous names are rendered
   * as `"[anonymous]"` whereas inaccessible ones have a `✝` appended at the end.
   * Use `InteractiveHypothesisBundle_nonAnonymousNames` to filter anonymouse ones out. */
  names: string[];
  playName?: string;
  fvarIds?: FVarId[];
  type: CodeWithInfos;
  val?: CodeWithInfos;
  isInstance?: boolean;
  isType?: boolean;
  isInserted?: boolean;
  isRemoved?: boolean;
  isAssumption?: boolean;
  /** If the hyp type is `lhs = rhs`, the parsed equality tree (else absent). */
  equalityTree?: EqualityTree;
  /** Backend-rendered forms obtained only from reducible unfolding. */
  reductionForms?: string[];
  /** Backend-driven click behavior for this hypothesis card, if any. */
  clickAction?: ClickAction;
}

export interface InteractiveGoalCore {
  hyps: InteractiveHypothesisBundle[];
  type: CodeWithInfos;
  ctx?: ContextInfo;
}

export interface InteractiveGoal extends InteractiveGoalCore {
  userName?: string;
  goalPrefix?: string;
  mvarId?: MVarId;
  isInserted?: boolean;
  isRemoved?: boolean;
  /** Backend-rendered forms obtained only from reducible unfolding. */
  reductionForms?: string[];
  /** Backend-driven click behavior for this goal card, if any. */
  clickAction?: ClickAction;
}

export interface InteractiveGoals extends InteractiveGoalCore {
  goals: InteractiveGoals[];
}

export interface InteractiveTermGoal extends InteractiveGoalCore {
  range?: Range;
  term?: TermInfo;
}

export interface GameHint {
  text: string;
  hidden: boolean;
  rawText: string;
  varNames: string[][]; // in Lean: `Array (Name × Name)`
}

export interface InteractiveGoalWithHints {
  goal: InteractiveGoal;
  hints: GameHint[];
  /** If the goal type is `lhs = rhs`, the parsed equality tree (else absent). */
  equalityTree?: EqualityTree;
  /** If the goal type is (or unfolds to) `∃ x, P x`, the bound variable and body (else absent). */
  existsInfo?: ExistsInfo;
  /** Backend-rendered forms obtained only from reducible unfolding. */
  reductionForms?: string[];
}

export interface StepAnnotation {
  playTactic: string;    // e.g. "drag_to h h2"
  leanTactic?: string;   // e.g. "specialize h2 h" — resolved by Lean (currently always absent)
}

export interface InteractiveGoalsWithHints {
  goals: InteractiveGoalWithHints[];
  focusedGoals?: InteractiveGoalWithHints[];
  command: string;
  diags: InteractiveDiagnostic[];
  annotation?: StepAnnotation;  // present for drag_* steps, absent for hand-typed tactics
}

/**
 * The proof state as it is received from the server.
 * Per proof step of the tactic proof, there is one `InteractiveGoalWithHints[]`.
 */
export interface ProofState {
  /** The proof steps. step 0 is the state at the beginning of the proof. step one
   * contains the goal after the first line has been evaluated.
   *
   * In particular `step[i]` is the proof step at the beginning of line `i` in vscode.
   */
  steps: InteractiveGoalsWithHints[];
  /** The remaining diagnostics that are not in the steps. Usually this should only
   * be the "unsolved goals" message, I believe.
   */
  diagnostics : InteractiveDiagnostic[];
  completed : Boolean;
  completedWithWarnings : Boolean;
}
