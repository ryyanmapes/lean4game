export type TheoremBucket = 'add' | 'ne' | 'le' | 'mul' | 'other'

export const THEOREM_BUCKETS: ReadonlyArray<{ id: TheoremBucket; label: string }> = [
  { id: 'add', label: '+' },
  { id: 'ne', label: '≠' },
  { id: 'le', label: '≤' },
  { id: 'mul', label: '*' },
]

function baseName(name: string): string {
  return name.split('.').at(-1) ?? name
}

/** Stable grouping key for left/right or operand-swapped companion lemmas. */
export function mirroredTheoremGroupKey(name: string): string {
  const theoremName = baseName(name)
  const tokens = theoremName.split('_').map(token =>
    token === 'left' || token === 'right' ? 'side' : token
  )
  if (tokens.length === 2) tokens.sort()
  return tokens.join('_')
}

export function compareTheoremNames(left: string, right: string): number {
  const leftName = baseName(left)
  const rightName = baseName(right)
  const groupOrder = mirroredTheoremGroupKey(leftName).localeCompare(mirroredTheoremGroupKey(rightName))
  return groupOrder || leftName.localeCompare(rightName)
}

export function theoremBucket(theorem: {
  category?: string
  theoremName?: string
  label?: string
  proposition?: string
}): TheoremBucket {
  const category = theorem.category?.trim()
  const searchable = `${theorem.theoremName ?? ''} ${theorem.label ?? ''} ${theorem.proposition ?? ''}`

  // Multiplication wins when a theorem could also look additive or ordered.
  if (category === '*' || /(?:^|[._\s])mul(?:[._\s]|$)|\*/u.test(searchable)) return 'mul'
  if (category === '+') return 'add'
  if (category === '≤' || category === '<=') return 'le'
  if (category === '≠' || category === '!=') return 'ne'
  if (/(?:^|[._\s])succ_inj(?:[._\s]|$)|(?:^|[._\s])add(?:[._\s]|$)|\+/u.test(searchable)) return 'add'
  if (/(?:^|[._\s])le(?:[._\s]|$)|≤/u.test(searchable)) return 'le'
  if (/(?:^|[._\s])ne(?:[._\s]|$)|≠/u.test(searchable)) return 'ne'
  return 'other'
}

export function compareBucketTheorems(
  left: { theoremName: string },
  right: { theoremName: string },
  bucket: TheoremBucket,
): number {
  if (bucket === 'add') {
    const leftSuccInj = baseName(left.theoremName) === 'succ_inj'
    const rightSuccInj = baseName(right.theoremName) === 'succ_inj'
    if (leftSuccInj !== rightSuccInj) return leftSuccInj ? 1 : -1
  }
  return compareTheoremNames(left.theoremName, right.theoremName)
}
