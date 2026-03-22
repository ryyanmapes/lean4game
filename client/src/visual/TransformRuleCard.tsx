import * as React from 'react'
import { useDraggable } from '@dnd-kit/core'

interface EqualityHypCardProps {
  dragId: string
  label: string    // e.g. "h"
  lhsStr: string
  rhsStr: string
  isReverse: boolean
  isFailing?: boolean
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

export function EqualityHypCard({ dragId, label, lhsStr, rhsStr, isReverse, isFailing = false, onMouseEnter, onMouseLeave }: EqualityHypCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: { equalityHyp: true },
  })

  const symbol = isReverse ? `${rhsStr} → ${lhsStr}` : `${lhsStr} → ${rhsStr}`

  return (
    <div
      ref={setNodeRef}
      id={dragId}
      {...listeners}
      {...attributes}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`tr-rule-card tr-eq-card${isDragging ? ' dragging' : ''}${isFailing ? ' drag-fail' : ''}`}
    >
      <h3>{label}</h3>
      <div className="tr-symbol">{symbol}</div>
    </div>
  )
}

interface TheoremCardProps {
  dragId: string
  name: string
  displayName: string
  locked: boolean
}

export function TheoremCard({ dragId, name, displayName, locked }: TheoremCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: { theorem: true, name },
  })

  return (
    <div
      ref={setNodeRef}
      id={dragId}
      {...listeners}
      {...attributes}
      className={`tr-rule-card tr-theorem-card${locked ? ' locked' : ''}${isDragging ? ' dragging' : ''}`}
    >
      <h3>{displayName || name}</h3>
      <div className="tr-symbol">{name}</div>
    </div>
  )
}
