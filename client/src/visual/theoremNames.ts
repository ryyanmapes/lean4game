export const DERIVED_THEOREM_PREFIX = 'THM_'
export const HIDDEN_DERIVED_THEOREM_PREFIX = '__hidden_THM_'

export function isHiddenDerivedTheoremName(name: string): boolean {
  return name.startsWith(HIDDEN_DERIVED_THEOREM_PREFIX)
}

export function isDerivedTheoremName(name: string): boolean {
  return name.startsWith(DERIVED_THEOREM_PREFIX) && !isHiddenDerivedTheoremName(name)
}

export function stripDerivedTheoremPrefix(name: string): string {
  if (isDerivedTheoremName(name)) {
    return name.slice(DERIVED_THEOREM_PREFIX.length)
  }
  if (isHiddenDerivedTheoremName(name)) {
    return name.slice(HIDDEN_DERIVED_THEOREM_PREFIX.length)
  }
  return name
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const HIDDEN_DERIVED_THEOREM_PREFIX_PATTERN = new RegExp(
  `\\b${escapeRegExp(HIDDEN_DERIVED_THEOREM_PREFIX)}`,
  'g',
)
const DERIVED_THEOREM_PREFIX_PATTERN = new RegExp(
  `\\b${escapeRegExp(DERIVED_THEOREM_PREFIX)}`,
  'g',
)

export function stripDerivedTheoremPrefixesInText(text: string): string {
  return text
    .replace(HIDDEN_DERIVED_THEOREM_PREFIX_PATTERN, '')
    .replace(DERIVED_THEOREM_PREFIX_PATTERN, '')
}
