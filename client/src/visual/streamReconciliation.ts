import { v4 as uuidv4 } from 'uuid'
import type { CanvasState, GoalStream, HypCard as HypCardType } from './types'
import { parse, printExpression } from './expr-engine'
import {
  branchLeafStream,
  collectActiveStreamIds,
  collectLiveStreamIds,
  completeLeafStream,
  replaceLeafStream,
  type ProofStreamTreeNode,
} from './proofTree'

export interface ReconciledTreeState {
  nextTree: ProofStreamTreeNode
  nextActiveId: string | null
  focusedStreams: GoalStream[]
  nextCanvas: CanvasState
}

function stripTaggedText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(stripTaggedText).join('')
  if (!value || typeof value !== 'object') return ''

  if ('text' in value && typeof value.text === 'string') {
    return value.text
  }
  if ('tag' in value && Array.isArray(value.tag)) {
    return value.tag.map(stripTaggedText).join('')
  }
  if ('append' in value && Array.isArray(value.append)) {
    return value.append.map(stripTaggedText).join('')
  }

  return ''
}

function goalTypeText(stream: GoalStream): string {
  return normalizePropositionText(stripTaggedText(stream.goal.type).trim())
}

function findHypCardByInteractionName(stream: GoalStream, hypName: string): HypCardType | null {
  return stream.hyps.find(card =>
    card.hyp.playName === hypName || card.hyp.names[0] === hypName
  ) ?? null
}

function dragGoalApplyNextGoalType(
  focusedStream: GoalStream,
  playTactic?: string,
): string | null {
  if (!(playTactic?.startsWith('drag_goal ') ?? false)) return null

  const hypName = playTactic.slice('drag_goal '.length).trim()
  if (!hypName) return null

  const hypCard = findHypCardByInteractionName(focusedStream, hypName)
  if (!hypCard) return null

  const hypType = normalizePropositionText(stripTaggedText(hypCard.hyp.type).trim())
  const implication = splitImplicationTargetForRuntime(hypType)
  if (!implication) return null

  const [nextGoalType, currentGoalType] = implication
  return normalizePropositionText(currentGoalType) === goalTypeText(focusedStream)
    ? normalizePropositionText(nextGoalType)
    : null
}

function isReflexiveEqualityGoal(stream: GoalStream): boolean {
  const equalityTarget = splitEqualityTarget(goalTypeText(stream))
  if (!equalityTarget) return false
  const [lhs, rhs] = equalityTarget
  return normalizePropositionText(lhs) === normalizePropositionText(rhs)
}

function likelyFocusedContinuation(
  focusedStream: GoalStream,
  candidate: GoalStream,
  playTactic?: string,
): boolean {
  if (focusedStream.id === candidate.id) return true

  const isGoalRewrite =
    (playTactic?.startsWith('drag_rw_') ?? false) &&
    !(playTactic?.startsWith('drag_rw_hyp_') ?? false)
  const isHypRewrite = playTactic?.startsWith('drag_rw_hyp_') ?? false
  const dragGoalApplyGoalType = dragGoalApplyNextGoalType(focusedStream, playTactic)
  const requiresStableGoalType =
    (playTactic?.startsWith('click_prop ') ?? false) ||
    (playTactic?.startsWith('drag_to ') ?? false)
  const candidateGoalType = goalTypeText(candidate)
  const allowsGoalTypeChangeWithinSameBranch =
    isGoalRewrite ||
    (dragGoalApplyGoalType !== null && dragGoalApplyGoalType === candidateGoalType)
  const goalTypeMatches = goalTypeText(focusedStream) === candidateGoalType
  const hypContextMatches = hypContextShape(focusedStream) === hypContextShape(candidate)

  if (requiresStableGoalType && !goalTypeMatches) return false
  if (streamShape(candidate) === streamShape(focusedStream)) return true

  const focusedName = focusedStream.goal.userName
  const candidateName = candidate.goal.userName
  if (focusedName && candidateName) {
    if (focusedName !== candidateName) return false
    if (goalTypeMatches) return true
    return allowsGoalTypeChangeWithinSameBranch && hypContextMatches
  }

  if (allowsGoalTypeChangeWithinSameBranch && hypContextMatches) return true

  // For hyp rewrites (drag_rw_hyp_*), the goal type is stable — only a hypothesis
  // changes. When goal types match, the stream is almost certainly the continuation.
  // Without this, likelyFocusedContinuation returns false when userName is absent,
  // causing the reconciler to return focusedStreams:[] and closing transformation mode.
  if (isHypRewrite && goalTypeMatches) return true

  return requiresStableGoalType ? goalTypeMatches : false
}

function hypShape(card: HypCardType): string {
  const name = card.hyp.names[0] ?? '?'
  const type = stripTaggedText(card.hyp.type).trim()
  const value = card.hyp.val ? ` := ${stripTaggedText(card.hyp.val).trim()}` : ''
  return `${name}: ${type}${value}`
}

