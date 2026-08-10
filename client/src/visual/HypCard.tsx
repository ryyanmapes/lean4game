import * as React from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { TaggedText_stripTags } from '@leanprover/infoview-api'
import type { HypCard as HypCardType } from './types'
import { formatFormulaText } from './expr-engine'
import { colorizeFormula } from './colorizeFormula'
import { hasIffNotation, renderFormulaWithIffArrow, type IffDirection } from './iffArrow'
import { StatementCardLine } from './StatementCardLine'
import { AtomicForm } from './AtomicForm'

interface HypCardProps {
  card: HypCardType
  streamId?: string
  positionOverride?: { x: number; y: number }
  isInteractive?: boolean
  isFailing?: boolean
  isClickable?: boolean
  clickTooltip?: string
  isTransformable?: boolean
  isConstructable?: boolean
  constructOnSingleClick?: boolean
  showDropTarget?: boolean
  isPotentialTarget?: boolean
  mobileList?: boolean
  animateMove?: boolean
  iffDirection?: IffDirection
  onClickAction?: () => void
  onDoubleClick?: () => void
  onContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void
  onMouseLeave?: () => void
  atomicContextNames?: string[]
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
  isConstructable = false,
  constructOnSingleClick = false,
  showDropTarget = false,
  isPotentialTarget = false,
  mobileList = false,
  animateMove = false,
  iffDirection = 'forward',
  onClickAction,
  onDoubleClick,
  onContextMenu,
  onMouseLeave,
  atomicContextNames = [],
}: HypCardProps) {
  const clickTimeoutRef = React.useRef<number | null>(null)
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({
    id: card.id,
    disabled: !isInteractive,
    data: { hypCard: true, card },
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
    position: mobileList ? 'relative' : 'absolute',
    left: mobileList ? undefined : positionOverride?.x ?? card.position.x,
    top: mobileList ? undefined : positionOverride?.y ?? card.position.y,
    transform: CSS.Translate.toString(transform),
    zIndex: isDragging ? 1000 : 10,
    visibility: isDragging && mobileList ? 'hidden' : undefined,
  }

  const classes = [
    'statement-card',
    !card.hyp.isAssumption && !card.isTheorem ? 'variable-card' : '',
    card.isTheorem ? 'derived-theorem-card' : '',
    card.hyp.forallFooter ? 'has-forall-footer' : '',
    isDragging ? 'dragging' : '',
    isPotentialTarget && !isDragging ? 'potential-drop-target' : '',
    isOver && showDropTarget && !isDragging ? 'drop-target-active' : '',
    isFailing ? 'drag-fail' : '',
    isClickable ? 'clickable' : '',
    isTransformable ? 'transformable' : '',
    isConstructable ? 'constructable' : '',
    animateMove ? 'fly-in' : '',
    mobileList ? 'mobile-list-card' : '',
  ].filter(Boolean).join(' ')

  const title = isClickable
    ? clickTooltip
    : isConstructable
      ? 'Double-click to specify an expression'
      : isTransformable
      ? 'Double-click to open transformation view'
      : card.isTheorem
      ? 'Drag onto another statement to use this theorem, or back to the theorem bar to delete it'
      : undefined
  const hypName = card.hyp.names[0] ?? ''
  const hypType = formatFormulaText(card.hyp.typeBody ?? TaggedText_stripTags(card.hyp.type))

  React.useEffect(() => {
    return () => {
      if (clickTimeoutRef.current !== null) {
        window.clearTimeout(clickTimeoutRef.current)
      }
    }
  }, [])

  function handleClick() {
    if (constructOnSingleClick && onDoubleClick) {
      if (clickTimeoutRef.current !== null) window.clearTimeout(clickTimeoutRef.current)
      clickTimeoutRef.current = null
      onDoubleClick()
      return
    }
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
      data-constructable={String(isConstructable)}
      style={style}
      className={classes}
      onClick={isInteractive && (isClickable || constructOnSingleClick) && !isDragging ? handleClick : undefined}
      onDoubleClick={isInteractive && (isTransformable || isConstructable) && !isDragging ? handleDoubleClick : undefined}
      onContextMenu={onContextMenu}
      onMouseLeave={onMouseLeave}
      title={title}
      {...(isInteractive ? listeners : {})}
      {...(isInteractive ? attributes : {})}
    >
      <HypCardContent card={card} iffDirection={iffDirection} atomicContextNames={atomicContextNames} />
    </div>
  )
}

function HypCardContent({ card, iffDirection = 'forward', atomicContextNames = [] }: { card: HypCardType; iffDirection?: IffDirection; atomicContextNames?: string[] }) {
  const hypType = formatFormulaText(card.hyp.typeBody ?? TaggedText_stripTags(card.hyp.type))
  const forallFooter = card.hyp.forallFooter ? formatFormulaText(card.hyp.forallFooter) : undefined
  const isIff = hasIffNotation(hypType) || (forallFooter ? hasIffNotation(forallFooter) : false)
  return (
    <>
      <StatementCardLine
        name={card.hyp.names.join(', ')}
        proposition={isIff ? renderFormulaWithIffArrow(hypType, iffDirection) : colorizeFormula(hypType)}
      />
      <AtomicForm displayText={hypType} reductionForms={card.hyp.reductionForms} contextNames={atomicContextNames} />
      {forallFooter && (
        <div className="statement-forall-footer">
          {hasIffNotation(forallFooter) && isIff
            ? renderFormulaWithIffArrow(forallFooter, iffDirection)
            : colorizeFormula(forallFooter)}
        </div>
      )}
    </>
  )
}

export function HypCardPreviewCard({ card, iffDirection }: { card: HypCardType; iffDirection?: IffDirection }) {
  return (
    <div className={`statement-card mobile-list-card hyp-overlay-card${!card.hyp.isAssumption && !card.isTheorem ? ' variable-card variable-overlay-card' : ''}${card.isTheorem ? ' derived-theorem-card' : ''}${card.hyp.forallFooter ? ' has-forall-footer' : ''}`}>
      <HypCardContent card={card} iffDirection={iffDirection} />
    </div>
  )
}
