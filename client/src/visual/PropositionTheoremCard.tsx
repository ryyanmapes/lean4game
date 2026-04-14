import * as React from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import type { PropositionTheorem, PropositionTheoremCopy } from './types'
import { formatFormulaText } from './expr-engine'
import { colorizeFormula, hasIntegerNotation } from './colorizeFormula'
import { hasIffNotation, renderFormulaWithIffArrow, type IffDirection } from './iffArrow'

function PropositionTheoremContent({
  theorem,
  iffDirection = 'forward',
}: { theorem: PropositionTheorem; iffDirection?: IffDirection }) {
  const proposition = formatFormulaText(theorem.proposition)
  const forallFooter = theorem.forallFooter ? formatFormulaText(theorem.forallFooter) : undefined
  const isIff = hasIffNotation(proposition) || (forallFooter ? hasIffNotation(forallFooter) : false)

  return (
    <>
      <div className="statement-card-main">
        <span className="hyp-name">{theorem.label}</span>
        <span className="hyp-colon">:</span>
        <span className="proposition">
          {isIff ? renderFormulaWithIffArrow(proposition, iffDirection) : colorizeFormula(proposition)}
        </span>
      </div>
      {forallFooter && (
        <div className="statement-forall-footer">
          {isIff && hasIffNotation(forallFooter)
            ? renderFormulaWithIffArrow(forallFooter, iffDirection)
            : colorizeFormula(forallFooter)}
        </div>
      )}
    </>
  )
}

/** Returns true if this theorem's displayed proposition contains an `↔`. */
export function theoremIsIff(theorem: PropositionTheorem): boolean {
  return hasIffNotation(theorem.proposition) ||
    (theorem.forallFooter ? hasIffNotation(theorem.forallFooter) : false)
}

/** Returns true if this theorem involves integer notation (MyInt namespace or integer symbols). */
function isIntegerTheorem(theorem: PropositionTheorem): boolean {
  return theorem.theoremName.startsWith('MyInt.') || hasIntegerNotation(theorem.proposition)
}

export function PropositionTheoremPreviewCard({ theorem, iffDirection }: { theorem: PropositionTheorem; iffDirection?: IffDirection }) {
  return (
    <div className={`statement-card theorem-copy-card theorem-overlay-card${theorem.forallFooter ? ' has-forall-footer' : ''}${isIntegerTheorem(theorem) ? ' int-theorem' : ''}`}>
      <PropositionTheoremContent theorem={theorem} iffDirection={iffDirection} />
    </div>
  )
}

interface PropositionTheoremTemplateCardProps {
  theorem: PropositionTheorem
  iffDirection?: IffDirection
  onDoubleClick?: () => void
  onContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void
}

export function PropositionTheoremTemplateCard({ theorem, iffDirection, onDoubleClick, onContextMenu }: PropositionTheoremTemplateCardProps) {
  const dragId = `theorem_template_${theorem.id}`
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: { theoremTemplate: true, theorem },
  })
  const style: React.CSSProperties | undefined = isDragging ? { visibility: 'hidden' } : undefined
  const title = theorem.forallSpecification
    ? 'Drag out to create a theorem copy, or double-click to specify an expression'
    : 'Drag out to create a theorem copy'

  return (
    <div
      ref={setNodeRef}
      id={dragId}
      data-testid="theorem-tray-card"
      data-theorem-name={theorem.theoremName}
      style={style}
      className={`statement-card theorem-tray-card${theorem.forallFooter ? ' has-forall-footer' : ''}${theorem.forallSpecification ? ' constructable' : ''}${isDragging ? ' dragging' : ''}${isIntegerTheorem(theorem) ? ' int-theorem' : ''}`}
      onDoubleClick={!isDragging ? onDoubleClick : undefined}
      onContextMenu={onContextMenu}
      {...listeners}
      {...attributes}
      title={title}
    >
      <PropositionTheoremContent theorem={theorem} iffDirection={iffDirection} />
    </div>
  )
}

interface PropositionTheoremCopyCardProps {
  copy: PropositionTheoremCopy
  isFailing?: boolean
  iffDirection?: IffDirection
  onDoubleClick?: () => void
  onContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void
}

export function PropositionTheoremCopyCard({ copy, isFailing = false, iffDirection, onDoubleClick, onContextMenu }: PropositionTheoremCopyCardProps) {
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: copy.id,
    data: { theoremCopy: true, theorem: copy.theorem },
  })

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: copy.id,
  })

  const setRef = (el: HTMLElement | null) => {
    setDragRef(el)
    setDropRef(el)
  }

  const style: React.CSSProperties = {
    position: 'absolute',
    left: copy.position.x,
    top: copy.position.y,
    zIndex: isDragging ? 1000 : 10,
    visibility: isDragging ? 'hidden' : undefined,
  }

  const classes = [
    'statement-card',
    'theorem-copy-card',
    copy.theorem.forallFooter ? 'has-forall-footer' : '',
    copy.theorem.forallSpecification ? 'constructable' : '',
    isDragging ? 'dragging' : '',
    isOver && !isDragging ? 'drop-target-active' : '',
    isFailing ? 'drag-fail' : '',
    isIntegerTheorem(copy.theorem) ? 'int-theorem' : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      id={copy.id}
      data-testid="theorem-copy-card"
      data-theorem-name={copy.theorem.theoremName}
      ref={setRef}
      style={style}
      className={classes}
      onDoubleClick={!isDragging ? onDoubleClick : undefined}
      onContextMenu={onContextMenu}
      title={copy.theorem.forallSpecification
        ? 'Drag onto cards to use this theorem, or double-click to specify an expression'
        : 'Drag onto cards to use this theorem, or back to the theorem bar to delete it'}
      {...listeners}
      {...attributes}
    >
      <PropositionTheoremContent theorem={copy.theorem} iffDirection={iffDirection} />
    </div>
  )
}
