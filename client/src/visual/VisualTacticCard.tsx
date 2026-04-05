import * as React from 'react'
import { useDraggable } from '@dnd-kit/core'
import type { VisualTactic } from './types'

function tacticTitle(tactic: VisualTactic): string {
  return tactic.name === 'revert'
    ? 'Drag onto a hypothesis to apply this tactic'
    : 'Drag onto a goal or hypothesis to apply this tactic'
}

function VisualTacticContent({ tactic }: { tactic: VisualTactic }) {
  return <span className="tactic-label">{tactic.label}</span>
}

export function VisualTacticPreviewCard({ tactic }: { tactic: VisualTactic }) {
  return (
    <div className="statement-card tactic-tray-card tactic-overlay-card">
      <VisualTacticContent tactic={tactic} />
    </div>
  )
}

export function VisualTacticTemplateCard({ tactic }: { tactic: VisualTactic }) {
  const dragId = `visual_tactic_${tactic.id}`
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: { visualTactic: true, tactic },
  })
  const style: React.CSSProperties | undefined = isDragging ? { visibility: 'hidden' } : undefined

  return (
    <div
      ref={setNodeRef}
      id={dragId}
      style={style}
      className={`statement-card tactic-tray-card${isDragging ? ' dragging' : ''}`}
      {...listeners}
      {...attributes}
      title={tacticTitle(tactic)}
    >
      <VisualTacticContent tactic={tactic} />
    </div>
  )
}
