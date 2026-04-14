import * as React from 'react'
import { colorizeFormula } from './colorizeFormula'

export type IffDirection = 'forward' | 'reverse'

/** Returns true if the formula text contains an `↔` operator. */
export function hasIffNotation(text: string): boolean {
  return text.includes('↔')
}

/**
 * Render a formula, wrapping every `↔` in a span that overlays a direction
 * arrow above it. `direction` is 'forward' by default (→) and 'reverse' (←)
 * when the user has right-clicked to flip the card.
 *
 * Non-iff segments are still passed through `colorizeFormula` so integer
 * notation stays colored.
 */
export function renderFormulaWithIffArrow(
  text: string,
  direction: IffDirection,
): React.ReactNode {
  if (!hasIffNotation(text)) return colorizeFormula(text)

  const parts = text.split(/(↔)/)
  return parts.map((part, i) => {
    if (part === '↔') {
      return (
        <span key={i} className={`iff-op iff-${direction}`}>
          <span className="iff-arrow" aria-hidden="true">
            {direction === 'forward' ? '→' : '←'}
          </span>
          <span className="iff-symbol">↔</span>
        </span>
      )
    }
    return <React.Fragment key={i}>{colorizeFormula(part)}</React.Fragment>
  })
}
