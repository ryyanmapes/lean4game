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
  const ref = React.useRef<HTMLDivElement | null>(null)
  const [fits, setFits] = React.useState(true)
  const atomic = React.useMemo(
    () => selectAtomicReductionForm(displayText, reductionForms, contextNames),
    [displayText, reductionForms, contextNames],
  )

  React.useLayoutEffect(() => {
    const element = ref.current
    if (!element || !atomic) return
    const card = element.closest('.statement-card') as HTMLElement | null
    const main = card?.querySelector<HTMLElement>('.statement-card-main, :scope > .proposition')
      ?? card?.querySelector<HTMLElement>('.proposition')
    if (!card || !main) return

    const update = () => {
      const mainStyle = getComputedStyle(main)
      const atomicStyle = getComputedStyle(element)
      const mainLineHeight = parseFloat(mainStyle.lineHeight) || parseFloat(mainStyle.fontSize) * 1.2
      const atomicLineHeight = parseFloat(atomicStyle.lineHeight) || parseFloat(atomicStyle.fontSize) * 1.2
      const mainLines = Math.max(1, Math.ceil(main.scrollHeight / mainLineHeight - 0.05))
      const atomicLines = Math.max(1, Math.ceil(element.scrollHeight / atomicLineHeight - 0.05))
      setFits(current => {
        const next = mainLines + atomicLines <= 3
        return current === next ? current : next
      })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(card)
    observer.observe(main)
    observer.observe(element)
    return () => observer.disconnect()
  }, [atomic])

  if (!atomic) return null
  return (
    <div ref={ref} className={`statement-atomic-form${fits ? '' : ' measuring-only'}`} aria-hidden={!fits}>
      {colorizeFormula(formatFormulaText(atomic))}
    </div>
  )
}