function hypContextShape(stream: GoalStream): string {
  return JSON.stringify(stream.hyps.map(hypShape))
}

function streamShape(stream: GoalStream): string {
  return JSON.stringify({
    goalType: stripTaggedText(stream.goal.type).trim(),
    hyps: stream.hyps.map(hypShape),
  })
}

function stripOuterParens(text: string): string {
  let current = text.trim()
  while (current.startsWith('(') && current.endsWith(')')) {
    let depth = 0
    let wrapsWhole = true
    for (let i = 0; i < current.length; i++) {
      const ch = current[i]
      if (ch === '(') depth++
      else if (ch === ')') {
        depth--
        if (depth === 0 && i < current.length - 1) {
          wrapsWhole = false
          break
        }
      }
    }
    if (!wrapsWhole) break
    current = current.slice(1, -1).trim()
  }
  return current
}

function splitTopLevelInfix(text: string, op: string): [string, string] | null {
  const trimmed = stripOuterParens(text)
  let depth = 0
  for (let i = 0; i <= trimmed.length - op.length; i++) {
    const ch = trimmed[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (depth !== 0) continue
    if (trimmed.slice(i, i + op.length) !== op) continue
    const left = stripOuterParens(trimmed.slice(0, i))
    const right = stripOuterParens(trimmed.slice(i + op.length))
    if (!left || !right) return null
    return [left, right]
  }
  return null
}

function takeTopLevelArg(text: string): [string, string] | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('(')) {
    let depth = 0
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i]
      if (ch === '(') depth++
      else if (ch === ')') {
        depth--
        if (depth === 0) {
          return [stripOuterParens(trimmed.slice(0, i + 1)), trimmed.slice(i + 1).trim()]
        }
      }
    }
    return null
  }

  const spaceIdx = trimmed.indexOf(' ')
  if (spaceIdx === -1) return [trimmed, '']
  return [trimmed.slice(0, spaceIdx), trimmed.slice(spaceIdx + 1).trim()]
}

function splitPrefixBinary(text: string, head: 'And' | 'Or'): [string, string] | null {
  const trimmed = stripOuterParens(text)
  const prefix = `${head} `
  if (!trimmed.startsWith(prefix)) return null
  const first = takeTopLevelArg(trimmed.slice(prefix.length))
  if (!first) return null
  const [left, rest] = first
  const second = takeTopLevelArg(rest)
  if (!second) return null
  const [right, remaining] = second
  if (remaining.length > 0 || !left || !right) return null
  return [stripOuterParens(left), stripOuterParens(right)]
}

function splitConjunctionTarget(text: string): [string, string] | null {
  return splitTopLevelInfix(text, ' ∧ ')
    ?? splitTopLevelInfix(text, '∧')
    ?? splitPrefixBinary(text, 'And')
}

function splitDisjunctionTarget(text: string): [string, string] | null {
  return splitTopLevelInfix(text, ' ∨ ')
    ?? splitTopLevelInfix(text, '∨')
    ?? splitPrefixBinary(text, 'Or')
}

function splitImplicationTarget(text: string): [string, string] | null {
  return splitTopLevelInfix(text, ' → ')
    ?? splitTopLevelInfix(text, '→')
    ?? splitTopLevelInfix(text, ' -> ')
    ?? splitTopLevelInfix(text, '->')
}

function splitConjunctionTargetForRuntime(text: string): [string, string] | null {
  const conjunction = String.fromCharCode(0x2227)
  return splitConjunctionTarget(text)
    ?? splitTopLevelInfix(text, ` ${conjunction} `)
    ?? splitTopLevelInfix(text, conjunction)
}

function splitDisjunctionTargetForRuntime(text: string): [string, string] | null {
  const disjunction = String.fromCharCode(0x2228)
  return splitDisjunctionTarget(text)
    ?? splitTopLevelInfix(text, ` ${disjunction} `)
    ?? splitTopLevelInfix(text, disjunction)
}

function splitImplicationTargetForRuntime(text: string): [string, string] | null {
  const implication = String.fromCharCode(0x2192)
  return splitImplicationTarget(text)
    ?? splitTopLevelInfix(text, ` ${implication} `)
    ?? splitTopLevelInfix(text, implication)
}

function splitEqualityTarget(text: string): [string, string] | null {
  return splitTopLevelInfix(text, ' = ')
    ?? splitTopLevelInfix(text, '=')
}

function normalizePropositionText(text: string): string {
  const normalized = stripOuterParens(text).replace(/\s+/g, ' ').trim()
  try {
    return printExpression(parse(normalized))
  } catch {
    return normalized
  }
}

function hasUsableClickAction(
  clickAction?: { playTactic?: string; options?: unknown[] },
): boolean {
  return Boolean(clickAction?.playTactic || (clickAction?.options?.length ?? 0) > 0)
}

