import * as React from 'react'

import { GameIdContext } from '../app'
import { LeanRpcClient } from './leanRpcClient'

interface VisualRpcContextValue {
  getClient: (worldId: string, levelId: number) => LeanRpcClient
  disposeClient: (client?: LeanRpcClient | null) => void
}

const VisualRpcContext = React.createContext<VisualRpcContextValue | null>(null)
const SHARED_CLIENT_RELEASE_DELAY_MS = 60000

type SharedClientEntry = {
  client: LeanRpcClient
  releaseTimer: number | null
}

const sharedClients = new Map<string, SharedClientEntry>()

function cancelSharedClientRelease(gameId: string) {
  const entry = sharedClients.get(gameId)
  if (!entry || entry.releaseTimer === null) return
  window.clearTimeout(entry.releaseTimer)
  entry.releaseTimer = null
}

function closeSharedClient(gameId: string, expectedClient?: LeanRpcClient | null) {
  const entry = sharedClients.get(gameId)
  if (!entry) return
  if (expectedClient && entry.client !== expectedClient) return
  cancelSharedClientRelease(gameId)
  entry.client.close()
  sharedClients.delete(gameId)
}

function scheduleSharedClientRelease(gameId: string) {
  const entry = sharedClients.get(gameId)
  if (!entry || entry.releaseTimer !== null) return
  entry.releaseTimer = window.setTimeout(() => {
    const currentEntry = sharedClients.get(gameId)
    if (currentEntry !== entry) return
    closeSharedClient(gameId, entry.client)
  }, SHARED_CLIENT_RELEASE_DELAY_MS)
}

function getOrCreateSharedClient(gameId: string, worldId: string, levelId: number) {
  cancelSharedClientRelease(gameId)

  let entry = sharedClients.get(gameId)
  if (!entry || entry.client.isClosed()) {
    entry?.client.close()
    entry = {
      client: new LeanRpcClient(gameId, worldId, levelId),
      releaseTimer: null,
    }
    sharedClients.set(gameId, entry)
  }

  return entry.client
}

export function VisualRpcProvider({ children }: { children: React.ReactNode }) {
  const gameId = React.useContext(GameIdContext)
  const clientRef = React.useRef<LeanRpcClient | null>(null)

  const disposeClient = React.useCallback((client?: LeanRpcClient | null) => {
    const currentClient = clientRef.current
    if (!currentClient) return
    if (client && currentClient !== client) return
    closeSharedClient(gameId, currentClient)
    clientRef.current = null
  }, [gameId])

  const getClient = React.useCallback((worldId: string, levelId: number) => {
    const client = getOrCreateSharedClient(gameId, worldId, levelId)
    clientRef.current = client
    return client
  }, [gameId])

  React.useEffect(() => {
    cancelSharedClientRelease(gameId)
    return () => {
      if (clientRef.current === sharedClients.get(gameId)?.client) {
        clientRef.current = null
      }
      scheduleSharedClientRelease(gameId)
    }
  }, [gameId])

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
