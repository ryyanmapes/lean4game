import * as React from 'react'
import { useDraggable } from '@dnd-kit/core'
import { formatFormulaText, parse, printDisplayExpression } from './expr-engine'
import type { ExpressionNode } from './expr-types'
import { MulDotContext, renderFormulaText } from './formulaDisplay'
import { OverflowMarquee } from './OverflowMarquee'

interface EqualityHypCardProps {
  dragId: string
  label: string
  lhsStr: string
  rhsStr: string
  lhsNode?: ExpressionNode
  rhsNode?: ExpressionNode
  forallFooter?: string
  /** Highlight the `∀ …` footer (`VisualEmphasizeForall`). */
  forallEmphasized?: boolean
  /** Shown with the axioms' double outline. */
  axiom?: boolean
  /** Where the rule comes from: a theorem of the inventory, one of the level's
   *  hypotheses, or a proposition the player derived. It picks the card's colour. */
  source?: 'theorem' | 'hyp' | 'derived'
  isReverse: boolean
  isFailing?: boolean
  emphasized?: boolean
  onClick?: () => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

function formatRuleExpr(expr: string, node?: ExpressionNode): string {
  if (node) return formatFormulaText(printDisplayExpression(node))
  try {
    return formatFormulaText(printDisplayExpression(parse(expr)))
  } catch {
    return formatFormulaText(expr)
  }
}

export function EqualityHypCard({
  dragId,
  label,
  lhsStr,
  rhsStr,
  lhsNode,
  rhsNode,
  forallFooter,
  forallEmphasized = false,
  axiom = false,
  source = 'theorem',
  isReverse,
  isFailing = false,
  emphasized = false,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: EqualityHypCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: { equalityHyp: true },
  })

  const mulDot = React.useContext(MulDotContext)
  const formattedLhs = formatRuleExpr(lhsStr, lhsNode)
  const formattedRhs = formatRuleExpr(rhsStr, rhsNode)
  // The sides stay put in both directions; the arrow shows which way the rule rewrites.
  const symbol = `${formattedLhs} ${isReverse ? '⇐' : '⇒'} ${formattedRhs}`

  return (
    <div
      ref={setNodeRef}
      id={dragId}
      data-rule-id={dragId}
      data-rule-label={label}
      data-rule-axiom={axiom ? 'true' : undefined}
      data-rule-kind={source}
      data-rule-source={isReverse ? rhsStr : lhsStr}
      data-rule-target={isReverse ? lhsStr : rhsStr}
      {...listeners}
      {...attributes}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`tr-rule-card tr-eq-card${source === 'hyp' ? ' tr-hyp-rule-card' : source === 'derived' ? ' tr-derived-rule-card' : ''}${axiom ? ' tr-axiom-card' : ''}${forallFooter ? ' has-forall-footer' : ''}${isDragging ? ' dragging' : ''}${isFailing ? ' drag-fail' : ''}${emphasized ? ' visual-emphasize' : ''}`}
    >
      <h3>{renderFormulaText(label)}</h3>
      <div className="tr-symbol">
        <OverflowMarquee>{renderFormulaText(symbol, mulDot)}</OverflowMarquee>
      </div>
      {forallFooter && (
        <div className={`tr-forall-footer${forallEmphasized ? ' visual-forall-emphasize' : ''}`}>
          {formatRuleExpr(forallFooter)}
        </div>
      )}
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
