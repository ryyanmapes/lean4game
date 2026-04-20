import * as React from 'react'
import { useDraggable } from '@dnd-kit/core'
import type { VisualTactic } from './types'

function isClickOnlyTactic(tactic: VisualTactic) {
  return tactic.activation === 'goal_click'
}

function tacticTitle(tactic: VisualTactic, disabled = false): string {
  if (isClickOnlyTactic(tactic)) {
    return disabled
      ? 'Select an active goal to use this tactic'
      : 'Click to try this tactic on the current goal'
  }

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

export function VisualTacticTemplateCard({
  tactic,
  onClick,
  disabled = false,
}: {
  tactic: VisualTactic
  onClick?: () => void
  disabled?: boolean
}) {
  const dragId = `visual_tactic_${tactic.id}`
  const clickOnly = isClickOnlyTactic(tactic)
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: { visualTactic: true, tactic },
    disabled: clickOnly || disabled,
  })
  const style: React.CSSProperties | undefined = isDragging ? { visibility: 'hidden' } : undefined

  return (
    <div
      ref={setNodeRef}
      id={dragId}
      data-tactic-name={tactic.name}
      data-tactic-activation={tactic.activation ?? 'drag'}
      style={style}
      className={`statement-card tactic-tray-card${clickOnly ? ' tactic-diamond-card' : ''}${disabled ? ' disabled' : ''}${isDragging ? ' dragging' : ''}`}
      onClick={clickOnly && !disabled ? onClick : undefined}
      {...(!clickOnly && !disabled ? listeners : {})}
      {...(!clickOnly && !disabled ? attributes : {})}
      title={tacticTitle(tactic, disabled)}
    >
      <VisualTacticContent tactic={tactic} />
    </div>
  )
}
