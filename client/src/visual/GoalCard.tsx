import * as React from 'react'
import { useDroppable } from '@dnd-kit/core'
import { TaggedText_stripTags } from '@leanprover/infoview-api'
import type { InteractiveGoal } from '../components/infoview/rpc_api'

interface GoalCardProps {
  id: string
  goal: InteractiveGoal
  isInteractive?: boolean
  onClick?: () => void
  onDoubleClick?: () => void
  onContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void
  onMouseLeave?: () => void
  isTransformable?: boolean
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
  isClickable,
  clickTooltip,
  isSolved,
}: GoalCardProps) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !isInteractive })
  const goalText = TaggedText_stripTags(goal.type)

  const classes = [
    'statement-card',
    'goal',
    isTransformable ? 'transformable' : '',
    isClickable ? 'clickable' : '',
    isOver ? 'drop-target-active' : '',
    isSolved ? 'solved' : '',
  ].filter(Boolean).join(' ')

  const title = isClickable
    ? clickTooltip
    : isTransformable
      ? 'Double-click to open transformation view'
      : undefined

  return (
    <div
      id={id}
      ref={setNodeRef}
      data-testid="goal-card"
      data-stream-id={id}
      data-goal-text={goalText}
      className={classes}
      onClick={isInteractive ? onClick : undefined}
      onDoubleClick={isInteractive ? onDoubleClick : undefined}
      onContextMenu={onContextMenu}
      onMouseLeave={onMouseLeave}
      title={title}
    >
      <div className="goal-prefix">Goal</div>
      <span className="proposition">{goalText}</span>
    </div>
  )
}
