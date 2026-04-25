export const DERIVED_THEOREM_PREFIX = 'thm_'
export const HIDDEN_DERIVED_THEOREM_PREFIX = '__hidden_thm_'

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
