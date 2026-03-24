import * as React from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { TaggedText_stripTags } from '@leanprover/infoview-api'
import type { HypCard as HypCardType } from './types'

interface HypCardProps {
  card: HypCardType
  streamId?: string
  positionOverride?: { x: number; y: number }
  isInteractive?: boolean
  isFailing?: boolean
  isClickable?: boolean
  clickTooltip?: string
  isTransformable?: boolean
  animateMove?: boolean
  onClickAction?: () => void
  onDoubleClick?: () => void
  onContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void
  onMouseLeave?: () => void
}

export function HypCard({
  card,
  streamId,
  positionOverride,
  isInteractive = true,
  isFailing = false,
  isClickable = false,
  clickTooltip,
  isTransformable = false,
  animateMove = false,
  onClickAction,
  onDoubleClick,
  onContextMenu,
  onMouseLeave,
}: HypCardProps) {
  const clickTimeoutRef = React.useRef<number | null>(null)
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({
    id: card.id,
    disabled: !isInteractive,
  })

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: card.id,
    disabled: !isInteractive,
  })

  // Merge both refs onto the same element
  const setRef = (el: HTMLElement | null) => {
    setDragRef(el)
    setDropRef(el)
  }

  const style: React.CSSProperties = {
    position: 'absolute',
    left: positionOverride?.x ?? card.position.x,
    top: positionOverride?.y ?? card.position.y,
    transform: CSS.Translate.toString(transform),
    zIndex: isDragging ? 1000 : 10,
  }

  const classes = [
    'statement-card',
    isDragging ? 'dragging' : '',
    isOver && !isDragging ? 'drop-target-active' : '',
    isFailing ? 'drag-fail' : '',
    isClickable ? 'clickable' : '',
    isTransformable ? 'transformable' : '',
    animateMove ? 'fly-in' : '',
  ].filter(Boolean).join(' ')

  const title = isClickable
    ? clickTooltip
    : isTransformable
      ? 'Double-click to open transformation view'
      : undefined
  const hypName = card.hyp.names[0] ?? ''
  const hypType = TaggedText_stripTags(card.hyp.type)

  React.useEffect(() => {
    return () => {
      if (clickTimeoutRef.current !== null) {
        window.clearTimeout(clickTimeoutRef.current)
      }
    }
  }, [])

  function handleClick() {
    if (!onClickAction) return
    if (onDoubleClick) {
      if (clickTimeoutRef.current !== null) {
        window.clearTimeout(clickTimeoutRef.current)
      }
      clickTimeoutRef.current = window.setTimeout(() => {
        clickTimeoutRef.current = null
        onClickAction()
      }, 220)
      return
    }
    onClickAction()
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
      id={card.id}
      ref={setRef}
      data-testid="hyp-card"
      data-stream-id={streamId}
      data-hyp-id={card.id}
      data-hyp-name={hypName}
      data-hyp-type={hypType}
      style={style}
      className={classes}
      onClick={isInteractive && isClickable && !isDragging ? handleClick : undefined}
      onDoubleClick={isInteractive && isTransformable && !isDragging ? handleDoubleClick : undefined}
      onContextMenu={onContextMenu}
      onMouseLeave={onMouseLeave}
      title={title}
      {...(isInteractive ? listeners : {})}
      {...(isInteractive ? attributes : {})}
    >
      <span className="hyp-name">{card.hyp.names.join(', ')}</span>
      <span className="hyp-colon">:</span>
      <span className="proposition">{hypType}</span>
    </div>
  )
}
