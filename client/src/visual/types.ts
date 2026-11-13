import type { InteractiveHypothesisBundle, InteractiveGoal, EqualityTree, ExistsInfo } from '../components/infoview/rpc_api'
import type { ForallSpecificationInfo } from './quantifiedStatement'

/** A single draggable hypothesis card on the canvas. */
export interface HypCard {
  id: string                           // from fvarId[0] or crypto.randomUUID()
  hyp: InteractiveHypothesisBundle     // Lean native type, passed straight to renderer
  isTheorem?: boolean
  position: { x: number; y: number }  // frontend-only, never sent to backend
  /** True once the user has manually dragged this card; preserved across proof steps.
   *  User-placed cards are treated as fixed obstacles during collision resolution. */
  userPlaced?: boolean
}

/** One proof stream = one Lean subgoal (e.g. after a tactic that splits goals). */
export interface GoalStream {
  id: string
  goal: InteractiveGoal   // Lean native type, passed straight to renderer
  hyps: HypCard[]
  /** Parsed equality tree for the goal type, if the goal is `lhs = rhs`. */
  equalityTree?: EqualityTree
  /** Bound variable and body if the goal is (or unfolds to) `∃ x, P x`. */
  existsInfo?: ExistsInfo
  /** Backend-rendered forms obtained only from reducible unfolding. */
  reductionForms?: string[]
}

/** Top-level canvas state. */
export interface CanvasState {
  streams: GoalStream[]
  completed: boolean
}

/** A theorem from the unlocked inventory rendered as a proposition card in combining mode. */
export interface PropositionTheorem {
  id: string
  theoremName: string
  label: string
  proposition: string
  reductionForms?: string[]
  forallFooter?: string
  forallSpecification?: ForallSpecificationInfo
  category?: string
}

/** A supported visual tactic rendered as a draggable tray card. */
export interface VisualTactic {
  id: string
  name: string
  label: string
  activation?: 'drag' | 'goal_click'
}

export interface VisualGoalInfo {
  position: 'above' | 'below'
  arrow: boolean
  goal?: string | null
  /** If set, the info only renders while the active goal contains a hypothesis whose
   *  type matches this string after formula-text normalization. */
  requireHypType?: string | null
  /** If set, the info only renders while the active goal does *not* contain a hypothesis
   *  whose type matches this string after formula-text normalization. */
  excludeHypType?: string | null
  /** Hide this lesson callout after the named player tactic has been applied.
   * Undo naturally restores it because the proof-step list is rolled back. */
  hideAfterTactic?: string | null
  /** Shown only while its goal matches, even in a game with persistent hints. */
  onlyWhile?: boolean
  text: string
}

export interface VisualTransformInfo {
  kind: 'side' | 'rewrite' | 'back' | 'reverse' | 'swap' | 'info' | 'check'
  side?: 'left' | 'right' | null
  source?: string
  target?: string
  goal?: string | null
  text: string
}

export interface VisualTacticHypInfo {
  tactic: string
  hyp: string
  goal?: string | null
  text: string
}

export interface VisualHypGoalInfo {
  hyp: string
  goal?: string | null
  /** Defaults to `goal`. `hyp` anchors the callout below the hypothesis itself, and
   *  `theorem` points an arrow at the inventory card of the theorem named `hyp`. */
  target?: 'goal' | 'hyp' | 'theorem'
  /** When targeting a hypothesis, only show while its type still matches this text. */
  hypType?: string | null
  /** Only show while the active goal has no hypothesis of this type. */
  excludeHypType?: string | null
  text: string
}

/** Guidance in the specialization view (`VisualSpecialize…Info`). */
export interface VisualSpecializationInfo {
  /** `info`: text only; `brick`: an arrow from the brick labelled `brick` to the first
   *  empty slot; `done`: an arrow to the Done button. */
  kind: 'info' | 'brick' | 'done'
  /** The term built so far as displayed, with `?` for each empty slot. */
  term?: string | null
  brick?: string
  /** The goal being specialized for. */
  goal?: string | null
  text: string
}

export interface VisualProofGraphInfo {
  goal?: string | null
  /** Left of the proof-stream graph (the default) or below it. */
  position?: 'left' | 'below'
  text: string
}

/** A draggable canvas copy created from a proposition theorem template. */
export interface PropositionTheoremCopy {
  id: string
  theorem: PropositionTheorem
  position: { x: number; y: number }
}
