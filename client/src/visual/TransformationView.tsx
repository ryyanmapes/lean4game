import * as React from 'react'
import { useState, useEffect, useCallback, useLayoutEffect, useRef, useMemo } from 'react'
import { DndContext, DragOverlay, useSensor, useSensors, PointerSensor, pointerWithin } from '@dnd-kit/core'
import type { CollisionDetection } from '@dnd-kit/core'
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core'
import { parse, printExpression, applyEqualityRule, applyTheoremRewrite, expressionsEqual, deepCloneWithNewIds, matchesPattern, findNodeById, findPath } from './expr-engine'
import type { ExpressionNode } from './expr-types'
import { ExprRenderer } from './ExprRenderer'
import { EqualityHypCard } from './TransformRuleCard'
import { ConnectionArrow } from './ConnectionArrow'

export interface EqualityHyp {
  id: string       // for hyp cards: fvarId; for theorem cards: theorem name
  label: string    // hypothesis name (e.g. "h") or theorem displayName
  lhsStr: string
  rhsStr: string
  lhs: ExpressionNode
  rhs: ExpressionNode
  /** NNG4 inventory category (e.g. "+", "*", "^", "≤", "012", "Peano"). Absent for hyp cards. */
  category?: string
}

interface RewriteOutcome {
  success: boolean
  completed: boolean
}

interface ExpectedRewriteGoal {
  lhsStr: string
  rhsStr: string
}

function rewriteReferenceForDrag(draggedId: string, hyp: EqualityHyp): string {
  // Theorem cards show friendly aliases, but Lean rewrites need the real declaration name.
  return draggedId.startsWith('thm_') ? hyp.id : hyp.label
}

/** Parse a goal equality string "lhs = rhs" into parts. Returns null if unparseable. */
export function parseGoalEquality(typeStr: string): { lhsStr: string; rhsStr: string } | null {
  const idx = typeStr.indexOf(' = ')
  if (idx === -1) return null
  const lhsStr = typeStr.slice(0, idx).trim()
  const rhsStr = typeStr.slice(idx + 3).trim()
  try {
    parse(lhsStr)
    parse(rhsStr)
    return { lhsStr, rhsStr }
  } catch {
    return null
  }
}

/** Try to parse a hyp type string as "lhsStr = rhsStr". */
export function parseEqualityHyp(typeStr: string, hypName: string, hypId: string): EqualityHyp | null {
  const idx = typeStr.indexOf(' = ')
  if (idx === -1) return null
  const lhsStr = typeStr.slice(0, idx).trim()
  const rhsStr = typeStr.slice(idx + 3).trim()
  try {
    return { id: hypId, label: hypName, lhsStr, rhsStr, lhs: parse(lhsStr), rhs: parse(rhsStr) }
  } catch {
    return null
  }
}

interface Props {
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
  /** Optional header bar rendered at the top of the overlay. */
  headerSlot?: React.ReactNode
  /** Applied to the overlay root div (e.g. for sidebar-offset positioning). */
  style?: React.CSSProperties
}

