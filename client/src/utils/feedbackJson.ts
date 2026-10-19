/** JSON text of a feedback report's proof state.
 *
 * Only a value nested inside itself becomes `"[Circular]"`. A proof state
 * shares objects freely (each hypothesis appears under its goal and again on
 * its canvas card), and every occurrence must keep its contents: replacing
 * every object already seen lost the cards' hypothesis types. BigInts, which
 * JSON cannot hold, become strings. */
export function proofStateJson(value: unknown): string {
  // The objects enclosing the value being serialized, outermost first.
  const ancestors: object[] = []
  return JSON.stringify(value, function (this: unknown, _key: string, current: unknown) {
    if (typeof current === 'bigint') return current.toString()
    if (typeof current !== 'object' || current === null) return current
    // `this` holds `current`; anything above it on the stack is a finished sibling.
    while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) ancestors.pop()
    if (ancestors.includes(current)) return '[Circular]'
    ancestors.push(current)
    return current
  }) ?? 'null'
}
