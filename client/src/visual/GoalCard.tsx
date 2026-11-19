import * as React from 'react'
import { useDroppable } from '@dnd-kit/core'
import { TaggedText_stripTags } from '@leanprover/infoview-api'
import type { InteractiveGoal } from '../components/infoview/rpc_api'
import { formatFormulaText } from './expr-engine'
import { colorizeFormula } from './colorizeFormula'
import { VisualInfoText } from './VisualInfoText'
import type { VisualGoalInfo } from './types'
import { AtomicForm } from './AtomicForm'
import { inferAtomicReductionForms } from './existsDisplay'

/** Whether a goal hint's conditions hold for a goal reading `goalText` (as displayed)
 * whose hypotheses read `hypTypeTexts`. */
export function goalInfoMatchesGoal(info: VisualGoalInfo, goalText: string, hypTypeTexts: string[]): boolean {
  if (info.goal && formatFormulaText(info.goal) !== goalText) return false
  if (info.requireHypType && !hypTypeTexts.includes(formatFormulaText(info.requireHypType))) return false
  if (info.excludeHypType && hypTypeTexts.includes(formatFormulaText(info.excludeHypType))) return false
  return true
}

interface GoalCardProps {
  id: string
  goal: InteractiveGoal
  isInteractive?: boolean
  onClick?: () => void
  onDoubleClick?: () => void
  onContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void
  onMouseLeave?: () => void
  isTransformable?: boolean
  isConstructable?: boolean
  isClickable?: boolean
  clickTooltip?: string
  isSolved?: boolean
  animateSolved?: boolean
  visualInfos?: VisualGoalInfo[]
  /** `visualInfos` are already the ones to show (the canvas matched them, and may be
   *  keeping them up after they stopped matching). */
  infosMatched?: boolean
  showDropTarget?: boolean
  isPotentialTarget?: boolean
  infoPositions?: Array<'above' | 'below'>
  atomicContextNames?: string[]
  reductionForms?: string[]
}

