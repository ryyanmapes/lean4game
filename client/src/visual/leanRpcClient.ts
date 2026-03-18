import type { ProofState } from '../components/infoview/rpc_api'

export class LeanRpcClient {
  private ws: WebSocket
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>()
  private nextId = 1
  private uri: string
  private worldId: string
  private levelId: number
  private notificationHandlers: Array<(msg: any) => void> = []
  private closed = false
  private sessionId: string | null = null
  private version = 1

  constructor(gameId: string, worldId: string, levelId: number) {
    this.worldId = worldId
    this.levelId = levelId
    this.uri = `file:///${worldId}/${levelId}.lean`
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/websocket/${gameId}`
    this.ws = new WebSocket(wsUrl)
    this.ws.onmessage = (e) => this.onMessage(JSON.parse(e.data))
  }

  /** Full sequence: connect → open doc → wait for Lean → get proof state.
   *  Stores the session id for use in subsequent sendProofUpdate calls. */
  async getProofState(): Promise<ProofState> {
    await this.waitForOpen()
    await this.initialize()
    this.sendNotification('initialized', {})
    this.sendNotification('textDocument/didOpen', {
      textDocument: { uri: this.uri, languageId: 'lean4', version: this.version, text: '' }
    })
    await this.waitForFileReady()
    const { sessionId } = await this.request('$/lean/rpc/connect', {
      uri: this.uri,
      position: { line: 0, character: 0 }
    })
    this.sessionId = sessionId
    return await this.rpcCallProofState()
  }

  /** Replace the proof body and await the new ProofState.
   *  Returns null when Lean reports any error-severity diagnostic. */
  async sendProofUpdate(proofBody: string): Promise<ProofState | null> {
    if (!this.sessionId) return null
    try {
      this.version++
      // Register the ready handler BEFORE sending the change to avoid a race.
      const readyPromise = this.waitForFileReady()
      // Use a range-based replacement so the relay's line shift keeps the
      // Runner header (lines 0-1) intact — we only replace the proof body.
      this.sendNotification('textDocument/didChange', {
        textDocument: { uri: this.uri, version: this.version },
        contentChanges: [{
          range: {
            start: { line: 0, character: 0 },
            end: { line: 99999, character: 0 }
          },
          text: proofBody + '\n'
        }]
      })
      await readyPromise
      // Re-connect: Lean invalidates the RPC session after every didChange.
      const { sessionId } = await this.request('$/lean/rpc/connect', {
        uri: this.uri,
        position: { line: 0, character: 0 }
      })
      this.sessionId = sessionId
      const proof = await this.rpcCallProofState()
      // Diagnostics with leanTags (e.g. "unsolved goals") are expected intermediate
      // state — not real errors. Only diagnostics WITHOUT leanTags indicate tactic failures.
      const isTacticError = (d: any) =>
        d.severity === 1 && (!d.leanTags || d.leanTags.length === 0)
      const hasError =
        proof.diagnostics?.some(isTacticError) ||
        proof.steps?.some((step: any) => step.diags?.some(isTacticError))
      return hasError ? null : proof
    } catch {
      return null
    }
  }

  close() {
    this.closed = true
    this.ws.close()
  }

  private async rpcCallProofState(): Promise<ProofState> {
    return await this.request('$/lean/rpc/call', {
      sessionId: this.sessionId,
      textDocument: { uri: this.uri },
      position: { line: 0, character: 0 },
      method: 'Game.getProofState',
      params: {
        textDocument: { uri: this.uri },
        position: { line: 0, character: 0 },
        worldId: this.worldId,
        levelId: this.levelId
      }
    })
  }

  private waitForOpen(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return Promise.resolve()
    return new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(), { once: true })
      this.ws.addEventListener('error', () => reject(new Error('WebSocket connection failed')), { once: true })
    })
  }

  private initialize(): Promise<any> {
    return this.request('initialize', {
      processId: null,
      rootUri: null,
      capabilities: {},
      initializationOptions: {
        difficulty: 0,
        inventory: []
      }
    })
  }

  private waitForFileReady(): Promise<void> {
    return new Promise(resolve => {
      const handler = (msg: any) => {
        if (
          msg.method === '$/lean/fileProgress' &&
          msg.params?.textDocument?.uri === this.uri &&
          msg.params?.processing?.length === 0
        ) {
          const idx = this.notificationHandlers.indexOf(handler)
          if (idx !== -1) this.notificationHandlers.splice(idx, 1)
          resolve()
        }
      }
      this.notificationHandlers.push(handler)
    })
  }

  private request(method: string, params: any): Promise<any> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  private sendNotification(method: string, params: any) {
    this.send({ jsonrpc: '2.0', method, params })
  }

  private send(msg: object) {
    this.ws.send(JSON.stringify(msg))
  }

  private onMessage(msg: any) {
    if (this.closed) return

    // Response to a pending request
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id)!
      this.pending.delete(msg.id)
      if (msg.error) {
        reject(new Error(msg.error.message ?? JSON.stringify(msg.error)))
      } else {
        resolve(msg.result)
      }
      return
    }

    // Notification — dispatch to all handlers
    for (const handler of this.notificationHandlers) {
      handler(msg)
    }
  }
}