function goalClickActionMatchesType(
  typeText: string,
  clickAction?: { playTactic?: string; streamSplit?: boolean; options?: unknown[] },
): boolean {
  const expected = buildGoalClickAction(typeText)
  if (!expected) return true
  if (!hasUsableClickAction(clickAction)) return false

  const optionCount = clickAction?.options?.length ?? 0
  if (expected.options.length > 0) {
    return optionCount > 0
  }

  return clickAction?.playTactic === expected.playTactic
    && Boolean(clickAction?.streamSplit) === Boolean(expected.streamSplit)
    && optionCount === 0
}

function hypClickActionMatchesType(
  typeText: string,
  hypName: string,
  clickAction?: { playTactic?: string; streamSplit?: boolean; options?: unknown[] },
): boolean {
  const expected = buildHypClickAction(typeText, hypName)
  if (!expected) return true
  if (!hasUsableClickAction(clickAction)) return false

  return clickAction?.playTactic === expected.playTactic
    && Boolean(clickAction?.streamSplit) === Boolean(expected.streamSplit)
    && (clickAction?.options?.length ?? 0) === 0
}

function cloneHypCards(cards: HypCardType[]): HypCardType[] {
  return cards.map(card => ({
    ...card,
    position: { ...card.position },
  }))
}

function synthesizeSplitStreams(focusedStream: GoalStream): GoalStream[] {
  const target = stripTaggedText(focusedStream.goal.type).trim()
  const splitTarget = splitConjunctionTargetForRuntime(target)
  if (!splitTarget) return []

  const hyps = cloneHypCards(focusedStream.hyps)
  return splitTarget.map((goalType, index) => ({
    id: uuidv4(),
    goal: {
      ...focusedStream.goal,
      mvarId: undefined,
      type: { text: goalType },
      userName: index === 0 ? 'left' : 'right',
      clickAction: undefined,
      reductionForms: [],
    },
    hyps: cloneHypCards(hyps),
    reductionForms: [],
  }))
}

function synthesizeHypSplitStream(
  focusedStream: GoalStream,
  hypName: string,
): GoalStream | null {
  const targetIndex = focusedStream.hyps.findIndex(card => card.hyp.names[0] === hypName)
  if (targetIndex === -1) return null

  const targetCard = focusedStream.hyps[targetIndex]
  const splitTarget = splitConjunctionTargetForRuntime(stripTaggedText(targetCard.hyp.type).trim())
  if (!splitTarget) return null

  const nextHyps = focusedStream.hyps.filter((_, index) => index !== targetIndex)
  const basePos = targetCard.position
  const splitNames = ['left', 'right']
  const splitCards: HypCardType[] = splitTarget.map((typeText, index) => ({
    ...targetCard,
    id: uuidv4(),
    hyp: {
      ...targetCard.hyp,
      names: [splitNames[index] ?? `${hypName}_${index + 1}`],
      fvarIds: undefined,
      type: { text: typeText },
      val: undefined,
      clickAction: undefined,
      reductionForms: [],
    },
    position: {
      x: basePos.x,
      y: basePos.y + index * 88,
    },
  }))

  nextHyps.splice(targetIndex, 0, ...splitCards)
  return {
    ...focusedStream,
    hyps: nextHyps,
  }
}

function synthesizeHypCaseSplitStreams(
  focusedStream: GoalStream,
  hypName: string,
): GoalStream[] {
  const targetIndex = focusedStream.hyps.findIndex(card => card.hyp.names[0] === hypName)
  if (targetIndex === -1) return []

  const targetCard = focusedStream.hyps[targetIndex]
  const splitTarget = splitDisjunctionTargetForRuntime(stripTaggedText(targetCard.hyp.type).trim())
  if (!splitTarget) return []

  const baseHyps = focusedStream.hyps.filter((_, index) => index !== targetIndex)
  const splitNames = ['left', 'right']
  const branchLabels = ['inl', 'inr']
  return splitTarget.map((typeText, index) => {
    const branchName = splitNames[index] ?? `${hypName}_${index + 1}`
    const branchHyps = cloneHypCards(baseHyps)
    branchHyps.splice(targetIndex, 0, {
      ...targetCard,
      id: uuidv4(),
      hyp: {
        ...targetCard.hyp,
        names: [branchName],
        fvarIds: undefined,
        type: { text: typeText },
        val: undefined,
        clickAction: buildHypClickAction(typeText, branchName),
        reductionForms: [],
      },
      position: { ...targetCard.position },
    })

    return {
      ...focusedStream,
      id: uuidv4(),
      goal: {
        ...focusedStream.goal,
        mvarId: undefined,
        userName: branchLabels[index] ? `${branchLabels[index]} ${branchName}` : focusedStream.goal.userName,
        clickAction: hasUsableClickAction(focusedStream.goal.clickAction)
          ? focusedStream.goal.clickAction
          : buildGoalClickAction(goalTypeText(focusedStream)),
        reductionForms: [],
      },
      hyps: branchHyps,
      reductionForms: [],
    }
  })
}

