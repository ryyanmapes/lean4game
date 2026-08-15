import type { VisualGoalInfo } from './types'

const USE_GOAL_TEXT = 'Double-click there-exists goals to enter Construction Mode.'
const LE_HYP_TEXT = 'Click there-exists hypotheses to name a variable fulfilling the condition.'
const IMPLICATION_THREE_TEXT =
  'Try solving this level both by dragging h1 onto h2, and dragging h2 onto the goal.'
const SYMM_TEXT = 'The `symm` tactic can be used to swap the sides of any equality.'
const OR_TEXT =
  "Click an 'or' hypothesis to split into two branches, one where each side is assumed. " +
  "Click an 'or' goal to specifify which side must be true. Be careful not to dead end " +
  'yourself by specifying the goal too early!'
const INDUCTION_TEXT =
  "Induct after only 'a' is introduced to get a more general inductive hypothesis."
const CASES_TEXT =
  'The `cases` tactic allows you to split a variable into every form it could take. ' +
  'For instance, natural numbers can take two forms: either 0 or the successor of another natural number. ' +
  'Also, there are *no* ways to make a variable any hypothesis of type `False`, so dragging `cases` onto ' +
  'a hypothesis of type `False` vacuously solves *any* goal!'
const LE_TEN_HINT_TEXT = "Hint: \n[Click to reveal: Don't forget about the `cases` tactic!]"

function isNng4Game(gameId: string): boolean {
  const parts = gameId.split('/').filter(Boolean)
  return parts.at(-1)?.toLowerCase() === 'nng4'
}

function belowGoal(text: string, extra: Partial<VisualGoalInfo> = {}): VisualGoalInfo {
  return { position: 'below', arrow: false, text, ...extra }
}

function withoutRevertSentences(info: VisualGoalInfo): VisualGoalInfo | null {
  const text = info.text
    .replace(/[^.!?\n]*\brevert\b[^.!?]*(?:[.!?]|$)/giu, '')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
  return text ? { ...info, text } : null
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

  // Authored level 6 is displayed as Implication 5 because level 5 is
  // skipped in Visual Lean. Retain its useful introduction reminder while
  // removing the obsolete sentence about the retired revert tactic.
  if (worldId === 'Implication' && levelId === 6) {
    return fetchedInfos.flatMap(info => {
      const cleaned = withoutRevertSentences(info)
      return cleaned ? [cleaned] : []
    })
  }

  // Authored level 10 is displayed as Implication 9.
  if (worldId === 'Implication' && levelId === 10) {
    return [...fetchedInfos, belowGoal(SYMM_TEXT)]
  }

  if (worldId === 'AdvAddition' && levelId === 5) {
    return [...fetchedInfos, belowGoal(CASES_TEXT)]
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
    case 10:
      return [...fetchedInfos, belowGoal(LE_TEN_HINT_TEXT)]
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
  symm: SYMM_TEXT,
  or: OR_TEXT,
  induction: INDUCTION_TEXT,
  cases: CASES_TEXT,
  leTenHint: LE_TEN_HINT_TEXT,
} as const
