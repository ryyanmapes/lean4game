import * as React from 'react'
import { useState, useEffect, useCallback, useLayoutEffect, useRef, useMemo } from 'react'
import { DndContext, DragOverlay, useSensor, useSensors, PointerSensor, pointerWithin } from '@dnd-kit/core'
import type { CollisionDetection } from '@dnd-kit/core'
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core'
import { parse, printExpression, formatFormulaText, applyEqualityRule, applyTheoremRewrite, expressionsEqual, deepCloneWithNewIds, matchesPattern, findMatchingNodeIds, findDisambiguatingRewritePath, findNodeById, sanitizeLeanDisplayName } from './expr-engine'
import { ruleClickTargetId, ruleMatchesNode, ruleMatching } from './ruleMatching'
import type { ExpressionNode } from './expr-types'
import { ExprRenderer } from './ExprRenderer'
import { EqualityHypCard } from './TransformRuleCard'
import { ConnectionArrow } from './ConnectionArrow'
import { VisualInfoText } from './VisualInfoText'
import { ResetIcon, RewriteDirectionIcon, SwapSidesIcon, UndoIcon } from './ControlIcons'
import { useHorizontalSwipe, useSwipePaging } from './useSwipePaging'
import { packAdaptivePages, renderedCardGap } from './adaptivePagination'
import type { VisualTransformInfo } from './types'
import { usePersistentHints } from './hintPersistence'
import { compareTheoremNames } from './theoremOrdering'

let transformationViewInstanceCounter = 0


export interface EqualityHyp {
  id: string       // for hyp cards: fvarId; for theorem cards: theorem name
  label: string    // hypothesis name (e.g. "h") or theorem displayName
  /** Lean-facing identifier to use when this local hypothesis is applied as a rewrite rule. */
  rewriteRef?: string
  lhsStr: string
  rhsStr: string
  lhs: ExpressionNode
  rhs: ExpressionNode
  /** NNG4 inventory category (e.g. "+", "*", "^", "≤", "012", "Peano"). Absent for hyp cards. */
  category?: string
  /** The `∀ …` binders of a quantified rule, shown under the card. */
  forallFooter?: string
  /** A hypothesis the player derived (a green card in Proposition Mode). */
  derived?: boolean
}

export type TransformRelation = '=' | '<' | '>' | '≤' | '≥' | '≠'

export interface ParsedTransformTarget {
  lhsStr: string
  rhsStr: string
  lhs: ExpressionNode
  rhs: ExpressionNode
  relation: TransformRelation
}

interface RewriteOutcome {
  success: boolean
  completed: boolean
}

interface ExpectedRewriteGoal {
  lhsStr: string
  rhsStr: string
  relation: TransformRelation
  explicitReverseArg?: string
}

export interface GuideRect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface GuideArrow {
  start: { x: number; y: number }
  end: { x: number; y: number }
  startPadding?: number
  endPadding?: number
  arc?: 'up' | 'down' | 'none'
  /** The element pointed at. The arrow is cut where it would enter this box, so
   *  its head stops `endGap` short of the element instead of running into it. */
  endRect?: GuideRect
  /** The element the arrow comes from, cut the same way at the start. */
  startRect?: GuideRect
  /** Clear space between the arrow's head and what it points at. */
  endGap?: number
  startGap?: number
}

export function guideRect(rect: DOMRect | GuideRect): GuideRect {
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
}

/** Where the segment from `from` to `to` first enters `rect`, as a fraction of
 * the way along it; `null` if it never does or `from` is already inside. */
function rectEntry(from: { x: number; y: number }, to: { x: number; y: number }, rect: GuideRect): number | null {
  let enter = 0
  let exit = 1
  const dx = to.x - from.x
  const dy = to.y - from.y
  for (const [delta, origin, low, high] of [
    [dx, from.x, rect.left, rect.right],
    [dy, from.y, rect.top, rect.bottom],
  ] as const) {
    if (Math.abs(delta) < 1e-9) {
      if (origin < low || origin > high) return null
      continue
    }
    const t1 = (low - origin) / delta
    const t2 = (high - origin) / delta
    enter = Math.max(enter, Math.min(t1, t2))
    exit = Math.min(exit, Math.max(t1, t2))
  }
  if (enter > exit || enter <= 0) return null
  return enter
}

/** `arrow` with its ends moved to the edges of the boxes it connects, less the gaps. */
export function clipGuideArrow(arrow: GuideArrow): GuideArrow {
  let { start, end } = arrow
  const towards = (from: { x: number; y: number }, to: { x: number; y: number }, distance: number) => {
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1
    return { x: from.x + (to.x - from.x) * distance / length, y: from.y + (to.y - from.y) * distance / length }
  }
  if (arrow.endRect) {
    const t = rectEntry(start, end, arrow.endRect)
    if (t !== null) {
      const edge = { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t }
      end = towards(edge, start, arrow.endGap ?? 10)
    }
  }
  if (arrow.startRect) {
    const t = rectEntry(end, start, arrow.startRect)
    if (t !== null) {
      const edge = { x: end.x + (start.x - end.x) * t, y: end.y + (start.y - end.y) * t }
      start = towards(edge, end, arrow.startGap ?? 8)
    }
  }
  return {
    ...arrow,
    start,
    end,
    startPadding: arrow.startRect ? 0 : arrow.startPadding,
    endPadding: arrow.endRect ? 0 : arrow.endPadding,
  }
}

/** A measured position, as text, for keeping in state. Layout effects measure
 * positions and other layout effects depend on them. As an object, a position
 * gets a new identity whenever React re-applies its queued updates on top of a
 * lower-priority one that is still pending, which a quick resize brings about;
 * the effects depending on it then ran on every render until React gave up
 * ("Maximum update depth exceeded"). The same text compares equal however often
 * it is set. Half pixels are plenty for placing a hint. */
function positionKey(left: number, top: number): string {
  return `${Math.round(left * 2) / 2},${Math.round(top * 2) / 2}`
}

function positionFromKey(key: string | null): { left: number; top: number } | null {
  if (key === null) return null
  const [left, top] = key.split(',').map(Number)
  return { left: left ?? 0, top: top ?? 0 }
}

function rewriteReferenceForDrag(draggedId: string, hyp: EqualityHyp): string {
  // Theorem cards show friendly aliases, but Lean rewrites need the real declaration name.
  return draggedId.startsWith('thm_') ? hyp.id : (hyp.rewriteRef ?? hyp.label)
}

export function InstructionGuideArrow({ arrow: requested, className = '' }: { arrow: GuideArrow; className?: string }) {
  const arrow = clipGuideArrow(requested)
  const dx = arrow.end.x - arrow.start.x
  const dy = arrow.end.y - arrow.start.y
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  // Trim the ends, but never past each other: an arrow shorter than its trims
  // would flip and point back the way it came. Leave room for the head.
  const wantedStartPad = arrow.startPadding ?? 44
  const wantedEndPad = arrow.endPadding ?? (arrow.endRect ? 0 : arrow.endGap ?? 64)
  const trimScale = Math.min(1, Math.max(0, len - 22) / ((wantedStartPad + wantedEndPad) || 1))
  const startPad = wantedStartPad * trimScale
  const endPad = wantedEndPad * trimScale
  const start = {
    x: arrow.start.x + (dx / len) * startPad,
    y: arrow.start.y + (dy / len) * startPad,
  }
  const end = {
    x: arrow.end.x - (dx / len) * endPad,
    y: arrow.end.y - (dy / len) * endPad,
  }
  const curveDx = end.x - start.x
  const curveDy = end.y - start.y
  const curveLen = Math.sqrt(curveDx * curveDx + curveDy * curveDy) || 1
  const sag = arrow.arc === 'none'
    ? 0
    : Math.min(110, Math.max(44, curveLen * 0.14)) * (arrow.arc === 'up' ? -1 : 1)
  const cp1 = {
    x: start.x + curveDx * 0.28,
    y: start.y + curveDy * 0.18 + sag,
  }
  const cp2 = {
    x: start.x + curveDx * 0.76,
    y: start.y + curveDy * 0.82 + sag,
  }
  const headDx = end.x - cp2.x
  const headDy = end.y - cp2.y
  const headLen = Math.sqrt(headDx * headDx + headDy * headDy) || 1
  const ux = headDx / headLen
  const uy = headDy / headLen
  const px = -uy
  const py = ux
  const headLength = 18
  const headHalfWidth = 8
  const base = {
    x: end.x - ux * headLength,
    y: end.y - uy * headLength,
  }
  const shaftEnd = {
    x: base.x + ux * 4,
    y: base.y + uy * 4,
  }
  const path = arrow.arc === 'none'
    ? `M ${start.x} ${start.y} L ${shaftEnd.x} ${shaftEnd.y}`
    : `M ${start.x} ${start.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${shaftEnd.x} ${shaftEnd.y}`
  const arrowHeadPoints = [
    `${end.x},${end.y}`,
    `${base.x + px * headHalfWidth},${base.y + py * headHalfWidth}`,
    `${base.x - px * headHalfWidth},${base.y - py * headHalfWidth}`,
  ].join(' ')

  return (
    <svg className={`visual-instruction-arrow${className ? ` ${className}` : ''}`} aria-hidden="true">
      <path d={path} />
      <polygon points={arrowHeadPoints} />
    </svg>
  )
}

const TRANSFORM_RELATIONS = new Set<TransformRelation>(['=', '<', '>', '≤', '≥', '≠'])

const PHONE_EXPR_BASE_SCALE = 1.04
const PHONE_EXPR_MIN_SCALE = 0.58
/** Phones shrink a wide relation no further than this to avoid scrolling it. */
const PHONE_EXPR_WIDTH_FLOOR_SCALE = 0.8