function synthesizeDragToStream(
  focusedStream: GoalStream,
  sourceName: string,
  targetName: string,
): GoalStream | null {
  const sourceCard = focusedStream.hyps.find(card => card.hyp.names[0] === sourceName)
  const targetCard = focusedStream.hyps.find(card => card.hyp.names[0] === targetName)
  if (!sourceCard || !targetCard) return null

  const sourceType = stripTaggedText(sourceCard.hyp.type).trim()
  const targetType = stripTaggedText(targetCard.hyp.type).trim()
  const targetImplication = splitImplicationTargetForRuntime(targetType)
  if (
    targetImplication &&
    normalizePropositionText(targetImplication[0]) === normalizePropositionText(sourceType)
  ) {
    return {
      ...focusedStream,
      hyps: focusedStream.hyps.map(card =>
        card.id === sourceCard.id
          ? {
              ...card,
              hyp: {
                ...card.hyp,
                fvarIds: undefined,
                type: { text: targetImplication[1] },
                val: undefined,
                clickAction: undefined,
                reductionForms: [],
              },
            }
          : card,
      ),
    }
  }

  const sourceImplication = splitImplicationTargetForRuntime(sourceType)
  if (
    sourceImplication &&
    normalizePropositionText(sourceImplication[0]) === normalizePropositionText(targetType)
  ) {
    return {
      ...focusedStream,
      hyps: focusedStream.hyps.map(card =>
        card.id === targetCard.id
          ? {
              ...card,
              hyp: {
                ...card.hyp,
                fvarIds: undefined,
                type: { text: sourceImplication[1] },
                val: undefined,
                clickAction: undefined,
                reductionForms: [],
              },
            }
          : card,
      ),
    }
  }

  return null
}

function nextFreshHypName(cards: HypCardType[], baseName: string): string {
  const existing = new Set(cards.map(card => card.hyp.names[0] ?? ''))
  if (!existing.has(baseName)) return baseName

  let suffix = 2
  while (existing.has(`${baseName}${suffix}`)) suffix += 1
  return `${baseName}${suffix}`
}

function synthesizedCardPosition(cardIndex: number): { x: number; y: number } {
  const col = cardIndex % 3
  const row = Math.floor(cardIndex / 3)
  return {
    x: col * 280 + 80,
    y: row * 110 + 130,
  }
}

function buildGoalClickAction(typeText: string) {
  const normalized = normalizePropositionText(typeText)
  const equalityTarget = splitEqualityTarget(normalized)
  if (equalityTarget) {
    const [lhs, rhs] = equalityTarget
    if (normalizePropositionText(lhs) === normalizePropositionText(rhs)) {
      return {
        playTactic: 'click_goal',
        tooltip: 'Click to complete',
        options: [],
      }
    }
  }

  const implicationTarget = splitImplicationTargetForRuntime(normalized)
  if (implicationTarget) {
    return {
      playTactic: 'click_goal',
      tooltip: 'Click to introduce assumption',
      options: [],
    }
  }

  const orTarget = splitDisjunctionTargetForRuntime(normalized)
  if (orTarget) {
    return {
      tooltip: 'Choose which side to prove',
      options: [
        {
          label: 'Left',
          playTactic: 'click_goal_left',
          previewText: orTarget[0],
        },
        {
          label: 'Right',
          playTactic: 'click_goal_right',
          previewText: orTarget[1],
        },
      ],
    }
  }

  if (splitConjunctionTargetForRuntime(normalized)) {
    return {
      playTactic: 'click_goal',
      tooltip: 'Click to split conjunction',
      streamSplit: true,
      options: [],
    }
  }

  return undefined
}

function buildHypClickAction(typeText: string, hypName: string, playName: string = hypName) {
  const normalized = normalizePropositionText(typeText)
  if (splitDisjunctionTargetForRuntime(normalized)) {
    return {
      playTactic: `click_prop ${playName}`,
      tooltip: 'Click to split into cases',
      streamSplit: true,
      options: [],
    }
  }

  if (splitConjunctionTargetForRuntime(normalized)) {
    return {
      playTactic: `click_prop ${playName}`,
      tooltip: 'Click to split conjunction',
      options: [],
    }
  }

  return undefined
}

function withSynthesizedInteractivity(stream: GoalStream): GoalStream {
  const streamGoalType = goalTypeText(stream)
  return {
    ...stream,
    goal: {
      ...stream.goal,
      clickAction: goalClickActionMatchesType(streamGoalType, stream.goal.clickAction)
        ? stream.goal.clickAction
        : buildGoalClickAction(goalTypeText(stream)),
    },
    hyps: stream.hyps.map(card => {
      const hypName = card.hyp.names[0] ?? ''
      const hypPlayName = card.hyp.playName ?? hypName
      const hypType = stripTaggedText(card.hyp.type).trim()
      return {
        ...card,
        hyp: {
          ...card.hyp,
          clickAction: hypClickActionMatchesType(hypType, hypPlayName, card.hyp.clickAction)
            ? card.hyp.clickAction
            : buildHypClickAction(hypType, hypName, hypPlayName),
        },
      }
    }),
  }
}

