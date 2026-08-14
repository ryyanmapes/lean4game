import {
  COMBINING_THEOREM_ORDER,
  TRANSFORM_THEOREM_ORDER,
} from './theoremOrder.generated.js'

export {
  COMBINING_THEOREM_ENTRIES,
  COMBINING_THEOREM_ORDER,
  TRANSFORM_THEOREM_ENTRIES,
  TRANSFORM_THEOREM_ORDER,
} from './theoremOrder.generated.js'

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
  const leftRank = TRANSFORM_THEOREM_ORDER.indexOf(leftName)
  const rightRank = TRANSFORM_THEOREM_ORDER.indexOf(rightName)
  if (leftRank !== rightRank) {
    if (leftRank === -1) return 1
    if (rightRank === -1) return -1
    return leftRank - rightRank
  }
  const groupOrder = mirroredTheoremGroupKey(leftName).localeCompare(mirroredTheoremGroupKey(rightName))
  return groupOrder || leftName.localeCompare(rightName)
}

export function compareCombiningTheoremNames(
  left: { theoremName: string },
  right: { theoremName: string },
): number {
  const leftName = baseName(left.theoremName)
  const rightName = baseName(right.theoremName)
  const leftRank = COMBINING_THEOREM_ORDER.indexOf(leftName)
  const rightRank = COMBINING_THEOREM_ORDER.indexOf(rightName)
  if (leftRank !== rightRank) {
    if (leftRank === -1) return 1
    if (rightRank === -1) return -1
    return leftRank - rightRank
  }
  return mirroredTheoremGroupKey(leftName).localeCompare(mirroredTheoremGroupKey(rightName))
    || leftName.localeCompare(rightName)
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
  _bucket: TheoremBucket,
): number {
  return compareCombiningTheoremNames(left, right)
}
