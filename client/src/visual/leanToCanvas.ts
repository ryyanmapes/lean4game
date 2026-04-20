import type { InteractiveGoalWithHints, ProofState } from '../components/infoview/rpc_api'
import type { CanvasState, GoalStream, HypCard } from './types'
import {
  isDerivedTheoremName,
  isHiddenDerivedTheoremName,
  stripDerivedTheoremPrefix,
} from './theoremNames'

function sanitizeHypDisplayName(name: string): string {
  const sanitized = stripDerivedTheoremPrefix(name.replace(/\u271d+$/giu, ''))
  return sanitized || name
}

export function proofStateToCanvas(proof: ProofState | null | undefined): CanvasState {
  const steps = Array.isArray(proof?.steps) ? proof.steps : []
  // Take the last step: current proof state after all tactics
  const lastStep = steps[steps.length - 1]

  const streams = interactiveGoalsToStreams(lastStep?.goals ?? [])

  return {
    streams,
    completed: Boolean(proof?.completed) && streams.length === 0,
  }
}

export function interactiveGoalsToStreams(goals: InteractiveGoalWithHints[]): GoalStream[] {
  return goals.map((goalWithHints, streamIndex) => {
    const goal = goalWithHints.goal
    const usedDisplayNames = new Set<string>()

    // Unbundle multi-name hypothesis bundles (e.g. "h1 h2 : Nat" -> two cards)
    let cardIndex = 0
    const hyps: HypCard[] = goal.hyps.flatMap((hyp) => {
      const filteredNames = hyp.names
        .map((name, nameIndex) => ({ name, nameIndex }))
        .filter(({ name }) => name !== '[anonymous]')
        .filter(({ name }) => !isHiddenDerivedTheoremName(name))
      const cards = filteredNames.map(({ name, nameIndex }) => {
        const isTheorem = isDerivedTheoremName(name)
        const displayBase = sanitizeHypDisplayName(name)
        let displayName = displayBase
        if (usedDisplayNames.has(displayName)) {
          let suffix = 2
          while (usedDisplayNames.has(`${displayBase}${suffix}`)) suffix += 1
          displayName = `${displayBase}${suffix}`
        }
        usedDisplayNames.add(displayName)
        return {
          id: hyp.fvarIds?.[nameIndex] ?? crypto.randomUUID(),
          isTheorem,
          hyp: {
            ...hyp,
            names: [displayName],
            ...(displayName !== name ? { playName: name } : {}),
          },
          position: gridPosition(streamIndex, cardIndex + nameIndex),
        }
      })
      cardIndex += filteredNames.length
      return cards
    })

    return {
      id: goal.mvarId ?? crypto.randomUUID(),
      goal,
      hyps,
      equalityTree: goalWithHints.equalityTree,
      existsInfo: goalWithHints.existsInfo,
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
function isCompactLandscapeViewport(): boolean {
  if (typeof window === 'undefined') return false
  return window.innerWidth > window.innerHeight && window.innerHeight <= 500
}

function gridPosition(streamIndex: number, cardIndex: number): { x: number; y: number } {
  const compactLandscape = isCompactLandscapeViewport()
  const COL_W = compactLandscape ? 180 : 280
  const ROW_H = compactLandscape ? 92 : 110
  const START_X = compactLandscape ? 28 : 80
  const START_Y = compactLandscape ? 96 : 130
  const cols = compactLandscape
    ? (window.innerWidth >= 760 ? 3 : 2)
    : 3
  const col = cardIndex % cols
  const row = Math.floor(cardIndex / cols)
  void streamIndex
  return {
    x: col * COL_W + START_X,
    y: row * ROW_H + START_Y,
  }
}