function normalizeCanvasInteractivity(canvas: CanvasState): CanvasState {
  return {
    ...canvas,
    streams: canvas.streams.map(withSynthesizedInteractivity),
  }
}

function synthesizeGoalIntroStream(focusedStream: GoalStream): GoalStream | null {
  const implication = splitImplicationTargetForRuntime(goalTypeText(focusedStream))
  if (!implication) return null

  const [domain, codomain] = implication
  const hypName = nextFreshHypName(focusedStream.hyps, 'h')
  const nextHyps = cloneHypCards(focusedStream.hyps)
  nextHyps.push({
    id: uuidv4(),
    hyp: {
      names: [hypName],
      type: { text: domain },
      clickAction: buildHypClickAction(domain, hypName),
      reductionForms: [],
    },
    position: synthesizedCardPosition(nextHyps.length),
  })

  return {
    ...focusedStream,
    goal: {
      ...focusedStream.goal,
      mvarId: undefined,
      type: { text: codomain },
      clickAction: buildGoalClickAction(codomain),
      reductionForms: [],
    },
    hyps: nextHyps,
    reductionForms: [],
  }
}

function synthesizeDragGoalApplyStream(
  focusedStream: GoalStream,
  playTactic: string,
): GoalStream | null {
  const nextGoalType = dragGoalApplyNextGoalType(focusedStream, playTactic)
  if (!nextGoalType) return null

  return {
    ...focusedStream,
    goal: {
      ...focusedStream.goal,
      mvarId: undefined,
      type: { text: nextGoalType },
      clickAction: buildGoalClickAction(nextGoalType),
      reductionForms: [],
    },
    hyps: cloneHypCards(focusedStream.hyps),
    reductionForms: [],
  }
}

function synthesizeGoalBranchStream(
  focusedStream: GoalStream,
  playTactic: 'click_goal_left' | 'click_goal_right',
): GoalStream | null {
  const disjunction = splitDisjunctionTargetForRuntime(goalTypeText(focusedStream))
  if (!disjunction) return null

  const branchIndex = playTactic === 'click_goal_left' ? 0 : 1
  const nextGoalType = disjunction[branchIndex]
  if (!nextGoalType) return null

  return {
    ...focusedStream,
    goal: {
      ...focusedStream.goal,
      mvarId: undefined,
      type: { text: nextGoalType },
      clickAction: buildGoalClickAction(nextGoalType),
      reductionForms: [],
    },
    hyps: cloneHypCards(focusedStream.hyps),
    reductionForms: [],
  }
}

function synthesizeContinuationStream(
  focusedStream: GoalStream,
  playTactic?: string,
): GoalStream | null {
  if (!playTactic) return null
  if (playTactic === 'click_goal_left' || playTactic === 'click_goal_right') {
    return synthesizeGoalBranchStream(focusedStream, playTactic)
  }
  if (playTactic.startsWith('click_prop ')) {
    const hypName = playTactic.slice('click_prop '.length).trim()
    return synthesizeHypSplitStream(focusedStream, hypName)
  }
  if (playTactic.startsWith('drag_to ')) {
    const [, sourceName, targetName] = playTactic.trim().split(/\s+/)
    if (!sourceName || !targetName) return null
    return synthesizeDragToStream(focusedStream, sourceName, targetName)
  }
  if (playTactic.startsWith('drag_goal ')) {
    return synthesizeDragGoalApplyStream(focusedStream, playTactic)
  }
  if (playTactic === 'click_goal') {
    return synthesizeGoalIntroStream(focusedStream)
  }
  return null
}

function synthesizeInductionStreams(
  focusedStream: GoalStream,
  hypName: string,
): GoalStream[] {
  const targetCard = focusedStream.hyps.find(card => card.hyp.names[0] === hypName)
  if (!targetCard) return []

  const hypsWithoutTarget = focusedStream.hyps.filter(card => card.hyp.names[0] !== hypName)

  // Base case: variable is 0, remove the induction target from context
  const zeroStream: GoalStream = {
    ...focusedStream,
    id: uuidv4(),
    goal: {
      ...focusedStream.goal,
      mvarId: undefined,
      userName: 'zero',
      reductionForms: [],
    },
    hyps: cloneHypCards(hypsWithoutTarget),
    reductionForms: [],
  }

  // Inductive step: keep the variable, add the induction hypothesis
  const ihName = nextFreshHypName(focusedStream.hyps, `${hypName}_ih`)
  const ihCard: HypCardType = {
    id: uuidv4(),
    hyp: {
      names: [ihName],
      type: { text: '…' },
      reductionForms: [],
    },
    position: synthesizedCardPosition(focusedStream.hyps.length),
  }
  const succStream: GoalStream = {
    ...focusedStream,
    id: uuidv4(),
    goal: {
      ...focusedStream.goal,
      mvarId: undefined,
      userName: 'succ',
      reductionForms: [],
    },
    hyps: [...cloneHypCards(focusedStream.hyps), ihCard],
    reductionForms: [],
  }

  return [zeroStream, succStream]
}

