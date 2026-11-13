/**
 * @fileOverview Hints that stay up while the proof moves on (`VisualPersistentHints`).
 *
 * A view shows the hints whose conditions match the current state. With
 * persistent hints, when none match, it keeps showing the ones that matched most
 * recently on the way to this state: a hint written for the opening position
 * stays up after the first move, until the next hint replaces it. What matched is
 * recorded by proof step, so an undo brings back the hints of the state it returns
 * to, never those of a later state. Hints that may only show while they match
 * (`onlyWhile`) are dropped from the record, and a matching hint with empty text
 * shows nothing but still replaces the hints before it.
 */
import { useRef } from 'react'

export interface HintRecord<T> {
  step: number
  /** What matched at `step`. */
  matched: T
  /** What stays up once nothing matches any more. */
  kept: T
}

export function persistHints<T>(
  records: readonly HintRecord<T>[],
  step: number,
  current: T,
  isEmpty: (hints: T) => boolean,
  keepAfterwards: (hints: T) => T,
): { records: HintRecord<T>[]; shown: T } {
  // Records of later steps belong to moves that have been undone.
  const valid = records.filter(record => record.step <= step)
  if (!isEmpty(current)) {
    const last = valid.at(-1)
    if (last && last.step === step && last.matched === current) {
      return { records: valid, shown: current }
    }
    const earlier = valid.filter(record => record.step < step)
    return {
      records: [...earlier, { step, matched: current, kept: keepAfterwards(current) }],
      shown: current,
    }
  }
  const last = valid.at(-1)
  return { records: valid, shown: last ? last.kept : current }
}

/** `current` with persistence when `enabled`; see the file overview. Keep
 * `current` referentially stable (memoised) so that the result is too. */
export function usePersistentHints<T>(
  enabled: boolean,
  step: number,
  current: T,
  isEmpty: (hints: T) => boolean,
  keepAfterwards: (hints: T) => T,
): T {
  const recordsRef = useRef<HintRecord<T>[]>([])
  if (!enabled) return current
  const { records, shown } = persistHints(recordsRef.current, step, current, isEmpty, keepAfterwards)
  recordsRef.current = records
  return shown
}

/** Drop hints with empty text, which only clear what was there before. */
export function withText<T extends { text: string }>(infos: readonly T[]): T[] {
  return infos.filter(info => info.text.trim().length > 0)
}