export function parseTransformTarget(typeStr: string): ParsedTransformTarget | null {
  try {
    const parsed = parse(typeStr.trim())
    if (parsed.type !== 'binary' || !TRANSFORM_RELATIONS.has(parsed.op as TransformRelation)) return null
    return {
      lhsStr: printExpression(parsed.left),
      rhsStr: printExpression(parsed.right),
      lhs: parsed.left,
      rhs: parsed.right,
      relation: parsed.op as TransformRelation,
    }
  } catch {
    return null
  }
}

/** Parse a goal equality string "lhs = rhs" into parts. Returns null if unparseable. */
export function parseGoalEquality(typeStr: string): { lhsStr: string; rhsStr: string } | null {
  const parsed = parseTransformTarget(typeStr)
  if (!parsed || parsed.relation !== '=') return null
  return parsed ? { lhsStr: parsed.lhsStr, rhsStr: parsed.rhsStr } : null
}

/** A back-button lesson authored for a reflexive equality describes the state
 * "both sides now match", not just one particular printed normal form. */
/** Guidance authored with `VisualTransformBackInfoOnHypothesis`. */
export function isHypothesisTransformInfo(info: VisualTransformInfo): boolean {
  return info.target === 'hypothesis'
}

export function transformInfoMatchesGoal(
  info: VisualTransformInfo,
  currentGoalText: string,
  relation: TransformRelation,
  currentSidesMatch: boolean,
): boolean {
  if (!info.goal || formatFormulaText(info.goal) === currentGoalText) return true
  if (info.kind !== 'back' || relation !== '=' || !currentSidesMatch) return false
  const authored = parseTransformTarget(info.goal)
  return authored?.relation === '=' && expressionsEqual(authored.lhs, authored.rhs)
}

/** Try to parse a hyp type string as "lhsStr = rhsStr". */
export function parseEqualityHyp(typeStr: string, hypName: string, hypId: string): EqualityHyp | null {
  const parsed = parseTransformTarget(typeStr)
  if (!parsed || parsed.relation !== '=') return null
  return {
    id: hypId,
    label: hypName,
    lhsStr: parsed.lhsStr,
    rhsStr: parsed.rhsStr,
    lhs: parsed.lhs,
    rhs: parsed.rhs,
  }
}

interface Props {
  relation: TransformRelation
  goalLhsStr: string
  goalRhsStr: string
  /** Pre-parsed nodes from Lean's ExprTree (preferred over parsing goalLhsStr). */
  goalLhsNode?: ExpressionNode
  goalRhsNode?: ExpressionNode
  /** Equality hypotheses from the canvas (draggable rewrite rules). */
  equalityHyps: EqualityHyp[]
  /** Unlocked theorem equalities fetched from the game inventory. */
  theoremEqualityHyps: EqualityHyp[]
  /** Called when the player performs a rewrite drag.
   *  `hypLabel` is the Lean hypothesis/theorem name.
   *  Returns whether Lean accepted the rewrite, and whether it completed the proof. */
  onRewrite: (
    hypLabel: string,
    isReverse: boolean,
    workingSide: 'left' | 'right',
    path?: number[],
    expectedGoal?: ExpectedRewriteGoal,
    occurrence?: number,
  ) => Promise<RewriteOutcome>
  /** Called for each undo step (removes one proof step from the proof script). */
  onUndo: () => Promise<boolean>
  /** Whether the undo button should be enabled (parent has steps to undo). Overrides rewriteStepCount-based check when provided. */
  canUndo?: boolean
  /** Called by the reset button: the relation goes back to how it read when
   *  this view opened (the whole level starts over in a Rewrite-only one). */
  onReset?: () => Promise<boolean>
  /** Whether the reset button is enabled. */
  canReset?: boolean
  /** Called by the swap button; resolves to whether Lean swapped the sides. */
  onSwap?: () => Promise<boolean>
  onClose: () => void
  /** Number of rewrite steps applied in this transformation session (incremented by parent on each rewrite). */
  rewriteStepCount: number
  /** Controlled reverse mode — lifted to parent so it survives target changes. */
  isReverse: boolean
  onIsReverseChange: (v: boolean) => void
  /** Controlled selected tab — lifted to parent so it survives target changes. */
  selectedTab: string
  onSelectedTabChange: (v: string) => void
  /** Remembered desired page per tab — lifted to parent so target changes preserve it. */
  pageIndexByTab: Record<string, number>
  onPageIndexChange: (tabId: string, pageIndex: number) => void
  /** Optional header bar rendered at the top of the overlay. */
  headerSlot?: React.ReactNode
  /** Applied to the overlay root div (e.g. for sidebar-offset positioning). */
  style?: React.CSSProperties
  isPhonePortrait?: boolean
  /** Names of equality-rewriting theorems to highlight with a soft glow. */
  emphasizeItems?: string[]
  /** Full names of the theorems shown in the axiom colour (`VisualAxioms`). */
  axioms?: string[]
  visualInfos?: VisualTransformInfo[]
  /** Rewrite Mode is the whole level: no Back button, and a check mark above the
   *  relation closes the goal once both sides match (`VisualRewriteOnly`). */
  rewriteOnly?: boolean
  /** Hide the rewrite-direction button; every rule rewrites left to right. */
  hideRewriteDirection?: boolean
  /** Hide the swap-sides button (`VisualHideSwapSides`). */
  hideSwapSides?: boolean
  /** No tabs: every rule is in one list (`VisualNoRewriteTabs`). */
  noTabs?: boolean
  /** No tab for the hypotheses alone (`VisualNoHypothesesTab`). */
  noHypothesesTab?: boolean
  /** Labels of rule cards whose `∀ …` footer is highlighted. */
  emphasizeForall?: string[]
  /** Called when the player clicks the check mark; resolves to whether Lean
   *  accepted the closing `rfl`. */
  onCheck?: () => Promise<boolean>
  /** The level is solved: the check mark is shown green. */
  completed?: boolean
  /** Opened on a finished proof to look at a statement: nothing can be changed,
   *  and the check mark only shows over a relation whose sides match. */
  reviewOnly?: boolean
  /** Show the check mark once both sides match although the level isn't Rewrite-only
   *  (`VisualRewriteCheck`, on a goal). */
  rewriteCheck?: boolean
  /** Hints stay up after the rewrite they were written for (`VisualPersistentHints`). */
  persistentHints?: boolean
}

/** The id of the Rewrite Mode tab with this label (`VisualStartTab`); the tab
 *  listing everything when there is none. */
export function rewriteTabId(label: string | undefined): string {
  if (!label || /^everything$/i.test(label)) return 'all'
  if (/^hypothes[ie]s$/i.test(label)) return 'hyps'
  return label
}

function printLeanExpression(node: ExpressionNode): string {
  if (node.type === 'variable') return node.name
  if (node.type === 'constant') return String(node.value)
  if (node.type === 'app') return `${node.func} (${printLeanExpression(node.arg)})`
  return `(${printLeanExpression(node.left)} ${node.op} ${printLeanExpression(node.right)})`
}

