/** Whether this level is reached after the game teaches `intro`, and should
 * therefore present its initial binders inside the goal in both UI modes. */
export function levelStartsWithBindersInGoal(
  worldId: string,
  levelId: number,
  edges: string[][],
): boolean {
  if (worldId === 'Implication') return levelId > 6
  const successors = new Map<string, string[]>()
  for (const [source, target] of edges) {
    if (!source || !target) continue
    successors.set(source, [...(successors.get(source) ?? []), target])
  }
  const reachable = new Set<string>(['Implication'])
  const queue = ['Implication']
  while (queue.length > 0) {
    const source = queue.shift()!
    for (const target of successors.get(source) ?? []) {
      if (reachable.has(target)) continue
      reachable.add(target)
      queue.push(target)
    }
  }
  return reachable.has(worldId)
}
