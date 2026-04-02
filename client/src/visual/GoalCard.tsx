import * as React from 'react'
import { useDroppable } from '@dnd-kit/core'
import { TaggedText_stripTags } from '@leanprover/infoview-api'
import type { InteractiveGoal } from '../components/infoview/rpc_api'
import { parse, printExpression } from './expr-engine'
import type { ExpressionNode } from './expr-types'

function leafCount(node: ExpressionNode): number {
  if (node.type === 'variable' || node.type === 'constant') return 1
  if (node.type === 'app') return 1 + leafCount(node.arg)
  if (node.type === 'binary') return leafCount(node.left) + leafCount(node.right)
  return 0
}

/** Re-print a simple arithmetic string with explicit associativity parens.
 *  Falls back to the original if the expression can't be fully parsed. */
function formatArith(s: string): string {
  try {
    const ast = parse(s.trim())
    const tokenCount = (s.match(/[\p{L}\p{N}_]+/gu) || []).length
    if (leafCount(ast) !== tokenCount) return s
    return printExpression(ast)
  } catch {
    return s
  }
}

/** Post-process a Lean goal string of the form `lhs = rhs` to add parens. */
function formatGoalText(text: string): string {
  const eqIdx = text.indexOf(' = ')
  if (eqIdx === -1) return text
  return `${formatArith(text.slice(0, eqIdx))} = ${formatArith(text.slice(eqIdx + 3))}`
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
}: GoalCardProps) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !isInteractive })
  const clickTimeoutRef = React.useRef<number | null>(null)
  const goalText = formatGoalText(TaggedText_stripTags(goal.type))

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
    <div
      id={id}
      ref={setNodeRef}
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
      <span className="proposition">{goalText}</span>
    </div>
  )
}
