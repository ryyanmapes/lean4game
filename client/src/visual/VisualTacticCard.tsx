import * as React from 'react'
import { useDraggable } from '@dnd-kit/core'
import type { VisualTactic } from './types'

function isClickOnlyTactic(tactic: VisualTactic) {
  return tactic.activation === 'goal_click'
}

function isVariableOnlyTactic(tactic: VisualTactic) {
  return tactic.name === 'induction' || tactic.name === 'cases'
}

function VisualTacticContent({ tactic }: { tactic: VisualTactic }) {
  return <span className="tactic-label">{tactic.label}</span>
}

export function VisualTacticPreviewCard({ tactic }: { tactic: VisualTactic }) {
  return (
    <div className={`statement-card tactic-tray-card tactic-overlay-card${isVariableOnlyTactic(tactic) ? ' variable-only-tactic' : ''}`}>
      <VisualTacticContent tactic={tactic} />
    </div>
  )
}

export function VisualTacticTemplateCard({
  tactic,
  onClick,
  disabled = false,
  emphasized = false,
  usesLeft,
}: {
  tactic: VisualTactic
  onClick?: () => void
  disabled?: boolean
  emphasized?: boolean
  /** Uses left on the current branch, shown under the card (`VisualTacticUses`). */
  usesLeft?: number
}) {
  const dragId = `visual_tactic_${tactic.id}`
  const clickOnly = isClickOnlyTactic(tactic)
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: { visualTactic: true, tactic },
    disabled: clickOnly || disabled,
  })
  const style: React.CSSProperties | undefined = isDragging ? { visibility: 'hidden' } : undefined

  const card = (
    <div
      ref={setNodeRef}
      id={dragId}
      data-tactic-name={tactic.name}
      data-tactic-activation={tactic.activation ?? 'drag'}
      style={style}
      className={`statement-card tactic-tray-card${isVariableOnlyTactic(tactic) ? ' variable-only-tactic' : ''}${clickOnly ? ' tactic-ellipse-card' : ''}${disabled ? ' disabled' : ''}${isDragging ? ' dragging' : ''}${emphasized ? ' visual-emphasize' : ''}`}
      onClick={clickOnly && !disabled ? onClick : undefined}
      {...(!clickOnly && !disabled ? listeners : {})}
      {...(!clickOnly && !disabled ? attributes : {})}
    >
      <VisualTacticContent tactic={tactic} />
    </div>
  )
  if (usesLeft === undefined) return card
  return (
    <div className={`tactic-with-uses${usesLeft === 0 ? ' spent' : ''}`}>
      {card}
      <span className="tactic-uses" data-testid="tactic-uses" data-tactic-name={tactic.name}>x{usesLeft}</span>
    </div>
  )
}
