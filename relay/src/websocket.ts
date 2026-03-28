import anonymize from 'ip-anonymize';
import * as jsonrpcserver from 'vscode-ws-jsonrpc/server';
import { IWebSocket, WebSocketMessageReader, WebSocketMessageWriter } from 'vscode-ws-jsonrpc';
import { WebSocket, WebSocketServer } from 'ws';
import { ChildProcess } from 'child_process';
import { GameManager, GameSession } from './serverProcess.js'
import { IncomingMessage } from 'http';
import { randomUUID, UUID } from 'crypto';

interface Player {
  id: UUID,
  currentGame: string
  anonIP: string
  lang: string
  process: ChildProcess
}

interface PlayerMeasurement {
  date: Array<Date>
  anon_Ip: Array<string>
  game: Array<string>
  lang: Array<string>
}

export class GameSessionsObserver {
  gameManager: GameManager
  wss: WebSocketServer
  players: Map<WebSocket, Player>
  socketCounter: number

  constructor(gameManager: GameManager, wss: WebSocketServer) {
    this.gameManager = gameManager
    this.wss = wss
    this.players = new Map<WebSocket, Player>()
  };

  /**
   * Return information about all current open game sessions on the server.
   * @returns A PlayerMeasurement object containing all current open game sessions
   */
  getAllConnectedPlayers(): PlayerMeasurement {
    const webSockets: Array<WebSocket> = this.getAllOpenWebSockets()
    const timestamp = new Date()

    let measurement: PlayerMeasurement = {
      date: new Array<Date>(),
      anon_Ip: new Array<string>(),
      game: new Array<string>(),
      lang: new Array<string>()
    }

    /**
     * Iterate over every open websocket of the server
     * while checking if the socket corresponds to player.
     * If the socket is corresponding to a player add the
     * player's information to the PlayerMeasuremnt intance.
     */
    webSockets.forEach( (ws) => {
      if(this.players.get(ws) !== undefined){
        measurement.date.push(timestamp)
        measurement.anon_Ip.push(this.players.get(ws).anonIP)
        measurement.game.push(this.players.get(ws).currentGame)
        measurement.lang.push( this.players.get(ws).lang)
      }
    })

    return measurement
  }

  /**
   * Start a game process on the server and add the player to the list
   * of currently active players until the player leaves the game.
   * @param ws
   * @param req
   * @param wss
   */
  async startObservedGame(ws: WebSocket, req: IncomingMessage) {
    const ip = anonymize(req.headers['x-forwarded-for'] as string || req.socket.remoteAddress);
    let gameSession: GameSession | null
    try {
      gameSession = await this.gameManager.startGame(req, ip)
    } catch (error) {
      console.error(`[${new Date()}] Failed to start game session: ${error}`)
      ws.close(1011, 'Game unavailable')
      return
    }
    if (gameSession == null) {
      ws.close(1011, 'Game unavailable')
      return
    }

    let ps = gameSession.process
    let game = gameSession.game
    let gameDir = gameSession.gameDir

    if (
      ps.exitCode !== null ||
      ps.signalCode !== null ||
      ps.killed ||
      !ps.stdin ||
      ps.stdin.destroyed
    ) {
      console.warn(`[${new Date()}] Refusing websocket for exited game process on ${game}`)
      ws.close(1011, 'Game process exited')
      return
    }

    const langRegex: RegExp = /^[a-zA-Z-]+(?=,)/
    let lang = "en-US"

    if(langRegex.exec(req.headers['accept-language']) !== null) {
      lang = langRegex.exec(req.headers['accept-language'])[0]
    }

    this.addPlayerConnection(ws, game, ip, ps, lang);

    //this.socketCounter++

    const socket: IWebSocket = {
      onMessage: (cb) => { ws.on("message", cb); },
      onError: (cb) => { ws.on("error", cb); },
      onClose: (cb) => { ws.on("close", cb); },
      send: (data) => { ws.send(data); },
      dispose: () => { }
    }

    const reader = new WebSocketMessageReader(socket);
    const writer = new WebSocketMessageWriter(socket);
    const socketConnection = jsonrpcserver.createConnection(reader, writer, () => {
      ws.close()
    });
    const serverConnection = jsonrpcserver.createProcessStreamConnection(this.players.get(ws).process);

    const handleProcessExit = (code: number | null, signal: NodeJS.Signals | null) => {
      console.warn(
        `[${new Date()}] Game process closed while websocket was open on ${game}` +
        ` (code=${code ?? 'null'}, signal=${signal ?? 'null'})`
      )
      ws.close(1011, 'Game process exited')
    }
    ps.once('exit', handleProcessExit)

    this.gameManager.messageTranslation(
      socketConnection, serverConnection, gameDir, gameSession.usesCustomLeanServer
    )

    socketConnection.onClose(() => {
      serverConnection.dispose()
    })
    serverConnection.onClose(() => {
      socketConnection.dispose()
    })

    //console.log(`[${new Date()}] Number of open sockets - ${this.socketCounter}`);
    //console.log(`[${new Date()}] Free RAM - ${Math.round(os.freemem() / 1024 / 1024)} / ${Math.round(os.totalmem() / 1024 / 1024)} MB`);

    ws.on('close', () => {
      ps.off('exit', handleProcessExit)
      const player = this.players.get(ws)
      this.players.delete(ws)
      //this.socketCounter--
      if (player) {
        console.log(`[${new Date()}] Socket closed by ${ip} on ${player.currentGame}`)
      }
    })
  }

  /**
   * Return all open WebSocket connections to the server
   * @returns Array of WebSocket objects
   */
  private getAllOpenWebSockets() {
    return Array.from(this.wss.clients);
  }

  private addPlayerConnection(ws: WebSocket, game: string, ip: string, ps: ChildProcess, lang: string) {
    let playerId: UUID = randomUUID();
    this.players.set(ws, {
      id: playerId,
      currentGame: game,
      anonIP: ip,
      lang: lang,
      process: ps
    }
    );
  }
}