export function TransformationView({
  relation, goalLhsStr, goalRhsStr, goalLhsNode, goalRhsNode, equalityHyps, theoremEqualityHyps,
  onRewrite, onUndo, canUndo, onReset, canReset, onSwap, onClose, isReverse, onIsReverseChange,
  selectedTab, onSelectedTabChange, pageIndexByTab, onPageIndexChange, rewriteStepCount, headerSlot, style,
  isPhonePortrait = false, emphasizeItems, axioms, visualInfos = [],
  rewriteOnly = false, hideRewriteDirection = false, hideSwapSides = false, emphasizeForall, onCheck, completed = false,
  rewriteCheck = false, persistentHints = false, noTabs = false, noHypothesesTab = false, reviewOnly = false,
}: Props) {
  const instanceIdRef = useRef(++transformationViewInstanceCounter)
  const initialLhs = useCallback(() => {
    if (goalLhsNode) return deepCloneWithNewIds(goalLhsNode)
    try { return parse(goalLhsStr) } catch { return { type: 'variable' as const, name: goalLhsStr, id: 'lhs-root' } }
  }, [goalLhsNode, goalLhsStr])
  const initialRhs = useCallback(() => {
    if (goalRhsNode) return deepCloneWithNewIds(goalRhsNode)
    try { return parse(goalRhsStr) } catch { return { type: 'variable' as const, name: goalRhsStr, id: 'rhs-root' } }
  }, [goalRhsNode, goalRhsStr])

  const [lhs, setLhs] = useState<ExpressionNode>(initialLhs)
  const [rhs, setRhs] = useState<ExpressionNode>(initialRhs)
  const [history, setHistory] = useState<{ lhs: ExpressionNode; rhs: ExpressionNode }[]>([])
  // A Rewrite-only level never leaves this view, so an undo or reset can change
  // Lean's goal under it without going through the local history. Follow Lean.
  // Elsewhere the local history is what the player sees, except while it is
  // empty, as after a reset or after Undo brings a reset back: then Lean's goal
  // is the only record of the relation, so follow it then too.
  const leanGoalKey = `${goalLhsNode ? printExpression(goalLhsNode) : goalLhsStr} ${relation} ${goalRhsNode ? printExpression(goalRhsNode) : goalRhsStr}`
  const syncedLeanGoalKeyRef = useRef(leanGoalKey)
  useEffect(() => {
    if (syncedLeanGoalKeyRef.current === leanGoalKey) return
    syncedLeanGoalKeyRef.current = leanGoalKey
    if (!rewriteOnly && history.length > 0) return
    setLhs(initialLhs())
    setRhs(initialRhs())
  }, [history.length, initialLhs, initialRhs, leanGoalKey, rewriteOnly])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [arrowStart, setArrowStart] = useState<{ x: number; y: number } | null>(null)
  const [arrowEnd, setArrowEnd] = useState<{ x: number; y: number } | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [failingCardId, setFailingCardId] = useState<string | null>(null)
  const [pageWidth, setPageWidth] = useState(() =>
    typeof window === 'undefined' ? 0 : Math.max(0, window.innerWidth - (isPhonePortrait ? 96 : 160))
  )
  const [cardWidthsByTab, setCardWidthsByTab] = useState<Record<string, Record<string, number>>>({})
  // The gap between cards as laid out; it grows with the interface on a large window.
  const [cardGap, setCardGap] = useState(isPhonePortrait ? 8 : 12)
  // Raised to have every card of the tab measured again (see `remeasureRules`).
  const [measureEpoch, setMeasureEpoch] = useState(0)
  const [ruleDockHeight, setRuleDockHeight] = useState(0)
  const [measuredLayoutKey, setMeasuredLayoutKey] = useState('')
  const [measuredDockLayoutKey, setMeasuredDockLayoutKey] = useState('')
  const hasPresentedReadyDockRef = useRef(false)
  const pageRef = useRef<HTMLDivElement>(null)
  const mainAreaRef = useRef<HTMLDivElement>(null)
  const exprScrollerRef = useRef<HTMLDivElement>(null)
  const exprWrapperRef = useRef<HTMLDivElement>(null)
  const scrollTrackRef = useRef<HTMLDivElement>(null)
  const scrollThumbDragRef = useRef<{ pointerId: number; startX: number; startScrollLeft: number } | null>(null)
  const ruleDockRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const backButtonRef = useRef<HTMLButtonElement>(null)
  const reverseButtonRef = useRef<HTMLButtonElement>(null)
  const reverseInfoRef = useRef<HTMLDivElement>(null)
  const swapButtonRef = useRef<HTMLButtonElement>(null)
  const swapInfoRef = useRef<HTMLDivElement>(null)
  const rewriteInfoRef = useRef<HTMLDivElement>(null)
  const relationRef = useRef<HTMLSpanElement>(null)
  const checkButtonRef = useRef<HTMLButtonElement>(null)
  const checkInfoRef = useRef<HTMLDivElement>(null)
  const lessonsRef = useRef<HTMLDivElement>(null)
  // Positions are kept as text: see `positionKey`.
  const [lessonsSpot, setLessonsSpot] = useState<string | null>(null)
  const lessonsPosition = useMemo(() => positionFromKey(lessonsSpot), [lessonsSpot])
  const [checkSpot, setCheckSpot] = useState<string | null>(null)
  const checkPosition = useMemo(() => positionFromKey(checkSpot), [checkSpot])
  const [checkArrow, setCheckArrow] = useState<GuideArrow | null>(null)
  const suppressRuleClickRef = useRef(false)
  const undoInFlightRef = useRef(false)
  // The whole relation is one row; when it is wider than the screen it
  // scrolls sideways under a scrollbar drawn just above the rule dock.
  const [exprScroll, setExprScroll] = useState({ left: 0, width: 0, viewport: 0 })
  const [phoneExprScale, setPhoneExprScale] = useState<number | null>(null)
  // How far the phone layout moves the expression down from the middle of the
  // main area, into the band between the side label and the lessons below.
  const [phoneExprShift, setPhoneExprShift] = useState(0)
  const phoneExprShiftRef = useRef(0)
  phoneExprShiftRef.current = phoneExprShift
  const [phoneRewriteArrow, setPhoneRewriteArrow] = useState<GuideArrow | null>(null)
  const [backGuide, setBackGuide] = useState<{ style: React.CSSProperties; arrow: GuideArrow } | null>(null)
  const [reverseArrow, setReverseArrow] = useState<{ start: { x: number; y: number }; end: { x: number; y: number }; endRect?: GuideRect } | null>(null)
  const [swapArrow, setSwapArrow] = useState<{ start: { x: number; y: number }; end: { x: number; y: number }; endRect?: GuideRect } | null>(null)
  const [rewriteGuide, setRewriteGuide] = useState<{
    info: VisualTransformInfo
    style: React.CSSProperties
    arrow: GuideArrow
  } | null>(null)

  useLayoutEffect(() => {
    const el = pageRef.current
    if (!el) return
    // Measure before the first paint, so the rules are paged right from the start.
    const style = window.getComputedStyle(el)
    setPageWidth(el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight))
    const observer = new ResizeObserver(entries => setPageWidth(entries[0].contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const scroller = exprScrollerRef.current
    const expr = exprWrapperRef.current
    if (!scroller || !expr) return
    const update = () => {
      const next = { left: scroller.scrollLeft, width: scroller.scrollWidth, viewport: scroller.clientWidth }
      setExprScroll(prev =>
        Math.abs(prev.left - next.left) < 0.5 && Math.abs(prev.width - next.width) < 0.5 &&
        Math.abs(prev.viewport - next.viewport) < 0.5 ? prev : next)
    }
    update()
    scroller.addEventListener('scroll', update, { passive: true })
    if (typeof ResizeObserver === 'undefined') {
      return () => scroller.removeEventListener('scroll', update)
    }
    const observer = new ResizeObserver(update)
    observer.observe(scroller)
    observer.observe(expr)
    return () => {
      scroller.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [])

  const exprScrollRange = Math.max(0, exprScroll.width - exprScroll.viewport)
  const isExprOverflowing = exprScrollRange > 1
  const scrollThumbFraction = isExprOverflowing ? exprScroll.viewport / exprScroll.width : 1
  const scrollThumbPosition = isExprOverflowing ? exprScroll.left / exprScrollRange : 0

  /** Pixels of expression scroll per pixel of thumb travel along the track. */
  const scrollPerTrackPixel = () => {
    const track = scrollTrackRef.current
    if (!track) return 0
    const trackWidth = track.getBoundingClientRect().width
    const thumbTravel = trackWidth * (1 - scrollThumbFraction)
    return thumbTravel > 0 ? exprScrollRange / thumbTravel : 0
  }

  const handleScrollTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const scroller = exprScrollerRef.current
    const track = scrollTrackRef.current
    if (!scroller || !track || !isExprOverflowing) return
    e.preventDefault()
    const trackRect = track.getBoundingClientRect()
    const thumbWidth = trackRect.width * scrollThumbFraction
    const thumbLeft = trackRect.left + (trackRect.width - thumbWidth) * scrollThumbPosition
    if (e.clientX < thumbLeft || e.clientX > thumbLeft + thumbWidth) {
      // Pressing the track away from the thumb centres the thumb there.
      const centred = (e.clientX - trackRect.left - thumbWidth / 2) / Math.max(1, trackRect.width - thumbWidth)
      scroller.scrollLeft = Math.min(1, Math.max(0, centred)) * exprScrollRange
    }
    track.setPointerCapture(e.pointerId)
    scrollThumbDragRef.current = { pointerId: e.pointerId, startX: e.clientX, startScrollLeft: scroller.scrollLeft }
  }

  const handleScrollTrackPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = scrollThumbDragRef.current
    const scroller = exprScrollerRef.current
    if (!drag || drag.pointerId !== e.pointerId || !scroller) return
    scroller.scrollLeft = drag.startScrollLeft + (e.clientX - drag.startX) * scrollPerTrackPixel()
  }

  const handleScrollTrackPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (scrollThumbDragRef.current?.pointerId === e.pointerId) scrollThumbDragRef.current = null
  }

  // A mouse wheel has no sideways axis; let it scroll a wide relation.
  const handleExprWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const scroller = exprScrollerRef.current
    if (!scroller || !isExprOverflowing || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return
    scroller.scrollLeft += e.deltaY
  }

  // Flat ordered list: hypotheses first (backend order), then theorems (backend order)
  const allRules = useMemo(() => [
    ...equalityHyps.map(h => ({ ...h, dragId: `hyp_${h.id}` })),
    ...[...theoremEqualityHyps]
      .sort((left, right) => compareTheoremNames(left.label || left.id, right.label || right.id))
      .map(t => ({ ...t, dragId: `thm_${t.id}` })),
  ], [equalityHyps, theoremEqualityHyps])

  // Build tab list: "Hypotheses" always first, then one tab per unique category in
  // the theorem rules, in the order they first appear (matching NNG4 inventory order).
  const tabs = useMemo(() => {
    const catOrder: string[] = []
    const seen = new Set<string>()
    let hasUncategorized = false
    allRules.forEach(r => {
      if (!r.dragId.startsWith('thm_')) return
      if (r.category) {
        if (!seen.has(r.category)) { seen.add(r.category); catOrder.push(r.category) }
      } else {
        hasUncategorized = true
      }
    })
    const result: { id: string; label: string }[] = [{ id: 'all', label: 'Everything' }]
    // With one tab there is no tab bar: every rule is in one list.
    if (noTabs) return result
    if (!noHypothesesTab) result.push({ id: 'hyps', label: 'Hypotheses' })
    catOrder.forEach(cat => result.push({ id: cat, label: cat }))
    if (hasUncategorized) result.push({ id: 'other', label: 'Other' })
    return result
  }, [allRules, noHypothesesTab, noTabs])

  // Clamp selectedTab to a valid tab when tabs change
  useEffect(() => {
    if (!tabs.find(t => t.id === selectedTab)) {
      onSelectedTabChange(tabs[0]?.id ?? 'hyps')
    }
  }, [tabs, selectedTab])

  // Filter rules by the selected tab
  const tabRules = useMemo(() => {
    if (selectedTab === 'all') return allRules
    if (selectedTab === 'hyps') return allRules.filter(r => r.dragId.startsWith('hyp_'))
    if (selectedTab === 'other') return allRules.filter(r => r.dragId.startsWith('thm_') && !r.category)
    return allRules.filter(r => r.dragId.startsWith('thm_') && r.category === selectedTab)
  }, [allRules, selectedTab])

  const ruleDockLayoutKey = useMemo(() => JSON.stringify({
    measureEpoch,
    selectedTab,
    isReverse,
    pageWidth: Math.round(pageWidth),
    rules: tabRules.map(rule => [
      rule.dragId,
      rule.label,
      rule.lhsStr,
      rule.rhsStr,
      (rule as EqualityHyp & { forallFooter?: string }).forallFooter ?? '',
    ]),
  }), [isReverse, measureEpoch, pageWidth, selectedTab, tabRules])

  // Track cards independently so each page can hold as many of its own cards
  // as fit, rather than inheriting the width of the tab's widest theorem.
  useLayoutEffect(() => {
    const el = pageRef.current
    if (!el) return
    let cancelled = false
    const measure = () => {
      if (cancelled) return
      const cards = Array.from(el.querySelectorAll<HTMLElement>('.tr-rule-card'))
      setCardGap(prev => {
        const gap = renderedCardGap(el, prev)
        return Math.abs(prev - gap) > 0.25 ? gap : prev
      })
      setCardWidthsByTab(prev => {
        const previous = prev[selectedTab] ?? {}
        const next = { ...previous }
        let changed = false
        cards.forEach(card => {
          const id = card.dataset.ruleId
          if (!id) return
          const width = card.getBoundingClientRect().width
          if (Math.abs((next[id] ?? 0) - width) > 0.5) {
            next[id] = width
            changed = true
          }
        })
        if (!changed) return prev
        return { ...prev, [selectedTab]: next }
      })
    }

    // A cold browser initially lays theorem cards out with its fallback font.
    // Keep the provisional all-rules row intact until the real fonts settle;
    // otherwise the first, wider measurement creates one-card pages and the
    // cards moved to later pages are no longer present to be remeasured.
    measure()
    // Measuring has laid the cards out, so a font they need has started loading by
    // now. With none pending the measurement is final, and the dock can show in this
    // very frame instead of popping in after the expression.
    if (document.fonts && document.fonts.status !== 'loaded') {
      void document.fonts.ready.then(() => {
        if (cancelled) return
        measure()
        setMeasuredLayoutKey(ruleDockLayoutKey)
      })
    } else {
      setMeasuredLayoutKey(ruleDockLayoutKey)
    }
    return () => { cancelled = true }
  }, [ruleDockLayoutKey, selectedTab])

  const hasRules = tabRules.length > 0
  const measuredWidths = cardWidthsByTab[selectedTab] ?? {}
  const hasMeasurements = measuredLayoutKey === ruleDockLayoutKey &&
    tabRules.every(rule => measuredWidths[rule.dragId] > 0)
  const pages = hasMeasurements
    ? packAdaptivePages(tabRules.map(rule => measuredWidths[rule.dragId] ?? pageWidth), pageWidth, cardGap)
    : [{ start: 0, end: tabRules.length }]
  const desiredPage = pageIndexByTab[selectedTab] ?? 0
  const totalPages = pages.length
  const clampedPage = Math.min(Math.max(0, desiredPage), totalPages - 1)
  const pageRange = pages[clampedPage] ?? { start: 0, end: 0 }
  const pageItems = tabRules.slice(pageRange.start, pageRange.end)
  const dockLayoutKey = `${ruleDockLayoutKey}:${clampedPage}:${pageRange.start}:${pageRange.end}`
  const layoutReady = hasMeasurements && measuredDockLayoutKey === dockLayoutKey && ruleDockHeight > 0
  if (layoutReady) hasPresentedReadyDockRef.current = true
  // Rewrites and player tab changes can replace the rule list while the next
  // measurements are being committed. Once the dock has a measured height,
  // keep that stable shell painted during the handoff; hiding it again for a
  // single frame is the menu-bar flash players see after a rewrite.
  // Should the measurements never settle, the view still has to show something:
  // after a moment, present the rules as they are rather than a blank page.
  const [forcedReady, setForcedReady] = useState(false)
  const dockPresentationReady = layoutReady || hasPresentedReadyDockRef.current || forcedReady
  useEffect(() => {
    if (dockPresentationReady) return
    const timer = window.setTimeout(() => {
      console.warn('Rewrite Mode: the rule dock did not settle; showing it as it is', {
        hasMeasurements, keyMatch: measuredLayoutKey === ruleDockLayoutKey,
        dockKeyMatch: measuredDockLayoutKey === dockLayoutKey, ruleDockHeight, pageWidth, rules: tabRules.length,
      })
      setForcedReady(true)
    }, 600)
    return () => window.clearTimeout(timer)
  }, [dockPresentationReady, dockLayoutKey, hasMeasurements, measuredDockLayoutKey, measuredLayoutKey,
    pageWidth, ruleDockHeight, ruleDockLayoutKey, tabRules.length])

  useLayoutEffect(() => {
    if (!hasMeasurements) return
    const dock = ruleDockRef.current
    if (!dock) return

    const updateHeight = () => {
      const nextHeight = dock.offsetHeight
      setRuleDockHeight(prev => (Math.abs(prev - nextHeight) <= 0.5 ? prev : nextHeight))
      setMeasuredDockLayoutKey(dockLayoutKey)
    }

    updateHeight()

    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => updateHeight())
    observer.observe(dock)
    return () => observer.disconnect()
  }, [dockLayoutKey, hasMeasurements])

  // The pages are packed from widths taken when the rules last changed. The
  // cards can change size without the rules changing: a font arrives, or the
  // window is resized and the interface rescales. So watch the cards on screen,
  // and when one no longer has the width it was packed with, or the page's row
  // has outgrown the page, measure every card of the tab again. A burst of
  // such rounds is cut short, so that a card that never settles can't keep the
  // dock remeasuring; once things have been quiet for a while the count starts
  // over, since a later resize is a new change, not the same one again.
  const remeasureRoundsRef = useRef({ rounds: 0, last: 0 })
  useEffect(() => {
    if (!hasMeasurements) return
    const page = pageRef.current
    if (!page || typeof ResizeObserver === 'undefined') return
    const remeasureRules = () => {
      const now = Date.now()
      const burst = remeasureRoundsRef.current
      if (now - burst.last > 1000) burst.rounds = 0
      if (burst.rounds >= 4) return
      burst.rounds += 1
      burst.last = now
      setMeasureEpoch(epoch => epoch + 1)
    }
    const check = () => {
      const cards = Array.from(page.querySelectorAll<HTMLElement>('.tr-rule-card'))
      const resized = cards.some(card => {
        const id = card.dataset.ruleId
        const width = card.getBoundingClientRect().width
        return id !== undefined && width > 0 && Math.abs((measuredWidths[id] ?? 0) - width) > 0.5
      })
      const row = page.querySelector<HTMLElement>('.tr-rule-page-cards')
      const overflowing = cards.length > 1 && row !== null && row.scrollWidth - row.clientWidth > 1
      const gapChanged = Math.abs(renderedCardGap(page, cardGap) - cardGap) > 0.25
      if (resized || overflowing || gapChanged) remeasureRules()
    }
    const observer = new ResizeObserver(check)
    page.querySelectorAll('.tr-rule-card').forEach(card => observer.observe(card))
    const fonts = typeof document === 'undefined' ? undefined : document.fonts
    fonts?.addEventListener?.('loadingdone', check)
    return () => {
      observer.disconnect()
      fonts?.removeEventListener?.('loadingdone', check)
    }
  }, [cardGap, dockLayoutKey, hasMeasurements, measuredWidths])

  // On a touch screen a sideways swipe on the lower menu sets the rewrite direction:
  // to the right for left-to-right rules, to the left for right-to-left ones (a
  // right-click swaps it with a mouse). The pages are turned with their buttons.
  // Where the direction is fixed, a swipe turns the page as it does elsewhere.
  const directionSwipe = useHorizontalSwipe(
    direction => {
      const reverse = direction === 'left'
      if (reverse !== isReverse) onIsReverseChange(reverse)
    },
    hideRewriteDirection || isProcessing,
  )
  const pageSwipeHandlers = useSwipePaging({
    currentPage: clampedPage,
    totalPages,
    disabled: !hideRewriteDirection || !hasRules || isProcessing,
    onPageChange: page => {
      onPageIndexChange(selectedTab, page)
      setHoveredId(null)
    },
  })

  // Emphasis: glow on matching cards; direct page buttons toward emphasized items.
  const isEmphasizedRule = (rule: { id: string }) =>
    emphasizeItems != null && emphasizeItems.includes(rule.id)
  // Axioms keep their colour on whichever tab they are filed under.
  const axiomNames = useMemo(() => new Set((axioms ?? []).flatMap(name =>
    [name, name.split('.').at(-1) ?? name])), [axioms])
  const isAxiomRule = (rule: { id: string; label: string; dragId: string }) =>
    rule.dragId.startsWith('thm_') && (axiomNames.has(rule.id) || axiomNames.has(rule.label))
  const emphIndexesInTab = tabRules.reduce<number[]>((acc, rule, i) => {
    if (isEmphasizedRule(rule)) acc.push(i)
    return acc
  }, [])
  const emphVisibleNow = pageItems.some(r => isEmphasizedRule(r))
  const emphOnPrevPage = !emphVisibleNow && emphIndexesInTab.some(i => i < pageRange.start)
  const emphOnNextPage = !emphVisibleNow && emphIndexesInTab.some(i => i >= pageRange.end)

  const currentGoalText = formatFormulaText(`${printExpression(lhs)} ${relation} ${printExpression(rhs)}`)
  const currentSidesMatch = relation === '=' && expressionsEqual(lhs, rhs)
  const matchingVisualInfos = useMemo(
    () => visualInfos.filter(info =>
      transformInfoMatchesGoal(info, currentGoalText, relation, currentSidesMatch)),
    [currentGoalText, currentSidesMatch, relation, visualInfos],
  )
  const activeVisualInfos = usePersistentHints(
    persistentHints, rewriteStepCount, matchingVisualInfos,
    infos => infos.length === 0, infos => infos,
  )
  // Lessons stack right above the relation sign. A phone keeps them in the
  // controls' row, where its narrow screen has room for them, except in a
  // Rewrite-only level, whose page has no canvas lessons to make way for.
  const stackedLessons = rewriteOnly || !isPhonePortrait
  // A Rewrite-only level has no Back button to point at.
  const backInfo = rewriteOnly ? undefined : activeVisualInfos.find(info => info.kind === 'back' && info.text)
  const generalInfo = activeVisualInfos.find(info => info.kind === 'info' && info.text)
  const reverseInfo = hideRewriteDirection
    ? undefined
    : activeVisualInfos.find(info => info.kind === 'reverse' && info.text)
  // The swap button turns `a = b` into `b = a`, and `a ≠ b` likewise. A
  // comparison would need its sign turned around too, so it gets no button.
  const showSwap = !!onSwap && !hideSwapSides && (relation === '=' || relation === '≠')
  const swapInfo = showSwap
    ? activeVisualInfos.find(info => info.kind === 'swap' && info.text)
    : undefined
  // The check mark closes the goal once both sides are the same: always in a
  // Rewrite-only level, and on any goal in a game with `VisualRewriteCheck`.
  const showCheck = (rewriteOnly || rewriteCheck) && (currentSidesMatch || (completed && !reviewOnly))
  // The hint stays once the check mark has been clicked, like every other hint.
  const checkInfo = showCheck
    ? activeVisualInfos.find(info => info.kind === 'check' && info.text)
    : undefined
  const rewriteInfos = useMemo(
    () => activeVisualInfos.filter(info => info.kind === 'rewrite' && info.text),
    [activeVisualInfos],
  )

  useLayoutEffect(() => {
    if (!isPhonePortrait) {
      setPhoneExprScale(prev => prev == null ? prev : null)
      setPhoneExprShift(prev => prev === 0 ? prev : 0)
      return
    }

    const main = mainAreaRef.current
    const expr = exprWrapperRef.current
    const scroller = exprScrollerRef.current
    if (!main || !expr || !scroller) return

    let rafId: number | null = null
    const updateScale = () => {
      if (rafId != null) window.cancelAnimationFrame(rafId)
      rafId = window.requestAnimationFrame(() => {
        const exprRect = expr.getBoundingClientRect()
        const scrollerRect = scroller.getBoundingClientRect()
        const mainRect = main.getBoundingClientRect()
        if (exprRect.width <= 0 || exprRect.height <= 0 || mainRect.width <= 0 || mainRect.height <= 0) return

        // The band the expression may use: below the back button, above the
        // controls along the bottom. Lessons come and go and are left out, so
        // they never move the expression; the bottom ones sit well below it.
        const gap = 12
        const bandTop = mainRect.top + parseFloat(getComputedStyle(main).paddingTop)
        const belowTops = Array.from(main.querySelectorAll<HTMLElement>(
          '.tr-controls .tr-ctrl-btn, .tr-side-controls .tr-ctrl-btn',
        ))
          .map(element => element.getBoundingClientRect().top)
          .filter(top => top > bandTop)
        const bandBottom = Math.min(mainRect.bottom, ...belowTops) - gap

        // Font-size scaling changes layout size, so the expression's own width
        // is its scaled width. Shrink towards the width floor to keep a short
        // relation on screen; anything wider than that scrolls sideways.
        const currentScale = phoneExprScale ?? PHONE_EXPR_BASE_SCALE
        const unscaledWidth = exprRect.width / currentScale
        const unscaledHeight = exprRect.height / currentScale
        const availableWidth = Math.max(120, mainRect.width - 24)
        const availableHeight = Math.max(40, bandBottom - bandTop)
        const fitScale = Math.min(
          PHONE_EXPR_BASE_SCALE,
          Math.max(PHONE_EXPR_WIDTH_FLOOR_SCALE, availableWidth / unscaledWidth),
          availableHeight / unscaledHeight,
        )
        const nextScale = Math.max(PHONE_EXPR_MIN_SCALE, Number(fitScale.toFixed(3)))
        setPhoneExprScale(prev => (prev != null && Math.abs(prev - nextScale) < 0.01) ? prev : nextScale)
        // The shift moves the whole scroller; scaling keeps its centre.
        const naturalCenter = (scrollerRect.top + scrollerRect.bottom) / 2 - phoneExprShiftRef.current
        const nextShift = Math.round((bandTop + bandBottom) / 2 - naturalCenter)
        setPhoneExprShift(prev => Math.abs(prev - nextShift) < 1 ? prev : nextShift)
      })
    }

    updateScale()
    window.addEventListener('resize', updateScale)

    if (typeof ResizeObserver === 'undefined') {
      return () => {
        if (rafId != null) window.cancelAnimationFrame(rafId)
        window.removeEventListener('resize', updateScale)
      }
    }

    const observer = new ResizeObserver(updateScale)
    observer.observe(main)
    observer.observe(expr)

    return () => {
      if (rafId != null) window.cancelAnimationFrame(rafId)
      window.removeEventListener('resize', updateScale)
      observer.disconnect()
    }
  }, [isPhonePortrait, phoneExprScale, lhs, rhs, ruleDockHeight])

  const cssEscape = (value: string) => {
    const escapeFn = (window as Window & { CSS?: { escape?: (value: string) => string } }).CSS?.escape
    return escapeFn ? escapeFn(value) : value.replace(/["\\]/g, '\\$&')
  }

  useLayoutEffect(() => {
    const updateGuides = () => {
      // The back lesson sits just right of the Back button, level with its
      // top, with a short arrow across to it.
      const overlay = overlayRef.current
      if (backInfo && backButtonRef.current && overlay) {
        const backRect = backButtonRef.current.getBoundingClientRect()
        const overlayRect = overlay.getBoundingClientRect()
        const left = backRect.right + (isPhonePortrait ? 40 : 52)
        const centreY = backRect.top + backRect.height / 2
        setBackGuide({
          style: {
            left: left - overlayRect.left,
            top: backRect.top - overlayRect.top,
            maxWidth: Math.max(160, Math.min(360, overlayRect.right - left - 12)),
          },
          arrow: {
            start: { x: left, y: centreY },
            end: { x: backRect.right, y: centreY },
            startPadding: 6,
            endPadding: 6,
            arc: 'none',
          },
        })
      } else {
        setBackGuide(null)
      }

      if (reverseInfo && reverseInfoRef.current && reverseButtonRef.current) {
        const infoRect = reverseInfoRef.current.getBoundingClientRect()
        const reverseRect = reverseButtonRef.current.getBoundingClientRect()
        const reverseCenterX = reverseRect.left + reverseRect.width / 2
        const reverseCenterY = reverseRect.top + reverseRect.height / 2
        setReverseArrow({
          endRect: guideRect(reverseRect),
          start: isPhonePortrait
            ? {
                x: reverseCenterX,
                y: infoRect.bottom,
              }
            : {
                x: infoRect.right,
                y: infoRect.top + infoRect.height / 2,
              },
          end: {
            x: reverseCenterX,
            y: reverseCenterY,
          },
        })
      } else {
        setReverseArrow(null)
      }

      if (swapInfo && swapInfoRef.current && swapButtonRef.current) {
        const infoRect = swapInfoRef.current.getBoundingClientRect()
        const swapRect = swapButtonRef.current.getBoundingClientRect()
        const swapCenterX = swapRect.left + swapRect.width / 2
        const swapCenterY = swapRect.top + swapRect.height / 2
        setSwapArrow({
          endRect: guideRect(swapRect),
          start: isPhonePortrait
            ? { x: swapCenterX, y: infoRect.bottom }
            : { x: infoRect.right, y: infoRect.top + infoRect.height / 2 },
          end: { x: swapCenterX, y: swapCenterY },
        })
      } else {
        setSwapArrow(null)
      }

      const page = pageRef.current
      let nextRewriteGuide: {
        info: VisualTransformInfo
        style: React.CSSProperties
        arrow: GuideArrow
      } | null = null
      if (page) {
        for (const info of rewriteInfos) {
          const source = info.source?.trim()
          const target = info.target?.trim()
          if (!source || !target) continue
          // Lessons name the Lean hypothesis; its card may show the name the way
          // Visual Lean displays it (`h_1` as `h1`).
          const sourceEl = page.querySelector<HTMLElement>(`[data-rule-label="${cssEscape(source)}"]`)
            ?? page.querySelector<HTMLElement>(`[data-rule-label="${cssEscape(sanitizeLeanDisplayName(source))}"]`)
          const targetEls = Array.from(mainAreaRef.current?.querySelectorAll<HTMLElement>(`[data-expr-text="${cssEscape(target)}"]`) ?? [])
          const targetEl = targetEls
            .sort((a, b) => {
              const ar = a.getBoundingClientRect()
              const br = b.getBoundingClientRect()
              return (ar.width * ar.height) - (br.width * br.height)
            })[0]
          if (!sourceEl || !targetEl) continue
          const sourceRect = sourceEl.getBoundingClientRect()
          const targetRect = targetEl.getBoundingClientRect()
          const start = { x: sourceRect.left + sourceRect.width / 2, y: sourceRect.top + sourceRect.height / 2 }
          const end = { x: targetRect.left + targetRect.width / 2, y: targetRect.top + targetRect.height / 2 }
          const edges = { startRect: guideRect(sourceRect), endRect: guideRect(targetRect) }
          if (stackedLessons) {
            // The lesson sits with the others above the relation sign; the
            // arrow runs from the rule card to the term.
            nextRewriteGuide = { info, style: {}, arrow: { start, end, ...edges } }
            break
          }
          // A phone: CSS places the lesson in the controls' row with the
          // others; its arrow runs from the lesson's top edge up to the bottom
          // of the term to rewrite once the lesson is laid out (phoneRewriteArrow).
          const targetBottom = { x: end.x, y: targetRect.bottom }
          nextRewriteGuide = { info, style: {}, arrow: { start: targetBottom, end: targetBottom } }
          break
        }
      }
      setRewriteGuide(nextRewriteGuide)
    }

    updateGuides()
    window.addEventListener('resize', updateGuides)
    window.addEventListener('scroll', updateGuides, true)
    // Opening or closing the proof sidebar slides the Back button and the row.
    window.addEventListener('transitionend', updateGuides, true)
    window.addEventListener('animationend', updateGuides, true)
    return () => {
      window.removeEventListener('resize', updateGuides)
      window.removeEventListener('scroll', updateGuides, true)
      window.removeEventListener('transitionend', updateGuides, true)
      window.removeEventListener('animationend', updateGuides, true)
    }
  }, [backInfo, reverseInfo, rewriteInfos, lhs, rhs, selectedTab, clampedPage, pageItems.length, isReverse, ruleDockHeight, isPhonePortrait,
    phoneExprScale, phoneExprShift, stackedLessons, generalInfo, checkInfo, swapInfo, lessonsSpot])

  // The check mark floats just above the relation sign, wherever the row has
  // scrolled; its lesson's arrow runs from the lesson down to it.
  useLayoutEffect(() => {
    if (!showCheck) {
      setCheckSpot(null)
      setCheckArrow(null)
      return
    }
    const update = () => {
      const overlay = overlayRef.current
      const relationEl = relationRef.current
      if (!overlay || !relationEl) return
      const overlayRect = overlay.getBoundingClientRect()
      const relationRect = relationEl.getBoundingClientRect()
      const left = relationRect.left + relationRect.width / 2 - overlayRect.left
      const top = relationRect.top - overlayRect.top - 6
      setCheckSpot(positionKey(left, top))
      const lesson = checkInfoRef.current
      const button = checkButtonRef.current
      if (lesson && button) {
        const lessonRect = lesson.getBoundingClientRect()
        // Where the button comes to rest, centred above the relation sign. Its
        // measured box would be wrong while it pops in from a smaller scale,
        // and the arrow would run into it once it has grown.
        const width = button.offsetWidth
        const height = button.offsetHeight
        const centreX = overlayRect.left + left
        const bottom = overlayRect.top + top
        const buttonRect = { left: centreX - width / 2, right: centreX + width / 2, top: bottom - height, bottom, width, height }
        setCheckArrow({
          start: { x: lessonRect.left + lessonRect.width / 2, y: lessonRect.bottom },
          end: { x: buttonRect.left + buttonRect.width / 2, y: buttonRect.top + buttonRect.height / 2 },
          startPadding: 8,
          endRect: guideRect(buttonRect),
          endGap: 10,
          arc: 'none',
        })
      } else {
        setCheckArrow(null)
      }
    }
    update()
    // The button is placed from the relation's position, so measure again once
    // it has been laid out to aim the arrow at it.
    const rafId = window.requestAnimationFrame(update)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    window.addEventListener('transitionend', update, true)
    window.addEventListener('animationend', update, true)
    return () => {
      window.cancelAnimationFrame(rafId)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('transitionend', update, true)
      window.removeEventListener('animationend', update, true)
    }
  }, [showCheck, checkInfo, checkSpot, lessonsSpot, lhs, rhs, isPhonePortrait, phoneExprScale, phoneExprShift, ruleDockHeight])

  // The rewrite lesson shown in the stack: the one whose arrow is drawn, or the
  // first while its rule card or its term is off screen.
  const rewriteLesson = rewriteGuide?.info ?? rewriteInfos[0]
  // The lessons sit right above the relation, centred across its width, with
  // room left above its sign for the check mark to appear, and for the arrow to
  // it when a lesson points at it. A relation nested deep enough to stand
  // taller than that room pushes them up to clear its top.
  useLayoutEffect(() => {
    if (!stackedLessons) {
      setLessonsSpot(null)
      return
    }
    const update = () => {
      const relationEl = relationRef.current
      const lessons = lessonsRef.current
      const scroller = exprScrollerRef.current
      const row = exprWrapperRef.current
      if (!relationEl || !lessons || !scroller || !row) return
      const relationRect = relationEl.getBoundingClientRect()
      const rowRect = row.getBoundingClientRect()
      const bounds = scroller.getBoundingClientRect()
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      const checkRoom = 2.6 * rem + 6
      const room = checkRoom + (checkInfo ? 3.25 : 0.75) * rem
      const half = lessons.offsetWidth / 2
      const margin = 0.75 * rem
      // Centred on the whole relation, as much of it as is in view, not on its
      // sign: a long side would otherwise pull the lessons off to the other.
      const viewLeft = Math.max(rowRect.left, bounds.left)
      const viewRight = Math.min(rowRect.right, bounds.right)
      const centre = viewRight > viewLeft ? (viewLeft + viewRight) / 2 : (bounds.left + bounds.right) / 2
      const left = Math.max(bounds.left + margin + half, Math.min(centre, bounds.right - margin - half))
      const bottom = Math.min(relationRect.top - room, rowRect.top - 0.5 * rem)
      // Never up under the header.
      const top = Math.max(3.75 * rem, bottom - lessons.offsetHeight)
      setLessonsSpot(positionKey(left, top))
    }
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    if (lessonsRef.current) observer?.observe(lessonsRef.current)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    window.addEventListener('transitionend', update, true)
    window.addEventListener('animationend', update, true)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('transitionend', update, true)
      window.removeEventListener('animationend', update, true)
    }
  }, [stackedLessons, checkInfo, generalInfo, reverseInfo, swapInfo, rewriteLesson, lhs, rhs,
    isPhonePortrait, phoneExprScale, phoneExprShift, ruleDockHeight, dockPresentationReady])

  useLayoutEffect(() => {
    const lesson = rewriteInfoRef.current
    if (stackedLessons || !rewriteGuide || !lesson) {
      setPhoneRewriteArrow(null)
      return
    }
    const lessonRect = lesson.getBoundingClientRect()
    const target = rewriteGuide.arrow.end
    setPhoneRewriteArrow({
      start: {
        x: Math.min(Math.max(target.x, lessonRect.left + 24), lessonRect.right - 24),
        y: lessonRect.top,
      },
      end: target,
      startPadding: 6,
      endPadding: 6,
      arc: 'none',
    })
  }, [rewriteGuide, stackedLessons])

  useEffect(() => {
    if (!activeId) return
    const handleMove = (e: PointerEvent) => setArrowEnd({ x: e.clientX, y: e.clientY })
    window.addEventListener('pointermove', handleMove)
    return () => window.removeEventListener('pointermove', handleMove)
  }, [activeId])

  /** Resolve a drag id (hyp_ or thm_ prefix) to an EqualityHyp. */
  const getEqualityHypForId = (id: string | null): EqualityHyp | null => {
    if (!id) return null
    if (id.startsWith('hyp_')) {
      const hypId = id.slice(4)
      return equalityHyps.find(h => h.id === hypId) ?? null
    }
    if (id.startsWith('thm_')) {
      const name = id.slice(4)
      return theoremEqualityHyps.find(h => h.id === name) ?? null
    }
    return null
  }

  const highlightId = getEqualityHypForId(activeId) ? activeId : hoveredId
  const highlightHyp = getEqualityHypForId(highlightId)
  const highlightFrom = highlightHyp ? (isReverse ? highlightHyp.rhs : highlightHyp.lhs) : null
  // Theorems and ∀ hypotheses match by pattern (their bound variables match any
  // term); other hypotheses match exactly (their terms are the real Lean ones).
  const highlightMatching = useMemo(
    () => highlightId && highlightHyp ? ruleMatching(highlightId, highlightHyp) : { isPattern: false },
    [highlightHyp, highlightId],
  )
  const isValidDropTarget = useCallback((node: ExpressionNode) => {
    if (!highlightFrom) return false
    return ruleMatchesNode(node, highlightFrom, highlightMatching)
  }, [highlightFrom, highlightMatching])
  const customIsValidDropTarget = highlightFrom ? isValidDropTarget : undefined

  // Nested expression nodes are all droppable, so a pointer can be "within" both an
  // inner target and its ancestors. Prefer the deepest matching node; otherwise fall
  // back to the deepest hovered node for invalid-drop feedback.
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    // Terms scrolled out of the row keep their rects; only the visible part
    // of the row accepts a drop.
    const visibleRow = exprScrollerRef.current?.getBoundingClientRect()
    const pointer = args.pointerCoordinates
    if (visibleRow && pointer && (
      pointer.x < visibleRow.left || pointer.x > visibleRow.right ||
      pointer.y < visibleRow.top || pointer.y > visibleRow.bottom
    )) return []
    const collisions = pointerWithin(args)
    if (collisions.length <= 1) return collisions

    return [...collisions].sort((a, b) => {
      const aNode = args.droppableContainers.find(c => c.id === a.id)?.data.current?.node as ExpressionNode | undefined
      const bNode = args.droppableContainers.find(c => c.id === b.id)?.data.current?.node as ExpressionNode | undefined
      const aValid = aNode ? isValidDropTarget(aNode) : false
      const bValid = bNode ? isValidDropTarget(bNode) : false
      if (aValid !== bValid) return aValid ? -1 : 1

      const aRect = args.droppableRects.get(a.id)
      const bRect = args.droppableRects.get(b.id)
      const aArea = aRect ? aRect.width * aRect.height : Number.POSITIVE_INFINITY
      const bArea = bRect ? bRect.width * bRect.height : Number.POSITIVE_INFINITY
      return aArea - bArea
    })
  }, [isValidDropTarget])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const handleDragStart = (event: DragStartEvent) => {
    suppressRuleClickRef.current = true
    // The touch is dragging a rule, not swiping the menu.
    directionSwipe.cancel()
    const id = event.active.id as string
    setActiveId(id)
    const el = document.getElementById(id)
    if (el) {
      const rect = el.getBoundingClientRect()
      setArrowStart({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
    }
    const sensorEvent = event.activatorEvent as PointerEvent
    if (sensorEvent) setArrowEnd({ x: sensorEvent.clientX, y: sensorEvent.clientY })
  }

  const applyRewriteAtTarget = async (draggedId: string, targetId: string) => {
    // A solved Rewrite-only level keeps its finished relation on screen.
    if (completed) return false
    const hyp = getEqualityHypForId(draggedId)
    if (!hyp) return false

    // Pre-check: does the target node structurally match the rewrite pattern?
    // Theorems and ∀ hypotheses match by pattern; other hypotheses exactly.
    const from = isReverse ? hyp.rhs : hyp.lhs
    const matching = ruleMatching(draggedId, hyp)
    const isThm = matching.isPattern
    // Both sides are on screen; the drop target says which one is rewritten.
    const leftTarget = findNodeById(lhs, targetId)
    const workingSide: 'left' | 'right' = leftTarget ? 'left' : 'right'
    const workingExpr = workingSide === 'left' ? lhs : rhs
    const targetNode = leftTarget ?? findNodeById(rhs, targetId)
    if (!targetNode) return false
    const patternMatches = isThm
      ? matchesPattern(targetNode, from, matching.wildcards)
      : printExpression(applyEqualityRule(workingExpr, targetId, hyp.lhs, hyp.rhs, isReverse)) !== printExpression(workingExpr)
    if (!patternMatches) return false

    // The path to the chosen term goes with every rewrite. A rule read backwards
    // from a lone variable (`n ⇐ n + 0`) matches every term, so nothing but the
    // path says which one the player picked.
    const path = findDisambiguatingRewritePath(
      workingExpr,
      targetId,
      node => ruleMatchesNode(node, from, matching),
    )
    // rw_nth counts matches across the complete relation from left to right,
    // not merely within the side that contains the target.
    // For a reverse variable theorem, count the concrete selected expression
    // because the displayed core rule supplies that theorem argument.
    const occurrenceMatcher = (node: ExpressionNode) =>
      isThm && isReverse && from.type === 'variable'
        ? expressionsEqual(node, targetNode)
        : ruleMatchesNode(node, from, matching)
    const leftMatches = findMatchingNodeIds(lhs, occurrenceMatcher)
    const sideMatches = workingSide === 'left'
      ? leftMatches
      : findMatchingNodeIds(rhs, occurrenceMatcher)
    let targetIndex = sideMatches.indexOf(targetId)
    if (targetIndex < 0 && isThm && isReverse && from.type === 'variable') {
      targetIndex = sideMatches.findIndex(id => {
        const candidate = findNodeById(workingExpr, id)
        return candidate ? expressionsEqual(candidate, targetNode) : false
      })
    }
    const occurrence = targetIndex < 0
      ? (isThm && isReverse && from.type === 'variable' ? 1 : undefined)
      : (workingSide === 'right' ? leftMatches.length : 0) + targetIndex + 1

    // Send to Lean — it is the final arbiter. Keep the overlay mounted and
    // update only the rewritten expression after Lean accepts the action.
    setIsProcessing(true)
    const rewrittenExpr = isThm
      ? applyTheoremRewrite(workingExpr, targetId, hyp.lhs, hyp.rhs, isReverse, matching.wildcards)
      : applyEqualityRule(workingExpr, targetId, hyp.lhs, hyp.rhs, isReverse)
    const expectedGoal = workingSide === 'right'
      ? {
          lhsStr: goalLhsStr,
          rhsStr: printExpression(rewrittenExpr),
          relation,
          explicitReverseArg: isThm && isReverse && from.type === 'variable'
            ? printLeanExpression(targetNode)
            : undefined,
        }
      : {
          lhsStr: printExpression(rewrittenExpr),
          rhsStr: goalRhsStr,
          relation,
          explicitReverseArg: isThm && isReverse && from.type === 'variable'
            ? printLeanExpression(targetNode)
            : undefined,
        }
    const outcome = await onRewrite(
      rewriteReferenceForDrag(draggedId, hyp),
      isReverse,
      workingSide,
      path,
      expectedGoal,
      occurrence,
    )
    setIsProcessing(false)

    if (!outcome.success) {
      setFailingCardId(draggedId)
      setTimeout(() => setFailingCardId(null), 600)
      return false
    }

    setHistory(prev => [...prev, { lhs, rhs }])
    if (workingSide === 'right') setRhs(rewrittenExpr)
    else setLhs(rewrittenExpr)
    return true
  }

  // A click rewrites the first term the rule can rewrite, reading left to right.
  const handleRuleClick = async (draggedId: string) => {
    if (isProcessing || suppressRuleClickRef.current || completed) return
    const hyp = getEqualityHypForId(draggedId)
    if (!hyp) return

    const from = isReverse ? hyp.rhs : hyp.lhs
    const targetId = ruleClickTargetId(lhs, rhs, from, ruleMatching(draggedId, hyp))
    if (!targetId) return

    await applyRewriteAtTarget(draggedId, targetId)
  }

  const handleCheck = async () => {
    if (!onCheck || isProcessing || completed || !currentSidesMatch) return
    setIsProcessing(true)
    let accepted = false
    try {
      accepted = await onCheck()
    } finally {
      setIsProcessing(false)
    }
    // Undo steps back through the closing `rfl` as through a rewrite, so record
    // it with the unchanged relation.
    if (accepted) setHistory(prev => [...prev, { lhs, rhs }])
  }

  const releaseSuppressedRuleClick = () => {
    window.setTimeout(() => {
      suppressRuleClickRef.current = false
    }, 0)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    const draggedId = active.id as string
    setActiveId(null)
    setArrowStart(null)
    setArrowEnd(null)
    releaseSuppressedRuleClick()
    if (!over || !active) return

    await applyRewriteAtTarget(draggedId, over.id as string)
  }

  const handleUndo = async () => {
    if (isProcessing || undoInFlightRef.current) return
    undoInFlightRef.current = true
    setIsProcessing(true)
    let success = false
    try {
      success = await onUndo()
    } finally {
      undoInFlightRef.current = false
      setIsProcessing(false)
    }
    if (!success) return
    if (history.length > 0) {
      const prev = history[history.length - 1]
      setLhs(prev.lhs)
      setRhs(prev.rhs)
      setHistory(h => h.slice(0, -1))
    }
  }

  /** Back to the relation as it read when this view opened. A Rewrite-only
   * level starts over and follows Lean's goal instead (see `leanGoalKey`). */
  const handleReset = async () => {
    if (!onReset || !canReset || isProcessing || undoInFlightRef.current) return
    undoInFlightRef.current = true
    setIsProcessing(true)
    let success = false
    try {
      success = await onReset()
    } finally {
      undoInFlightRef.current = false
      setIsProcessing(false)
    }
    if (!success) return
    if (!rewriteOnly && history.length > 0) {
      const opened = history[0]
      setLhs(opened.lhs)
      setRhs(opened.rhs)
    }
    setHistory([])
  }

  /** Swap the two sides; undo steps back through it as through a rewrite. */
  const handleSwap = async () => {
    if (!onSwap || isProcessing || completed) return
    setIsProcessing(true)
    let success = false
    try {
      success = await onSwap()
    } finally {
      setIsProcessing(false)
    }
    if (!success) return
    setHistory(prev => [...prev, { lhs, rhs }])
    setLhs(rhs)
    setRhs(lhs)
  }

  return (
    <div
      ref={overlayRef}
      className={`visual-page tr-overlay tr-transformation-overlay${isPhonePortrait ? ' phone-portrait' : ''}${showSwap ? ' tr-has-swap' : ''}`}
      data-transform-instance={instanceIdRef.current}
      style={{
        ...(style ?? {}),
        '--tr-rule-dock-height': `${ruleDockHeight}px`,
        '--tr-expression-scale': phoneExprScale != null ? String(phoneExprScale) : undefined,
        '--tr-expression-shift': `${phoneExprShift}px`,
      } as React.CSSProperties}
    >
      {headerSlot}
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        // Auto-scroll would slide the row whenever a card nears a term in the
        // outer fifth of the screen, moving a different term under the pointer.
        // The scrollbar and swipes move the row instead.
        autoScroll={false}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={releaseSuppressedRuleClick}
      >
        {/* Back button; a Rewrite-only level has nowhere to go back to */}
        {!rewriteOnly && (
          <button ref={backButtonRef} className="tr-back-btn" onClick={() => { if (!isProcessing) onClose() }} aria-disabled={isProcessing}>
            ← Back
          </button>
        )}

        {/* Processing overlay */}
        {isProcessing && <div className="tr-processing" />}

        {/* Main expression area, which appears together with the rule dock */}
        <div
          className="tr-main-area"
          ref={mainAreaRef}
          // Faded out, not `visibility: hidden`: the dock is a composited layer
          // (its blur), and a visibility flip on it has been seen not to repaint
          // until the window was resized, leaving the view blank.
          style={dockPresentationReady ? undefined : { opacity: 0, pointerEvents: 'none' }}
        >
          <div
            className={`tr-expr-scroller${isExprOverflowing ? ' overflowing' : ''}`}
            ref={exprScrollerRef}
            onWheel={handleExprWheel}
          >
            <div className="tr-expr-wrapper" ref={exprWrapperRef}>
              <ExprRenderer
                node={lhs}
                isActive={!!activeId && !isProcessing}
                customIsValidDropTarget={customIsValidDropTarget}
              />
              <span ref={relationRef} className="tr-op tr-relation-op">{relation}</span>
              <ExprRenderer
                node={rhs}
                isActive={!!activeId && !isProcessing}
                customIsValidDropTarget={customIsValidDropTarget}
              />
            </div>
          </div>

          {/* Lessons stack right above the relation sign; a phone keeps those of a
              level with a canvas in its controls' row. */}
          {stackedLessons ? (
            <div
              ref={lessonsRef}
              className="tr-relation-lessons"
              data-testid="rewrite-lessons"
              style={lessonsPosition ?? { visibility: 'hidden' }}
            >
              {generalInfo && (
                <div className="visual-info-callout transform-info stacked-info">
                  <VisualInfoText text={generalInfo.text} />
                </div>
              )}
              {rewriteLesson && (
                <div ref={rewriteInfoRef} className="visual-info-callout transform-info stacked-info stacked-info-rewrite">
                  <VisualInfoText text={rewriteLesson.text} />
                </div>
              )}
              {reverseInfo && (
                <div ref={reverseInfoRef} className="visual-info-callout transform-info stacked-info stacked-info-reverse">
                  <VisualInfoText text={reverseInfo.text} />
                </div>
              )}
              {swapInfo && (
                <div ref={swapInfoRef} className="visual-info-callout transform-info stacked-info stacked-info-swap">
                  <VisualInfoText text={swapInfo.text} />
                </div>
              )}
              {checkInfo && (
                <div ref={checkInfoRef} className="visual-info-callout transform-info stacked-info check-info">
                  <VisualInfoText text={checkInfo.text} />
                </div>
              )}
            </div>
          ) : (
            <>
              {generalInfo && (
                <div className="visual-info-callout transform-info side-info">
                  <VisualInfoText text={generalInfo.text} />
                </div>
              )}

              {reverseInfo && (
                <div ref={reverseInfoRef} className="visual-info-callout transform-info side-info reverse-info">
                  <VisualInfoText text={reverseInfo.text} />
                </div>
              )}

              {swapInfo && (
                <div ref={swapInfoRef} className="visual-info-callout transform-info side-info swap-info">
                  <VisualInfoText text={swapInfo.text} />
                </div>
              )}

              {checkInfo && (
                <div ref={checkInfoRef} className="visual-info-callout transform-info side-info check-info">
                  <VisualInfoText text={checkInfo.text} />
                </div>
              )}
            </>
          )}

          {!stackedLessons && rewriteGuide && (
            <div ref={rewriteInfoRef} className="visual-info-callout transform-info rewrite-info">
              <VisualInfoText text={rewriteGuide.info.text} />
            </div>
          )}

          {/* Reset and Undo */}
          <div className="tr-controls">
            <button
              onClick={() => void handleReset()}
              disabled={!canReset}
              aria-disabled={isProcessing || !canReset}
              className={`tr-ctrl-btn${canReset ? ' active-reset' : ''}`}
              aria-label="Reset"
              title={rewriteOnly ? 'Start this level over' : 'Back to how this read when Rewrite Mode opened'}
            ><ResetIcon /></button>
            <button
              onClick={handleUndo}
              disabled={!(canUndo ?? rewriteStepCount > 0)}
              aria-disabled={isProcessing || !(canUndo ?? rewriteStepCount > 0)}
              className={`tr-ctrl-btn${(canUndo ?? rewriteStepCount > 0) ? ' active-undo' : ''}`}
              aria-label="Undo"
            ><UndoIcon /></button>
          </div>

          {/* Swap sides, then the rewrite direction */}
          {(showSwap || !hideRewriteDirection) && (
            <div className="tr-side-controls">
              {showSwap && (
                <button
                  ref={swapButtonRef}
                  onClick={() => void handleSwap()}
                  disabled={completed}
                  aria-disabled={isProcessing || completed}
                  className="tr-ctrl-btn tr-swap-btn"
                  aria-label="Swap sides"
                  title="Swap the two sides"
                ><SwapSidesIcon /></button>
              )}
              {!hideRewriteDirection && (
                <button
                  ref={reverseButtonRef}
                  onClick={() => { if (!isProcessing) onIsReverseChange(!isReverse) }}
                  aria-disabled={isProcessing}
                  className={`tr-ctrl-btn tr-direction-btn${isReverse ? ' active-reverse' : ''}`}
                  aria-label={isReverse ? 'Mode: Reverse' : 'Mode: Forward'}
                ><RewriteDirectionIcon reverse={isReverse} /></button>
              )}
            </div>
          )}

        </div>

        {/* Check mark: closes a Rewrite-only level once both sides match */}
        {showCheck && (
          <button
            ref={checkButtonRef}
            type="button"
            className={`tr-check-btn${completed ? ' completed' : ''}`}
            data-testid="rewrite-check"
            style={checkPosition ?? { visibility: 'hidden' }}
            onClick={() => void handleCheck()}
            disabled={completed}
            aria-disabled={isProcessing || completed}
            aria-label={completed ? 'Proof complete' : 'Both sides match: complete the proof'}
          >✓</button>
        )}

        {/* Scrollbar for a relation wider than the screen */}
        {isExprOverflowing && (
          <div
            className="tr-expr-scrollbar"
            ref={scrollTrackRef}
            data-testid="rewrite-scrollbar"
            onPointerDown={handleScrollTrackPointerDown}
            onPointerMove={handleScrollTrackPointerMove}
            onPointerUp={handleScrollTrackPointerEnd}
            onPointerCancel={handleScrollTrackPointerEnd}
          >
            <div
              className="tr-expr-scrollbar-thumb"
              style={{
                width: `${scrollThumbFraction * 100}%`,
                left: `${(1 - scrollThumbFraction) * scrollThumbPosition * 100}%`,
              }}
            />
          </div>
        )}

        {/* Rule dock */}
        <div
          className="tr-rule-dock"
          ref={ruleDockRef}
          data-layout-ready={dockPresentationReady ? 'true' : 'false'}
          data-debug={JSON.stringify({ hasMeasurements, keyMatch: measuredLayoutKey === ruleDockLayoutKey, dockKeyMatch: measuredDockLayoutKey === dockLayoutKey, ruleDockHeight, pageWidth, rules: tabRules.length, widths: tabRules.map(rule => measuredWidths[rule.dragId] ?? null), fonts: typeof document !== 'undefined' && document.fonts ? document.fonts.status : null })}
          aria-busy={!dockPresentationReady}
          style={dockPresentationReady ? undefined : { opacity: 0, pointerEvents: 'none' }}
          onContextMenu={e => { e.preventDefault(); if (!isProcessing && !hideRewriteDirection) onIsReverseChange(!isReverse) }}
          {...directionSwipe.handlers}
        >
          {/* Cards row */}
          <div className="tr-dock-cards">
            <button
              className={`tr-nav-btn${emphOnPrevPage ? ' visual-emphasize-btn' : ''}`}
              onClick={() => { if (isProcessing) return; onPageIndexChange(selectedTab, Math.max(0, clampedPage - 1)); setHoveredId(null) }}
              disabled={clampedPage === 0 || !hasRules}
              aria-disabled={isProcessing || clampedPage === 0 || !hasRules}
              aria-label="Previous rule"
            >‹</button>

            <div
              className={`tr-rule-page${hasRules ? '' : ' empty'}`}
              ref={pageRef}
              {...pageSwipeHandlers}
            >
              {hasRules ? (
                <>
                  <div className="tr-rule-page-cards">
                    {pageItems.map(rule => (
                      <EqualityHypCard
                        key={rule.dragId}
                        dragId={rule.dragId}
                        label={rule.label}
                        lhsStr={rule.lhsStr}
                        rhsStr={rule.rhsStr}
                        lhsNode={rule.lhs}
                        rhsNode={rule.rhs}
                        forallFooter={rule.forallFooter}
                        forallEmphasized={emphasizeForall?.some(name =>
                          name === rule.label || sanitizeLeanDisplayName(name) === rule.label) ?? false}
                        axiom={isAxiomRule(rule)}
                        source={rule.dragId.startsWith('thm_') ? 'theorem' : rule.derived ? 'derived' : 'hyp'}
                        isReverse={isReverse}
                        isFailing={failingCardId === rule.dragId}
                        emphasized={isEmphasizedRule(rule)}
                        onClick={() => void handleRuleClick(rule.dragId)}
                        onMouseEnter={() => setHoveredId(rule.dragId)}
                        onMouseLeave={() => setHoveredId(null)}
                      />
                    ))}
                  </div>
                  <span className="tr-page-indicator">Page {clampedPage + 1} of {totalPages}</span>
                </>
              ) : (
                <div className="tr-rule-page-empty">
                  <span className="tr-no-rules">No rules available</span>
                  <span className="tr-page-indicator">Page {clampedPage + 1} of {totalPages}</span>
                </div>
              )}
            </div>

            <button
              className={`tr-nav-btn${emphOnNextPage ? ' visual-emphasize-btn' : ''}`}
              onClick={() => { if (isProcessing) return; onPageIndexChange(selectedTab, Math.min(totalPages - 1, clampedPage + 1)); setHoveredId(null) }}
              disabled={clampedPage >= totalPages - 1 || !hasRules}
              aria-disabled={isProcessing || clampedPage >= totalPages - 1 || !hasRules}
              aria-label="Next rule"
            >›</button>
          </div>

          {/* Tab bar */}
          {tabs.length > 1 && (
            <div className="tr-dock-tabs">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  className={`tr-tab-btn${selectedTab === tab.id ? ' active' : ''}`}
                  onClick={() => { if (isProcessing) return; onSelectedTabChange(tab.id); setHoveredId(null) }}
                  aria-disabled={isProcessing}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Connection arrow */}
        {activeId && arrowStart && arrowEnd && (
          <ConnectionArrow start={arrowStart} end={arrowEnd} />
        )}
        {backInfo && backGuide && (
          <>
            <InstructionGuideArrow arrow={backGuide.arrow} className="back-guide-arrow" />
            <div className="visual-info-callout transform-info back-info" style={backGuide.style}>
              <VisualInfoText text={backInfo.text} />
            </div>
          </>
        )}
        {reverseArrow && <InstructionGuideArrow arrow={{
          ...reverseArrow,
          startPadding: isPhonePortrait ? 6 : 28,
          // The head stops just short of the button's edge (`endRect`).
          arc: isPhonePortrait ? 'none' : 'up',
        }} />}
        {swapArrow && <InstructionGuideArrow arrow={{
          ...swapArrow,
          startPadding: isPhonePortrait ? 6 : 28,
          arc: isPhonePortrait ? 'none' : 'up',
        }} className="swap-guide-arrow" />}
        {phoneRewriteArrow && <InstructionGuideArrow arrow={phoneRewriteArrow} />}
        {rewriteGuide && stackedLessons && <InstructionGuideArrow arrow={rewriteGuide.arrow} />}
        {checkInfo && checkArrow && <InstructionGuideArrow arrow={checkArrow} className="check-guide-arrow" />}

        <DragOverlay dropAnimation={null}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--visual-accent-soft)', opacity: 0 }} />
        </DragOverlay>
      </DndContext>
    </div>
  )
}
