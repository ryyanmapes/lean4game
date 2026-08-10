import * as React from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import type { PropositionTheorem, PropositionTheoremCopy } from './types'
import { formatFormulaText } from './expr-engine'
import { colorizeFormula, hasIntegerNotation } from './colorizeFormula'
import { hasIffNotation, renderFormulaWithIffArrow, type IffDirection } from './iffArrow'
import { StatementCardLine } from './StatementCardLine'
import { AtomicForm } from './AtomicForm'

function PropositionTheoremContent({
  theorem,
  iffDirection = 'forward',
}: { theorem: PropositionTheorem; iffDirection?: IffDirection }) {
  const proposition = formatFormulaText(theorem.proposition)
  const forallFooter = theorem.forallFooter ? formatFormulaText(theorem.forallFooter) : undefined
  const isIff = hasIffNotation(proposition) || (forallFooter ? hasIffNotation(forallFooter) : false)

  return (
    <>
      <StatementCardLine
        name={theorem.label}
        proposition={isIff ? renderFormulaWithIffArrow(proposition, iffDirection) : colorizeFormula(proposition)}
      />
      <AtomicForm displayText={proposition} reductionForms={theorem.reductionForms} />
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

function theoremCardLayoutClass(theorem: PropositionTheorem): string {
  const lineCapacity = 30
  const labelAndPropositionLength = theorem.label.length + 2 + theorem.proposition.length
  const reservedLines = (theorem.forallFooter ? 1 : 0) + (theorem.reductionForms?.length ? 1 : 0)
  const availablePropositionLines = Math.max(0, 2 - reservedLines)
  const propositionLines = Math.ceil(theorem.proposition.length / lineCapacity)
  if (
    labelAndPropositionLength > lineCapacity
    && theorem.label.length <= lineCapacity
    && propositionLines <= availablePropositionLines
  ) {
    return ' theorem-card-break-after-label'
  }
  const contentLength = `${theorem.label} ${theorem.proposition} ${theorem.forallFooter ?? ''}`.length
  return contentLength > 54 ? ' theorem-card-compact' : contentLength > 38 ? ' theorem-card-snug' : ''
}

export function PropositionTheoremPreviewCard({ theorem, iffDirection }: { theorem: PropositionTheorem; iffDirection?: IffDirection }) {
  return (
    <div className={`statement-card theorem-copy-card theorem-overlay-card${theorem.forallFooter ? ' has-forall-footer' : ''}${isIntegerTheorem(theorem) ? ' int-theorem' : ''}${theoremCardLayoutClass(theorem)}`}>
      <PropositionTheoremContent theorem={theorem} iffDirection={iffDirection} />
    </div>
  )
}

interface PropositionTheoremTemplateCardProps {
  theorem: PropositionTheorem
  iffDirection?: IffDirection
  onDoubleClick?: () => void
  onContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void
  emphasized?: boolean
}

export function PropositionTheoremTemplateCard({ theorem, iffDirection, onDoubleClick, onContextMenu, emphasized = false }: PropositionTheoremTemplateCardProps) {
  const dragId = `theorem_template_${theorem.id}`
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: { theoremTemplate: true, theorem },
  })
  const style: React.CSSProperties | undefined = isDragging ? { visibility: 'hidden' } : undefined
  return (
    <div
      ref={setNodeRef}
      id={dragId}
      data-testid="theorem-tray-card"
      data-theorem-name={theorem.theoremName}
      style={style}
      className={`statement-card theorem-tray-card${theorem.forallFooter ? ' has-forall-footer' : ''}${theorem.forallSpecification ? ' constructable' : ''}${isDragging ? ' dragging' : ''}${isIntegerTheorem(theorem) ? ' int-theorem' : ''}${theoremCardLayoutClass(theorem)}${emphasized ? ' visual-emphasize' : ''}`}
      onDoubleClick={!isDragging ? onDoubleClick : undefined}
      onContextMenu={onContextMenu}
      {...listeners}
      {...attributes}
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
  showDropTarget?: boolean
  mobileList?: boolean
}

export function PropositionTheoremCopyCard({ copy, isFailing = false, iffDirection, onDoubleClick, onContextMenu, showDropTarget = false, mobileList = false }: PropositionTheoremCopyCardProps) {
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
    position: mobileList ? 'relative' : 'absolute',
    left: mobileList ? undefined : copy.position.x,
    top: mobileList ? undefined : copy.position.y,
    zIndex: isDragging ? 1000 : 10,
    visibility: isDragging ? 'hidden' : undefined,
  }

  const classes = [
    'statement-card',
    'theorem-copy-card',
    copy.theorem.forallFooter ? 'has-forall-footer' : '',
    copy.theorem.forallSpecification ? 'constructable' : '',
    isDragging ? 'dragging' : '',
    isOver && showDropTarget && !isDragging ? 'drop-target-active' : '',
    isFailing ? 'drag-fail' : '',
    isIntegerTheorem(copy.theorem) ? 'int-theorem' : '',
    theoremCardLayoutClass(copy.theorem),
    mobileList ? 'mobile-list-card' : '',
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
