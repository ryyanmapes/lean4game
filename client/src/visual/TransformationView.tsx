import * as React from 'react'
import { useState, useEffect, useCallback, useLayoutEffect, useRef, useMemo } from 'react'
import { DndContext, DragOverlay, useSensor, useSensors, PointerSensor, pointerWithin } from '@dnd-kit/core'
import type { CollisionDetection } from '@dnd-kit/core'
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core'
import { parse, printExpression, formatFormulaText, applyEqualityRule, applyTheoremRewrite, expressionsEqual, deepCloneWithNewIds, matchesPattern, findNodeById, findPath } from './expr-engine'
import type { ExpressionNode } from './expr-types'
import { ExprRenderer } from './ExprRenderer'
import { EqualityHypCard } from './TransformRuleCard'
import { ConnectionArrow } from './ConnectionArrow'
import { VisualInfoText } from './VisualInfoText'
import { useSwipePaging } from './useSwipePaging'
import type { VisualTransformInfo } from './types'

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
}

export type TransformRelation = '=' | '<' | '>' | '≤' | '≥'

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
}

export interface GuideArrow {
  start: { x: number; y: number }
  end: { x: number; y: number }
  startPadding?: number
  endPadding?: number
  arc?: 'up' | 'down' | 'none'
}

function rewriteReferenceForDrag(draggedId: string, hyp: EqualityHyp): string {
  // Theorem cards show friendly aliases, but Lean rewrites need the real declaration name.
  return draggedId.startsWith('thm_') ? hyp.id : (hyp.rewriteRef ?? hyp.label)
}

export function InstructionGuideArrow({ arrow, className = '' }: { arrow: GuideArrow; className?: string }) {
  const dx = arrow.end.x - arrow.start.x
  const dy = arrow.end.y - arrow.start.y
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  const startPad = arrow.startPadding ?? 44
  const endPad = arrow.endPadding ?? 64
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
  const path = `M ${start.x} ${start.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${shaftEnd.x} ${shaftEnd.y}`
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

const TRANSFORM_RELATIONS = new Set<TransformRelation>(['=', '<', '>', '≤', '≥'])

const PHONE_EXPR_BASE_SCALE = 1.04
const PHONE_EXPR_MIN_SCALE = 0.58

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
  ) => Promise<RewriteOutcome>
  /** Called for each undo step (removes one proof step from the proof script). */
  onUndo: () => Promise<boolean>
  /** Whether the undo button should be enabled (parent has steps to undo). Overrides rewriteStepCount-based check when provided. */
  canUndo?: boolean
  onClose: () => void
  /** Number of rewrite steps applied in this transformation session (incremented by parent on each rewrite). */
  rewriteStepCount: number
  /** Controlled reverse mode — lifted to parent so it survives remounts between rewrites. */
  isReverse: boolean
  onIsReverseChange: (v: boolean) => void
  /** Controlled working side — lifted to parent so it survives remounts between rewrites. */
  workingSide: 'left' | 'right'
  onWorkingSideChange: (v: 'left' | 'right') => void
  /** Controlled selected tab — lifted to parent so it survives remounts between rewrites. */
  selectedTab: string
  onSelectedTabChange: (v: string) => void
  /** Remembered desired page per tab — lifted to parent so rewrites/remounts preserve it. */
  pageIndexByTab: Record<string, number>
  onPageIndexChange: (tabId: string, pageIndex: number) => void
  /** Optional header bar rendered at the top of the overlay. */
  headerSlot?: React.ReactNode
  /** Applied to the overlay root div (e.g. for sidebar-offset positioning). */
  style?: React.CSSProperties
  isPhonePortrait?: boolean
  /** Names of equality-rewriting theorems to highlight with a soft glow. */
  emphasizeItems?: string[]
  visualInfos?: VisualTransformInfo[]
}

