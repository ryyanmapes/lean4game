export interface RemovableStorage {
  readonly length: number
  key(index: number): string | null
  removeItem(key: string): void
}

export interface GameVisualStorage extends RemovableStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
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

/** Capture only Visual proof/session data belonging to one game. */
export function exportGameVisualProgress(
  gameId: string,
  storage: GameVisualStorage = localStorage,
): Record<string, string> {
  const prefixes = gameScopedVisualStoragePrefixes(gameId)
  const exported: Record<string, string> = {}
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (!key || !prefixes.some(prefix => key.startsWith(prefix))) continue
    const value = storage.getItem(key)
    if (value !== null) exported[key] = value
  }
  return exported
}

/** Replace one game's Visual proof/session data without touching other games. */
export function importGameVisualProgress(
  gameId: string,
  values: Record<string, string>,
  storage: GameVisualStorage = localStorage,
): void {
  clearGameVisualProgress(gameId, storage)
  const prefixes = gameScopedVisualStoragePrefixes(gameId)
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string' && prefixes.some(prefix => key.startsWith(prefix))) {
      storage.setItem(key, value)
    }
  }
}