export function GoalCard({
  id,
  goal,
  isInteractive = true,
  onClick,
  onDoubleClick,
  onContextMenu,
  onMouseLeave,
  isTransformable,
  isConstructable,
  isClickable,
  isSolved,
  animateSolved = false,
  visualInfos = [],
  infosMatched = false,
  showDropTarget = false,
  isPotentialTarget = false,
  infoPositions = ['above', 'below'],
  atomicContextNames = [],
  reductionForms,
}: GoalCardProps) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !isInteractive })
  const clickTimeoutRef = React.useRef<number | null>(null)
  const clickSequenceGoalRef = React.useRef<string | null>(null)
  const wrapperRef = React.useRef<HTMLDivElement | null>(null)
  const cardRef = React.useRef<HTMLDivElement | null>(null)
  const propositionRef = React.useRef<HTMLSpanElement | null>(null)
  const [arrows, setArrows] = React.useState<Array<{ start: { x: number; y: number }; end: { x: number; y: number } }>>([])
  const goalText = formatFormulaText(TaggedText_stripTags(goal.type))
  const effectiveReductionForms = React.useMemo(() => {
    const merged = [...(reductionForms ?? [])]
    for (const form of inferAtomicReductionForms(goalText)) {
      if (!merged.includes(form)) merged.push(form)
    }
    return merged
  }, [goalText, reductionForms])
  const hypTypeTexts = React.useMemo(
    () => goal.hyps.map(h => formatFormulaText(TaggedText_stripTags(h.type))),
    [goal.hyps],
  )
  const activeVisualInfos = React.useMemo(
    () => infosMatched
      ? visualInfos
      : visualInfos.filter(info => goalInfoMatchesGoal(info, goalText, hypTypeTexts)),
    [goalText, hypTypeTexts, infosMatched, visualInfos],
  )

  const classes = [
    'statement-card',
    'goal',
    isTransformable ? 'transformable' : '',
    isConstructable ? 'constructable' : '',
    isClickable ? 'clickable' : '',
    isPotentialTarget ? 'potential-drop-target' : '',
    isOver && showDropTarget ? 'drop-target-active' : '',
    isSolved ? 'solved' : '',
    isSolved && animateSolved ? 'just-solved' : '',
  ].filter(Boolean).join(' ')

  React.useEffect(() => {
    return () => {
      if (clickTimeoutRef.current !== null) {
        window.clearTimeout(clickTimeoutRef.current)
      }
    }
  }, [])

  const setCardNode = React.useCallback((node: HTMLDivElement | null) => {
    cardRef.current = node
    setNodeRef(node)
  }, [setNodeRef])

  React.useLayoutEffect(() => {
    const update = () => {
      const wrapperRect = wrapperRef.current?.getBoundingClientRect()
      const cardRect = cardRef.current?.getBoundingClientRect()
      if (!wrapperRect || !cardRect) {
        setArrows([])
        return
      }
      const next = activeVisualInfos.flatMap((info) => {
        if (!info.arrow) return []
        const goalAnchorY = cardRect.top - wrapperRect.top + cardRect.height / 2
        const goalAnchorX = cardRect.left - wrapperRect.left - 42
        return [{
          start: {
            x: goalAnchorX - 108,
            y: goalAnchorY,
          },
          end: {
            x: goalAnchorX,
            y: goalAnchorY,
          },
        }]
      })
      setArrows(next)
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [activeVisualInfos, goalText])

  function renderGoalInfoArrow(
    arrow: { start: { x: number; y: number }; end: { x: number; y: number } },
    index: number,
  ) {
    const dx = arrow.end.x - arrow.start.x
    const dy = arrow.end.y - arrow.start.y
    const len = Math.sqrt(dx * dx + dy * dy) || 1
    const ux = dx / len
    const uy = dy / len
    const px = -uy
    const py = ux
    const headLength = 20
    const headHalfWidth = 9
    const base = {
      x: arrow.end.x - ux * headLength,
      y: arrow.end.y - uy * headLength,
    }
    const shaftEnd = {
      x: base.x + ux * 4,
      y: base.y + uy * 4,
    }
    const path = `M ${arrow.start.x} ${arrow.start.y} L ${shaftEnd.x} ${shaftEnd.y}`
    const arrowHeadPoints = [
      `${arrow.end.x},${arrow.end.y}`,
      `${base.x + px * headHalfWidth},${base.y + py * headHalfWidth}`,
      `${base.x - px * headHalfWidth},${base.y - py * headHalfWidth}`,
    ].join(' ')

    return (
      <svg key={index} className="goal-info-arrow" aria-hidden="true">
        <path d={path} />
        <polygon points={arrowHeadPoints} />
      </svg>
    )
  }

  const renderInfo = (position: 'above' | 'below') =>
    activeVisualInfos.map((info, index) => info.position === position && (
      <div
        key={`${position}-${index}`}
        className={`visual-info-callout goal-info ${position}`}
      >
        <VisualInfoText text={info.text} />
      </div>
    ))

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    // A native double-click sends two click events. Only the first may be a
    // single-click action; otherwise an intro-able goal can introduce twice.
    if (event.detail > 1) return
    clickSequenceGoalRef.current = id
    if (!onClick) return
    if (onDoubleClick) {
      if (clickTimeoutRef.current !== null) {
        window.clearTimeout(clickTimeoutRef.current)
      }
      clickTimeoutRef.current = window.setTimeout(() => {
        clickTimeoutRef.current = null
        onClick()
      }, 220)
      return
    }
    onClick()
  }

  function handleDoubleClick() {
    // The first click may have introduced a binder and replaced this card's
    // goal before the browser emits dblclick. Never combine clicks that began
    // on different goals into a transformation/construction gesture.
    if (clickSequenceGoalRef.current !== id) {
      clickSequenceGoalRef.current = null
      return
    }
    clickSequenceGoalRef.current = null
    if (clickTimeoutRef.current !== null) {
      window.clearTimeout(clickTimeoutRef.current)
      clickTimeoutRef.current = null
    }
    onDoubleClick?.()
  }

  return (
    <div ref={wrapperRef} className="goal-card-with-info">
      {infoPositions.includes('above') && renderInfo('above')}
      <div
        id={id}
        ref={setCardNode}
        data-testid="goal-card"
        data-stream-id={id}
        data-goal-text={goalText}
        className={classes}
        // A finished goal is not interactive but can still be opened to look at
        // (the click is what a double-click's sequence starts from).
        onClick={isInteractive || onDoubleClick ? handleClick : undefined}
        onDoubleClick={isInteractive || onDoubleClick ? handleDoubleClick : undefined}
        onContextMenu={onContextMenu}
        onMouseLeave={onMouseLeave}
      >
        <div className="goal-prefix">Goal</div>
        <span ref={propositionRef} className="proposition">{colorizeFormula(goalText)}</span>
        <AtomicForm displayText={goalText} reductionForms={effectiveReductionForms} contextNames={atomicContextNames} />
      </div>
      {infoPositions.includes('below') && renderInfo('below')}
      {arrows.map(renderGoalInfoArrow)}
    </div>
  )
}
