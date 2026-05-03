import type { InteractiveGoalWithHints, ProofState } from '../components/infoview/rpc_api'
import type { CanvasState, GoalStream, HypCard } from './types'
import {
  isDerivedTheoremName,
  isHiddenDerivedTheoremName,
} from './theoremNames'

function sanitizeHypDisplayName(name: string): string {
  const sanitized = name.replace(/\u271d+$/giu, '')
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

function isPhonePortraitViewport(): boolean {
  if (typeof window === 'undefined') return false
  return window.innerWidth <= 720 && window.innerHeight >= window.innerWidth
}

function gridPosition(streamIndex: number, cardIndex: number): { x: number; y: number } {
  const compactLandscape = isCompactLandscapeViewport()
  const phonePortrait = isPhonePortraitViewport()
  const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth
  const phoneCols = viewportWidth >= 360 ? 2 : 1
  const phoneGap = 16
  const phoneStartX = 20
  const phoneColW = phoneCols === 1
    ? 0
    : Math.max(156, (viewportWidth - phoneStartX * 2 - phoneGap) / phoneCols)
  const COL_W = phonePortrait ? phoneColW : compactLandscape ? 180 : 280
  const ROW_H = phonePortrait ? 96 : compactLandscape ? 92 : 110
  const START_X = phonePortrait ? phoneStartX : compactLandscape ? 28 : 80
  const START_Y = phonePortrait ? 228 : compactLandscape ? 96 : 130
  const cols = phonePortrait
    ? phoneCols
    : compactLandscape
      ? (viewportWidth >= 760 ? 3 : 2)
      : 3
  const col = cardIndex % cols
  const row = Math.floor(cardIndex / cols)
  void streamIndex
  return {
    x: col * COL_W + START_X,
    y: row * ROW_H + START_Y,
  }
}
