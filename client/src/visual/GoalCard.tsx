import * as React from 'react'
import { useDroppable } from '@dnd-kit/core'
import { TaggedText_stripTags } from '@leanprover/infoview-api'
import type { InteractiveGoal } from '../components/infoview/rpc_api'
import { formatFormulaText } from './expr-engine'
import { colorizeFormula } from './colorizeFormula'
import { VisualInfoText } from './VisualInfoText'
import type { VisualGoalInfo } from './types'

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
  visualInfos?: VisualGoalInfo[]
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
  clickTooltip,
  isSolved,
  visualInfos = [],
}: GoalCardProps) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !isInteractive })
  const clickTimeoutRef = React.useRef<number | null>(null)
  const wrapperRef = React.useRef<HTMLDivElement | null>(null)
  const cardRef = React.useRef<HTMLDivElement | null>(null)
  const propositionRef = React.useRef<HTMLSpanElement | null>(null)
  const [arrows, setArrows] = React.useState<Array<{ start: { x: number; y: number }; end: { x: number; y: number } }>>([])
  const goalText = formatFormulaText(TaggedText_stripTags(goal.type))
  const hypTypeTexts = React.useMemo(
    () => goal.hyps.map(h => formatFormulaText(TaggedText_stripTags(h.type))),
    [goal.hyps],
  )
  const activeVisualInfos = React.useMemo(
    () => visualInfos.filter(info => {
      if (info.goal && formatFormulaText(info.goal) !== goalText) return false
      if (info.requireHypType) {
        const target = formatFormulaText(info.requireHypType)
        if (!hypTypeTexts.includes(target)) return false
      }
      if (info.excludeHypType) {
        const target = formatFormulaText(info.excludeHypType)
        if (hypTypeTexts.includes(target)) return false
      }
      return true
    }),
    [goalText, hypTypeTexts, visualInfos],
  )

  const classes = [
    'statement-card',
    'goal',
    isTransformable ? 'transformable' : '',
    isConstructable ? 'constructable' : '',
    isClickable ? 'clickable' : '',
    isOver ? 'drop-target-active' : '',
    isSolved ? 'solved' : '',
  ].filter(Boolean).join(' ')

  const doubleClickHint = isConstructable
    ? 'Double-click to propose a witness'
    : isTransformable
      ? 'Double-click to open transformation view'
      : undefined
  const title = isClickable && doubleClickHint
    ? clickTooltip
      ? `${clickTooltip}. ${doubleClickHint}`
      : doubleClickHint
    : isClickable
      ? clickTooltip
      : doubleClickHint

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

  function handleClick() {
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
    if (clickTimeoutRef.current !== null) {
      window.clearTimeout(clickTimeoutRef.current)
      clickTimeoutRef.current = null
    }
    onDoubleClick?.()
  }

  return (
    <div ref={wrapperRef} className="goal-card-with-info">
      {renderInfo('above')}
      <div
        id={id}
        ref={setCardNode}
        data-testid="goal-card"
        data-stream-id={id}
        data-goal-text={goalText}
        className={classes}
        onClick={isInteractive ? handleClick : undefined}
        onDoubleClick={isInteractive ? handleDoubleClick : undefined}
        onContextMenu={onContextMenu}
        onMouseLeave={onMouseLeave}
        title={title}
      >
        <div className="goal-prefix">Goal</div>
        <span ref={propositionRef} className="proposition">{colorizeFormula(goalText)}</span>
      </div>
      {renderInfo('below')}
      {arrows.map(renderGoalInfoArrow)}
    </div>
  )
}
