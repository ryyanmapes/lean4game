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
  forallFooter?: string
  forallSpecification?: ForallSpecificationInfo
}

/** A supported visual tactic rendered as a draggable tray card. */
export interface VisualTactic {
  id: string
  name: string
  label: string
  activation?: 'drag' | 'goal_click'
}

/** A draggable canvas copy created from a proposition theorem template. */
export interface PropositionTheoremCopy {
  id: string
  theorem: PropositionTheorem
  position: { x: number; y: number }
}