function synthesizeCasesStreams(
  focusedStream: GoalStream,
  hypName: string,
): GoalStream[] {
  const targetCard = focusedStream.hyps.find(card => card.hyp.names[0] === hypName)
  if (!targetCard) return []

  const hypsWithoutTarget = focusedStream.hyps.filter(card => card.hyp.names[0] !== hypName)

  // Zero case: the variable is 0, remove it from context
  const zeroStream: GoalStream = {
    ...focusedStream,
    id: uuidv4(),
    goal: {
      ...focusedStream.goal,
      mvarId: undefined,
      userName: 'zero',
      reductionForms: [],
    },
    hyps: cloneHypCards(hypsWithoutTarget),
    reductionForms: [],
  }

  // Successor case: introduce a predecessor variable with the same name
  const predName = nextFreshHypName(hypsWithoutTarget, hypName)
  const predCard: HypCardType = {
    id: uuidv4(),
    hyp: {
      names: [predName],
      type: { text: 'ℕ' },
      reductionForms: [],
    },
    position: synthesizedCardPosition(hypsWithoutTarget.length),
  }
  const succStream: GoalStream = {
    ...focusedStream,
    id: uuidv4(),
    goal: {
      ...focusedStream.goal,
      mvarId: undefined,
      userName: 'succ',
      reductionForms: [],
    },
    hyps: [...cloneHypCards(hypsWithoutTarget), predCard],
    reductionForms: [],
  }

  return [zeroStream, succStream]
}

function synthesizeSplitStreamsForInteraction(
  focusedStream: GoalStream,
  playTactic?: string,
): GoalStream[] {
  if (playTactic?.startsWith('click_prop ')) {
    const hypName = playTactic.slice('click_prop '.length).trim()
    return synthesizeHypCaseSplitStreams(focusedStream, hypName)
  }

  if (playTactic?.startsWith('induction ')) {
    const hypName = playTactic.slice('induction '.length).trim()
    return synthesizeInductionStreams(focusedStream, hypName)
  }

  if (playTactic?.startsWith('cases ')) {
    const hypName = playTactic.slice('cases '.length).trim()
    return synthesizeCasesStreams(focusedStream, hypName)
  }

  return synthesizeSplitStreams(focusedStream)
}

function findStableStreamMatch(
  before: GoalStream,
  afterStreams: GoalStream[],
  matchedAfterIds: Set<string>,
): GoalStream | null {
  const exactIdMatch = afterStreams.find(after =>
    !matchedAfterIds.has(after.id) && after.id === before.id
  )
  if (exactIdMatch) return exactIdMatch

  const beforeShape = streamShape(before)
  const shapeMatches = afterStreams.filter(after =>
    !matchedAfterIds.has(after.id) && streamShape(after) === beforeShape
  )
  if (shapeMatches.length === 1) return shapeMatches[0]

  const goalType = goalTypeText(before)
  const goalTypeMatches = afterStreams.filter(after =>
    !matchedAfterIds.has(after.id) && goalTypeText(after) === goalType
  )
  if (goalTypeMatches.length === 1) return goalTypeMatches[0]

  const goalName = before.goal.userName
  const branchMatches = afterStreams.filter(after => {
    if (matchedAfterIds.has(after.id)) return false
    if (goalTypeText(after) !== goalType) return false
    return Boolean(goalName && after.goal.userName && after.goal.userName === goalName)
  })
  if (branchMatches.length === 1) return branchMatches[0]

  return null
}

function buildReconciledCanvasState(
  beforeCanvas: CanvasState,
  afterCanvas: CanvasState,
  focusedStream: GoalStream,
  siblingStreamsByBeforeId: Map<string, GoalStream>,
  focusedStreams: GoalStream[],
  globallyCompleted: boolean,
): CanvasState {
  const nextStreams: GoalStream[] = []
  const insertedStreamIds = new Set<string>()

  for (const stream of beforeCanvas.streams) {
    if (stream.id === focusedStream.id) {
      for (const focused of focusedStreams) {
        if (insertedStreamIds.has(focused.id)) continue
        nextStreams.push(focused)
        insertedStreamIds.add(focused.id)
      }
      continue
    }

    const preserved = siblingStreamsByBeforeId.get(stream.id) ?? stream
    if (insertedStreamIds.has(preserved.id)) continue
    nextStreams.push(preserved)
    insertedStreamIds.add(preserved.id)
  }

  for (const stream of afterCanvas.streams) {
    if (insertedStreamIds.has(stream.id)) continue
    nextStreams.push(stream)
    insertedStreamIds.add(stream.id)
  }

  return {
    ...afterCanvas,
    streams: nextStreams,
    completed: globallyCompleted && nextStreams.length === 0,
  }
}

