import type { InteractiveGoalWithHints, ProofState } from '../components/infoview/rpc_api'
import type { CanvasState, GoalStream, HypCard } from './types'

export function proofStateToCanvas(proof: ProofState): CanvasState {
  // Take the last step — current proof state after all tactics
  const lastStep = proof.steps[proof.steps.length - 1]

  const streams = interactiveGoalsToStreams(lastStep?.goals ?? [])

  return {
    streams,
    completed: Boolean(proof.completed) && streams.length === 0,
  }
}

export function interactiveGoalsToStreams(goals: InteractiveGoalWithHints[]): GoalStream[] {
  return goals.map((goalWithHints, streamIndex) => {
    const goal = goalWithHints.goal

    // Unbundle multi-name hypothesis bundles (e.g. "h1 h2 : ℕ" → two cards)
    let cardIndex = 0
    const hyps: HypCard[] = goal.hyps.flatMap((hyp) => {
      const filteredNames = hyp.names.filter(name => !name.endsWith('✝') && name !== '[anonymous]')
      const cards = filteredNames.map((name, nameIndex) => ({
        id: hyp.fvarIds?.[nameIndex] ?? crypto.randomUUID(),
        hyp: { ...hyp, names: [name] },  // one card per name, same type
        position: gridPosition(streamIndex, cardIndex + nameIndex)
      }))
      cardIndex += filteredNames.length
      return cards
    })

    return {
      id: goal.mvarId ?? crypto.randomUUID(),
      goal,
      hyps,
      equalityTree: goalWithHints.equalityTree,
      reductionForms: goalWithHints.reductionForms ?? goal.reductionForms,
    }
  })
}

/**
 * Scatter layout matching the combining-mode canvas:
 * cards arranged left-to-right in rows of 3, starting from the top-left.
 * Column width and row height are generous to prevent overlap.
 * streamIndex offsets each subgoal's block horizontally.
 */
function gridPosition(streamIndex: number, cardIndex: number): { x: number; y: number } {
  const COL_W = 280            // generous column width (cards can be wide)
  const ROW_H = 110            // generous row height
  const START_X = 80           // left margin
  const START_Y = 130          // top margin (clears any page chrome)
  const cols = 3
  const col = cardIndex % cols
  const row = Math.floor(cardIndex / cols)
  void streamIndex
  return {
    x: col * COL_W + START_X,
    y: row * ROW_H + START_Y
  }
}
