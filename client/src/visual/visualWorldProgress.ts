export interface VisualProgressInput {
  worldIds: string[]
  edges: string[][]
  worldSizes: Record<string, number>
  skippedLevels: Record<string, number[]>
  isCompleted: (world: string, level: number) => boolean
}

export interface VisualProgressFrontier {
  completedLevels: Record<string, boolean[]>
  completedWorlds: Record<string, boolean>
  nextLevels: Record<string, number | null>
  frontierWorlds: string[]
  highlightedLevels: Record<string, number>
}

/** Compute the visible progress frontier without allowing hidden levels to become
 * independent unlock steps. Frontier worlds are the sources of the remaining
 * incomplete world graph after completed worlds are removed. */
export function computeVisualProgressFrontier({
  worldIds,
  edges,
  worldSizes,
  skippedLevels,
  isCompleted,
}: VisualProgressInput): VisualProgressFrontier {
  const completedLevels: Record<string, boolean[]> = {}
  const completedWorlds: Record<string, boolean> = {}
  const nextLevels: Record<string, number | null> = {}

  for (const worldId of worldIds) {
    const skipped = new Set(skippedLevels[worldId] ?? [])
    const levels = Array.from({ length: (worldSizes[worldId] ?? 0) + 1 }, (_, level) =>
      level === 0 || skipped.has(level) || isCompleted(worldId, level),
    )
    completedLevels[worldId] = levels

    let nextLevel: number | null = null
    let hasVisibleLevel = false
    for (let level = 1; level < levels.length; level += 1) {
      if (skipped.has(level)) continue
      hasVisibleLevel = true
      if (!levels[level] && nextLevel === null) nextLevel = level
    }
    nextLevels[worldId] = nextLevel
    completedWorlds[worldId] = hasVisibleLevel && nextLevel === null
  }

  const incompleteWorlds = new Set(worldIds.filter(worldId =>
    nextLevels[worldId] !== null,
  ))
  const blockedByIncompletePredecessor = new Set<string>()
  for (const edge of edges) {
    const [source, target] = edge
    if (source && target && incompleteWorlds.has(source) && incompleteWorlds.has(target)) {
      blockedByIncompletePredecessor.add(target)
    }
  }

  const frontierWorlds = worldIds.filter(worldId =>
    incompleteWorlds.has(worldId) && !blockedByIncompletePredecessor.has(worldId),
  )
  const highlightedLevels: Record<string, number> = {}
  for (const worldId of frontierWorlds) {
    const nextLevel = nextLevels[worldId]
    if (nextLevel !== null) highlightedLevels[worldId] = nextLevel
  }

  return {
    completedLevels,
    completedWorlds,
    nextLevels,
    frontierWorlds,
    highlightedLevels,
  }
}
