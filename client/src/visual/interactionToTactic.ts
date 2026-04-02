/**
 * Maps visual canvas interactions to play tactic strings.
 *
 * The frontend reports *what was dragged where* (hypothesis names); it does not
 * classify the interaction semantically - that is Lean's job.
 */

export type VisualInteraction =
  | { type: 'drag_to';    nameA: string; nameB: string }
  | { type: 'drag_goal';  hypName: string }
  | { type: 'drag_tactic'; tacticName: string; targetHypName?: string }
  | { type: 'drag_induction'; hypName: string }
  | { type: 'drag_cases'; hypName: string }
  | {
      type: 'drag_rw'
      theoremName: string
      isReverse: boolean
      workingSide: 'left' | 'right'
      targetHypName?: string
      path?: number[]
    }
  | { type: 'click_goal' }
  | { type: 'click_prop'; hypName: string }

export function interactionToPlayTactic(i: VisualInteraction): string {
  switch (i.type) {
    case 'drag_to':
      return `drag_to ${i.nameA} ${i.nameB}`
    case 'drag_goal':
      return `drag_goal ${i.hypName}`
    case 'drag_tactic':
      return i.targetHypName ? `${i.tacticName} at ${i.targetHypName}` : i.tacticName
    case 'drag_induction':
      return `induction ${i.hypName}`
    case 'drag_cases':
      return `cases ${i.hypName}`
    case 'drag_rw': {
      const bracket = i.isReverse ? `← ${i.theoremName}` : i.theoremName
      const prefix = `${i.targetHypName ? 'drag_rw_hyp_' : 'drag_rw_'}${i.workingSide === 'left' ? 'lhs' : 'rhs'}${i.path && i.path.length > 0 ? '_at' : ''}`
      if (i.targetHypName) {
        return i.path && i.path.length > 0
          ? `${prefix} ${i.targetHypName} [${bracket}] [${i.path.join(',')}]`
          : `${prefix} ${i.targetHypName} [${bracket}]`
      }
      return i.path && i.path.length > 0
        ? `${prefix} [${bracket}] [${i.path.join(',')}]`
        : `${prefix} [${bracket}]`
    }
    case 'click_goal':
      return 'click_goal'
    case 'click_prop':
      return `click_prop ${i.hypName}`
  }
}
