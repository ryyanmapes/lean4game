export interface RemovableStorage {
  readonly length: number
  key(index: number): string | null
  removeItem(key: string): void
}

export function visualAutosavePrefixForGame(gameId: string): string {
  return `visual-proof-autosave/${gameId}/`
}

export function gameScopedVisualStoragePrefixes(gameId: string): string[] {
  return [
    visualAutosavePrefixForGame(gameId),
    `visual-mobile-order/${gameId}/`,
    `playlog/${gameId}/`,
  ]
}

/** Remove visual proof sessions for one game without touching preferences,
 * telemetry, or progress belonging to any other game. */
export function clearGameVisualProgress(
  gameId: string,
  storage: RemovableStorage = localStorage,
): void {
  const prefixes = gameScopedVisualStoragePrefixes(gameId)
  const matchingKeys: string[] = []
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (key && prefixes.some(prefix => key.startsWith(prefix))) matchingKeys.push(key)
  }
  for (const key of matchingKeys) storage.removeItem(key)
}
