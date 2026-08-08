import * as React from 'react'
import { colorizeFormula } from './colorizeFormula'
import { formatFormulaText } from './expr-engine'
import { selectAtomicReductionForm } from './existsDisplay'

export function AtomicForm({
  displayText,
  reductionForms,
  contextNames = [],
}: {
  displayText: string
  reductionForms?: string[]
  contextNames?: string[]
}) {
  const atomic = React.useMemo(
    () => selectAtomicReductionForm(displayText, reductionForms, contextNames),
    [displayText, reductionForms, contextNames],
  )

  if (!atomic) return null
  return (
    <div className="statement-atomic-form">
      {colorizeFormula(formatFormulaText(atomic))}
    </div>
  )
}
