import * as React from 'react'
import { useState, useLayoutEffect, useCallback, useEffect, useRef } from 'react'
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors, useDroppable } from '@dnd-kit/core'
import { TaggedText_stripTags } from '@leanprover/infoview-api'
import { v4 as uuidv4 } from 'uuid'
import { flushSync } from 'react-dom'
import type { CanvasState, GoalStream, HypCard as HypCardType, PropositionTheorem, PropositionTheoremCopy, VisualTactic } from './types'
import type { ClickAction, ClickActionOption, ProofState } from '../components/infoview/rpc_api'
import { HypCard } from './HypCard'
import { GoalCard } from './GoalCard'
import { PropositionTheoremTemplateCard, PropositionTheoremCopyCard, PropositionTheoremPreviewCard } from './PropositionTheoremCard'
import { VisualTacticTemplateCard, VisualTacticPreviewCard } from './VisualTacticCard'
import { parseEqualityHyp, parseGoalEquality, TransformationView } from './TransformationView'
import type { EqualityHyp } from './TransformationView'
import { applyEqualityRule, applyTheoremRewrite, exprTreeToNode, parse, printExpression } from './expr-engine'
import type { ExpressionNode } from './expr-types'
import { interactiveGoalsToStreams, proofStateToCanvas } from './leanToCanvas'
import { interactionToPlayTactic } from './interactionToTactic'
import { ProofStreamGraph } from './ProofStreamGraph'
import { VisualHeader } from './VisualHeader'
import {
  casePathForStream,
  cloneProofTree,
  collectActiveStreamIds,
  collectLiveStreamIds,
  createInitialProofTree,
  findLeafForStream,
  leafCount,
  replaceLeafStream,
  type ProofStreamTreeNode,
} from './proofTree'
import { reconcileProofTreeAfterInteraction } from './streamReconciliation'

import './visual.css'

// ── Play log ──────────────────────────────────────────────────────────────────

interface PlayLogEntry {
  timestamp: number
  playTactic: string
  leanTactic: string | null
  succeeded: boolean
}

function appendPlayLog(gameKey: string, entry: PlayLogEntry) {
  try {
    const key = `playlog/${gameKey}`
    const existing: PlayLogEntry[] = JSON.parse(localStorage.getItem(key) ?? '[]')
    existing.push(entry)
    localStorage.setItem(key, JSON.stringify(existing))
  } catch {
    // localStorage may be unavailable; silently ignore
  }
}

// ── Collision avoidance ───────────────────────────────────────────────────────

const REPULSION_ITERATIONS = 10
const HITBOX_PADDING = 16
const DEFAULT_WIDTH = 200
const DEFAULT_HEIGHT = 50

function resolveCollisions(hyps: HypCardType[], obstacleIds: string[] = []): HypCardType[] {
  if (hyps.length === 0) return hyps

  const items: { id: string; x: number; y: number; hw: number; hh: number; fixed: boolean }[] =
    hyps.map(h => {
      const el = document.getElementById(h.id)
      const rect = el?.getBoundingClientRect()
      return {
        id: h.id,
        x: h.position.x,
        y: h.position.y,
        hw: (rect ? rect.width : DEFAULT_WIDTH) / 2 + HITBOX_PADDING,
        hh: (rect ? rect.height : DEFAULT_HEIGHT) / 2 + HITBOX_PADDING,
        fixed: false,
      }
    })

  for (const id of obstacleIds) {
    const rect = document.getElementById(id)?.getBoundingClientRect()
    if (rect) {
      items.push({
        id,
        x: rect.left,
        y: rect.top,
        hw: rect.width / 2 + HITBOX_PADDING,
        hh: rect.height / 2 + HITBOX_PADDING,
        fixed: true,
      })
    }
  }

  for (let iter = 0; iter < REPULSION_ITERATIONS; iter++) {
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const dx = items[j].x - items[i].x
        const dy = items[j].y - items[i].y
        const rx = items[i].hw + items[j].hw
        const ry = items[i].hh + items[j].hh
        const nx = dx / rx
        const ny = dy / ry
        const ellipDist = Math.sqrt(nx * nx + ny * ny)
        if (ellipDist < 1 && ellipDist > 0) {
          const force = (1 - ellipDist) / 2
          const pushX = (nx / ellipDist) * force * rx
          const pushY = (ny / ellipDist) * force * ry
          if (!items[i].fixed) { items[i].x -= pushX; items[i].y -= pushY }
          if (!items[j].fixed) { items[j].x += pushX; items[j].y += pushY }
        }
      }
    }
  }

  const margin = 100
  for (const item of items) {
    if (!item.fixed) {
      item.x = Math.max(margin, item.x)
      item.y = Math.max(margin, item.y)
    }
  }

  return hyps.map(h => {
    const item = items.find(p => p.id === h.id)
    return item ? { ...h, position: { x: item.x, y: item.y } } : h
  })
}

/** Merge a freshly computed canvas state with the current one, preserving
 *  card positions for cards that still exist (matched by id/fvarId). */
function mergeCanvasState(fresh: CanvasState, current: CanvasState): CanvasState {
  const posMap = new Map<string, { x: number; y: number }>()
  for (const stream of current.streams) {
    for (const card of stream.hyps) {
      posMap.set(card.id, card.position)
    }
  }
  return {
    ...fresh,
    streams: fresh.streams.map(stream => ({
      ...stream,
      hyps: stream.hyps.map(card => ({
        ...card,
        position: posMap.get(card.id) ?? card.position,
      })),
    })),
  }
}

