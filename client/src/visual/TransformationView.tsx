import * as React from 'react'
import { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react'
import { DndContext, DragOverlay, useSensor, useSensors, PointerSensor, pointerWithin } from '@dnd-kit/core'
import type { CollisionDetection } from '@dnd-kit/core'
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core'
import { parse, printExpression, applyEqualityRule, expressionsEqual, deepCloneWithNewIds, matchesPattern, findNodeById, findPath } from './expr-engine'
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
}

interface RewriteOutcome {
  success: boolean
  completed: boolean
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
  onRewrite: (hypLabel: string, isReverse: boolean, workingSide: 'left' | 'right', path?: number[]) => Promise<RewriteOutcome>
  /** Called for each undo step (removes one proof step from the proof script). */
  onUndo: () => Promise<boolean>
  onClose: () => void
  /** Controlled reverse mode — lifted to parent so it survives remounts between rewrites. */
  isReverse: boolean
  onIsReverseChange: (v: boolean) => void
  /** Controlled working side — lifted to parent so it survives remounts between rewrites. */
  workingSide: 'left' | 'right'
  onWorkingSideChange: (v: 'left' | 'right') => void
}

export function TransformationView({
  goalLhsStr, goalRhsStr, goalLhsNode, goalRhsNode, equalityHyps, theoremEqualityHyps,
  onRewrite, onUndo, onClose, isReverse, onIsReverseChange, workingSide, onWorkingSideChange
}: Props) {
  const backButtonRef = useRef<HTMLButtonElement | null>(null)
  const mainAreaRef = useRef<HTMLDivElement | null>(null)
  const staticLabelRef = useRef<HTMLSpanElement | null>(null)
  const exprWrapperRef = useRef<HTMLDivElement | null>(null)
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
  const [dockStaticLabel, setDockStaticLabel] = useState(false)
  const [dockedStaticLabelTop, setDockedStaticLabelTop] = useState<number>(88)

  const workingExpr = workingSide === 'right' ? rhs : lhs
  const staticStr = workingSide === 'right' ? goalLhsStr : goalRhsStr

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

  const updateStaticLabelLayout = useCallback(() => {
    const mainArea = mainAreaRef.current
    const staticLabel = staticLabelRef.current
    const exprWrapper = exprWrapperRef.current
    if (!mainArea || !staticLabel || !exprWrapper) return

    const labelRect = staticLabel.getBoundingClientRect()
    const exprRect = exprWrapper.getBoundingClientRect()
    const shouldDock = labelRect.right + 32 > exprRect.left
    setDockStaticLabel(prev => (prev === shouldDock ? prev : shouldDock))

    if (!shouldDock) return

    const mainRect = mainArea.getBoundingClientRect()
    const backRect = backButtonRef.current?.getBoundingClientRect()
    const nextTop = backRect ? Math.round(backRect.bottom - mainRect.top + 16) : 88
    setDockedStaticLabelTop(prev => (prev === nextTop ? prev : nextTop))
  }, [])

  useLayoutEffect(() => {
    updateStaticLabelLayout()
  }, [updateStaticLabelLayout, staticStr, lhs, rhs, workingSide])

  useEffect(() => {
    const mainArea = mainAreaRef.current
    const staticLabel = staticLabelRef.current
    const exprWrapper = exprWrapperRef.current
    if (!mainArea || !staticLabel || !exprWrapper || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => updateStaticLabelLayout())
    observer.observe(mainArea)
    observer.observe(staticLabel)
    observer.observe(exprWrapper)
    if (backButtonRef.current) observer.observe(backButtonRef.current)

    window.addEventListener('resize', updateStaticLabelLayout)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateStaticLabelLayout)
    }
  }, [updateStaticLabelLayout])

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
    const rewrittenExpr = applyEqualityRule(workingExpr, targetId, hyp.lhs, hyp.rhs, isReverse)
    const outcome = await onRewrite(hyp.label, isReverse, workingSide, path)
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
    if (history.length === 0) return
    setIsProcessing(true)
    const success = await onUndo()
    setIsProcessing(false)
    if (!success) return
    const prev = history[history.length - 1]
    setLhs(prev.lhs)
    setRhs(prev.rhs)
    setHistory(h => h.slice(0, -1))
  }

  const handleReset = async () => {
    if (history.length === 0) return
    setIsProcessing(true)
    // Undo all history steps one by one
    let remaining = history.length
    for (let i = 0; i < history.length; i++) {
      const success = await onUndo()
      if (!success) break
      remaining--
    }
    setIsProcessing(false)
    if (remaining === 0) {
      setLhs(initialLhs())
      setRhs(initialRhs())
      setHistory([])
    }
  }

  const handleSwap = () => {
    onWorkingSideChange(workingSide === 'right' ? 'left' : 'right')
    setHistory([])
  }

  return (
    <div className="visual-page tr-overlay">
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
        <div ref={mainAreaRef} className="tr-main-area">
          <span
            ref={staticLabelRef}
            className={`tr-static-label${dockStaticLabel ? ' compact' : ''}`}
            style={dockStaticLabel ? { top: dockedStaticLabelTop, transform: 'none' } : undefined}
          >
            {staticStr} =
          </span>
          <div ref={exprWrapperRef} className="tr-expr-wrapper">
            <ExprRenderer
              node={workingExpr}
              isActive={!!activeId && !isProcessing}
              customIsValidDropTarget={customIsValidDropTarget}
            />
          </div>

          {/* Undo / Reset */}
          <div className="tr-controls">
            <button
              onClick={handleUndo}
              disabled={history.length === 0 || isProcessing}
              className={`tr-ctrl-btn${history.length > 0 ? ' active-undo' : ''}`}
              title="Undo"
            >↩</button>
            <button
              onClick={handleReset}
              disabled={history.length === 0 || isProcessing}
              className="tr-ctrl-btn reset"
              title="Reset"
            >↺</button>
          </div>

          {/* Swap / Reverse */}
          <div className="tr-side-controls">
            <button onClick={handleSwap} disabled={isProcessing} className="tr-ctrl-btn" title="Swap working side">⇄</button>
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
          {/* Equality hypothesis cards */}
          {equalityHyps.length > 0 && (
            <div className="tr-rule-section">
              <span className="tr-section-label">Hypotheses</span>
              {equalityHyps.map(hyp => (
                <EqualityHypCard
                  key={hyp.id}
                  dragId={`hyp_${hyp.id}`}
                  label={hyp.label}
                  lhsStr={hyp.lhsStr}
                  rhsStr={hyp.rhsStr}
                  isReverse={isReverse}
                  isFailing={failingCardId === `hyp_${hyp.id}`}
                  onMouseEnter={() => setHoveredId(`hyp_${hyp.id}`)}
                  onMouseLeave={() => setHoveredId(null)}
                />
              ))}
            </div>
          )}

          {/* Unlocked theorem equality cards */}
          {theoremEqualityHyps.length > 0 && (
            <div className="tr-rule-section">
              <span className="tr-section-label">Theorems</span>
              {theoremEqualityHyps.map(thm => (
                <EqualityHypCard
                  key={thm.id}
                  dragId={`thm_${thm.id}`}
                  label={thm.label}
                  lhsStr={thm.lhsStr}
                  rhsStr={thm.rhsStr}
                  isReverse={isReverse}
                  isFailing={failingCardId === `thm_${thm.id}`}
                  onMouseEnter={() => setHoveredId(`thm_${thm.id}`)}
                  onMouseLeave={() => setHoveredId(null)}
                />
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
