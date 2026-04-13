import * as React from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import type { PropositionTheorem, PropositionTheoremCopy } from './types'
import { formatFormulaText } from './expr-engine'
import { colorizeFormula, hasIntegerNotation } from './colorizeFormula'

function PropositionTheoremContent({ theorem }: { theorem: PropositionTheorem }) {
  const proposition = formatFormulaText(theorem.proposition)
  const forallFooter = theorem.forallFooter ? formatFormulaText(theorem.forallFooter) : undefined

  return (
    <>
      <div className="statement-card-main">
        <span className="hyp-name">{theorem.label}</span>
        <span className="hyp-colon">:</span>
        <span className="proposition">{colorizeFormula(proposition)}</span>
      </div>
      {forallFooter && <div className="statement-forall-footer">{colorizeFormula(forallFooter)}</div>}
    </>
  )
}

/** Returns true if this theorem involves integer notation (MyInt namespace or integer symbols). */
function isIntegerTheorem(theorem: PropositionTheorem): boolean {
  return theorem.theoremName.startsWith('MyInt.') || hasIntegerNotation(theorem.proposition)
}

export function PropositionTheoremPreviewCard({ theorem }: { theorem: PropositionTheorem }) {
  return (
    <div className={`statement-card theorem-copy-card theorem-overlay-card${theorem.forallFooter ? ' has-forall-footer' : ''}`}>
      <PropositionTheoremContent theorem={theorem} />
    </div>
  )
}

interface PropositionTheoremTemplateCardProps {
  theorem: PropositionTheorem
  onDoubleClick?: () => void
}

export function PropositionTheoremTemplateCard({ theorem, onDoubleClick }: PropositionTheoremTemplateCardProps) {
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
      className={`statement-card theorem-tray-card${theorem.forallFooter ? ' has-forall-footer' : ''}${theorem.forallSpecification ? ' constructable' : ''}${isDragging ? ' dragging' : ''}`}
      onDoubleClick={!isDragging ? onDoubleClick : undefined}
      {...listeners}
      {...attributes}
      title={title}
    >
      <PropositionTheoremContent theorem={theorem} />
    </div>
  )
}

interface PropositionTheoremCopyCardProps {
  copy: PropositionTheoremCopy
  isFailing?: boolean
  onDoubleClick?: () => void
}

export function PropositionTheoremCopyCard({ copy, isFailing = false, onDoubleClick }: PropositionTheoremCopyCardProps) {
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
      title={copy.theorem.forallSpecification
        ? 'Drag onto cards to use this theorem, or double-click to specify an expression'
        : 'Drag onto cards to use this theorem, or back to the theorem bar to delete it'}
      {...listeners}
      {...attributes}
    >
      <PropositionTheoremContent theorem={copy.theorem} />
    </div>
  )
}
