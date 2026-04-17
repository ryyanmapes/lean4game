import * as React from 'react'

import { GameIdContext } from '../app'
import { LeanRpcClient } from './leanRpcClient'

interface VisualRpcContextValue {
  getClient: (worldId: string, levelId: number) => LeanRpcClient
  disposeClient: (client?: LeanRpcClient | null) => void
}

const VisualRpcContext = React.createContext<VisualRpcContextValue | null>(null)

export function VisualRpcProvider({ children }: { children: React.ReactNode }) {
  const gameId = React.useContext(GameIdContext)
  const clientRef = React.useRef<LeanRpcClient | null>(null)
  const clientGameIdRef = React.useRef<string | null>(null)

  const disposeClient = React.useCallback((client?: LeanRpcClient | null) => {
    const currentClient = clientRef.current
    if (!currentClient) return
    if (client && currentClient !== client) return
    currentClient.close()
    clientRef.current = null
    clientGameIdRef.current = null
  }, [])

  const getClient = React.useCallback((worldId: string, levelId: number) => {
    let client = clientRef.current
    if (!client || clientGameIdRef.current !== gameId) {
      client?.close()
      client = new LeanRpcClient(gameId, worldId, levelId)
      clientRef.current = client
      clientGameIdRef.current = gameId
    }
    return client
  }, [gameId])

  React.useEffect(() => {
    if (clientRef.current && clientGameIdRef.current !== gameId) {
      disposeClient()
    }
  }, [disposeClient, gameId])

  React.useEffect(() => {
    return () => disposeClient()
  }, [disposeClient])

  const value = React.useMemo(
    () => ({ getClient, disposeClient }),
    [disposeClient, getClient],
  )

  return (
    <VisualRpcContext.Provider value={value}>
      {children}
    </VisualRpcContext.Provider>
  )
}

export function useVisualRpcClient() {
  const context = React.useContext(VisualRpcContext)
  if (!context) {
    throw new Error('useVisualRpcClient must be used within a VisualRpcProvider')
  }
  return context
}