function orderCanvasStreamsByTree(tree: ProofStreamTreeNode, canvas: CanvasState): CanvasState {
  if (canvas.streams.length <= 1) return canvas
  const leafOrder = collectActiveStreamIds(tree)
  if (leafOrder.length === 0) return canvas
  const order = new Map(leafOrder.map((streamId, index) => [streamId, index]))
  const streams = [...canvas.streams].sort((a, b) =>
    (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER)
  )
  const unchanged = streams.every((stream, index) => stream.id === canvas.streams[index]?.id)
  return unchanged ? canvas : { ...canvas, streams }
}

function pickNextLiveStreamId(
  tree: ProofStreamTreeNode,
  currentStreamId: string,
  canvas: CanvasState,
): string | null {
  const liveStreamIds = collectLiveStreamIds(tree).filter(streamId =>
    canvas.streams.some(stream => stream.id === streamId)
  )
  if (liveStreamIds.length === 0) return canvas.streams[0]?.id ?? null

  const leafOrder = collectActiveStreamIds(tree)
  const currentIndex = leafOrder.indexOf(currentStreamId)
  if (currentIndex >= 0) {
    for (let index = currentIndex + 1; index < leafOrder.length; index++) {
      const streamId = leafOrder[index]
      if (streamId && liveStreamIds.includes(streamId)) return streamId
    }
    for (let index = 0; index < currentIndex; index++) {
      const streamId = leafOrder[index]
      if (streamId && liveStreamIds.includes(streamId)) return streamId
    }
  }

  return liveStreamIds[0] ?? null
}