export function TransformationView({
  goalLhsStr, goalRhsStr, goalLhsNode, goalRhsNode, equalityHyps, theoremEqualityHyps,
  onRewrite, onUndo, onClose, isReverse, onIsReverseChange, workingSide, onWorkingSideChange,
  selectedTab, onSelectedTabChange, rewriteStepCount, headerSlot, style
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
  const [pageIndex, setPageIndex] = useState(0)
  const [pageWidth, setPageWidth] = useState(0)
  const pageRef = useRef<HTMLDivElement>(null)
  const mainAreaRef = useRef<HTMLDivElement>(null)
  const exprWrapperRef = useRef<HTMLDivElement>(null)
  const staticGroupRef = useRef<HTMLDivElement>(null)
  const [isExprOverflowing, setIsExprOverflowing] = useState(false)

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
      setPageIndex(0)
    }
  }, [tabs, selectedTab])

  // Filter rules by the selected tab
  const tabRules = useMemo(() => {
    if (selectedTab === 'all') return allRules
    if (selectedTab === 'hyps') return allRules.filter(r => r.dragId.startsWith('hyp_'))
    if (selectedTab === 'other') return allRules.filter(r => r.dragId.startsWith('thm_') && !r.category)
    return allRules.filter(r => r.dragId.startsWith('thm_') && r.category === selectedTab)
  }, [allRules, selectedTab])

  // avgCardPx: measured after each commit from actual rendered card widths.
  // Defaults to 0 (unknown) so we show all cards until the first measurement.
  const [avgCardPx, setAvgCardPx] = useState(0)
  useLayoutEffect(() => {
    const el = pageRef.current
    if (!el) return
    const cards = Array.from(el.querySelectorAll<HTMLElement>('.tr-rule-card'))
    if (!cards.length) return
    const avg = cards.reduce((s, c) => s + c.offsetWidth, 0) / cards.length
    setAvgCardPx(prev => Math.abs(avg - prev) > 0.5 ? avg : prev)
  }, [tabRules])

  const GAP_PX = 12
  const itemsPerPage = (pageWidth > 0 && avgCardPx > 0)
    ? Math.max(1, Math.floor((pageWidth + GAP_PX) / (avgCardPx + GAP_PX)))
    : tabRules.length  // show all until measured
  const totalPages = Math.max(1, Math.ceil(tabRules.length / itemsPerPage))
  const clampedPage = Math.min(pageIndex, totalPages - 1)
  const pageItems = tabRules.slice(clampedPage * itemsPerPage, (clampedPage + 1) * itemsPerPage)
  const workingExpr = workingSide === 'right' ? rhs : lhs
  const rawStaticStr = workingSide === 'right' ? goalLhsStr : goalRhsStr
  const staticStr = (() => { try { return printExpression(parse(rawStaticStr)) } catch { return rawStaticStr } })()

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
      ? { lhsStr: goalLhsStr, rhsStr: printExpression(rewrittenExpr) }
      : { lhsStr: printExpression(rewrittenExpr), rhsStr: goalRhsStr }
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
    <div className="visual-page tr-overlay" style={style}>
      {headerSlot}
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {/* Back button */}
        <button className="tr-back-btn" onClick={onClose} disabled={isProcessing}>
          ← Back
        </button>

        {/* Processing overlay */}
        {isProcessing && <div className="tr-processing" />}

        {/* Main expression area */}
        <div className="tr-main-area" ref={mainAreaRef}>
          {/* Static side label + swap button */}
          <div ref={staticGroupRef} className={`tr-static-group${workingSide === 'left' ? ' static-right' : ''}${isExprOverflowing ? ' pinned-top' : ''}`}>
            <span className="tr-static-label">
              {workingSide === 'left' ? `= ${staticStr}` : `${staticStr} =`}
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

          {/* Undo */}
          <div className="tr-controls">
            <button
              onClick={handleUndo}
              disabled={rewriteStepCount === 0 || isProcessing}
              className={`tr-ctrl-btn${rewriteStepCount > 0 ? ' active-undo' : ''}`}
              title="Undo"
            >↩</button>
          </div>

          {/* Reverse */}
          <div className="tr-side-controls">
            <button
              onClick={() => onIsReverseChange(!isReverse)}
              disabled={isProcessing}
              className={`tr-ctrl-btn${isReverse ? ' active-reverse' : ''}`}
              title={isReverse ? 'Mode: Reverse' : 'Mode: Forward'}
            >↕</button>
          </div>
        </div>

        {/* Rule dock */}
        <div className="tr-rule-dock" onContextMenu={e => { e.preventDefault(); onIsReverseChange(!isReverse) }}>
          {/* Cards row */}
          <div className="tr-dock-cards">
            <button
              className="tr-nav-btn"
              onClick={() => { setPageIndex(p => Math.max(0, p - 1)); setHoveredId(null) }}
              disabled={clampedPage === 0 || tabRules.length === 0 || isProcessing}
              aria-label="Previous rule"
            >‹</button>

            <div className="tr-rule-page" ref={pageRef}>
              {tabRules.length > 0 ? (
                <>
                  <div className="tr-rule-page-cards">
                    {pageItems.map(rule => (
                      <EqualityHypCard
                        key={rule.dragId}
                        dragId={rule.dragId}
                        label={rule.label}
                        lhsStr={rule.lhsStr}
                        rhsStr={rule.rhsStr}
                        isReverse={isReverse}
                        isFailing={failingCardId === rule.dragId}
                        onMouseEnter={() => setHoveredId(rule.dragId)}
                        onMouseLeave={() => setHoveredId(null)}
                      />
                    ))}
                  </div>
                  {totalPages > 1 && (
                    <span className="tr-page-indicator">{clampedPage + 1} / {totalPages}</span>
                  )}
                </>
              ) : (
                <span className="tr-no-rules">No rules available</span>
              )}
            </div>

            <button
              className="tr-nav-btn"
              onClick={() => { setPageIndex(p => Math.min(totalPages - 1, p + 1)); setHoveredId(null) }}
              disabled={clampedPage >= totalPages - 1 || tabRules.length === 0 || isProcessing}
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
                  onClick={() => { onSelectedTabChange(tab.id); setPageIndex(0); setHoveredId(null) }}
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

        <DragOverlay dropAnimation={null}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#a78bfa', opacity: 0 }} />
        </DragOverlay>
      </DndContext>
    </div>
  )
}
