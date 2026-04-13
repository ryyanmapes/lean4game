import type { ProofState } from '../components/infoview/rpc_api'
import { getWebsocketUrl } from '../utils/url'

const OPEN_TIMEOUT_MS = 15000
const REQUEST_TIMEOUT_MS = 30000
const FILE_READY_TIMEOUT_MS = 600000
const PROOF_STATE_MAX_ATTEMPTS = 5
const PROOF_STATE_RETRY_DELAY_MS = 150

function coerceProofState(value: any): ProofState | null {
  if (!value || !Array.isArray(value.steps) || !Array.isArray(value.diagnostics)) {
    return null
  }

  return {
    ...value,
    steps: value.steps,
    diagnostics: value.diagnostics,
    completed: Boolean(value.completed),
    completedWithWarnings: Boolean(value.completedWithWarnings),
  }
}

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
    const sessionId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
    this.uri = `file:///${worldId}/${levelId}.lean?session=${encodeURIComponent(sessionId)}`
    const wsUrl = getWebsocketUrl(gameId)
    this.ws = new WebSocket(wsUrl)
    this.ws.onmessage = (e) => this.onMessage(JSON.parse(e.data))
    this.ws.onclose = () => {
      this.closed = true
      this.rejectPending(new Error('WebSocket closed'))
    }
    this.ws.onerror = () => {
      this.rejectPending(new Error('WebSocket connection failed'))
    }
  }

  /** Full sequence: connect → open doc → wait for Lean → get proof state.
   *  Stores the session id for use in subsequent sendProofUpdate calls. */
  async getProofState(): Promise<ProofState> {
    await this.waitForOpen()
    await this.initialize()
    this.sendNotification('initialized', {})
    const readyPromise = this.waitForFileReady()
    this.sendNotification('textDocument/didOpen', {
      textDocument: { uri: this.uri, languageId: 'lean4', version: this.version, text: '' }
    })
    await readyPromise
    this.sessionId = await this.connectRpcSession()
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
      this.sessionId = await this.connectRpcSession()
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

  private async connectRpcSession(): Promise<string> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const result = await this.request('$/lean/rpc/connect', {
        uri: this.uri,
        position: { line: 0, character: 0 }
      })
      const sessionId = result?.sessionId
      if (typeof sessionId === 'string' && sessionId.length > 0) {
        return sessionId
      }
      await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)))
    }
    throw new Error('Lean RPC session did not initialize')
  }

  private async rpcCallProofState(): Promise<ProofState> {
    for (let attempt = 0; attempt < PROOF_STATE_MAX_ATTEMPTS; attempt++) {
      const result = await this.request('$/lean/rpc/call', {
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

      const proof = coerceProofState(result)
      if (proof) {
        return proof
      }

      if (attempt < PROOF_STATE_MAX_ATTEMPTS - 1) {
        await new Promise(resolve => setTimeout(resolve, PROOF_STATE_RETRY_DELAY_MS * (attempt + 1)))
      }
    }

    throw new Error('Lean proof state was not ready')
  }

  private waitForOpen(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        window.clearTimeout(timeoutId)
        this.ws.removeEventListener('open', handleOpen)
        this.ws.removeEventListener('error', handleError)
      }

      const handleOpen = () => {
        cleanup()
        resolve()
      }

      const handleError = () => {
        cleanup()
        reject(new Error('WebSocket connection failed'))
      }

      const timeoutId = window.setTimeout(() => {
        cleanup()
        reject(new Error('WebSocket connection timed out'))
      }, OPEN_TIMEOUT_MS)

      this.ws.addEventListener('open', handleOpen, { once: true })
      this.ws.addEventListener('error', handleError, { once: true })
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
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        window.clearTimeout(timeoutId)
        const idx = this.notificationHandlers.indexOf(handler)
        if (idx !== -1) this.notificationHandlers.splice(idx, 1)
      }

      const handler = (msg: any) => {
        if (
          msg.method === '$/lean/fileProgress' &&
          msg.params?.textDocument?.uri === this.uri &&
          msg.params?.processing?.length === 0
        ) {
          cleanup()
          resolve()
        }
      }

      const timeoutId = window.setTimeout(() => {
        cleanup()
        reject(new Error('Lean file progress timed out'))
      }, FILE_READY_TIMEOUT_MS)

      this.notificationHandlers.push(handler)
    })
  }

  private request(method: string, params: any): Promise<any> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out`))
      }, REQUEST_TIMEOUT_MS)

      this.pending.set(id, {
        resolve: value => {
          window.clearTimeout(timeoutId)
          resolve(value)
        },
        reject: error => {
          window.clearTimeout(timeoutId)
          reject(error)
        }
      })
      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  private sendNotification(method: string, params: any) {
    this.send({ jsonrpc: '2.0', method, params })
  }

  private send(msg: object) {
    this.ws.send(JSON.stringify(msg))
  }

  private rejectPending(error: Error) {
    for (const { reject } of this.pending.values()) {
      reject(error)
    }
    this.pending.clear()
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

    // Server-initiated request (has id + method, not in our pending map).
    // LSP requires the client to send a null response; without it Lean blocks
    // waiting for the acknowledgment and never sends the final $/lean/fileProgress.
    if (msg.id !== undefined && msg.method !== undefined) {
      this.send({ jsonrpc: '2.0', id: msg.id, result: null })
      return
    }

    // Notification — dispatch to all handlers
    for (const handler of this.notificationHandlers) {
      handler(msg)
    }
  }
}
