import * as React from 'react'
import { useDraggable } from '@dnd-kit/core'
import { parse, printExpression } from './expr-engine'
import type { ExpressionNode } from './expr-types'

interface EqualityHypCardProps {
  dragId: string
  label: string
  lhsStr: string
  rhsStr: string
  lhsNode?: ExpressionNode
  rhsNode?: ExpressionNode
  isReverse: boolean
  isFailing?: boolean
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

function formatRuleExpr(expr: string, node?: ExpressionNode): string {
  if (node) return printExpression(node)
  try {
    return printExpression(parse(expr))
  } catch {
    return expr
  }
}

export function EqualityHypCard({
  dragId,
  label,
  lhsStr,
  rhsStr,
  lhsNode,
  rhsNode,
  isReverse,
  isFailing = false,
  onMouseEnter,
  onMouseLeave,
}: EqualityHypCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: { equalityHyp: true },
  })

  const formattedLhs = formatRuleExpr(lhsStr, lhsNode)
  const formattedRhs = formatRuleExpr(rhsStr, rhsNode)
  const symbol = isReverse ? `${formattedRhs} \u2192 ${formattedLhs}` : `${formattedLhs} \u2192 ${formattedRhs}`
  const tooltip = `${label}: ${symbol}`

  return (
    <div
      ref={setNodeRef}
      id={dragId}
      {...listeners}
      {...attributes}
      title={tooltip}
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
      title={`${displayName || name}: ${name}`}
      className={`tr-rule-card tr-theorem-card${locked ? ' locked' : ''}${isDragging ? ' dragging' : ''}`}
    >
      <h3>{displayName || name}</h3>
      <div className="tr-symbol">{name}</div>
    </div>
  )
}
