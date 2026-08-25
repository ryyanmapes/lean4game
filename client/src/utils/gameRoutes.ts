export type GameMapMode = 'classic' | 'visual'

/** Return the public map URL for a game, while retaining generic routes for
 * games that do not have a release landing shortcut. */
export function gameMapPath(gameId: string, mode: GameMapMode): string {
  const normalized = gameId.toLowerCase()
  if (normalized === 'g/local/nng4') {
    return mode === 'visual' ? '/visualNNG' : '/classicNNG'
  }
  if (normalized === 'g/local/visualtest' && mode === 'visual') return '/pitch'
  return `/${gameId}${mode === 'visual' ? '/visual' : ''}`
}
