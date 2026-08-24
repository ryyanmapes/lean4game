function getAppBaseUrl(): URL {
  // Routes are real paths now (`/visualNNG`, `/g/local/NNG4/world/...`), so the
  // current pathname is no longer the directory the app was served from.
  // Deriving the base from it sent every data request to a route-shaped folder
  // that does not exist, and nothing rendered. The bundler knows where the
  // bundle and its data actually live.
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/'
  return new URL(base.endsWith('/') ? base : `${base}/`, window.location.origin)
}

export function getAppRelativePath(relativePath: string): string {
  return new URL(relativePath, getAppBaseUrl()).pathname
}

export function getDataBaseUrl(): string {
  return getAppRelativePath('data/')
}

export function getWebsocketUrl(gameId: string): string {
  const wsUrl = new URL(`websocket/${gameId}`, getAppBaseUrl())
  wsUrl.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return wsUrl.toString()
}
