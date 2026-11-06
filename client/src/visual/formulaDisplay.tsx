/**
 * @fileOverview Display-only forms of formula text in Rewrite Mode. Lean and the
 * rewrite engine see ordinary identifiers, so these never affect matching: a
 * variable named `frac1over2` shows as a vertical fraction, a name ending in
 * `_inv` shows with `⁻¹`, and a level can ask for `·` as multiplication
 * (`VisualMulDot`).
 */
import * as React from 'react'

const DISPLAY_FORM = /\bfrac(\d+)over(\d+)\b|\b(\w+)_inv\b/gu

/** Whether multiplication shows as `·` here, for the whole of Rewrite Mode. */
export const MulDotContext = React.createContext(false)

/** The symbol to show for a binary operator. */
export function displayOperator(op: string, mulDot: boolean): string {
  return mulDot && op === '*' ? '·' : op
}

/** `text` with its display forms in place. Plain strings stay plain strings. */
export function renderFormulaText(text: string, mulDot = false): React.ReactNode {
  const source = mulDot ? text.replace(/ \* /gu, ' · ') : text
  const nodes: React.ReactNode[] = []
  let cursor = 0
  for (const match of source.matchAll(DISPLAY_FORM)) {
    nodes.push(source.slice(cursor, match.index))
    const [whole, numerator, denominator, inverted] = match
    nodes.push(inverted
      ? `${inverted}⁻¹`
      : (
        <span key={match.index} className="formula-fraction" role="img" aria-label={`${numerator}/${denominator}`}>
          <span>{numerator}</span>
          <span>{denominator}</span>
        </span>
      ))
    cursor = match.index + whole.length
  }
  if (nodes.length === 0) return source
  nodes.push(source.slice(cursor))
  return nodes
}