export function TransformationView({
  relation, goalLhsStr, goalRhsStr, goalLhsNode, goalRhsNode, equalityHyps, theoremEqualityHyps,
  onRewrite, onUndo, canUndo, onClose, isReverse, onIsReverseChange, workingSide, onWorkingSideChange,
  selectedTab, onSelectedTabChange, pageIndexByTab, onPageIndexChange, rewriteStepCount, headerSlot, style,
  isPhonePortrait = false, emphasizeItems, visualInfos = [],
}: Props) {
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
  const [activeId, setActiveId] = useState<string | null>(null)
  const [arrowStart, setArrowStart] = useState<{ x: number; y: number } | null>(null)
  const [arrowEnd, setArrowEnd] = useState<{ x: number; y: number } | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [failingCardId, setFailingCardId] = useState<string | null>(null)
  const [pageWidth, setPageWidth] = useState(() =>
    typeof window === 'undefined' ? 0 : Math.max(0, window.innerWidth - (isPhonePortrait ? 96 : 160))
  )
  const [maxCardWidthsByTab, setMaxCardWidthsByTab] = useState<Record<string, number>>({})
  const [ruleDockHeight, setRuleDockHeight] = useState(0)
  const pageRef = useRef<HTMLDivElement>(null)
  const mainAreaRef = useRef<HTMLDivElement>(null)
  const exprWrapperRef = useRef<HTMLDivElement>(null)
  const staticGroupRef = useRef<HTMLDivElement>(null)
  const ruleDockRef = useRef<HTMLDivElement>(null)
  const sideInfoRef = useRef<HTMLDivElement>(null)
  const backButtonRef = useRef<HTMLButtonElement>(null)
  const backInfoRef = useRef<HTMLDivElement>(null)
  const reverseButtonRef = useRef<HTMLButtonElement>(null)
  const reverseInfoRef = useRef<HTMLDivElement>(null)
  const [isExprOverflowing, setIsExprOverflowing] = useState(false)
  const [phoneExprScale, setPhoneExprScale] = useState<number | null>(null)
  const [sideArrow, setSideArrow] = useState<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(null)
  const [backArrow, setBackArrow] = useState<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(null)
  const [reverseArrow, setReverseArrow] = useState<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(null)
  const [rewriteGuide, setRewriteGuide] = useState<{
    info: VisualTransformInfo
    style: React.CSSProperties
    arrow: GuideArrow
  } | null>(null)

  useEffect(() => {
    const el = pageRef.current
    if (!el) return
    const observer = new ResizeObserver(entries => setPageWidth(entries[0].contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const main = mainAreaRef.current
    const expr = exprWrapperRef.current
    const sg = staticGroupRef.current
    if (!main || !expr || !sg) return
    const exprVisualW = expr.getBoundingClientRect().width
    const mainW = main.getBoundingClientRect().width
    const sgW = sg.getBoundingClientRect().width
    const sideMargin = (mainW - exprVisualW) / 2
    // Trigger when label doesn't fit: sideMargin < sgW + right:3rem(48px) + 16px breathing room
    const next = mainW > 0 && sideMargin < sgW + 64
    setIsExprOverflowing(prev => prev === next ? prev : next)
  })

  // Flat ordered list: hypotheses first (backend order), then theorems (backend order)
  const allRules = useMemo(() => [
    ...equalityHyps.map(h => ({ ...h, dragId: `hyp_${h.id}` })),
    ...theoremEqualityHyps.map(t => ({ ...t, dragId: `thm_${t.id}` })),
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
    const result: { id: string; label: string }[] = [{ id: 'all', label: 'Everything' }, { id: 'hyps', label: 'Hypotheses' }]
    catOrder.forEach(cat => result.push({ id: cat, label: cat }))
    if (hasUncategorized) result.push({ id: 'other', label: 'Other' })
    return result
  }, [allRules])

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

  // Use the widest rendered card seen for the current tab so pagination stays stable
  // when reverse-mode text is narrower than forward-mode text.
  useLayoutEffect(() => {
    const el = pageRef.current
    if (!el) return
    const cards = Array.from(el.querySelectorAll<HTMLElement>('.tr-rule-card'))
    if (!cards.length) return
    const max = cards.reduce((widest, card) => Math.max(widest, card.offsetWidth), 0)
    setMaxCardWidthsByTab(prev => {
      const prevMax = prev[selectedTab] ?? 0
      const nextMax = Math.max(prevMax, max)
      if (Math.abs(nextMax - prevMax) <= 0.5) return prev
      return { ...prev, [selectedTab]: nextMax }
    })
  }, [tabRules, selectedTab, isReverse, pageWidth, pageIndexByTab])

  useLayoutEffect(() => {
    const dock = ruleDockRef.current
    if (!dock) return

    const updateHeight = () => {
      const nextHeight = dock.offsetHeight
      setRuleDockHeight(prev => (Math.abs(prev - nextHeight) <= 0.5 ? prev : nextHeight))
    }

    updateHeight()

    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => updateHeight())
    observer.observe(dock)
    return () => observer.disconnect()
  }, [selectedTab, tabRules.length, isProcessing])

  const GAP_PX = 12
  const maxCardPx = maxCardWidthsByTab[selectedTab] ?? 0
  const hasRules = tabRules.length > 0
  const estimatedCardPx = isPhonePortrait
    ? Math.min(288, Math.max(180, pageWidth))
    : 320
  const paginationCardPx = maxCardPx > 0 ? maxCardPx : estimatedCardPx
  const itemsPerPage = isPhonePortrait
    ? 1
    : (
        (pageWidth > 0 && hasRules)
          ? Math.max(1, Math.floor((pageWidth + GAP_PX) / (paginationCardPx + GAP_PX)))
          : 1
      )
  const desiredPage = pageIndexByTab[selectedTab] ?? 0
  const totalPages = Math.max(1, Math.ceil(tabRules.length / itemsPerPage))
  const clampedPage = Math.min(Math.max(0, desiredPage), totalPages - 1)
  const pageItems = tabRules.slice(clampedPage * itemsPerPage, (clampedPage + 1) * itemsPerPage)
  const pageSwipeHandlers = useSwipePaging({
    currentPage: clampedPage,
    totalPages,
    disabled: !hasRules || isProcessing,
    onPageChange: page => {
      onPageIndexChange(selectedTab, page)
      setHoveredId(null)
    },
  })

  // Emphasis: glow on matching cards; direct page buttons toward emphasized items.
  const isEmphasizedRule = (rule: { id: string }) =>
    emphasizeItems != null && emphasizeItems.includes(rule.id)
  const emphIndexesInTab = tabRules.reduce<number[]>((acc, rule, i) => {
    if (isEmphasizedRule(rule)) acc.push(i)
    return acc
  }, [])
  const emphVisibleNow = pageItems.some(r => isEmphasizedRule(r))
  const emphOnPrevPage = !emphVisibleNow && emphIndexesInTab.some(i => i < clampedPage * itemsPerPage)
  const emphOnNextPage = !emphVisibleNow && emphIndexesInTab.some(i => i >= (clampedPage + 1) * itemsPerPage)

  const workingExpr = workingSide === 'right' ? rhs : lhs
  const rawStaticStr = workingSide === 'right' ? goalLhsStr : goalRhsStr
  const staticStr = formatFormulaText(rawStaticStr)
  const currentGoalText = formatFormulaText(`${printExpression(lhs)} ${relation} ${printExpression(rhs)}`)
  const activeVisualInfos = useMemo(
    () => visualInfos.filter(info => !info.goal || formatFormulaText(info.goal) === currentGoalText),
    [currentGoalText, visualInfos],
  )
  const sideInfo = activeVisualInfos.find(info =>
    info.kind === 'side' && (info.side === 'left' || info.side === 'right') && info.side !== workingSide
  )
  const backInfo = activeVisualInfos.find(info => info.kind === 'back' && info.text)
  const generalInfo = activeVisualInfos.find(info => info.kind === 'info' && info.text)
  const reverseInfo = activeVisualInfos.find(info => info.kind === 'reverse' && info.text)
  const rewriteInfos = useMemo(
    () => activeVisualInfos.filter(info => info.kind === 'rewrite' && info.text),
    [activeVisualInfos],
  )

  useLayoutEffect(() => {
    if (!isPhonePortrait) {
      setPhoneExprScale(prev => prev == null ? prev : null)
      return
    }

    const main = mainAreaRef.current
    const expr = exprWrapperRef.current
    if (!main || !expr) return

    let rafId: number | null = null
    const updateScale = () => {
      if (rafId != null) window.cancelAnimationFrame(rafId)
      rafId = window.requestAnimationFrame(() => {
        const exprRect = expr.getBoundingClientRect()
        const mainRect = main.getBoundingClientRect()
        if (exprRect.width <= 0 || exprRect.height <= 0 || mainRect.width <= 0 || mainRect.height <= 0) return

        const currentScale = phoneExprScale ?? PHONE_EXPR_BASE_SCALE
        const unscaledWidth = exprRect.width / currentScale
        const unscaledHeight = exprRect.height / currentScale
        const availableWidth = Math.max(120, mainRect.width - 24)
        const availableHeight = Math.max(120, mainRect.height - 192)
        const fitScale = Math.min(
          PHONE_EXPR_BASE_SCALE,
          availableWidth / unscaledWidth,
          availableHeight / unscaledHeight,
        )
        const nextScale = Math.max(PHONE_EXPR_MIN_SCALE, Number(fitScale.toFixed(3)))
        setPhoneExprScale(prev => (prev != null && Math.abs(prev - nextScale) < 0.01) ? prev : nextScale)
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
  }, [isPhonePortrait, phoneExprScale, workingSide, workingExpr, ruleDockHeight])

  const cssEscape = (value: string) => {
    const escapeFn = (window as Window & { CSS?: { escape?: (value: string) => string } }).CSS?.escape
    return escapeFn ? escapeFn(value) : value.replace(/["\\]/g, '\\$&')
  }

  useLayoutEffect(() => {
    const updateGuides = () => {
      if (sideInfo && sideInfoRef.current) {
        const infoRect = sideInfoRef.current.getBoundingClientRect()
        const swapRect = mainAreaRef.current?.querySelector<HTMLElement>('.tr-swap-btn')?.getBoundingClientRect()
        const swapCenter = swapRect ? {
          x: swapRect.left + swapRect.width / 2,
          y: swapRect.top + swapRect.height / 2,
        } : null
        const infoCenterX = infoRect.left + infoRect.width / 2
        const startsFromLeft = swapCenter != null && swapCenter.x < infoCenterX
        setSideArrow(swapRect ? {
          start: {
            x: startsFromLeft ? infoRect.left : infoRect.right,
            y: infoRect.top + infoRect.height / 2,
          },
          end: swapCenter!,
        } : null)
      } else {
        setSideArrow(null)
      }

      if (backInfo && backInfoRef.current && backButtonRef.current) {
        const infoRect = backInfoRef.current.getBoundingClientRect()
        const backRect = backButtonRef.current.getBoundingClientRect()
        setBackArrow({
          start: {
            x: infoRect.left,
            y: infoRect.top + infoRect.height / 2,
          },
          end: {
            x: backRect.left + backRect.width / 2,
            y: backRect.top + backRect.height / 2,
          },
        })
      } else {
        setBackArrow(null)
      }

      if (reverseInfo && reverseInfoRef.current && reverseButtonRef.current) {
        const infoRect = reverseInfoRef.current.getBoundingClientRect()
        const reverseRect = reverseButtonRef.current.getBoundingClientRect()
        const reverseCenterX = reverseRect.left + reverseRect.width / 2
        const reverseCenterY = reverseRect.top + reverseRect.height / 2
        setReverseArrow({
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
          const sourceEl = page.querySelector<HTMLElement>(`[data-rule-label="${cssEscape(source)}"]`)
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
          const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
          const guideWidth = 360
          const margin = 34
          const viewportW = window.innerWidth
          const lineLeft = Math.min(sourceRect.left, targetRect.left)
          const lineRight = Math.max(sourceRect.right, targetRect.right)
          const leftPos = lineLeft - guideWidth - margin
          const rightPos = lineRight + margin
          const fitsLeft = leftPos >= 16
          const fitsRight = rightPos + guideWidth <= viewportW - 16
          // Prefer whichever side has more room. If neither side has clearance,
          // clamp to the viewport edge with the most space.
          const preferLeft = fitsLeft && (!fitsRight || lineLeft > viewportW - lineRight)
          const left = preferLeft
            ? Math.max(16, leftPos)
            : Math.min(viewportW - guideWidth - 16, rightPos)
          nextRewriteGuide = {
            info,
            style: {
              left,
              top: midpoint.y,
              transform: 'translateY(-50%)',
              width: guideWidth,
            },
            arrow: { start, end, startPadding: 48, endPadding: 60 },
          }
          break
        }
      }
      setRewriteGuide(nextRewriteGuide)
    }

    updateGuides()
    window.addEventListener('resize', updateGuides)
    window.addEventListener('scroll', updateGuides, true)
    return () => {
      window.removeEventListener('resize', updateGuides)
      window.removeEventListener('scroll', updateGuides, true)
    }
  }, [sideInfo, backInfo, reverseInfo, rewriteInfos, workingExpr, selectedTab, clampedPage, pageItems.length, isReverse, ruleDockHeight, isPhonePortrait])

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

  const highlightHyp = getEqualityHypForId(activeId) ?? getEqualityHypForId(hoveredId)
  const highlightFrom = highlightHyp ? (isReverse ? highlightHyp.rhs : highlightHyp.lhs) : null
  // Theorem hyps use pattern matching (their variables are generic wildcards);
  // hypothesis hyps use exact matching (their terms are the real Lean expressions).
  const highlightIsThm = (activeId ?? hoveredId)?.startsWith('thm_') ?? false
  const isValidDropTarget = useCallback((node: ExpressionNode) => {
    if (!highlightFrom) return false
    return highlightIsThm
      ? matchesPattern(node, highlightFrom)
      : expressionsEqual(node, highlightFrom)
  }, [highlightFrom, highlightIsThm])
  const customIsValidDropTarget = highlightFrom ? isValidDropTarget : undefined

  // Nested expression nodes are all droppable, so a pointer can be "within" both an
  // inner target and its ancestors. Prefer the deepest matching node; otherwise fall
  // back to the deepest hovered node for invalid-drop feedback.
  const collisionDetection = useCallback<CollisionDetection>((args) => {
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

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    const draggedId = active.id as string
    setActiveId(null)
    setArrowStart(null)
    setArrowEnd(null)
    if (!over || !active) return

    const targetId = over.id as string
    const hyp = getEqualityHypForId(draggedId)
    if (!hyp) return

    // Pre-check: does the target node structurally match the rewrite pattern?
    // Theorem hyps use wildcard matching; hypothesis hyps use exact matching.
    const from = isReverse ? hyp.rhs : hyp.lhs
    const isThm = draggedId.startsWith('thm_')
    const targetNode = findNodeById(workingExpr, targetId)
    if (!targetNode) return
    const patternMatches = isThm
      ? matchesPattern(targetNode, from)
      : printExpression(applyEqualityRule(workingExpr, targetId, hyp.lhs, hyp.rhs, isReverse)) !== printExpression(workingExpr)
    if (!patternMatches) return

    // Compute the path from the root of the working expression to the target node.
    const path = findPath(workingExpr, targetId) ?? undefined

    // Send to Lean — it is the final arbiter. Visual update comes from remount
    // with the fresh Lean state (TransformationView key changes on each rewrite).
    setIsProcessing(true)
    const rewrittenExpr = isThm
      ? applyTheoremRewrite(workingExpr, targetId, hyp.lhs, hyp.rhs, isReverse)
      : applyEqualityRule(workingExpr, targetId, hyp.lhs, hyp.rhs, isReverse)
    const expectedGoal = workingSide === 'right'
      ? { lhsStr: goalLhsStr, rhsStr: printExpression(rewrittenExpr), relation }
      : { lhsStr: printExpression(rewrittenExpr), rhsStr: goalRhsStr, relation }
    const outcome = await onRewrite(rewriteReferenceForDrag(draggedId, hyp), isReverse, workingSide, path, expectedGoal)
    setIsProcessing(false)

    if (!outcome.success) {
      setFailingCardId(draggedId)
      setTimeout(() => setFailingCardId(null), 600)
      return
    }

    setHistory(prev => [...prev, { lhs, rhs }])
    if (workingSide === 'right') setRhs(rewrittenExpr)
    else setLhs(rewrittenExpr)
  }

  const handleUndo = async () => {
    setIsProcessing(true)
    const success = await onUndo()
    setIsProcessing(false)
    if (!success) return
    if (history.length > 0) {
      const prev = history[history.length - 1]
      setLhs(prev.lhs)
      setRhs(prev.rhs)
      setHistory(h => h.slice(0, -1))
    }
  }

  const handleSwap = () => {
    onWorkingSideChange(workingSide === 'right' ? 'left' : 'right')
    setHistory([])
  }

  return (
    <div
      className={`visual-page tr-overlay tr-transformation-overlay${isPhonePortrait ? ' phone-portrait' : ''}`}
      style={{
        ...(style ?? {}),
        '--tr-rule-dock-height': `${ruleDockHeight}px`,
        '--tr-expression-scale': phoneExprScale != null ? String(phoneExprScale) : undefined,
      } as React.CSSProperties}
    >
      {headerSlot}
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {/* Back button */}
        <button ref={backButtonRef} className="tr-back-btn" onClick={onClose} disabled={isProcessing}>
          ← Back
        </button>

        {/* Processing overlay */}
        {isProcessing && <div className="tr-processing" />}

        {/* Main expression area */}
        <div className="tr-main-area" ref={mainAreaRef}>
          {/* Static side label + swap button */}
          <div ref={staticGroupRef} className={`tr-static-group${workingSide === 'left' ? ' static-right' : ''}${isExprOverflowing ? ' pinned-top' : ''}`}>
            <span className="tr-static-label">
              {workingSide === 'left' ? `${relation} ${staticStr}` : `${staticStr} ${relation}`}
            </span>
            <button
              className="tr-swap-btn"
              onClick={handleSwap}
              disabled={isProcessing}
              title="Edit this side instead"
            >{workingSide === 'left' ? '→' : '←'}</button>
          </div>

          <div className="tr-expr-wrapper" ref={exprWrapperRef}>
            <ExprRenderer
              node={workingExpr}
              isActive={!!activeId && !isProcessing}
              customIsValidDropTarget={customIsValidDropTarget}
            />
          </div>

          {sideInfo && (
            <div ref={sideInfoRef} className="visual-info-callout transform-info side-info">
              <VisualInfoText text={sideInfo.text} />
            </div>
          )}

          {backInfo && (
            <div ref={backInfoRef} className="visual-info-callout transform-info side-info">
              <VisualInfoText text={backInfo.text} />
            </div>
          )}

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

          {/* Undo */}
          <div className="tr-controls">
            <button
              onClick={handleUndo}
              disabled={!(canUndo ?? rewriteStepCount > 0) || isProcessing}
              className={`tr-ctrl-btn${(canUndo ?? rewriteStepCount > 0) ? ' active-undo' : ''}`}
              title="Undo"
            >↩</button>
          </div>

          {/* Reverse */}
          <div className="tr-side-controls">
            <button
              ref={reverseButtonRef}
              onClick={() => onIsReverseChange(!isReverse)}
              disabled={isProcessing}
              className={`tr-ctrl-btn${isReverse ? ' active-reverse' : ''}`}
              title={isReverse ? 'Mode: Reverse' : 'Mode: Forward'}
            >↕</button>
          </div>

        </div>

        {/* Rule dock */}
        <div
          className="tr-rule-dock"
          ref={ruleDockRef}
          onContextMenu={e => { e.preventDefault(); onIsReverseChange(!isReverse) }}
        >
          {/* Cards row */}
          <div className="tr-dock-cards">
            <button
              className={`tr-nav-btn${emphOnPrevPage ? ' visual-emphasize-btn' : ''}`}
              onClick={() => { onPageIndexChange(selectedTab, Math.max(0, clampedPage - 1)); setHoveredId(null) }}
              disabled={clampedPage === 0 || !hasRules || isProcessing}
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
                        forallFooter={(rule as EqualityHyp & { forallFooter?: string }).forallFooter}
                        isReverse={isReverse}
                        isFailing={failingCardId === rule.dragId}
                        emphasized={isEmphasizedRule(rule)}
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
              onClick={() => { onPageIndexChange(selectedTab, Math.min(totalPages - 1, clampedPage + 1)); setHoveredId(null) }}
              disabled={clampedPage >= totalPages - 1 || !hasRules || isProcessing}
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
                  onClick={() => { onSelectedTabChange(tab.id); setHoveredId(null) }}
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
        {sideArrow && <InstructionGuideArrow arrow={sideArrow} />}
        {backArrow && <InstructionGuideArrow arrow={{ ...backArrow, startPadding: 28, endPadding: 42 }} />}
        {reverseArrow && <InstructionGuideArrow arrow={{
          ...reverseArrow,
          startPadding: isPhonePortrait ? 6 : 28,
          // On phone portrait the info text sits just above the reverse
          // button — the gap is small (~30–60px), so a large endPadding
          // would over-shoot and flip the arrow to point upward at the info
          // text. Keep endPadding short enough to stop just past the button
          // edge.
          endPadding: isPhonePortrait ? 20 : 42,
          arc: isPhonePortrait ? 'none' : 'up',
        }} />}
        {rewriteGuide && (
          <>
            <InstructionGuideArrow arrow={rewriteGuide.arrow} />
            <div className="visual-info-callout transform-info rewrite-info" style={rewriteGuide.style}>
              <VisualInfoText text={rewriteGuide.info.text} />
            </div>
          </>
        )}

        <DragOverlay dropAnimation={null}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--visual-accent-soft)', opacity: 0 }} />
        </DragOverlay>
      </DndContext>
    </div>
  )
}