export function reconcileProofTreeAfterInteraction(
  beforeTree: ProofStreamTreeNode,
  beforeCanvas: CanvasState,
  afterCanvas: CanvasState,
  focusedStream: GoalStream,
  playTactic: string | undefined,
  streamSplit: boolean,
  currentActiveId: string | null,
  exactFocusedStreams?: GoalStream[] | null,
): ReconciledTreeState {
  let nextTree = beforeTree
  let nextActiveId = currentActiveId
  const solvesFocusedByReflexiveClick =
    playTactic === 'click_goal' && isReflexiveEqualityGoal(focusedStream)

  const matchedAfterIds = new Set<string>()
  const siblingStreamsByBeforeId = new Map<string, GoalStream>()
  for (const stream of beforeCanvas.streams) {
    if (stream.id === focusedStream.id) continue
    const match = findStableStreamMatch(stream, afterCanvas.streams, matchedAfterIds)
    if (match) {
      matchedAfterIds.add(match.id)
      siblingStreamsByBeforeId.set(stream.id, match)
      nextTree = replaceLeafStream(nextTree, stream.id, match)
      continue
    }
    siblingStreamsByBeforeId.set(stream.id, stream)
  }

  const staleSolvedContinuationIds = solvesFocusedByReflexiveClick
    ? new Set(
        afterCanvas.streams
          .filter(stream =>
            !matchedAfterIds.has(stream.id) && likelyFocusedContinuation(focusedStream, stream, playTactic)
          )
          .map(stream => stream.id),
      )
    : new Set<string>()
  const effectiveAfterCanvas = staleSolvedContinuationIds.size > 0
    ? {
        ...afterCanvas,
        streams: afterCanvas.streams.filter(stream => !staleSolvedContinuationIds.has(stream.id)),
      }
    : afterCanvas
  const remainingFromCanvas = effectiveAfterCanvas.streams.filter(stream => !matchedAfterIds.has(stream.id))
  const unmatchedExactFocusedStreams = Array.isArray(exactFocusedStreams)
    ? exactFocusedStreams.filter(stream =>
        !matchedAfterIds.has(stream.id) && !staleSolvedContinuationIds.has(stream.id)
      )
    : exactFocusedStreams
  const trustedFocusedStreams = (() => {
    if (unmatchedExactFocusedStreams === undefined) return undefined
    if (streamSplit) {
      return unmatchedExactFocusedStreams.length >= 2 ? unmatchedExactFocusedStreams : undefined
    }
    if (unmatchedExactFocusedStreams.length === 0) {
      return undefined
    }
    const matchesFocusedBranch = unmatchedExactFocusedStreams.some(stream =>
      likelyFocusedContinuation(focusedStream, stream, playTactic)
    )
    return matchesFocusedBranch ? unmatchedExactFocusedStreams : undefined
  })()
  const remaining = trustedFocusedStreams ?? remainingFromCanvas
  const interactionRequiresFollowUp =
    streamSplit ||
    (playTactic?.startsWith('click_prop ') ?? false) ||
    (playTactic?.startsWith('drag_to ') ?? false)
  const solvesFocusedGoal =
    (playTactic?.startsWith('drag_goal ') ?? false) || solvesFocusedByReflexiveClick
  const hasSiblingBranches = siblingStreamsByBeforeId.size > 0
  const canPromoteSingleRemainingStream =
    !interactionRequiresFollowUp &&
    !solvesFocusedGoal &&
    !(
      (playTactic?.startsWith('drag_rw') ?? false) &&
      (Array.isArray(exactFocusedStreams) || hasSiblingBranches)
    )
  const globallyCompleted =
    (
      effectiveAfterCanvas.completed ||
      solvesFocusedByReflexiveClick
    ) &&
    effectiveAfterCanvas.streams.length === 0 &&
    siblingStreamsByBeforeId.size === 0 &&
    !interactionRequiresFollowUp
  const shouldTreatAsSplit = streamSplit || remaining.length >= 2
  const synthesizedSplitStreams =
    shouldTreatAsSplit && remaining.length === 0 && !globallyCompleted && trustedFocusedStreams === undefined
      ? synthesizeSplitStreamsForInteraction(focusedStream, playTactic)
      : []
  const buildNextCanvas = (nextFocusedStreams: GoalStream[]) =>
    normalizeCanvasInteractivity(
      orderCanvasStreamsByTree(
        nextTree,
        buildReconciledCanvasState(
          beforeCanvas,
          effectiveAfterCanvas,
          focusedStream,
          siblingStreamsByBeforeId,
          nextFocusedStreams,
          globallyCompleted,
        ),
      ),
    )

  if (shouldTreatAsSplit) {
    const splitStreams = remaining.length >= 2 ? remaining : synthesizedSplitStreams
    if (splitStreams.length >= 2) {
      nextTree = branchLeafStream(nextTree, focusedStream.id, splitStreams)
      nextActiveId = splitStreams[0]?.id ?? nextActiveId
      return {
        nextTree,
        nextActiveId,
        focusedStreams: splitStreams,
        nextCanvas: buildNextCanvas(splitStreams),
      }
    }
    if (remaining.length === 1) {
      nextTree = replaceLeafStream(nextTree, focusedStream.id, remaining[0])
      nextActiveId = remaining[0].id
      return {
        nextTree,
        nextActiveId,
        focusedStreams: remaining,
        nextCanvas: buildNextCanvas(remaining),
      }
    }
    if (!globallyCompleted) {
      return {
        nextTree,
        nextActiveId: focusedStream.id,
        focusedStreams: [focusedStream],
        nextCanvas: buildNextCanvas([focusedStream]),
      }
    }
    nextTree = completeLeafStream(nextTree, focusedStream.id)
    const nextCanvas = buildNextCanvas([])
    return {
      nextTree,
      nextActiveId: pickNextLiveStreamId(nextTree, focusedStream.id, nextCanvas),
      focusedStreams: [],
      nextCanvas,
    }
  }

  const continuation = remaining.find(stream =>
    likelyFocusedContinuation(focusedStream, stream, playTactic)
  ) ?? (canPromoteSingleRemainingStream && remaining.length === 1 ? remaining[0] : null)
  if (continuation) {
    nextTree = replaceLeafStream(nextTree, focusedStream.id, continuation)
    nextActiveId = continuation.id
    return {
      nextTree,
      nextActiveId,
      focusedStreams: [continuation],
      nextCanvas: buildNextCanvas([continuation]),
    }
  }

  const synthesizedContinuation = !globallyCompleted && trustedFocusedStreams === undefined
    ? synthesizeContinuationStream(focusedStream, playTactic)
    : null
  if (synthesizedContinuation) {
    nextTree = replaceLeafStream(nextTree, focusedStream.id, synthesizedContinuation)
    nextActiveId = synthesizedContinuation.id
    return {
      nextTree,
      nextActiveId,
      focusedStreams: [synthesizedContinuation],
      nextCanvas: buildNextCanvas([synthesizedContinuation]),
    }
  }

  if (remaining.length > 0 && canPromoteSingleRemainingStream) {
    nextTree = replaceLeafStream(nextTree, focusedStream.id, remaining[0])
    nextActiveId = remaining[0].id
    return {
      nextTree,
      nextActiveId,
      focusedStreams: [remaining[0]],
      nextCanvas: buildNextCanvas([remaining[0]]),
    }
  }

  nextTree = completeLeafStream(nextTree, focusedStream.id)
  const nextCanvas = buildNextCanvas([])
  nextActiveId = pickNextLiveStreamId(nextTree, focusedStream.id, nextCanvas)
  return { nextTree, nextActiveId, focusedStreams: [], nextCanvas }
}
