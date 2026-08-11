import type { VisualGoalInfo } from './types'

const USE_GOAL_TEXT = 'Double-click there-exists goals to enter Construction Mode.'
const LE_HYP_TEXT = 'Click there-exists hypotheses to name a variable fulfilling the condition.'
const IMPLICATION_THREE_TEXT =
  'Try solving this level both by dragging h1 onto h2, and dragging h2 onto the goal.'
const OR_TEXT =
  "Click an 'or' hypothesis to split into two branches, one where each side is assumed. " +
  "Click an 'or' goal to specifify which side must be true. Be careful not to dead end " +
  'yourself by specifying the goal too early!'
const INDUCTION_TEXT =
  "Induct after only 'a' is introduced to get a more general inductive hypothesis."

function isNng4Game(gameId: string): boolean {
  const parts = gameId.split('/').filter(Boolean)
  return parts.at(-1)?.toLowerCase() === 'nng4'
}

function belowGoal(text: string, extra: Partial<VisualGoalInfo> = {}): VisualGoalInfo {
  return { position: 'below', arrow: false, text, ...extra }
}

/**
 * Small Visual Lean presentation overrides that belong to a particular NNG4
 * lesson rather than to the general renderer. Keeping the merge here also
 * lets a released client correct older cached game metadata deterministically.
 */
export function goalInfosForLevel(
  gameId: string,
  worldId: string,
  levelId: number,
  fetchedInfos: VisualGoalInfo[],
): VisualGoalInfo[] {
  if (!isNng4Game(gameId)) return fetchedInfos

  if (worldId === 'Implication' && levelId === 3) {
    return [belowGoal(IMPLICATION_THREE_TEXT)]
  }

  if (worldId !== 'LessOrEqual') return fetchedInfos

  switch (levelId) {
    case 1:
      return [...fetchedInfos, belowGoal(USE_GOAL_TEXT)]
    case 4:
      return [...fetchedInfos, belowGoal(LE_HYP_TEXT)]
    case 7:
      return [...fetchedInfos, belowGoal(OR_TEXT)]
    case 8:
      return [...fetchedInfos, belowGoal(INDUCTION_TEXT, { hideAfterTactic: 'induction' })]
    default:
      return fetchedInfos
  }
}

export function goalInfoVisibleAfterTactics(info: VisualGoalInfo, playTactics: string[]): boolean {
  if (!info.hideAfterTactic) return true
  return !playTactics.some(tactic => tactic.trim().split(/\s+/u)[0] === info.hideAfterTactic)
}

export const NNG4_VISUAL_LESSON_TEXT = {
  useGoal: USE_GOAL_TEXT,
  leHyp: LE_HYP_TEXT,
  implicationThree: IMPLICATION_THREE_TEXT,
  or: OR_TEXT,
  induction: INDUCTION_TEXT,
} as const