function cloneCanvasState(canvas: CanvasState): CanvasState {
  return {
    ...canvas,
    streams: canvas.streams.map(stream => ({
      ...stream,
      hyps: stream.hyps.map(card => ({
        ...card,
        position: { ...card.position },
      })),
    })),
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProofStepRecord {
  command: string
  playTactic: string
  leanTactic: string | null
  treeSnapshot: ProofStreamTreeNode
  canvasSnapshot: CanvasState
  activeStreamIdAfter: string | null
  /** The transform target active when this step was applied (non-null = was a rewrite). Used by undo to navigate back to the right mode. */
  transformTargetSnapshot: TransformTarget | null
}

interface PlacementHint {
  hypId: string
  streamId: string
  hypName: string
  originalPosition: { x: number; y: number }
  droppedPosition: { x: number; y: number }
}

interface AnimatedHypMarker {
  hypId?: string
  hypName: string
}

interface InteractionOptions {
  placementHint?: PlacementHint
  solvedGoalId?: string
  consumedTheoremCopyIds?: string[]
  streamSplit?: boolean
  targetStreamId?: string
}

interface GoalChoiceMenu {
  goalId: string
  pos: { x: number; y: number }
  options: ClickActionOption[]
}

interface ReductionTooltip {
  anchorId: string
  pos: { x: number; y: number }
  forms: string[]
  isClosing?: boolean
}

interface RewriteOutcome {
  success: boolean
  completed: boolean
}

interface ExpectedRewriteGoal {
  lhsStr: string
  rhsStr: string
}

interface PendingTransformSync {
  nextTree: ProofStreamTreeNode
  nextActiveId: string | null
  nextCanvas: CanvasState
  celebrationCanvas?: CanvasState
  finalDisplayCanvas?: CanvasState
  solvedGoalId?: string | null
  finalCompletion?: boolean
}

interface TransformRewriteDebug {
  playTactic: string
  focusedStreamId: string | null
  focusedGoalType: string | null
  focusedGoalUserName: string | null
  leanCanvasStreamIds: string[]
  leanCanvasGoalTypes: string[]
  leanCanvasUserNames: Array<string | null>
  leanCanvasGoalPlayTactics: Array<string | null>
  mergedCanvasStreamIds: string[]
  mergedCanvasGoalTypes: string[]
  mergedCanvasUserNames: Array<string | null>
  exactFocusedStreamIds: string[]
  exactFocusedGoalTypes: string[]
  exactFocusedUserNames: Array<string | null>
  reconciledFocusedStreamIds: string[]
  reconciledFocusedGoalTypes: string[]
  reconciledFocusedUserNames: Array<string | null>
  nextStreamId: string | null
  nextGoalType: string | null
  nextGoalUserName: string | null
  nextActiveId: string | null
  deferredCompletion: boolean
}

interface FocusedCommand {
  casePath: string[]
  tactic: string
}

interface VisualCanvasTestHarness {
  dragHypToGoal: (hypName: string) => Promise<void>
  dragHypToHyp: (sourceName: string, targetName: string) => Promise<void>
  dragTacticToHyp: (tacticName: string, hypName: string) => Promise<void>
  clickHyp: (hypName: string) => Promise<void>
  clickGoal: (playTactic?: string) => Promise<void>
  openGoalTransform: () => void
  openHypTransform: (hypName: string) => void
  rewriteGoalInTransform: (theoremName: string, workingSide?: 'left' | 'right', path?: number[]) => Promise<void>
  rewriteHypInTransform: (theoremName: string, workingSide?: 'left' | 'right', path?: number[]) => Promise<void>
  closeTransform: () => void
  getTransformStatus: () => {
    isOpen: boolean
    pendingSync: boolean
    targetKind: 'goal' | 'hyp' | null
    targetStreamId: string | null
  }
  getLastTransformRewriteDebug: () => TransformRewriteDebug | null
  getCurrentStreamSnapshot: () => {
    streamId: string
    displayStreamId: string | null
    goalType: string
    displayGoalType: string | null
    goalPlayTactic: string | null
    goalOptionTactics: string[]
    goalHasEqualityTree: boolean
    displayGoalHasEqualityTree: boolean | null
    currentStreamIsLive: boolean
    currentStreamIsCompleted: boolean
    streamInteractionsEnabled: boolean
    canvasStreamIds: string[]
    renderStreamIds: string[]
    hypTypes: Record<string, string>
    hypPlayTactics: Record<string, string | null>
    hypOptionTactics: Record<string, string[]>
  }
}

interface ProofScriptBlock {
  items: ProofScriptItem[]
}

type ProofScriptItem =
  | { kind: 'tactic'; tactic: string }
  | { kind: 'case'; label: string; block: ProofScriptBlock }

const THEOREM_TRAY_ID = 'theorem-tray'
const REDUCTION_TOOLTIP_EXIT_MS = 140
type TrayTab = 'tactics' | 'theorems'

declare global {
  interface Window {
    Cypress?: unknown
    __visualTestHarness?: VisualCanvasTestHarness
  }
}

function focusCommandForStream(
  playTactic: string,
  stream: GoalStream | null,
  tree: ProofStreamTreeNode,
): string {
  if (!stream) return playTactic
  const casePath = casePathForStream(tree, stream.id)
    ?.map(label => label.trim())
    .filter(label => label.length > 0)
    ?? []
  return casePath.reduceRight((inner, caseName) => `case ${caseName} => ${inner}`, playTactic)
}

function parseFocusedCommand(command: string): FocusedCommand {
  const casePath: string[] = []
  let rest = command.trim()

  while (
    rest.startsWith('focus_case ') ||
    rest.startsWith('case ') ||
    rest.startsWith("case' ")
  ) {
    const prefixLength = rest.startsWith('focus_case ')
      ? 11
      : rest.startsWith("case' ")
        ? 6
        : 5
    const inner = rest.slice(prefixLength)
    const separator = inner.indexOf('=>')
    if (separator === -1) break
    const label = inner.slice(0, separator).trim()
    const next = inner.slice(separator + 2).trim()
    if (!label || !next) break
    casePath.push(label)
    rest = next
  }

  return { casePath, tactic: rest }
}

function parsedGoalEquality(stream: GoalStream) {
  return parseGoalEquality(TaggedText_stripTags(stream.goal.type).trim())
}

function parsedHypEquality(card: HypCardType) {
  const hypName = card.hyp.names[0] ?? '?'
  return parseEqualityHyp(TaggedText_stripTags(card.hyp.type).trim(), hypName, card.id)
}

function goalIsReflexiveEquality(stream: GoalStream): boolean {
  if (stream.equalityTree?.isRefl) return true
  const parsedGoal = parsedGoalEquality(stream)
  return parsedGoal ? formulasMatch(parsedGoal.lhsStr, parsedGoal.rhsStr) : false
}

function goalIsTransformable(stream: GoalStream): boolean {
  if (goalIsReflexiveEquality(stream)) return false
  return stream.equalityTree !== undefined || parsedGoalEquality(stream) !== null
}

function hypIsTransformable(card: HypCardType): boolean {
  return card.hyp.equalityTree !== undefined || parsedHypEquality(card) !== null
}

function isVisualOnlyPlayTactic(playTactic: string): boolean {
  return playTactic.startsWith('click_') || playTactic.startsWith('drag_')
}

function normalizeFormulaText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function stripOuterParens(text: string): string {
  let current = normalizeFormulaText(text)
  while (current.startsWith('(') && current.endsWith(')')) {
    let depth = 0
    let wrapsWhole = true
    for (let i = 0; i < current.length; i++) {
      if (current[i] === '(') depth++
      else if (current[i] === ')') {
        depth--
        if (depth === 0 && i < current.length - 1) {
          wrapsWhole = false
          break
        }
      }
    }
    if (!wrapsWhole) break
    current = normalizeFormulaText(current.slice(1, -1))
  }
  return current
}

function formulasMatch(left: string, right: string): boolean {
  return stripOuterParens(left) === stripOuterParens(right)
}

function cloneHypCards(cards: HypCardType[]): HypCardType[] {
  return cards.map(card => ({
    ...card,
    position: { ...card.position },
  }))
}

function synthesizeGoalRewriteContinuation(
  focusedStream: GoalStream,
  expectedGoal: ExpectedRewriteGoal,
): GoalStream {
  const nextGoalType = `${expectedGoal.lhsStr} = ${expectedGoal.rhsStr}`
  const isDirectlyClickable = formulasMatch(expectedGoal.lhsStr, expectedGoal.rhsStr)
  const clickAction: ClickAction | undefined = isDirectlyClickable
    ? {
        playTactic: 'click_goal',
        tooltip: 'Click to complete',
        options: [],
      }
    : undefined

  return {
    ...focusedStream,
    id: uuidv4(),
    goal: {
      ...focusedStream.goal,
      mvarId: undefined,
      type: { text: nextGoalType },
      clickAction,
      reductionForms: [],
    },
    hyps: cloneHypCards(focusedStream.hyps),
    reductionForms: [],
    equalityTree: undefined,
  }
}

function findExpressionNodeAtPath(root: ExpressionNode, path?: number[]): ExpressionNode | null {
  let current: ExpressionNode | null = root
  for (const step of path ?? []) {
    if (!current) return null
    if (current.type === 'binary') {
      current = step === 1
        ? current.left
        : step === 2
        ? current.right
        : null
      continue
    }
    if (current.type === 'app') {
      current = step === 1 ? current.arg : null
      continue
    }
    return null
  }
  return current
}

function resolveRewriteHyp(
  equalityHyps: EqualityHyp[],
  theoremEqualityHyps: EqualityHyp[],
  hypRef: string,
): { hyp: EqualityHyp; isTheorem: boolean; rewriteRef: string } | null {
  // The theorem tray is keyed by declaration name even when tests refer to the display label.
  const theoremHyp = theoremEqualityHyps.find(hyp => hyp.id === hypRef || hyp.label === hypRef)
  if (theoremHyp) {
    return { hyp: theoremHyp, isTheorem: true, rewriteRef: theoremHyp.id }
  }

  const equalityHyp = equalityHyps.find(hyp => hyp.id === hypRef || hyp.label === hypRef)
  if (equalityHyp) {
    return { hyp: equalityHyp, isTheorem: false, rewriteRef: equalityHyp.label }
  }

  return null
}

function expectedGoalForRewrite(
  goalLhsStr: string,
  goalRhsStr: string,
  goalLhsNode: ExpressionNode | undefined,
  goalRhsNode: ExpressionNode | undefined,
  equalityHyps: EqualityHyp[],
  theoremEqualityHyps: EqualityHyp[],
  hypLabel: string,
  isReverse: boolean,
  workingSide: 'left' | 'right',
  path?: number[],
): ExpectedRewriteGoal | undefined {
  const resolved = resolveRewriteHyp(equalityHyps, theoremEqualityHyps, hypLabel)
  if (!resolved) return undefined
  const { hyp, isTheorem } = resolved

  const workingExpr = workingSide === 'right'
    ? (goalRhsNode ?? parse(goalRhsStr))
    : (goalLhsNode ?? parse(goalLhsStr))
  const targetNode = findExpressionNodeAtPath(workingExpr, path)
  if (!targetNode) return undefined

  const rewrittenExpr = isTheorem
    ? applyTheoremRewrite(workingExpr, targetNode.id, hyp.lhs, hyp.rhs, isReverse)
    : applyEqualityRule(workingExpr, targetNode.id, hyp.lhs, hyp.rhs, isReverse)

  return workingSide === 'right'
    ? { lhsStr: goalLhsStr, rhsStr: printExpression(rewrittenExpr) }
    : { lhsStr: printExpression(rewrittenExpr), rhsStr: goalRhsStr }
}

function replaceFocusedStreamInCanvas(
  beforeCanvas: CanvasState,
  nextCanvas: CanvasState,
  focusedStreamId: string,
  replacement: GoalStream,
): CanvasState {
  const replacementIds = new Set<string>([replacement.id])
  const streams = beforeCanvas.streams.map(stream => {
    if (stream.id === focusedStreamId) return replacement
    const matched = nextCanvas.streams.find(candidate => candidate.id === stream.id)
    if (matched) replacementIds.add(matched.id)
    return matched ?? stream
  })

  for (const stream of nextCanvas.streams) {
    if (!replacementIds.has(stream.id)) {
      streams.push(stream)
      replacementIds.add(stream.id)
    }
  }

  return {
    ...nextCanvas,
    streams,
    completed: false,
  }
}

function isConjunctionText(text: string): boolean {
  const normalized = stripOuterParens(text)
  return normalized.includes('∧') || normalized.startsWith('And ') || normalized.includes(' And ')
}

function isDisjunctionText(text: string): boolean {
  const normalized = stripOuterParens(text)
  return normalized.includes('∨') || normalized.startsWith('Or ') || normalized.includes(' Or ')
}

function extractImplicationTarget(text: string): string | null {
  const normalized = stripOuterParens(text)
  let depth = 0
  let lastArrowIndex = -1
  let lastArrowWidth = 0

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (depth === 0) {
      if (normalized.startsWith('→', i)) {
        lastArrowIndex = i
        lastArrowWidth = 1
      } else if (normalized.startsWith('->', i) || normalized.startsWith('=>', i)) {
        lastArrowIndex = i
        lastArrowWidth = 2
      }
    }
  }

  if (lastArrowIndex === -1) return null
  return stripOuterParens(normalized.slice(lastArrowIndex + lastArrowWidth))
}

function findHypCardByName(stream: GoalStream | null, hypName: string): HypCardType | null {
  if (!stream) return null
  return stream.hyps.find(card => card.hyp.names[0] === hypName) ?? null
}

function inferLeanTacticFromVisualInteraction(
  playTactic: string,
  stream: GoalStream | null,
): string | null {
  if (playTactic === 'click_goal_left') return 'left'
  if (playTactic === 'click_goal_right') return 'right'

  if (playTactic.startsWith('click_prop ')) {
    const hypName = playTactic.slice('click_prop '.length).trim()
    const hypCard = findHypCardByName(stream, hypName)
    if (!hypCard) return null
    const hypType = normalizeFormulaText(TaggedText_stripTags(hypCard.hyp.type))
    if (isConjunctionText(hypType)) {
      return `have left := And.left ${hypName}; have right := And.right ${hypName}; clear ${hypName}`
    }
    if (isDisjunctionText(hypType)) {
      return `cases ${hypName}`
    }
    return null
  }

  if (playTactic.startsWith('induction ')) return playTactic

  if (playTactic.startsWith('drag_goal ')) {
    const hypName = playTactic.slice('drag_goal '.length).trim()
    const hypCard = findHypCardByName(stream, hypName)
    if (!hypCard || !stream) return null
    const hypType = normalizeFormulaText(TaggedText_stripTags(hypCard.hyp.type))
    if (hypType === 'False') {
      return `exfalso\nexact ${hypName}`
    }
    const goalType = normalizeFormulaText(TaggedText_stripTags(stream.goal.type))
    if (formulasMatch(hypType, goalType)) {
      return `exact ${hypName}`
    }
    const implicationTarget = extractImplicationTarget(hypType)
    if (implicationTarget && formulasMatch(implicationTarget, goalType)) {
      return `apply ${hypName}`
    }
  }

  return null
}

/** Strip capitalized namespace prefixes from Lean identifiers for display (e.g. MyNat.zero_ne_succ → zero_ne_succ). */
function shortenQualifiedNames(tactic: string): string {
  return tactic.replace(/\b(?:[A-Z]\w*\.)+(\w+)\b/g, '$1')
}

function resolveLeanTactic(
  annotationLeanTactic: string | null | undefined,
  command: string,
  playTactic: string,
  stream: GoalStream | null,
): string | null {
  if (annotationLeanTactic) return annotationLeanTactic
  const inferredLeanTactic = inferLeanTacticFromVisualInteraction(playTactic, stream)
  if (inferredLeanTactic) return shortenQualifiedNames(inferredLeanTactic)
  if (command !== playTactic && !isVisualOnlyPlayTactic(playTactic)) return shortenQualifiedNames(command)
  return null
}

function getOrCreateCaseItem(block: ProofScriptBlock, label: string): ProofScriptBlock {
  const existing = block.items.find(item => item.kind === 'case' && item.label === label)
  if (existing && existing.kind === 'case') return existing.block

  const nextBlock: ProofScriptBlock = { items: [] }
  block.items.push({ kind: 'case', label, block: nextBlock })
  return nextBlock
}

function serializeProofCommands(commands: string[]): string {
  const root: ProofScriptBlock = { items: [] }

  for (const command of commands) {
    const { casePath, tactic } = parseFocusedCommand(command)
    if (!tactic) continue

    let block = root
    for (const label of casePath) {
      block = getOrCreateCaseItem(block, label)
    }
    block.items.push({ kind: 'tactic', tactic })
  }

  function render(block: ProofScriptBlock, indent: number): string[] {
    const pad = ' '.repeat(indent)
    const lines: string[] = []

    for (const item of block.items) {
      if (item.kind === 'tactic') {
        lines.push(`${pad}${item.tactic}`)
        continue
      }

      lines.push(`${pad}case ${item.label} =>`)
      lines.push(...render(item.block, indent + 2))
    }

    return lines
  }

  return render(root, 0).join('\n')
}

function stripCasePrefixes(tactic: string | null): string | null {
  if (!tactic) return null
  let s = tactic.trim()
  while (s.startsWith('case ') || s.startsWith('focus_case ') || s.startsWith("case' ")) {
    const prefixLen = s.startsWith('focus_case ') ? 11 : s.startsWith("case' ") ? 6 : 5
    const inner = s.slice(prefixLen)
    const sep = inner.indexOf('=>')
    if (sep === -1) break
    s = inner.slice(sep + 2).trim()
  }
  return s || null
}

function buildStructuredLeanProof(steps: ProofStepRecord[]): string {
  const leanCommands = steps.map(step => {
    const { casePath } = parseFocusedCommand(step.command)
    const leaf = stripCasePrefixes(step.leanTactic) ?? `-- ? (${step.playTactic})`
    return casePath.reduceRight((inner, c) => `case ${c} => ${inner}`, leaf)
  })
  return serializeProofCommands(leanCommands)
}

type TransformTarget =
  | { kind: 'goal'; streamId: string }
  | { kind: 'hyp'; streamId: string; hypId: string; hypName: string }

interface VisualCanvasProps {
  initialState: CanvasState
  theoremEqualityHyps: EqualityHyp[]
  propositionTheorems: PropositionTheorem[]
  visualTactics: VisualTactic[]
  worldId: string
  levelId: number
  onInteraction: (proofBody: string) => Promise<ProofState | null>
  onNextLevel?: () => void
  onPreviousLevel?: () => void
  onWorldMap?: () => void
  levelTitle?: string | null
  worldTitle?: string | null
  worldSize?: number | null
  previouslyCompleted?: boolean
  onLevelCompleted?: () => void
}

function TheoremTray({
  theorems,
  tactics,
  activeTab,
  onTabChange,
}: {
  theorems: PropositionTheorem[]
  tactics: VisualTactic[]
  activeTab: TrayTab
  onTabChange: (tab: TrayTab) => void
}) {
  // Compute derived values before hooks so they can be used in deps
  const availableTabs: TrayTab[] = []
  if (tactics.length > 0) availableTabs.push('tactics')
  if (theorems.length > 0) availableTabs.push('theorems')
  const hasTray = availableTabs.length > 0
  const visibleTab: TrayTab | undefined =
    activeTab === 'tactics' && tactics.length > 0
      ? 'tactics'
      : activeTab === 'theorems' && theorems.length > 0
        ? 'theorems'
        : availableTabs[0]
  const items: (PropositionTheorem | VisualTactic)[] =
    visibleTab === 'tactics' ? tactics : visibleTab === 'theorems' ? theorems : []

  const { setNodeRef, isOver } = useDroppable({ id: THEOREM_TRAY_ID })
  const [pageIndex, setPageIndex] = useState(0)
  const [pageWidth, setPageWidth] = useState(0)
  const [maxCardPx, setMaxCardPx] = useState(0)
  const dockCardsRef = useRef<HTMLDivElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)

  // Observe the outer dock-cards container and subtract the nav button space
  // so pageWidth is exactly the room available for cards.
  useEffect(() => {
    const el = dockCardsRef.current
    if (!el) return
    const measure = () => {
      const btns = Array.from(el.querySelectorAll<HTMLElement>(':scope > .tr-nav-btn'))
      const btnSpace = btns.reduce((s, b) => s + b.offsetWidth, 0)
      const cs = getComputedStyle(el)
      const pL = parseFloat(cs.paddingLeft) || 0
      const pR = parseFloat(cs.paddingRight) || 0
      const gap = parseFloat(cs.columnGap || cs.gap) || 0
      setPageWidth(el.clientWidth - pL - pR - btnSpace - btns.length * gap)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasTray])

  // Use max card width (not average) so no card ever overflows the page.
  useLayoutEffect(() => {
    const el = pageRef.current
    if (!el) return
    const cards = Array.from(el.querySelectorAll<HTMLElement>('.statement-card'))
    if (!cards.length) return
    const max = cards.reduce((m, c) => Math.max(m, c.offsetWidth), 0)
    setMaxCardPx(prev => Math.abs(max - prev) > 0.5 ? max : prev)
  }, [items])

  if (!hasTray) return null

  const GAP_PX = 12
  const itemsPerPage = pageWidth > 0 && maxCardPx > 0
    ? Math.max(1, Math.floor((pageWidth + GAP_PX) / (maxCardPx + GAP_PX)))
    : items.length
  const totalPages = Math.max(1, Math.ceil(items.length / itemsPerPage))
  const clampedPage = Math.min(pageIndex, totalPages - 1)
  const pageItems = items.slice(clampedPage * itemsPerPage, (clampedPage + 1) * itemsPerPage)

  return (
    <div
      id={THEOREM_TRAY_ID}
      ref={setNodeRef}
      className={`theorem-tray-panel${isOver ? ' drop-target-active' : ''}`}
    >
      {hasTray && (
        <div className="tr-dock-cards" ref={dockCardsRef}>
          <button
            className="tr-nav-btn"
            onClick={() => setPageIndex(p => Math.max(0, p - 1))}
            disabled={clampedPage === 0 || items.length === 0}
            aria-label="Previous"
          >‹</button>

          <div className="tr-rule-page" ref={pageRef}>
            <div className="tr-rule-page-cards">
              {pageItems.map(item =>
                visibleTab === 'tactics'
                  ? <VisualTacticTemplateCard key={(item as VisualTactic).id} tactic={item as VisualTactic} />
                  : <PropositionTheoremTemplateCard key={(item as PropositionTheorem).id} theorem={item as PropositionTheorem} />
              )}
            </div>
            {totalPages > 1 && (
              <span className="tr-page-indicator">{clampedPage + 1} / {totalPages}</span>
            )}
          </div>

          <button
            className="tr-nav-btn"
            onClick={() => setPageIndex(p => Math.min(totalPages - 1, p + 1))}
            disabled={clampedPage >= totalPages - 1 || items.length === 0}
            aria-label="Next"
          >›</button>
        </div>
      )}

      {availableTabs.length > 1 && (
        <div className="tr-dock-tabs">
          {availableTabs.map(tab => (
            <button
              key={tab}
              type="button"
              className={`tr-tab-btn${visibleTab === tab ? ' active' : ''}`}
              onClick={() => { onTabChange(tab); setPageIndex(0) }}
            >
              {tab === 'tactics' ? 'Tactics' : 'Theorems'}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export function VisualCanvas({
  initialState, theoremEqualityHyps, propositionTheorems, visualTactics, worldId, levelId,
  onInteraction, onNextLevel, onPreviousLevel, onWorldMap, levelTitle, worldTitle, worldSize, previouslyCompleted,
  onLevelCompleted
}: VisualCanvasProps) {
  const [canvasState, setCanvasState] = useState<CanvasState>(initialState)
  // Frozen snapshot for display — updated only when there are streams, so cards
  // stay visible after completion (when Lean returns an empty goals array).
  const [displayCanvasState, setDisplayCanvasState] = useState<CanvasState>(initialState)
  const [streamSnapshots, setStreamSnapshots] = useState<Record<string, GoalStream>>(() =>
    Object.fromEntries(initialState.streams.map(stream => [stream.id, stream]))
  )
  const initialProofTreeRef = useRef<ProofStreamTreeNode>(createInitialProofTree(initialState.streams[0]))
  const [proofTree, setProofTree] = useState<ProofStreamTreeNode>(() => cloneProofTree(initialProofTreeRef.current))
  const [activeStreamId, setActiveStreamId] = useState<string | null>(initialState.streams[0]?.id ?? null)
  useEffect(() => {
    if (canvasState.streams.length > 0) setDisplayCanvasState(canvasState)
  }, [canvasState])
  useEffect(() => {
    if (canvasState.streams.length === 0) return
    setStreamSnapshots(prev => {
      const next = { ...prev }
      for (const stream of canvasState.streams) {
        next[stream.id] = stream
      }
      return next
    })
  }, [canvasState.streams])
  useEffect(() => {
    setTheoremCopies([])
    setFailingTheoremCopyId(null)
  }, [propositionTheorems])

  const [transformTarget, setTransformTarget] = useState<TransformTarget | null>(null)
  const [transformationVersion, setTransformationVersion] = useState(0)
  const [isTransformReverse, setIsTransformReverse] = useState(false)
  const [transformWorkingSide, setTransformWorkingSide] = useState<'left' | 'right'>('right')
  const [transformSelectedTab, setTransformSelectedTab] = useState<string>('all')
  const [pendingTransformSync, setPendingTransformSync] = useState<PendingTransformSync | null>(null)
  const [proofSteps, setProofSteps] = useState<ProofStepRecord[]>([])
  const [failingCardId, setFailingCardId] = useState<string | null>(null)
  const [failingTheoremCopyId, setFailingTheoremCopyId] = useState<string | null>(null)
  const [solvedGoalId, setSolvedGoalId] = useState<string | null>(null)
  const [animatedHyps, setAnimatedHyps] = useState<AnimatedHypMarker[]>([])
  const [positionOverrides, setPositionOverrides] = useState<Record<string, { x: number; y: number }>>({})
  const [theoremCopies, setTheoremCopies] = useState<PropositionTheoremCopy[]>([])
  const [activeDraggedTheorem, setActiveDraggedTheorem] = useState<PropositionTheorem | null>(null)
  const [activeDraggedTactic, setActiveDraggedTactic] = useState<VisualTactic | null>(null)
  const [activeTrayTab, setActiveTrayTab] = useState<TrayTab>('theorems')
  const [isProcessing, setIsProcessing] = useState(false)
  const [showProofSidebar, setShowProofSidebar] = useState<boolean>(() => {
    try { return localStorage.getItem('visual-proof-sidebar-open') === 'true' } catch { return false }
  })
  const [sideViewMode, setSideViewMode] = useState<'lean' | 'play'>(() => {
    try { return (localStorage.getItem('visual-proof-view-mode') as 'lean' | 'play') || 'lean' } catch { return 'lean' }
  })
  const [goalChoiceMenu, setGoalChoiceMenu] = useState<GoalChoiceMenu | null>(null)
  const [reductionTooltip, setReductionTooltip] = useState<ReductionTooltip | null>(null)
  const reductionTooltipCloseTimerRef = useRef<number | null>(null)
  const visualTestStateRef = useRef<{
    canvasState: CanvasState
    currentStream: GoalStream | null
    currentStreamIsLive: boolean
    currentStreamIsCompleted: boolean
    canvasCompleted: boolean
  }>({
    canvasState: initialState,
    currentStream: initialState.streams[0] ?? null,
    currentStreamIsLive: initialState.streams.length > 0,
    currentStreamIsCompleted: false,
    canvasCompleted: initialState.completed,
  })
  const lastTransformRewriteDebugRef = useRef<TransformRewriteDebug | null>(null)
  const applyInteractionRef = useRef<((playTactic: string, sourceCardId: string, options?: InteractionOptions) => Promise<void>) | null>(null)

  // Stable game key for play log
  const logKey = `${worldId}/${levelId}`

  useEffect(() => {
    if (canvasState.completed) {
      onLevelCompleted?.()
    }
  }, [canvasState.completed])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setGoalChoiceMenu(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    return () => {
      if (reductionTooltipCloseTimerRef.current !== null) {
        window.clearTimeout(reductionTooltipCloseTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const availableTabs: TrayTab[] = []
    if (visualTactics.length > 0) availableTabs.push('tactics')
    if (propositionTheorems.length > 0) availableTabs.push('theorems')
    if (availableTabs.length === 0) return
    if (!availableTabs.includes(activeTrayTab)) {
      setActiveTrayTab(availableTabs.includes('theorems') ? 'theorems' : availableTabs[0])
    }
  }, [activeTrayTab, propositionTheorems.length, visualTactics.length])

  useLayoutEffect(() => {
    setCanvasState(prev => {
      const obstacleIds = prev.streams.map(s => s.id)
      return {
        ...prev,
        streams: prev.streams.map(stream => ({
          ...stream,
          hyps: resolveCollisions(stream.hyps, obstacleIds),
        })),
      }
    })
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  useEffect(() => {
    const navigableIds = collectActiveStreamIds(proofTree)
    const liveIds = collectLiveStreamIds(proofTree)
    if (navigableIds.length === 0) {
      if (activeStreamId !== null) setActiveStreamId(null)
      return
    }
    if (activeStreamId && navigableIds.includes(activeStreamId)) return
    const nextId = liveIds.find(streamId =>
      canvasState.streams.some(stream => stream.id === streamId)
    )
      ?? canvasState.streams[0]?.id
      ?? navigableIds[0]
      ?? null
    if (nextId !== activeStreamId) setActiveStreamId(nextId)
  }, [canvasState.streams, activeStreamId, proofTree])

  // ── Core interaction logic ──────────────────────────────────────────────────

  function triggerFailureFeedback(cardId: string) {
    setFailingCardId(cardId)
    setTimeout(() => setFailingCardId(null), 600)
  }

  function clearPositionOverride(hypId: string) {
    setPositionOverrides(prev => {
      if (!(hypId in prev)) return prev
      const next = { ...prev }
      delete next[hypId]
      return next
    })
  }

  function triggerTheoremCopyFailureFeedback(copyId: string) {
    setFailingTheoremCopyId(copyId)
    setTimeout(() => setFailingTheoremCopyId(null), 600)
  }

  function consumeTheoremCopies(copyIds?: string[]) {
    if (!copyIds || copyIds.length === 0) return
    const consumed = new Set(copyIds)
    setTheoremCopies(prev => prev.filter(copy => !consumed.has(copy.id)))
    setFailingTheoremCopyId(prev => (prev && consumed.has(prev) ? null : prev))
  }

  function getTheoremCopyById(copyId: string): PropositionTheoremCopy | undefined {
    return theoremCopies.find(copy => copy.id === copyId)
  }

  function updatePlacedHypPosition(
    canvas: CanvasState,
    hint: PlacementHint,
    nextPosition: { x: number; y: number }
  ): CanvasState {
    const targetStreamIndex = canvas.streams.findIndex(stream =>
      stream.id === hint.streamId &&
      stream.hyps.some(h => h.id === hint.hypId || h.hyp.names[0] === hint.hypName)
    )
    const fallbackStreamIndex = canvas.streams.findIndex(stream =>
      stream.hyps.some(h => h.id === hint.hypId || h.hyp.names[0] === hint.hypName)
    )
    const streamIndex = targetStreamIndex >= 0 ? targetStreamIndex : fallbackStreamIndex

    if (streamIndex === -1) return canvas

    return {
      ...canvas,
      streams: canvas.streams.map((stream, idx) => {
        if (idx !== streamIndex) return stream
        const targetIdx = stream.hyps.findIndex(h => h.id === hint.hypId || h.hyp.names[0] === hint.hypName)
        if (targetIdx === -1) return stream
        const moved = stream.hyps.map((hyp, idx) =>
          idx === targetIdx ? { ...hyp, position: nextPosition } : hyp
        )
        return { ...stream, hyps: moved }
      }),
    }
  }

  function placeHypNearAnchor(canvas: CanvasState, hint: PlacementHint): CanvasState {
    return updatePlacedHypPosition(canvas, hint, hint.originalPosition)
  }

  function triggerGeneratedCardAnimation(marker: AnimatedHypMarker) {
    setAnimatedHyps(prev =>
      prev.some(item => item.hypName === marker.hypName || (marker.hypId && item.hypId === marker.hypId))
        ? prev
        : [...prev, marker]
    )
    window.setTimeout(() => {
      setAnimatedHyps(prev =>
        prev.filter(item => item.hypName !== marker.hypName && (!marker.hypId || item.hypId !== marker.hypId))
      )
    }, 320)
  }

  function createTheoremCopy(theorem: PropositionTheorem, position: { x: number; y: number }) {
    setTheoremCopies(prev => [
      ...prev,
      {
        id: uuidv4(),
        theorem,
        position,
      },
    ])
  }

  function clearReductionTooltipCloseTimer() {
    if (reductionTooltipCloseTimerRef.current !== null) {
      window.clearTimeout(reductionTooltipCloseTimerRef.current)
      reductionTooltipCloseTimerRef.current = null
    }
  }

  function showReductionTooltip(next: Omit<ReductionTooltip, 'isClosing'>) {
    clearReductionTooltipCloseTimer()
    setReductionTooltip({ ...next, isClosing: false })
  }

  function closeReductionTooltip(anchorId?: string) {
    clearReductionTooltipCloseTimer()
    setReductionTooltip(current => {
      if (!current) return null
      if (anchorId && current.anchorId !== anchorId) return current
      if (current.isClosing) return current
      reductionTooltipCloseTimerRef.current = window.setTimeout(() => {
        setReductionTooltip(latest => latest?.isClosing ? null : latest)
        reductionTooltipCloseTimerRef.current = null
      }, REDUCTION_TOOLTIP_EXIT_MS)
      return { ...current, isClosing: true }
    })
  }

  async function applyInteraction(playTactic: string, sourceCardId: string, options?: InteractionOptions) {
    if (isProcessing) return
    const focusedStreamId = options?.targetStreamId
      ?? (canvasState.streams.some(stream => stream.id === sourceCardId) ? sourceCardId : null)
      ?? (canvasState.streams.find(stream => stream.hyps.some(card => card.id === sourceCardId))?.id ?? null)
      ?? activeStreamId
    const focusedStream = focusedStreamId
      ? canvasState.streams.find(stream => stream.id === focusedStreamId) ?? null
      : null
    if (!focusedStream) return
    const command = focusCommandForStream(playTactic, focusedStream, proofTree)
    setGoalChoiceMenu(null)
    closeReductionTooltip()
    setIsProcessing(true)

    const newScript = serializeProofCommands([...proofSteps.map(step => step.command), command])
    const result = await onInteraction(newScript)
    const handledBySyntheticReflexiveClick =
      result === null &&
      playTactic === 'click_goal' &&
      goalIsReflexiveEquality(focusedStream) &&
      !focusedStream.goal.mvarId

    setIsProcessing(false)

    const lastStep = result?.steps.at(-1)
    const leanTactic = handledBySyntheticReflexiveClick
      ? 'rfl'
      : result
      ? resolveLeanTactic(lastStep?.annotation?.leanTactic, command, playTactic, focusedStream)
      : null

    // Log the attempt regardless of outcome
    appendPlayLog(logKey, {
      timestamp: Date.now(),
      playTactic,
      leanTactic,
      succeeded: result !== null || handledBySyntheticReflexiveClick,
    })

    if (handledBySyntheticReflexiveClick) {
      const { nextTree, nextActiveId, nextCanvas } = reconcileProofTreeAfterInteraction(
        proofTree,
        canvasState,
        canvasState,
        focusedStream,
        playTactic,
        Boolean(options?.streamSplit),
        activeStreamId,
      )

      setProofTree(nextTree)
      setActiveStreamId(nextActiveId)

      if (nextCanvas.completed && options?.solvedGoalId) {
        setSolvedGoalId(options.solvedGoalId)
        window.setTimeout(() => {
          setCanvasState(nextCanvas)
        }, 700)
        return
      }

      setCanvasState(nextCanvas)
      return
    }

    if (result === null) {
      if (options?.placementHint) {
        clearPositionOverride(options.placementHint.hypId)
        setCanvasState(prev => updatePlacedHypPosition(prev, options.placementHint!, options.placementHint!.originalPosition))
      }
      if (getTheoremCopyById(sourceCardId)) triggerTheoremCopyFailureFeedback(sourceCardId)
      else triggerFailureFeedback(sourceCardId)
      return
    }

    const annotation = lastStep?.annotation
    const leanCanvas = proofStateToCanvas(result)
    const mergedCanvas = mergeCanvasState(leanCanvas, canvasState)
    const exactFocusedStreams = lastStep?.focusedGoals !== undefined
      ? interactiveGoalsToStreams(lastStep.focusedGoals)
      : undefined

    let nextCanvas = mergedCanvas
    const { nextTree, nextActiveId, nextCanvas: reconciledCanvas } = focusedStream
      ? reconcileProofTreeAfterInteraction(
          proofTree,
          canvasState,
          mergedCanvas,
          focusedStream,
          playTactic,
          Boolean(options?.streamSplit),
          activeStreamId,
          exactFocusedStreams,
        )
      : {
          nextTree: proofTree,
          nextActiveId: activeStreamId,
          nextCanvas: mergedCanvas,
        }
    nextCanvas = reconciledCanvas

    setProofTree(nextTree)
    setActiveStreamId(nextActiveId)
    setProofSteps(prev => [...prev, {
      command,
      playTactic,
      leanTactic,
      treeSnapshot: cloneProofTree(nextTree),
      canvasSnapshot: cloneCanvasState(nextCanvas),
      activeStreamIdAfter: nextActiveId,
      transformTargetSnapshot: null,
    }])
    consumeTheoremCopies(options?.consumedTheoremCopyIds)

    if (leanCanvas.completed && options?.solvedGoalId) {
      if (options?.placementHint) clearPositionOverride(options.placementHint.hypId)
      setSolvedGoalId(options.solvedGoalId)
      window.setTimeout(() => {
        setCanvasState(options?.placementHint ? placeHypNearAnchor(nextCanvas, options.placementHint) : nextCanvas)
      }, 700)
      return
    }

    if (options?.placementHint) {
      clearPositionOverride(options.placementHint.hypId)
      triggerGeneratedCardAnimation({
        hypId: options.placementHint.hypId,
        hypName: options.placementHint.hypName,
      })
      nextCanvas = updatePlacedHypPosition(nextCanvas, options.placementHint, options.placementHint.droppedPosition)
      setCanvasState(nextCanvas)
      window.setTimeout(() => {
        setCanvasState(prev => placeHypNearAnchor(prev, options.placementHint!))
      }, 24)
      return
    }

    setCanvasState(nextCanvas)
  }

  async function undoLastStep(): Promise<boolean> {
    if (proofSteps.length === 0 || isProcessing) return false
    setGoalChoiceMenu(null)
    closeReductionTooltip()
    setPendingTransformSync(null)
    setIsProcessing(true)

    const removedStep = proofSteps[proofSteps.length - 1]
    const newSteps = proofSteps.slice(0, -1)
    const newScript = serializeProofCommands(newSteps.map(step => step.command))
    const result = await onInteraction(newScript)

    setIsProcessing(false)
    if (result === null) return false

    const nextTree = newSteps.at(-1)?.treeSnapshot ?? cloneProofTree(initialProofTreeRef.current)
    const nextActiveId = newSteps.at(-1)?.activeStreamIdAfter
      ?? collectActiveStreamIds(nextTree)[0]
      ?? null
    const nextCanvas = newSteps.at(-1)?.canvasSnapshot
      ?? (newSteps.length === 0
        ? cloneCanvasState(initialState)
        : mergeCanvasState(proofStateToCanvas(result), canvasState))

    setProofSteps(newSteps)
    setProofTree(cloneProofTree(nextTree))
    setSolvedGoalId(null)
    setCanvasState(cloneCanvasState(nextCanvas))

    // Navigate to the mode where the undone step was taken.
    // If it was a rewrite (non-null snapshot), restore transformation mode.
    // If it was a combining step (null snapshot), go to combining mode.
    const snapshot = removedStep.transformTargetSnapshot
    if (snapshot !== null) {
      // The undone step was a rewrite — find the same stream in the post-undo canvas
      // (snapshot.streamId is the pre-rewrite stream ID, which is valid in nextCanvas).
      const nextStream = nextCanvas.streams.find(s => s.id === snapshot.streamId)
        ?? nextCanvas.streams[0]
        ?? null
      if (nextStream) {
        setActiveStreamId(nextStream.id)
        if (snapshot.kind === 'goal') {
          setTransformTarget({ kind: 'goal', streamId: nextStream.id })
        } else {
          const nextHyp = nextStream.hyps.find(h => h.hyp.names[0] === snapshot.hypName)
          if (nextHyp) {
            setTransformTarget({ kind: 'hyp', streamId: nextStream.id, hypId: nextHyp.id, hypName: snapshot.hypName })
          } else {
            setActiveStreamId(nextActiveId)
            setTransformTarget(null)
          }
        }
        setTransformationVersion(v => Math.max(0, v - 1))
      } else {
        setActiveStreamId(nextActiveId)
        setTransformTarget(null)
      }
    } else {
      setActiveStreamId(nextActiveId)
      setTransformTarget(null)
    }

    return true
  }

  // ── Drag handlers ───────────────────────────────────────────────────────────

  function handleDragStart(event: DragStartEvent) {
    const theorem = event.active.data.current?.theorem as PropositionTheorem | undefined
    const tactic = event.active.data.current?.tactic as VisualTactic | undefined
    const isTheoremDrag = !!event.active.data.current?.theoremTemplate || !!event.active.data.current?.theoremCopy
    const isTacticDrag = !!event.active.data.current?.visualTactic
    setGoalChoiceMenu(null)
    closeReductionTooltip()
    setActiveDraggedTheorem(isTheoremDrag && theorem ? theorem : null)
    setActiveDraggedTactic(isTacticDrag && tactic ? tactic : null)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { delta, active, over } = event
    setActiveDraggedTheorem(null)
    setActiveDraggedTactic(null)
    const activeId = active.id as string
    const overId = over?.id as string | undefined
    const theoremTemplate = active.data.current?.theoremTemplate
      ? active.data.current.theorem as PropositionTheorem
      : null
    const tacticTemplate = active.data.current?.visualTactic
      ? active.data.current.tactic as VisualTactic
      : null
    const sourceTheoremCopy = getTheoremCopyById(activeId)
    const sourceStream = canvasState.streams.find(s => s.hyps.some(h => h.id === activeId))
    const sourceCard = sourceStream?.hyps.find(h => h.id === activeId)
    const goalIds = new Set(canvasState.streams.map(s => s.id))

    if (tacticTemplate) {
      if (goalIds.has(overId as string)) {
        const playTactic = interactionToPlayTactic({ type: 'drag_tactic', tacticName: tacticTemplate.name })
        applyInteraction(playTactic, activeId, { solvedGoalId: overId as string })
        return
      }

      const targetStream = canvasState.streams.find(s => s.hyps.some(h => h.id === overId))
      const targetCard = targetStream?.hyps.find(h => h.id === overId)
      const targetName = interactionHypName(targetCard)
      if (targetCard && targetStream && targetName) {
        if (tacticTemplate.name === 'induction') {
          const playTactic = interactionToPlayTactic({ type: 'drag_induction', hypName: targetName })
          applyInteraction(playTactic, activeId, { streamSplit: true })
          return
        }
        const placementHint: PlacementHint = {
          hypId: targetCard.id,
          streamId: targetStream.id,
          hypName: targetCard.hyp.names[0] ?? targetName,
          originalPosition: targetCard.position,
          droppedPosition: targetCard.position,
        }
        const playTactic = interactionToPlayTactic({
          type: 'drag_tactic',
          tacticName: tacticTemplate.name,
          targetHypName: targetName,
        })
        applyInteraction(playTactic, activeId, { placementHint })
      }
      return
    }

    if (theoremTemplate) {
      if (over && over.id !== active.id && overId !== THEOREM_TRAY_ID) {
        if (goalIds.has(overId as string)) {
          const playTactic = interactionToPlayTactic({ type: 'drag_goal', hypName: theoremTemplate.theoremName })
          applyInteraction(playTactic, activeId, { solvedGoalId: overId as string })
          return
        }

        const targetStream = canvasState.streams.find(s => s.hyps.some(h => h.id === overId))
        const targetCard = targetStream?.hyps.find(h => h.id === overId)
        const targetTheoremCopy = overId ? getTheoremCopyById(overId) : undefined
        const targetName = interactionHypName(targetCard) ?? targetTheoremCopy?.theorem.theoremName
        if (targetName) {
          const placementHint = targetCard && targetStream
            ? {
                hypId: targetCard.id,
                streamId: targetStream.id,
                hypName: targetCard.hyp.names[0] ?? targetName,
                originalPosition: targetCard.position,
                droppedPosition: targetCard.position,
              }
            : undefined
          const playTactic = interactionToPlayTactic({
            type: 'drag_to',
            nameA: theoremTemplate.theoremName,
            nameB: targetName,
          })
          applyInteraction(playTactic, activeId, placementHint ? { placementHint } : undefined)
          return
        }
      }

      if (overId === THEOREM_TRAY_ID) return
      const startRect = active.rect.current.initial
      if (!startRect) return
      const margin = 50
      createTheoremCopy(theoremTemplate, {
        x: Math.max(margin, Math.min(window.innerWidth - 320, startRect.left + delta.x)),
        y: Math.max(margin, Math.min(window.innerHeight - 220, startRect.top + delta.y)),
      })
      return
    }

    if (sourceTheoremCopy && overId === THEOREM_TRAY_ID) {
      setTheoremCopies(prev => prev.filter(copy => copy.id !== sourceTheoremCopy.id))
      return
    }

    // If dropped on a different card or a goal, it's an interaction
    if (over && over.id !== active.id && overId !== THEOREM_TRAY_ID) {
      const sourceName = interactionHypName(sourceCard) ?? sourceTheoremCopy?.theorem.theoremName
      if (!sourceName) return

      if (goalIds.has(overId as string)) {
        // Dropped on a goal card → drag_goal
        const playTactic = interactionToPlayTactic({ type: 'drag_goal', hypName: sourceName })
        applyInteraction(playTactic, activeId, {
          solvedGoalId: overId as string,
          consumedTheoremCopyIds: sourceTheoremCopy ? [sourceTheoremCopy.id] : undefined,
        })
      } else {
        // Dropped on another hyp card → drag_to (source onto target)
        const targetStream = canvasState.streams.find(s => s.hyps.some(h => h.id === overId))
        const targetCard = targetStream?.hyps.find(h => h.id === overId)
        const targetTheoremCopy = overId ? getTheoremCopyById(overId) : undefined
        const targetName = interactionHypName(targetCard) ?? targetTheoremCopy?.theorem.theoremName
        if (!targetName) return

        let placementHint: PlacementHint | undefined
        if (sourceCard && targetStream && sourceStream) {
          placementHint = {
            hypId: sourceCard.id,
            streamId: targetStream.id,
            hypName: sourceCard.hyp.names[0] ?? sourceName,
            originalPosition: sourceCard.position,
            droppedPosition: {
              x: sourceCard.position.x + delta.x,
              y: sourceCard.position.y + delta.y,
            },
          }
          flushSync(() => {
            setPositionOverrides(prev => ({ ...prev, [placementHint!.hypId]: placementHint!.droppedPosition }))
          })
        }

        const playTactic = interactionToPlayTactic({ type: 'drag_to', nameA: sourceName, nameB: targetName })
        const consumedTheoremCopyIds = [sourceTheoremCopy?.id, targetTheoremCopy?.id]
          .filter((id): id is string => Boolean(id))
        applyInteraction(playTactic, activeId, {
          ...(placementHint ? { placementHint } : {}),
          ...(consumedTheoremCopyIds.length > 0 ? { consumedTheoremCopyIds } : {}),
        })
      }
      return
    }

    // Otherwise just reposition the card
    if (isProcessing) return
    if (sourceTheoremCopy) {
      const margin = 50
      setTheoremCopies(prev => prev.map(copy => {
        if (copy.id !== sourceTheoremCopy.id) return copy
        return {
          ...copy,
          position: {
            x: Math.max(margin, Math.min(window.innerWidth - 320, copy.position.x + delta.x)),
            y: Math.max(margin, Math.min(window.innerHeight - margin, copy.position.y + delta.y)),
          },
        }
      }))
      return
    }
    setCanvasState(prev => {
      const margin = 50
      const obstacleIds = prev.streams.map(s => s.id)
      const streams = prev.streams.map(stream => {
        const moved = stream.hyps.map(h => {
          if (h.id !== activeId) return h
          const newX = Math.max(margin, Math.min(window.innerWidth - 250, h.position.x + delta.x))
          const newY = Math.max(margin, Math.min(window.innerHeight - margin, h.position.y + delta.y))
          return { ...h, position: { x: newX, y: newY } }
        })
        return { ...stream, hyps: resolveCollisions(moved, obstacleIds) }
      })
      return { ...prev, streams }
    })
  }

  // ── Click handlers ──────────────────────────────────────────────────────────

  function hasClickAction(clickAction?: ClickAction): clickAction is ClickAction {
    return Boolean(clickAction?.playTactic || (clickAction?.options.length ?? 0) > 0)
  }

  function hasReductionForms(forms?: string[]): forms is string[] {
    return (forms?.length ?? 0) > 0
  }

  function goalChoiceMenuPosition(goalId: string, optionCount: number): { x: number; y: number } {
    const rect = document.getElementById(goalId)?.getBoundingClientRect()
    const rawX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2
    const rawY = rect ? rect.bottom + 8 : window.innerHeight / 2
    const estimatedWidth = Math.min(
      440,
      48 + optionCount * 180 + Math.max(0, optionCount - 1) * 24,
    )
    const margin = 16
    const halfWidth = Math.min(estimatedWidth / 2, Math.max(0, window.innerWidth / 2 - margin))
    return {
      x: Math.min(Math.max(rawX, margin + halfWidth), window.innerWidth - margin - halfWidth),
      y: rawY,
    }
  }

  function reductionTooltipPosition(element: HTMLElement): { x: number; y: number } {
    const rect = element.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.bottom + 10 }
  }

  function handleReductionContextMenu(
    event: React.MouseEvent<HTMLDivElement>,
    anchorId: string,
    forms?: string[],
  ) {
    event.preventDefault()
    setGoalChoiceMenu(null)
    if (!hasReductionForms(forms)) {
      closeReductionTooltip()
      return
    }
    showReductionTooltip({
      anchorId,
      pos: reductionTooltipPosition(event.currentTarget),
      forms,
    })
  }

  function handleReductionMouseLeave(anchorId: string) {
    closeReductionTooltip(anchorId)
  }

  function handleGoalClick(streamId: string, clickAction?: ClickAction) {
    if (isProcessing || canvasState.completed || !hasClickAction(clickAction)) return
    closeReductionTooltip()
    if (clickAction.options.length > 0) {
      setGoalChoiceMenu({
        goalId: streamId,
        pos: goalChoiceMenuPosition(streamId, clickAction.options.length),
        options: clickAction.options,
      })
      return
    }
    if (!clickAction.playTactic) return
    applyInteraction(clickAction.playTactic, streamId, {
      solvedGoalId: streamId,
      streamSplit: clickAction.streamSplit,
      targetStreamId: streamId,
    })
  }

  function handleGoalChoice(goalId: string, playTactic: string) {
    if (isProcessing || canvasState.completed) return
    applyInteraction(playTactic, goalId, {
      solvedGoalId: goalId,
      targetStreamId: goalId,
    })
  }

  function handleHypClick(streamId: string, cardId: string, clickAction?: ClickAction) {
    if (!hasClickAction(clickAction) || !clickAction.playTactic) return
    applyInteraction(clickAction.playTactic, cardId, {
      streamSplit: clickAction.streamSplit,
      targetStreamId: streamId,
    })
  }

  function handleHypDoubleClick(cardId: string) {
    if (isProcessing || canvasState.completed) return
    const stream = canvasState.streams.find(s => s.hyps.some(h => h.id === cardId))
    const card = stream?.hyps.find(h => h.id === cardId)
    if (!stream || !card) return
    if (!hypIsTransformable(card)) return
    closeReductionTooltip()
    setSolvedGoalId(null)
    setPendingTransformSync(null)
    setIsTransformReverse(false)
    setTransformWorkingSide('right')
    setTransformationVersion(0)
    setTransformTarget({
      kind: 'hyp',
      streamId: stream.id,
      hypId: card.id,
      hypName: card.hyp.names[0] ?? '?',
    })
  }

  // ── TransformationView callbacks ────────────────────────────────────────────

  function handleGoalDoubleClick(streamId: string) {
    if (isProcessing || canvasState.completed) return
    const stream = canvasState.streams.find(s => s.id === streamId)
    if (!stream || !goalIsTransformable(stream)) return
    closeReductionTooltip()
    setSolvedGoalId(null)
    setPendingTransformSync(null)
    setIsTransformReverse(false)
    setTransformWorkingSide('right')
    setTransformationVersion(0)
    setTransformTarget({ kind: 'goal', streamId })
  }

  function closeTransformationView() {
    const pendingSync = pendingTransformSync
    setPendingTransformSync(null)

    if (!pendingSync) {
      setSolvedGoalId(null)
      setTransformTarget(null)
      return
    }

    if (pendingSync.finalCompletion) {
      if (pendingSync.solvedGoalId) setSolvedGoalId(pendingSync.solvedGoalId)
      setTransformTarget(null)
      setProofTree(pendingSync.nextTree)
      setActiveStreamId(pendingSync.nextActiveId)
      // Use celebrationCanvas (shows post-rewrite goal e.g. "0 = 0") if available,
      // so the display is correct during the 700ms celebration window.
      setCanvasState(pendingSync.celebrationCanvas ?? { ...pendingSync.nextCanvas, completed: true })
      window.setTimeout(() => {
        setCanvasState({ ...pendingSync.nextCanvas, completed: true })
        if (pendingSync.finalDisplayCanvas) {
          setDisplayCanvasState(pendingSync.finalDisplayCanvas)
        }
      }, 700)
      return
    }

    setProofTree(pendingSync.nextTree)
    setActiveStreamId(pendingSync.nextActiveId)
    setCanvasState(pendingSync.nextCanvas)
    setSolvedGoalId(null)
    setTransformTarget(null)
  }

  /** Called by TransformationView when a rewrite drag succeeds visually.
   *  Sends drag_rw to Lean and returns whether Lean accepted it. */
  const handleRewrite = useCallback(async (
    hypLabel: string,
    isReverse: boolean,
    workingSide: 'left' | 'right',
    path?: number[],
    expectedGoal?: ExpectedRewriteGoal,
  ): Promise<RewriteOutcome> => {
    const playTactic = interactionToPlayTactic({
      type: 'drag_rw',
      theoremName: hypLabel,
      isReverse,
      workingSide,
      targetHypName: transformTarget?.kind === 'hyp' ? transformTarget.hypName : undefined,
      path,
    })
    if (isProcessing) return { success: false, completed: false }
    const focusedStream = transformTarget
      ? canvasState.streams.find(stream => stream.id === transformTarget.streamId) ?? null
      : null
    const command = focusCommandForStream(playTactic, focusedStream, proofTree)
    closeReductionTooltip()
    setIsProcessing(true)

    const newScript = serializeProofCommands([...proofSteps.map(step => step.command), command])
    const result = await onInteraction(newScript)
    setIsProcessing(false)

    const lastStep = result?.steps.at(-1)
    const annotationLeanTactic = lastStep?.annotation?.leanTactic ?? null
    const leanTactic = result
      ? resolveLeanTactic(annotationLeanTactic, command, playTactic, focusedStream)
      : null
    appendPlayLog(logKey, {
      timestamp: Date.now(),
      playTactic,
      leanTactic,
      succeeded: result !== null,
    })

    if (result === null) return { success: false, completed: false }

    // Compute the new canvas state eagerly so we can update transformingStreamId in the same
    // render cycle — after rw, Lean assigns a new mvarId to the goal, so we must update the
    // tracked stream ID to the stream at the same index, otherwise TransformationView unmounts.
    const leanCanvas = proofStateToCanvas(result)
    const mergedCanvas = mergeCanvasState(leanCanvas, canvasState)
    const exactFocusedStreams = lastStep?.focusedGoals !== undefined
      ? interactiveGoalsToStreams(lastStep.focusedGoals)
      : undefined
    let { nextTree, nextActiveId, focusedStreams, nextCanvas } = focusedStream
      ? reconcileProofTreeAfterInteraction(
          proofTree,
          canvasState,
          mergedCanvas,
          focusedStream,
          playTactic,
          false,
          activeStreamId,
          exactFocusedStreams,
        )
      : {
          nextTree: proofTree,
          nextActiveId: activeStreamId,
        focusedStreams: [] as GoalStream[],
        nextCanvas: mergedCanvas,
      }
    let nextStream = focusedStreams[0] ?? null
    if (
      transformTarget?.kind === 'goal' &&
      nextStream === null &&
      !leanCanvas.completed &&
      focusedStream &&
      expectedGoal
    ) {
      const syntheticStream = synthesizeGoalRewriteContinuation(focusedStream, expectedGoal)
      nextTree = replaceLeafStream(nextTree, focusedStream.id, syntheticStream)
      nextActiveId = syntheticStream.id
      focusedStreams = [syntheticStream]
      nextCanvas = replaceFocusedStreamInCanvas(canvasState, nextCanvas, focusedStream.id, syntheticStream)
      nextStream = syntheticStream
    }
    const shouldKeepReflexiveGoalUntilClick =
      transformTarget?.kind === 'goal' &&
      nextStream === null &&
      leanCanvas.completed &&
      focusedStream !== null &&
      expectedGoal !== undefined &&
      formulasMatch(expectedGoal.lhsStr, expectedGoal.rhsStr)
    if (shouldKeepReflexiveGoalUntilClick && focusedStream && expectedGoal) {
      const syntheticStream = synthesizeGoalRewriteContinuation(focusedStream, expectedGoal)
      nextTree = replaceLeafStream(nextTree, focusedStream.id, syntheticStream)
      nextActiveId = syntheticStream.id
      focusedStreams = [syntheticStream]
      nextCanvas = {
        ...replaceFocusedStreamInCanvas(canvasState, nextCanvas, focusedStream.id, syntheticStream),
        completed: false,
      }
      nextStream = syntheticStream
    }
    const shouldDeferGoalCompletionUntilClose =
      transformTarget?.kind === 'goal' && nextStream === null

    lastTransformRewriteDebugRef.current = {
      playTactic,
      focusedStreamId: focusedStream?.id ?? null,
      focusedGoalType: focusedStream ? TaggedText_stripTags(focusedStream.goal.type).trim() : null,
      focusedGoalUserName: focusedStream?.goal.userName ?? null,
      leanCanvasStreamIds: leanCanvas.streams.map(stream => stream.id),
      leanCanvasGoalTypes: leanCanvas.streams.map(stream => TaggedText_stripTags(stream.goal.type).trim()),
      leanCanvasUserNames: leanCanvas.streams.map(stream => stream.goal.userName ?? null),
      leanCanvasGoalPlayTactics: leanCanvas.streams.map(stream => stream.goal.clickAction?.playTactic ?? null),
      mergedCanvasStreamIds: mergedCanvas.streams.map(stream => stream.id),
      mergedCanvasGoalTypes: mergedCanvas.streams.map(stream => TaggedText_stripTags(stream.goal.type).trim()),
      mergedCanvasUserNames: mergedCanvas.streams.map(stream => stream.goal.userName ?? null),
      exactFocusedStreamIds: exactFocusedStreams?.map(stream => stream.id) ?? [],
      exactFocusedGoalTypes: exactFocusedStreams?.map(stream => TaggedText_stripTags(stream.goal.type).trim()) ?? [],
      exactFocusedUserNames: exactFocusedStreams?.map(stream => stream.goal.userName ?? null) ?? [],
      reconciledFocusedStreamIds: focusedStreams.map(stream => stream.id),
      reconciledFocusedGoalTypes: focusedStreams.map(stream => TaggedText_stripTags(stream.goal.type).trim()),
      reconciledFocusedUserNames: focusedStreams.map(stream => stream.goal.userName ?? null),
      nextStreamId: nextStream?.id ?? null,
      nextGoalType: nextStream ? TaggedText_stripTags(nextStream.goal.type).trim() : null,
      nextGoalUserName: nextStream?.goal.userName ?? null,
      nextActiveId,
      deferredCompletion: shouldDeferGoalCompletionUntilClose,
    }

    setProofSteps(prev => [...prev, {
      command,
      playTactic,
      leanTactic,
      treeSnapshot: cloneProofTree(nextTree),
      canvasSnapshot: cloneCanvasState(nextCanvas),
      activeStreamIdAfter: nextActiveId,
      transformTargetSnapshot: transformTarget,
    }])

    if (shouldDeferGoalCompletionUntilClose) {
      // When the rewrite auto-completes the proof (e.g. rw [add_zero] closes "0 = 0" via rfl),
      // build a celebration canvas that shows the post-rewrite goal so the display is correct
      // during the 700ms celebration window instead of showing the pre-rewrite goal.
      const celebrationCanvas: CanvasState | undefined =
        leanCanvas.completed && focusedStream && expectedGoal
          ? {
              ...canvasState,
              completed: true,
              streams: canvasState.streams.map(stream =>
                stream.id === focusedStream.id
                  ? {
                      ...stream,
                      goal: {
                        ...stream.goal,
                        type: { text: `${expectedGoal.lhsStr} = ${expectedGoal.rhsStr}` },
                        clickAction: undefined,
                      },
                    }
                  : stream
              ),
            }
          : undefined
      setPendingTransformSync({
        nextTree,
        nextActiveId,
        nextCanvas,
        celebrationCanvas,
        finalDisplayCanvas: leanCanvas.completed ? leanCanvas : undefined,
        solvedGoalId: leanCanvas.completed ? transformTarget.streamId : null,
        finalCompletion: leanCanvas.completed,
      })
      return { success: true, completed: leanCanvas.completed }
    }

    setProofTree(nextTree)
    setActiveStreamId(nextActiveId)

    if (leanCanvas.completed && !shouldKeepReflexiveGoalUntilClick) {
      if (transformTarget?.kind === 'goal') setSolvedGoalId(transformTarget.streamId)
      setCanvasState(prev => ({ ...prev, completed: true }))
      window.setTimeout(() => {
        setCanvasState(nextCanvas)
        setDisplayCanvasState(leanCanvas)
        setTransformTarget(null)
      }, 700)
      return { success: true, completed: true }
    }

    setCanvasState(nextCanvas)
    if (nextStream) {
      if (transformTarget?.kind === 'goal') {
        setTransformTarget({ kind: 'goal', streamId: nextStream.id })
      } else if (transformTarget?.kind === 'hyp') {
        const nextHyp = nextStream.hyps.find(card => card.hyp.names[0] === transformTarget.hypName)
        if (nextHyp) {
          setTransformTarget({
            kind: 'hyp',
            streamId: nextStream.id,
            hypId: nextHyp.id,
            hypName: transformTarget.hypName,
          })
        } else {
          setTransformTarget(null)
        }
      }
    } else {
      setTransformTarget(null)
    }
    // Increment version to force TransformationView remount with fresh props even
    // when the stream id is unchanged (rw often keeps the same mvarId).
    setTransformationVersion(v => v + 1)

    return { success: true, completed: false }
  }, [activeStreamId, canvasState, isProcessing, logKey, onInteraction, proofTree, transformTarget])

  // ── Build TransformationView props ──────────────────────────────────────────

  const transformingStream = transformTarget
    ? canvasState.streams.find(s => s.id === transformTarget.streamId)
    : null

  const transformProps = (() => {
    if (!transformingStream) return null

    let goalLhsStr: string
    let goalRhsStr: string
    let goalLhsNode: ReturnType<typeof exprTreeToNode> | undefined
    let goalRhsNode: ReturnType<typeof exprTreeToNode> | undefined

    if (transformTarget?.kind === 'goal') {
      const goalTypeStr = TaggedText_stripTags(transformingStream.goal.type)
      if (transformingStream.equalityTree) {
        goalLhsNode = exprTreeToNode(transformingStream.equalityTree.lhs)
        goalRhsNode = exprTreeToNode(transformingStream.equalityTree.rhs)
      }
      const parsedGoal = parseGoalEquality(goalTypeStr)
      if (parsedGoal) {
        goalLhsStr = parsedGoal.lhsStr
        goalRhsStr = parsedGoal.rhsStr
      } else if (transformingStream.equalityTree) {
        goalLhsStr = printExpression(goalLhsNode!)
        goalRhsStr = printExpression(goalRhsNode!)
      } else {
        return null
      }
    } else {
      const targetCard = transformingStream.hyps.find(card => card.id === transformTarget?.hypId)
      if (!targetCard) return null
      const typeStr = TaggedText_stripTags(targetCard.hyp.type)
      if (targetCard.hyp.equalityTree) {
        goalLhsNode = exprTreeToNode(targetCard.hyp.equalityTree.lhs)
        goalRhsNode = exprTreeToNode(targetCard.hyp.equalityTree.rhs)
      }
      const parsedHyp = parsedHypEquality(targetCard)
      if (parsedHyp) {
        goalLhsStr = parsedHyp.lhsStr
        goalRhsStr = parsedHyp.rhsStr
      } else if (targetCard.hyp.equalityTree) {
        goalLhsStr = printExpression(goalLhsNode!)
        goalRhsStr = printExpression(goalRhsNode!)
      } else {
        return null
      }
    }

    const equalityHyps: EqualityHyp[] = transformingStream.hyps.flatMap(card => {
      if (transformTarget?.kind === 'hyp' && card.id === transformTarget.hypId) return []
      const name = card.hyp.names[0] ?? '?'
      if (card.hyp.equalityTree) {
        const lhs = exprTreeToNode(card.hyp.equalityTree.lhs)
        const rhs = exprTreeToNode(card.hyp.equalityTree.rhs)
        return [{ id: card.id, label: name, lhsStr: printExpression(lhs), rhsStr: printExpression(rhs), lhs, rhs }]
      }
      const parsedHyp = parsedHypEquality(card)
      return parsedHyp
        ? [{ ...parsedHyp, label: name }]
        : []
    })

    return {
      goalLhsStr,
      goalRhsStr,
      goalLhsNode,
      goalRhsNode,
      equalityHyps,
      theoremEqualityHyps,
    }
  })()

  const activeStreamIds = collectActiveStreamIds(proofTree)
  const liveStreamIds = collectLiveStreamIds(proofTree)
  const renderCanvasState = canvasState.streams.length > 0
    ? canvasState
    : displayCanvasState
  const pinnedStreamId =
    pendingTransformSync && transformTarget?.kind === 'goal'
      ? transformTarget.streamId
      : null
  const selectedStreamId = pinnedStreamId ?? activeStreamId
  const defaultStreamId = liveStreamIds.find(streamId =>
    canvasState.streams.some(stream => stream.id === streamId) || streamSnapshots[streamId] !== undefined
  ) ?? activeStreamIds[0] ?? null
  const currentStream = (selectedStreamId
    ? canvasState.streams.find(stream => stream.id === selectedStreamId)
      ?? streamSnapshots[selectedStreamId]
      ?? null
    : null)
    ?? (defaultStreamId
      ? canvasState.streams.find(stream => stream.id === defaultStreamId)
        ?? streamSnapshots[defaultStreamId]
        ?? null
      : canvasState.streams[0] ?? null)
  const currentLeaf = currentStream ? findLeafForStream(proofTree, currentStream.id) : null
  const currentStreamIsLive = currentStream
    ? canvasState.streams.some(stream => stream.id === currentStream.id)
    : false
  const currentStreamIsCompleted = currentLeaf?.completed ?? false
  const displayStream = currentStream
    ? renderCanvasState.streams.find(stream => stream.id === currentStream.id)
      ?? currentStream
    : (solvedGoalId
      ? renderCanvasState.streams.find(stream => stream.id === solvedGoalId) ?? null
      : null)
      ?? renderCanvasState.streams[0]
      ?? null
  const currentStreamIndex = currentStream ? activeStreamIds.indexOf(currentStream.id) : -1
  const totalLeafCount = leafCount(proofTree)
  const visibleHyps = displayStream?.hyps ?? []
  const streamInteractionsEnabled = currentStreamIsLive && !currentStreamIsCompleted && !canvasState.completed
  visualTestStateRef.current = {
    canvasState,
    currentStream,
    currentStreamIsLive,
    currentStreamIsCompleted,
    canvasCompleted: canvasState.completed,
  }
  applyInteractionRef.current = applyInteraction

  function requireInteractiveCurrentStream(): GoalStream {
    const {
      canvasState: latestCanvasState,
      currentStream: latestCurrentStream,
      currentStreamIsLive: latestCurrentStreamIsLive,
      currentStreamIsCompleted: latestCurrentStreamIsCompleted,
      canvasCompleted,
    } = visualTestStateRef.current
    if (!latestCurrentStream || !latestCurrentStreamIsLive || latestCurrentStreamIsCompleted || canvasCompleted) {
      throw new Error('No interactive current stream is available')
    }
    const liveStream = latestCanvasState.streams.find(stream => stream.id === latestCurrentStream.id)
    if (!liveStream) {
      throw new Error(`Current stream ${latestCurrentStream.id} is not live`)
    }
    return liveStream
  }

  function requireHypCard(stream: GoalStream, hypName: string): HypCardType {
    const card = stream.hyps.find(candidate => candidate.hyp.names[0] === hypName)
    if (!card) {
      throw new Error(`Could not find hypothesis "${hypName}" on stream ${stream.id}`)
    }
    return card
  }

  function interactionHypName(card?: HypCardType | null): string | undefined {
    return card?.hyp.playName ?? card?.hyp.names[0]
  }

  async function applyTestDragHypToGoal(hypName: string) {
    const stream = requireInteractiveCurrentStream()
    const sourceCard = requireHypCard(stream, hypName)
    const playTactic = interactionToPlayTactic({
      type: 'drag_goal',
      hypName: interactionHypName(sourceCard) ?? hypName,
    })
    const latestApplyInteraction = applyInteractionRef.current
    if (!latestApplyInteraction) throw new Error('Visual interaction bridge is not ready')
    await latestApplyInteraction(playTactic, sourceCard.id, { solvedGoalId: stream.id })
  }

  async function applyTestDragHypToHyp(sourceName: string, targetName: string) {
    const stream = requireInteractiveCurrentStream()
    const sourceCard = requireHypCard(stream, sourceName)
    const targetCard = requireHypCard(stream, targetName)
    const playTactic = interactionToPlayTactic({
      type: 'drag_to',
      nameA: interactionHypName(sourceCard) ?? sourceName,
      nameB: interactionHypName(targetCard) ?? targetName,
    })
    const latestApplyInteraction = applyInteractionRef.current
    if (!latestApplyInteraction) throw new Error('Visual interaction bridge is not ready')
    await latestApplyInteraction(playTactic, sourceCard.id)
  }

  async function applyTestDragTacticToHyp(tacticName: string, hypName: string) {
    const stream = requireInteractiveCurrentStream()
    const targetCard = requireHypCard(stream, hypName)
    const targetPlayName = interactionHypName(targetCard) ?? hypName
    const latestApplyInteraction = applyInteractionRef.current
    if (!latestApplyInteraction) throw new Error('Visual interaction bridge is not ready')

    if (tacticName === 'induction') {
      const playTactic = interactionToPlayTactic({ type: 'drag_induction', hypName: targetPlayName })
      await latestApplyInteraction(playTactic, `visual_tactic_${tacticName}`, {
        streamSplit: true,
        targetStreamId: stream.id,
      })
      return
    }

    const playTactic = interactionToPlayTactic({
      type: 'drag_tactic',
      tacticName,
      targetHypName: targetPlayName,
    })
    await latestApplyInteraction(playTactic, `visual_tactic_${tacticName}`, {
      targetStreamId: stream.id,
    })
  }

  async function applyTestClickHyp(hypName: string) {
    const stream = requireInteractiveCurrentStream()
    const sourceCard = requireHypCard(stream, hypName)
    const clickAction = sourceCard.hyp.clickAction
    if (!hasClickAction(clickAction) || !clickAction.playTactic) {
      throw new Error(`Hypothesis "${hypName}" is not clickable on stream ${stream.id}`)
    }
    const latestApplyInteraction = applyInteractionRef.current
    if (!latestApplyInteraction) throw new Error('Visual interaction bridge is not ready')
    await latestApplyInteraction(clickAction.playTactic, sourceCard.id, {
      streamSplit: clickAction.streamSplit,
      targetStreamId: stream.id,
    })
  }

  async function applyTestClickGoal(playTactic?: string) {
    const stream = requireInteractiveCurrentStream()
    const clickAction = stream.goal.clickAction
    const latestApplyInteraction = applyInteractionRef.current
    if (!latestApplyInteraction) throw new Error('Visual interaction bridge is not ready')

    if (playTactic) {
      const matchingOption = clickAction?.options.find(option => option.playTactic === playTactic)
      if (!matchingOption) {
        throw new Error(`Goal on stream ${stream.id} does not offer goal tactic "${playTactic}"`)
      }
      await latestApplyInteraction(playTactic, stream.id, {
        solvedGoalId: stream.id,
        targetStreamId: stream.id,
      })
      return
    }

    if (!hasClickAction(clickAction) || !clickAction.playTactic) {
      throw new Error(`Goal on stream ${stream.id} is not directly clickable`)
    }
    await latestApplyInteraction(clickAction.playTactic, stream.id, {
      solvedGoalId: stream.id,
      streamSplit: clickAction.streamSplit,
      targetStreamId: stream.id,
    })
  }

  function openTestGoalTransform() {
    const stream = requireInteractiveCurrentStream()
    handleGoalDoubleClick(stream.id)
  }

  function openTestHypTransform(hypName: string) {
    const stream = requireInteractiveCurrentStream()
    const card = requireHypCard(stream, hypName)
    handleHypDoubleClick(card.id)
  }

  async function applyTestRewriteInTransform(
    theoremName: string,
    workingSide: 'left' | 'right' = 'left',
    path?: number[],
  ) {
    if (transformTarget === null) {
      throw new Error('No transformation session is open')
    }
    const expectedGoal = transformProps
      ? expectedGoalForRewrite(
          transformProps.goalLhsStr,
          transformProps.goalRhsStr,
          transformProps.goalLhsNode,
          transformProps.goalRhsNode,
          transformProps.equalityHyps,
          transformProps.theoremEqualityHyps,
          theoremName,
          false,
          workingSide,
          path,
        )
      : undefined
    const rewriteRef = transformProps
      ? resolveRewriteHyp(transformProps.equalityHyps, transformProps.theoremEqualityHyps, theoremName)?.rewriteRef ?? theoremName
      : theoremName
    const outcome = await handleRewrite(rewriteRef, false, workingSide, path, expectedGoal)
    if (!outcome.success) {
      throw new Error(`Rewrite with "${theoremName}" was rejected`)
    }
  }

  async function applyTestRewriteGoalInTransform(
    theoremName: string,
    workingSide: 'left' | 'right' = 'left',
    path?: number[],
  ) {
    if (transformTarget?.kind !== 'goal') {
      throw new Error('No goal transformation session is open')
    }
    await applyTestRewriteInTransform(theoremName, workingSide, path)
  }

  async function applyTestRewriteHypInTransform(
    theoremName: string,
    workingSide: 'left' | 'right' = 'left',
    path?: number[],
  ) {
    if (transformTarget?.kind !== 'hyp') {
      throw new Error('No hypothesis transformation session is open')
    }
    await applyTestRewriteInTransform(theoremName, workingSide, path)
  }

  function closeTestTransform() {
    closeTransformationView()
  }

  function getTransformStatus() {
    return {
      isOpen: transformTarget !== null,
      pendingSync: pendingTransformSync !== null,
      targetKind: transformTarget?.kind ?? null,
      targetStreamId: transformTarget?.streamId ?? null,
    }
  }

  function getLastTransformRewriteDebug() {
    return lastTransformRewriteDebugRef.current
  }

  function getCurrentStreamSnapshot() {
    const stream = requireInteractiveCurrentStream()
    const displaySnapshot = displayStream ?? null
    return {
      streamId: stream.id,
      displayStreamId: displaySnapshot?.id ?? null,
      goalType: TaggedText_stripTags(stream.goal.type).trim(),
      displayGoalType: displaySnapshot ? TaggedText_stripTags(displaySnapshot.goal.type).trim() : null,
      goalPlayTactic: stream.goal.clickAction?.playTactic ?? null,
      goalOptionTactics: Array.from(stream.goal.clickAction?.options ?? []).map(option => option.playTactic),
      goalHasEqualityTree: stream.equalityTree !== undefined,
      displayGoalHasEqualityTree: displaySnapshot ? displaySnapshot.equalityTree !== undefined : null,
      currentStreamIsLive,
      currentStreamIsCompleted,
      streamInteractionsEnabled,
      canvasStreamIds: canvasState.streams.map(candidate => candidate.id),
      renderStreamIds: renderCanvasState.streams.map(candidate => candidate.id),
      hypTypes: Object.fromEntries(
        stream.hyps
          .map(card => {
            const hypName = card.hyp.names[0]
            return hypName
              ? [hypName, TaggedText_stripTags(card.hyp.type).trim()]
              : null
          })
          .filter((entry): entry is [string, string] => entry !== null),
      ),
      hypPlayTactics: Object.fromEntries(
        stream.hyps
          .map(card => {
            const hypName = card.hyp.names[0]
            return hypName
              ? [hypName, card.hyp.clickAction?.playTactic ?? null]
              : null
          })
          .filter((entry): entry is [string, string | null] => entry !== null),
      ),
      hypOptionTactics: Object.fromEntries(
        stream.hyps
          .map(card => {
            const hypName = card.hyp.names[0]
            return hypName
              ? [hypName, Array.from(card.hyp.clickAction?.options ?? []).map(option => option.playTactic)]
              : null
          })
          .filter((entry): entry is [string, string[]] => entry !== null),
      ),
    }
  }

  useEffect(() => {
    if (!window.Cypress) return

    const harness: VisualCanvasTestHarness = {
      dragHypToGoal: applyTestDragHypToGoal,
      dragHypToHyp: applyTestDragHypToHyp,
      dragTacticToHyp: applyTestDragTacticToHyp,
      clickHyp: applyTestClickHyp,
      clickGoal: applyTestClickGoal,
      openGoalTransform: openTestGoalTransform,
      openHypTransform: openTestHypTransform,
      rewriteGoalInTransform: applyTestRewriteGoalInTransform,
      rewriteHypInTransform: applyTestRewriteHypInTransform,
      closeTransform: closeTestTransform,
      getTransformStatus,
      getLastTransformRewriteDebug,
      getCurrentStreamSnapshot,
    }
    window.__visualTestHarness = harness

    return () => {
      if (window.__visualTestHarness === harness) {
        delete window.__visualTestHarness
      }
    }
  })

  function navigateToStream(streamId: string) {
    if (streamId === currentStream?.id) return
    setGoalChoiceMenu(null)
    closeReductionTooltip()
    setPendingTransformSync(null)
    setTransformTarget(null)
    setActiveStreamId(streamId)
  }

  function goLeft() {
    if (currentStreamIndex <= 0) return
    navigateToStream(activeStreamIds[currentStreamIndex - 1]!)
  }

  function goRight() {
    if (currentStreamIndex < 0 || currentStreamIndex >= activeStreamIds.length - 1) return
    navigateToStream(activeStreamIds[currentStreamIndex + 1]!)
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setActiveDraggedTheorem(null)
          setActiveDraggedTactic(null)
          closeReductionTooltip()
        }}
      >
        <div
          className="visual-page"
          data-testid="visual-proof-page"
          data-world-id={worldId}
          data-level-id={String(levelId)}
          style={{ '--proof-sidebar-width': showProofSidebar ? '280px' : '0px' } as React.CSSProperties}
        >
          <VisualHeader
            worldId={worldId}
            worldTitle={worldTitle ?? undefined}
            levelId={levelId}
            levelTitle={levelTitle}
            hasPrev={levelId > 1}
            hasNext={worldSize == null || levelId < worldSize}
            isCompleted={canvasState.completed}
            previouslyCompleted={previouslyCompleted ?? false}
            onPrev={onPreviousLevel ?? (() => {})}
            onNext={onNextLevel ?? (() => {})}
            onWorldMap={onWorldMap ?? (() => {})}
          />

          {/* Thinking label — below header, centered */}
          {isProcessing && (
            <div className="visual-thinking-label">Thinking…</div>
          )}

          {totalLeafCount > 1 && (
            <div className="proof-tree-panel">
              <ProofStreamGraph
                tree={proofTree}
                currentStreamId={currentStream?.id ?? null}
                onNavigate={navigateToStream}
              />
              {currentStream && (
                <div className="stream-navigator" data-testid="stream-navigator">
                  <button
                    className="stream-nav-btn"
                    data-testid="stream-nav-prev"
                    onClick={goLeft}
                    disabled={currentStreamIndex <= 0}
                  >
                    &lt;
                  </button>
                  <div
                    className="stream-label"
                    data-testid="stream-nav-label"
                    data-current-stream-index={String(currentStreamIndex + 1)}
                    data-total-streams={String(activeStreamIds.length)}
                    data-current-stream-id={currentStream.id}
                  >
                    Stream {currentStreamIndex + 1} of {activeStreamIds.length}
                  </div>
                  <button
                    className="stream-nav-btn"
                    data-testid="stream-nav-next"
                    onClick={goRight}
                    disabled={currentStreamIndex === -1 || currentStreamIndex >= activeStreamIds.length - 1}
                  >
                    &gt;
                  </button>
                </div>
              )}
            </div>
          )}



          <div className="combining-canvas" data-testid="combining-canvas">
            {visibleHyps.map(card => {
              const clickAction = card.hyp.clickAction
              const isClickable = hasClickAction(clickAction)
              const isTransformable = hypIsTransformable(card)
              return (
                <HypCard
                  key={card.id}
                  card={card}
                  streamId={displayStream?.id}
                  positionOverride={positionOverrides[card.id]}
                  animateMove={animatedHyps.some(marker =>
                    marker.hypId === card.id || marker.hypName === (card.hyp.names[0] ?? '')
                  )}
                  isInteractive={streamInteractionsEnabled}
                  isFailing={failingCardId === card.id}
                  isClickable={streamInteractionsEnabled && isClickable}
                  clickTooltip={clickAction?.tooltip}
                  isTransformable={streamInteractionsEnabled && isTransformable}
                  onClickAction={streamInteractionsEnabled && isClickable && displayStream ? () => handleHypClick(displayStream.id, card.id, clickAction) : undefined}
                  onDoubleClick={streamInteractionsEnabled && isTransformable ? () => handleHypDoubleClick(card.id) : undefined}
                  onContextMenu={(event) => handleReductionContextMenu(event, card.id, card.hyp.reductionForms)}
                  onMouseLeave={() => handleReductionMouseLeave(card.id)}
                />
              )
            })}
            {theoremCopies.map(copy => (
              <PropositionTheoremCopyCard
                key={copy.id}
                copy={copy}
                isFailing={failingTheoremCopyId === copy.id}
              />
            ))}
            <div className="goals-container" data-testid="goals-container">
              {displayStream && (() => {
                const stream = displayStream
                const liveGoalStream =
                  currentStream && currentStream.id === stream.id
                    ? currentStream
                    : stream
                const clickAction = liveGoalStream.goal.clickAction ?? stream.goal.clickAction
                const isClickable = hasClickAction(clickAction)
                const isTransformable = goalIsTransformable(liveGoalStream)
                return (
                  <GoalCard
                    key={stream.id}
                    id={stream.id}
                    goal={stream.goal}
                    isInteractive={streamInteractionsEnabled}
                    isTransformable={streamInteractionsEnabled && isTransformable}
                    isClickable={streamInteractionsEnabled && isClickable}
                    clickTooltip={clickAction?.tooltip}
                    isSolved={solvedGoalId === stream.id || currentStreamIsCompleted}
                    onClick={streamInteractionsEnabled && isClickable ? () => handleGoalClick(liveGoalStream.id, clickAction) : undefined}
                    onDoubleClick={streamInteractionsEnabled && isTransformable ? () => handleGoalDoubleClick(liveGoalStream.id) : undefined}
                    onContextMenu={(event) => handleReductionContextMenu(event, stream.id, stream.reductionForms)}
                    onMouseLeave={() => handleReductionMouseLeave(stream.id)}
                  />
                )
              })()}
            </div>
            {reductionTooltip && (
              <div
                className={`defeq-tooltip${reductionTooltip.isClosing ? ' closing' : ''}`}
                style={{ left: reductionTooltip.pos.x, top: reductionTooltip.pos.y }}
              >
                <div className="defeq-tooltip-label">Reduces to</div>
                {reductionTooltip.forms.map((form) => (
                  <div key={form} className="defeq-tooltip-item proposition">{form}</div>
                ))}
              </div>
            )}
            {goalChoiceMenu && (
              <>
                <div className="or-tooltip-backdrop" onClick={() => setGoalChoiceMenu(null)} />
                <div
                  className="or-tooltip"
                  data-testid="goal-choice-menu"
                  data-option-count={String(goalChoiceMenu.options.length)}
                  style={{ left: goalChoiceMenu.pos.x, top: goalChoiceMenu.pos.y }}
                >
                  {goalChoiceMenu.options.map((option, index) => (
                    <React.Fragment key={option.playTactic}>
                      {index > 0 && <span className="or-tooltip-divider">or</span>}
                      <button
                        type="button"
                        className="or-tooltip-btn"
                        data-testid="goal-choice-option"
                        data-play-tactic={option.playTactic}
                        data-option-label={option.label}
                        onClick={() => void handleGoalChoice(goalChoiceMenu.goalId, option.playTactic)}
                      >
                        <span className="or-tooltip-label">{option.label}</span>
                        <span className="proposition">{option.previewText ?? option.label}</span>
                      </button>
                    </React.Fragment>
                  ))}
                </div>
              </>
            )}
            {proofSteps.length > 0 && (
              <div className="tr-controls" style={{ zIndex: 25 }}>
                <button
                  onClick={() => void undoLastStep()}
                  disabled={isProcessing}
                  className="tr-ctrl-btn active-undo"
                  title="Undo"
                >↩</button>
              </div>
            )}
            <TheoremTray
              theorems={propositionTheorems}
              tactics={visualTactics}
              activeTab={activeTrayTab}
              onTabChange={setActiveTrayTab}
            />
          </div>
          <DragOverlay dropAnimation={null}>
            {activeDraggedTheorem
              ? <PropositionTheoremPreviewCard theorem={activeDraggedTheorem} />
              : activeDraggedTactic
                ? <VisualTacticPreviewCard tactic={activeDraggedTactic} />
                : null}
          </DragOverlay>
        </div>
      </DndContext>

      {/* Proof sidebar — outside DndContext so it stays above the transformation overlay */}
      <div className={`proof-sidebar${showProofSidebar ? ' open' : ''}`}>
        <button
          className="proof-sidebar-tab"
          onClick={() => {
            const next = !showProofSidebar
            setShowProofSidebar(next)
            try { localStorage.setItem('visual-proof-sidebar-open', String(next)) } catch {}
          }}
          title={showProofSidebar ? 'Close proof view' : 'Open proof view'}
        >
          <span>Proof</span>
        </button>
        <div className="proof-sidebar-inner">
          <div className="proof-sidebar-header">
            <button
              className={`proof-sidebar-mode-btn${sideViewMode === 'lean' ? ' active' : ''}`}
              onClick={() => {
                setSideViewMode('lean')
                try { localStorage.setItem('visual-proof-view-mode', 'lean') } catch {}
              }}
            >Core</button>
            <button
              className={`proof-sidebar-mode-btn${sideViewMode === 'play' ? ' active' : ''}`}
              onClick={() => {
                setSideViewMode('play')
                try { localStorage.setItem('visual-proof-view-mode', 'play') } catch {}
              }}
            >Interactive</button>
            <button
              className="proof-sidebar-copy-btn"
              onClick={() => {
                const text = sideViewMode === 'lean'
                  ? buildStructuredLeanProof(proofSteps)
                  : proofSteps.map(s => s.playTactic).join('\n')
                navigator.clipboard.writeText(text).catch(() => {})
              }}
              title="Copy to clipboard"
            >Copy</button>
          </div>
          <div className="proof-sidebar-steps">
            {proofSteps.length === 0
              ? <div className="proof-sidebar-empty">No proof steps yet.</div>
              : proofSteps.map((step, i) => {
                  const display = sideViewMode === 'lean'
                    ? (() => {
                        const { casePath } = parseFocusedCommand(step.command)
                        const leaf = stripCasePrefixes(step.leanTactic)
                        if (!leaf) return `? (${step.playTactic})`
                        return shortenQualifiedNames(casePath.reduceRight((inner, c) => `case ${c} => ${inner}`, leaf))
                      })()
                    : (() => {
                        const { casePath } = parseFocusedCommand(step.command)
                        return casePath.reduceRight((inner, c) => `case ${c} => ${inner}`, step.playTactic)
                      })()
                  const isUnknown = sideViewMode === 'lean' && !step.leanTactic
                  return (
                    <div key={i} className={`proof-sidebar-step${isUnknown ? ' unknown' : ''}`}>
                      <span className="proof-sidebar-step-num">{i + 1}</span>
                      <span className="proof-sidebar-step-text">{display}</span>
                    </div>
                  )
                })
            }
          </div>
        </div>
      </div>

      {/* Transformation overlay — outside the canvas DndContext to avoid nesting */}
      {transformProps && (
        <TransformationView
          key={`${transformTarget?.streamId ?? ''}-${transformTarget?.kind ?? ''}-${transformTarget?.kind === 'hyp' ? transformTarget.hypId : ''}-${transformationVersion}`}
          style={{ '--proof-sidebar-width': showProofSidebar ? '280px' : '0px' } as React.CSSProperties}
          goalLhsStr={transformProps.goalLhsStr}
          goalRhsStr={transformProps.goalRhsStr}
          goalLhsNode={transformProps.goalLhsNode}
          goalRhsNode={transformProps.goalRhsNode}
          equalityHyps={transformProps.equalityHyps}
          theoremEqualityHyps={transformProps.theoremEqualityHyps}
          onRewrite={handleRewrite}
          onUndo={undoLastStep}
          canUndo={proofSteps.length > 0}
          onClose={closeTransformationView}
          rewriteStepCount={transformationVersion}
          isReverse={isTransformReverse}
          onIsReverseChange={setIsTransformReverse}
          workingSide={transformWorkingSide}
          onWorkingSideChange={setTransformWorkingSide}
          selectedTab={transformSelectedTab}
          onSelectedTabChange={setTransformSelectedTab}
          headerSlot={
            <VisualHeader
              worldId={worldId}
              worldTitle={worldTitle ?? undefined}
              levelId={levelId}
              levelTitle={levelTitle}
              hasPrev={levelId > 1}
              hasNext={worldSize == null || levelId < worldSize}
              isCompleted={canvasState.completed}
              previouslyCompleted={previouslyCompleted ?? false}
              onPrev={onPreviousLevel ?? (() => {})}
              onNext={onNextLevel ?? (() => {})}
              onWorldMap={onWorldMap ?? (() => {})}
              hideNav
            />
          }
        />
      )}

    </>
  )
}
