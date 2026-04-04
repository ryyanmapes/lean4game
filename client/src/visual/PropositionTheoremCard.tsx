import * as React from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import type { PropositionTheorem, PropositionTheoremCopy } from './types'
import { formatFormulaText } from './expr-engine'

function PropositionTheoremContent({ theorem }: { theorem: PropositionTheorem }) {
  const proposition = formatFormulaText(theorem.proposition)

  return (
    <>
      <span className="hyp-name">{theorem.label}</span>
      <span className="hyp-colon">:</span>
      <span className="proposition">{proposition}</span>
    </>
  )
}

export function PropositionTheoremPreviewCard({ theorem }: { theorem: PropositionTheorem }) {
  return (
    <div className="statement-card theorem-copy-card theorem-overlay-card">
      <PropositionTheoremContent theorem={theorem} />
    </div>
  )
}

interface PropositionTheoremTemplateCardProps {
  theorem: PropositionTheorem
}

export function PropositionTheoremTemplateCard({ theorem }: PropositionTheoremTemplateCardProps) {
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
      style={style}
      className={`statement-card theorem-tray-card${isDragging ? ' dragging' : ''}`}
      {...listeners}
      {...attributes}
      title="Drag out to create a theorem copy"
    >
      <PropositionTheoremContent theorem={theorem} />
    </div>
  )
}

interface PropositionTheoremCopyCardProps {
  copy: PropositionTheoremCopy
  isFailing?: boolean
}

export function PropositionTheoremCopyCard({ copy, isFailing = false }: PropositionTheoremCopyCardProps) {
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
    isDragging ? 'dragging' : '',
    isOver && !isDragging ? 'drop-target-active' : '',
    isFailing ? 'drag-fail' : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      id={copy.id}
      ref={setRef}
      style={style}
      className={classes}
      title="Drag onto cards to use this theorem, or back to the theorem bar to delete it"
      {...listeners}
      {...attributes}
    >
      <PropositionTheoremContent theorem={copy.theorem} />
    </div>
  )
}
