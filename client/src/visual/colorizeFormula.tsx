import * as React from 'react'

/**
 * Integer notation symbols that should be rendered in blue.
 * Capture group ensures split() includes the matched tokens in the result array.
 */
const INT_PATTERN = /(≡ᵢ|——|\+ᵢ|negᵢ)/

/** Map integer notation to its display form (simpler symbol shown to the player). */
const DISPLAY_MAP: Record<string, string> = {
  '≡ᵢ': ' = ',
  '+ᵢ': ' + ',
  'negᵢ': '-',
}

const INT_TOKENS = new Set(Object.keys(DISPLAY_MAP).concat('——'))

/**
 * Takes a plain-text formula string and returns React nodes where
 * integer notation symbols (≡ᵢ, ——, +ᵢ, negᵢ) are wrapped in
 * blue-colored spans. Non-integer parts are left as plain text.
 *
 * If no integer notation is found, returns the original string unchanged.
 */
export function colorizeFormula(text: string): React.ReactNode {
  const parts = text.split(INT_PATTERN)
  if (parts.length === 1) return text // no integer notation found

  return parts.map((part, i) => {
    if (INT_TOKENS.has(part)) {
      const display = DISPLAY_MAP[part] ?? part
      return <span key={i} className="int-op">{display}</span>
    }
    return part
  })
}

/**
 * Returns true if the text contains any integer notation symbols,
 * useful for detecting whether a card represents an integer expression.
 */
export function hasIntegerNotation(text: string): boolean {
  return INT_PATTERN.test(text)
}
