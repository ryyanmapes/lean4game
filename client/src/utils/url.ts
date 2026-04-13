function getAppBaseUrl(): URL {
  const baseUrl = new URL(window.location.href)
  baseUrl.hash = ''
  baseUrl.search = ''

  if (!baseUrl.pathname.endsWith('/')) {
    const lastSegment = baseUrl.pathname.split('/').pop() ?? ''
    const looksLikeFile = lastSegment.includes('.')
    baseUrl.pathname = looksLikeFile
      ? baseUrl.pathname.replace(/[^/]+$/, '')
      : `${baseUrl.pathname}/`
  }

  return baseUrl
}

export function getDataBaseUrl(): string {
  return new URL('data/', getAppBaseUrl()).toString()
}

export function getWebsocketUrl(gameId: string): string {
  const wsUrl = new URL(`websocket/${gameId}`, getAppBaseUrl())
  wsUrl.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return wsUrl.toString()
}
