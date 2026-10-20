export interface VisualProgressInput {
  worldIds: string[]
  edges: string[][]
  worldSizes: Record<string, number>
  skippedLevels: Record<string, number[]>
  completionNeutralLevels?: Record<string, number[]>
  isCompleted: (world: string, level: number) => boolean
  isEntered?: (world: string, level: number) => boolean
}

export interface VisualProgressFrontier {
  completedLevels: Record<string, boolean[]>
  actualCompletedLevels: Record<string, boolean[]>
  /** Completion paint used by the map; neutral levels become done once opened. */
  mapCompletedLevels: Record<string, boolean[]>
  completedWorlds: Record<string, boolean>
  /** No world leading here is unfinished, so its levels can be played. */
  unlockedWorlds: Record<string, boolean>
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
  completionNeutralLevels = {},
  isCompleted,
  isEntered = () => false,
}: VisualProgressInput): VisualProgressFrontier {
  const completedLevels: Record<string, boolean[]> = {}
  const actualCompletedLevels: Record<string, boolean[]> = {}
  const mapCompletedLevels: Record<string, boolean[]> = {}
  const completedWorlds: Record<string, boolean> = {}
  const nextLevels: Record<string, number | null> = {}

  for (const worldId of worldIds) {
    const skipped = new Set(skippedLevels[worldId] ?? [])
    const neutral = new Set(completionNeutralLevels[worldId] ?? [])
    const actual = Array.from({ length: (worldSizes[worldId] ?? 0) + 1 }, (_, level) =>
      level === 0 || isCompleted(worldId, level),
    )
    const levels = Array.from({ length: (worldSizes[worldId] ?? 0) + 1 }, (_, level) =>
      level === 0 || skipped.has(level) || neutral.has(level) || actual[level],
    )
    const mapLevels = actual.map((done, level) =>
      done || (neutral.has(level) && isEntered(worldId, level)),
    )
    actualCompletedLevels[worldId] = actual
    mapCompletedLevels[worldId] = mapLevels
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
  const unlockedWorlds: Record<string, boolean> = Object.fromEntries(worldIds.map(worldId => [worldId, true]))
  for (const edge of edges) {
    const [source, target] = edge
    if (source && target && incompleteWorlds.has(source)) unlockedWorlds[target] = false
  }

  const frontierWorlds = worldIds.filter(worldId =>
    incompleteWorlds.has(worldId) && unlockedWorlds[worldId],
  )
  const highlightedLevels: Record<string, number> = {}
  for (const worldId of frontierWorlds) {
    const nextLevel = nextLevels[worldId]
    if (nextLevel !== null) highlightedLevels[worldId] = nextLevel
  }

  return {
    completedLevels,
    actualCompletedLevels,
    mapCompletedLevels,
    completedWorlds,
    unlockedWorlds,
    nextLevels,
    frontierWorlds,
    highlightedLevels,
  }
}

/** Whether the player may open a level: one they have finished (or, for a
 * level that doesn't count towards completion, opened), or one in an unlocked
 * world with no unfinished level before it. Opening a later level would skip
 * the level that teaches the gesture it needs. */
export function isVisualLevelUnlocked(
  frontier: VisualProgressFrontier,
  worldId: string,
  level: number,
): boolean {
  if (frontier.mapCompletedLevels[worldId]?.[level]) return true
  if (!frontier.unlockedWorlds[worldId]) return false
  const nextLevel = frontier.nextLevels[worldId]
  return nextLevel === null || level <= nextLevel
}
