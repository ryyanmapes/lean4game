import * as cp from 'child_process';
import { ChildProcess } from 'child_process';
import { IncomingMessage } from 'http';
import * as jsonrpcserver from 'vscode-ws-jsonrpc/server';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

type Tag = { owner: string; repo: string; };
type ResolvedGame = Tag & { gameDir: string };
type DirectLeanServerConfig = {
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
}

const DEVELOPMENT_REPO_ALIASES: Record<string, string[]> = {
  nng4: ['nng4'],
  visualtest: ['visualtest'],
  realanalysisgame: ['rng'],
  rng: ['rng'],
}
export type GameSession = {
  process: ChildProcess,
  game: string,
  gameDir: string,
  usesCustomLeanServer: boolean
}
const environment = process.env.NODE_ENV;
const isDevelopment = environment === 'development';

export class GameManager {
  queueLength: Record<string, number>
  queue: Record<string, cp.ChildProcessWithoutNullStreams[]>
  exclusiveProcessByTag: Record<string, cp.ChildProcessWithoutNullStreams | undefined>
  urlRegEx: RegExp
  dir: string

  constructor(directory: string) {
    /**
     * Add a game here if the server should keep a queue of pre-loaded games ready at all times.
     *
     * IMPORTANT! Tags here need to be lower case!
    */
    this.queueLength = {
      "g/leanprover-community/nng4": 2,
      "g/ryyanmapes/visualtest": 2,
      "g/test/testgame": 1,
      "g/local/visualtest": 1,
      "g/local/rng": 1,
    };
    /** We keep queues of started Lean Server processes to be ready when a user arrives */
    this.queue = {};
    this.exclusiveProcessByTag = {};
    this.urlRegEx = /^\/websocket\/g\/([\w.-]+)\/([\w.-]+)$/;
    this.dir = directory

    if (isDevelopment) {
      this.fillQueue({ owner: 'test', repo: 'testgame' })
      this.fillQueue({ owner: 'local', repo: 'visualtest' })
      this.fillQueue({ owner: 'local', repo: 'rng' })
    }
  }

  async startGame(req: IncomingMessage, ip: string): Promise<GameSession | null> {
    let ps: ChildProcess | undefined
    const reRes = this.urlRegEx.exec(req.url);

    if (!reRes) { console.error(`Connection refused because of invalid URL: ${req.url}`); return; }
    const resolvedGame = this.resolveGame(reRes[1], reRes[2]);
    if (!resolvedGame) {
      return null;
    }

    const tag = this.getTagString(resolvedGame);
    const game = `${resolvedGame.owner}/${resolvedGame.repo}`
    const customLeanServer = this.getCustomLeanServer(resolvedGame.gameDir)
    const requiresExclusiveProcess = this.requiresExclusiveProcess(resolvedGame, customLeanServer)

    if (requiresExclusiveProcess) {
      await this.stopExclusiveProcess(tag)
    }

    const shouldQueue = customLeanServer !== null
    const targetQueueLength = shouldQueue ? (this.queueLength[tag] ?? 0) : 0
    if (targetQueueLength > 0) {
      if (!this.queue[tag]) {
        this.queue[tag] = []
      }

      this.pruneQueue(tag)

      if (this.queue[tag].length === 0) {
        this.fillQueue(resolvedGame)
        this.pruneQueue(tag)
      }

      while (this.queue[tag].length > 0 && !ps) {
        const candidate = this.queue[tag].shift()
        if (!this.isUsableProcess(candidate)) {
          console.warn(`[${new Date()}] Dropped dead queued process for ${tag}`)
          continue
        }
        console.info('Got process from the queue');
        ps = candidate
      }

      if (ps) {
        this.fillQueue(resolvedGame);
      } else {
        ps = this.createGameProcess(resolvedGame, customLeanServer);
      }
    } else {
      ps = this.createGameProcess(resolvedGame, customLeanServer);
    }

    if (ps == null) {
      console.error(`[${new Date()}] server process is undefined/null`);
      return null;
    }

    if (requiresExclusiveProcess && this.isUsableProcess(ps)) {
      this.exclusiveProcessByTag[tag] = ps
      ps.once('exit', () => {
        if (this.exclusiveProcessByTag[tag] === ps) {
          delete this.exclusiveProcessByTag[tag]
        }
      })
    }

    // TODO (Matvey): extract further information from `req`, for example browser language.
    console.log(`[${new Date()}] Socket opened by ${ip} on ${game}`);
    return {process: ps, game: game, gameDir: resolvedGame.gameDir, usesCustomLeanServer: customLeanServer !== null }
  }

  getCustomLeanServer(gameDir: string) : string | null {
    const binaryNames = process.platform === 'win32'
      ? ['gameserver.exe', 'gameserver']
      : ['gameserver']
    const candidateDirs = [
      path.join(gameDir, '.lake', 'build', 'bin'),
      path.join(gameDir, '.lake', 'packages', 'GameServer', 'server', '.lake', 'build', 'bin'),
    ]

    for (const dir of candidateDirs) {
      for (const binaryName of binaryNames) {
        const binary = path.join(dir, binaryName)
        if (fs.existsSync(binary)) {
          return binary
        }
      }
    }

    return null
  }

  createGameProcess(game: ResolvedGame, customLeanServer: string | null) {
    let game_dir = game.gameDir;

    let serverProcess: cp.ChildProcessWithoutNullStreams;
    if (isDevelopment) {
      if (customLeanServer) {
        // If the game still uses a custom Lean server, use it.
        // Note: `cwd` is important to be the `bin` directory as `Watchdog` calls `./gameserver` again
        serverProcess = cp.spawn(
          "./" + path.basename(customLeanServer),
          ["--server", game_dir],
          { cwd: path.dirname(customLeanServer) }
        );
      } else {
        const directLeanServer = this.getDirectLeanServer(game_dir)
        if (directLeanServer) {
          console.info(
            `[${new Date()}] Starting prebuilt Lean server for ${game.owner}/${game.repo}` +
            ` via ${directLeanServer.command}`
          )
          serverProcess = cp.spawn(
            directLeanServer.command,
            directLeanServer.args,
            { cwd: directLeanServer.cwd, env: directLeanServer.env }
          )
        } else {
          serverProcess = cp.spawn("lake", ["env", "lean", "--server"], { cwd: game_dir });
        }
      }
    } else {
      let cmd = "../../scripts/bubblewrap.sh"
      let options = [game_dir, customLeanServer ? "true" : "false"]
      if (game.owner == "test") {
        // TestGame doesn't have its own copy of the server and needs lean4game as a local dependency
        const lean4GameFolder = path.join(this.dir, '..', '..', '..', 'server')
        options.push(`--bind ${lean4GameFolder} /server`)
      }

      serverProcess = cp.spawn(cmd, options,
        { cwd: this.dir });
    }

    serverProcess.on('error', error => console.error(`[${new Date()}] Launching Lean Server failed: ${error}`));
    // Suppress EPIPE on stdin: occurs when the relay writes to a process that has already exited.
    // Without this handler the error propagates as an unhandled rejection and crashes Node.
    serverProcess.stdin?.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code !== 'EPIPE') {
        console.error(`[${new Date()}] Lean Server stdin error: ${err}`)
      }
    })
    serverProcess.on('exit', (code, signal) => {
      console.warn(
        `[${new Date()}] Lean Server exited for ${game.owner}/${game.repo}` +
        ` (code=${code ?? 'null'}, signal=${signal ?? 'null'})`
      )
    })
    if (serverProcess.stderr !== null) {
      serverProcess.stderr.on('data', data => console.error(`[${new Date()}] Lean Server: ${data}`)
      );
    }
    return serverProcess;
  }

  /**
   * start Lean Server processes to refill the queue
   */
  fillQueue(tag: { owner: string; repo: string; }) {
    const resolvedGame = this.resolveGame(tag.owner, tag.repo);
    if (!resolvedGame) {
      console.error(`[${new Date()}] Unable to resolve queued game ${tag.owner}/${tag.repo}`);
      return;
    }

    const tagString = this.getTagString(resolvedGame);
    const targetQueueLength = this.queueLength[tagString];
    if (!targetQueueLength) {
      return;
    }

    const customLeanServer = this.getCustomLeanServer(resolvedGame.gameDir)
    if (!customLeanServer) {
      return;
    }

    if (!this.queue[tagString]) {
      this.queue[tagString] = [];
    }

    this.pruneQueue(tagString)

    while (this.queue[tagString].length < targetQueueLength) {
      let serverProcess: cp.ChildProcessWithoutNullStreams;
      serverProcess = this.createGameProcess(
        resolvedGame,
        customLeanServer
      );
      if (serverProcess == null) {
        console.error(`[${new Date()}] serverProcess was undefined/null`);
        return;
      }
      this.queue[tagString].push(serverProcess);
    }
  }

  private isUsableProcess(process?: ChildProcess | null): process is cp.ChildProcessWithoutNullStreams {
    return Boolean(
      process &&
      process.exitCode === null &&
      process.signalCode === null &&
      !process.killed &&
      process.stdin &&
      !process.stdin.destroyed &&
      process.stdout &&
      !process.stdout.destroyed
    )
  }

  private pruneQueue(tag: string) {
    const queue = this.queue[tag]
    if (!queue?.length) {
      return
    }

    const before = queue.length
    this.queue[tag] = queue.filter(process => this.isUsableProcess(process))
    const removed = before - this.queue[tag].length
    if (removed > 0) {
      console.warn(`[${new Date()}] Removed ${removed} dead queued process(es) for ${tag}`)
    }
  }

  private requiresExclusiveProcess(game: ResolvedGame, customLeanServer: string | null) {
    return isDevelopment && game.owner === 'local' && customLeanServer === null
  }

  private async stopExclusiveProcess(tag: string) {
    const existing = this.exclusiveProcessByTag[tag]
    if (!this.isUsableProcess(existing)) {
      delete this.exclusiveProcessByTag[tag]
      return
    }

    console.warn(`[${new Date()}] Waiting for prior local Lean server to exit before starting ${tag}`)
    const exited = this.waitForProcessExit(existing)
    existing.kill()
    await exited
    if (this.exclusiveProcessByTag[tag] === existing) {
      delete this.exclusiveProcessByTag[tag]
    }
  }

  private waitForProcessExit(process: ChildProcess) {
    if (process.exitCode !== null || process.signalCode !== null || process.killed) {
      return Promise.resolve()
    }

    return new Promise<void>(resolve => {
      process.once('exit', () => resolve())
    })
  }

  private getDirectLeanServer(gameDir: string): DirectLeanServerConfig | null {
    const leanPathEntries = this.collectLeanPathEntries(gameDir)
    if (leanPathEntries.length === 0) {
      return null
    }

    const leanBinary = this.getLeanBinary(gameDir)
    return {
      command: leanBinary,
      args: ['--server'],
      cwd: gameDir,
      env: {
        ...process.env,
        LEAN_PATH: leanPathEntries.join(path.delimiter),
      },
    }
  }

  private collectLeanPathEntries(projectDir: string) {
    const seenProjects = new Set<string>()
    const seenEntries = new Set<string>()
    const entries: string[] = []

    const addEntry = (entry: string) => {
      const normalized = path.normalize(entry)
      if (!fs.existsSync(normalized) || seenEntries.has(normalized)) {
        return
      }
      seenEntries.add(normalized)
      entries.push(normalized)
    }

    const visitProject = (currentDir: string) => {
      const normalizedProjectDir = path.normalize(currentDir)
      if (seenProjects.has(normalizedProjectDir)) {
        return
      }
      seenProjects.add(normalizedProjectDir)

      const manifestPath = path.join(currentDir, 'lake-manifest.json')
      if (fs.existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
          const packages = Array.isArray(manifest?.packages) ? manifest.packages : []
          for (const pkg of packages) {
            if (!pkg || typeof pkg.name !== 'string') {
              continue
            }

            if (pkg.type === 'path' && typeof pkg.dir === 'string') {
              const depDir = path.resolve(currentDir, pkg.dir)
              addEntry(path.join(depDir, '.lake', 'build', 'lib', 'lean'))
              visitProject(depDir)
              continue
            }

            addEntry(path.join(currentDir, '.lake', 'packages', pkg.name, '.lake', 'build', 'lib', 'lean'))
          }
        } catch (error) {
          console.warn(
            `[${new Date()}] Failed to read lake-manifest.json for ${currentDir}: ${error}`
          )
        }
      }

      addEntry(path.join(currentDir, '.lake', 'build', 'lib', 'lean'))
    }

    visitProject(projectDir)
    return entries
  }

  private getLeanBinary(gameDir: string) {
    const leanToolchainPath = path.join(gameDir, 'lean-toolchain')
    if (!fs.existsSync(leanToolchainPath)) {
      return 'lean'
    }

    const elanHome = process.env.ELAN_HOME
      ?? (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, '.elan') : null)
      ?? (process.env.HOME ? path.join(process.env.HOME, '.elan') : null)
    if (!elanHome) {
      return 'lean'
    }

    const toolchainSpec = fs.readFileSync(leanToolchainPath, 'utf8').trim()
    if (!toolchainSpec) {
      return 'lean'
    }

    const toolchainDirName = toolchainSpec
      .replace(/\//g, '--')
      .replace(/:/g, '---')
    const leanBinary = path.join(
      elanHome,
      'toolchains',
      toolchainDirName,
      'bin',
      process.platform === 'win32' ? 'lean.exe' : 'lean',
    )
    return fs.existsSync(leanBinary) ? leanBinary : 'lean'
  }

  messageTranslation(
    socketConnection: jsonrpcserver.IConnection,
    serverConnection: jsonrpcserver.IConnection,
    gameDir: string,
    usesCustomLeanServer: boolean
  ) {

    let shift = (line: number, offset: number) => Math.max(0, line + offset)

    let shiftLines = (p : any, offset : number) => {
      if (p.hasOwnProperty("line")) {
        p.line = shift(p.line, offset)
      }
      if (p.hasOwnProperty("lineRange")) {
        p.lineRange.start = shift(p.lineRange.start, offset)
        p.lineRange.end = shift(p.lineRange.end, offset)
      }
      for (let key in p) {
        if (typeof p[key] === 'object' && p[key] !== null) {
          p[key] = shiftLines(p[key], offset);
        }
      }
      return p;
    }

    function replaceUri(obj: object, val: string) {
      for (const key in obj) {
        if (key === 'uri') {
          obj[key] = val;
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          replaceUri(obj[key], val);
        }
      }
      return obj
    }


    // These values will be set by the initialize message
    let difficulty: number
    let inventory: string[]
    let worldId: string
    let levelId: string

    let semanticTokenRequestIds = new Set<number>()
    let clientUri: string | null = null

    const PROOF_START_LINE = 2
    const metadataUri = pathToFileURL(path.join(gameDir, 'Game', 'Metadata.lean')).toString()

    const gameDataPath = path.join(gameDir, '.lake', 'gamedata', `game.json`)
    const gameData = JSON.parse(fs.readFileSync(gameDataPath, 'utf8'))

    /** Sending messages from the client to the server */
    socketConnection.forward(serverConnection, (message: any) => {
      if (message?.error) {
        console.error(`[${new Date()}] CLIENT->SERVER error payload: ${JSON.stringify(message.error)}`)
      }

      // backwards compatibility for versions ≤ v4.7.0
      if (usesCustomLeanServer) {
        if (isDevelopment) { console.log(`CLIENT: ${JSON.stringify(message)}`); }
        return message
      }

      if (message.method === "initialize") {
        difficulty = message.params.initializationOptions.difficulty
        inventory = message.params.initializationOptions.inventory
        // We abuse the rootUri field to pass the game name to the server
        message.params.rootUri = gameData.name
      }

      if (message.method === "textDocument/semanticTokens/full") {
        semanticTokenRequestIds.add(message.id)
      }

      if (message.method === "textDocument/didOpen") {
        clientUri = message.params?.textDocument?.uri ?? null
        console.info(`[${new Date()}] didOpen: ${clientUri}`)
        // Parse the URI to get world and level
        const uri = new URL(clientUri)
        const pathParts = path.parse(uri.pathname)
        worldId = path.basename(pathParts.dir)
        levelId = pathParts.name

        replaceUri(message, metadataUri)

        // Read level data from JSON file
        const levelDataPath = path.join(gameDir, '.lake', 'gamedata', `level__${worldId}__${levelId}.json`)
        if (!fs.existsSync(levelDataPath)) {
          console.error(`[${new Date()}] Missing level data: ${levelDataPath}`)
        }
        const levelData = JSON.parse(fs.readFileSync(levelDataPath, 'utf8'))

        if (difficulty === undefined || inventory === undefined) {
          console.error("Did not receive difficulty/inventory from client!")
          difficulty = 1
          inventory = []
        }

        let content = message.params.textDocument.text;
        message.params.textDocument.text =
          `import ${levelData.module} import GameServer.Runner \nRunner ` +
          `${JSON.stringify(gameData.name)} ${JSON.stringify(worldId)} ${levelId} ` +
          `(difficulty := ${difficulty}) ` +
          `(inventory := [${inventory.map(s => JSON.stringify(s)).join(',')}]) ` +
          `:= by\n${content}\n`
      } else {
        replaceUri(message, metadataUri)
      }

      shiftLines(message, +PROOF_START_LINE)

      // Print the message as the server will receive it
      if (isDevelopment) { console.log(`CLIENT: ${JSON.stringify(message)}`); }

      return message
    });


    /** Sending messages from the server to the client */
    serverConnection.forward(socketConnection, message => {
      if ((message as any)?.error) {
        console.error(`[${new Date()}] SERVER->CLIENT error payload: ${JSON.stringify((message as any).error)}`)
      }

      // Print the message as the server sends it (suppress noisy publishDiagnostics)
      if (isDevelopment && (message as any)?.method !== 'textDocument/publishDiagnostics') {
        console.log(`SERVER: ${JSON.stringify(message)}`);
      }

      // backwards compatibility for versions ≤ v4.7.0
      if (usesCustomLeanServer) return message

      shiftLines(message, -PROOF_START_LINE);
      replaceUri(message, clientUri ?? `file:///${worldId}/${levelId}.lean`)

      // Disable range semantic tokens because they are difficult to shift
      if ((message as any)?.result?.capabilities?.semanticTokensProvider?.range) {
        (message as any).result.capabilities.semanticTokensProvider.range = false
      }

      // Shift semantic tokens (https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocument_semanticTokens)
      if (semanticTokenRequestIds.delete((message as any)?.id)) {
        const data : number[] = (message as any).result.data
        let i = 0
        let newData = []
        let line = 0
        // Search for semantic tokens at or after PROOF_START_LINE
        while (i < data.length) {
          line += data[i] // line info is a delta
          if (line >= PROOF_START_LINE) {
            // Relevant tokens start here. Copy them.
            newData = data.slice(i);
            // Adjust the first line number to be relative to the proof
            newData[0] = line - PROOF_START_LINE;
            break;
          }
          i += 5 // Line info is on every fifth entry
        }
        (message as any).result.data = newData
      }

      return message
    });
  }

  private isReadyGameDir(game_dir: string) {
    return fs.existsSync(game_dir) &&
      fs.existsSync(path.join(game_dir, ".lake", "gamedata", "game.json"));
  }

  private resolveInstalledGame(owner: string, repo: string): ResolvedGame | null {
    const gamesPath = path.join(this.dir, '..', '..', '..', 'games');
    if (!fs.existsSync(gamesPath)) {
      console.error(`[${new Date()}] Did not find the following folder: ${gamesPath}`);
      console.error(`[${new Date()}] Did you already import any games?`);
      return null;
    }

    const exactDir = path.join(gamesPath, owner, repo);
    if (this.isReadyGameDir(exactDir)) {
      return { owner, repo, gameDir: exactDir };
    }

    const repoMatches: ResolvedGame[] = [];
    for (const ownerEntry of fs.readdirSync(gamesPath, { withFileTypes: true })) {
      if (!ownerEntry.isDirectory()) continue;

      const ownerName = ownerEntry.name;
      const ownerDir = path.join(gamesPath, ownerName);
      for (const repoEntry of fs.readdirSync(ownerDir, { withFileTypes: true })) {
        if (!repoEntry.isDirectory()) continue;
        if (repoEntry.name.toLowerCase() !== repo) continue;

        const candidateDir = path.join(ownerDir, repoEntry.name);
        if (!this.isReadyGameDir(candidateDir)) continue;

        repoMatches.push({
          owner: ownerName.toLowerCase(),
          repo: repoEntry.name.toLowerCase(),
          gameDir: candidateDir
        });
      }
    }

    if (repoMatches.length === 1) {
      const resolvedGame = repoMatches[0];
      console.warn(
        `[${new Date()}] Falling back from ${owner}/${repo} to installed game ` +
        `${resolvedGame.owner}/${resolvedGame.repo}`
      );
      return resolvedGame;
    }

    if (repoMatches.length > 1) {
      console.error(
        `[${new Date()}] Ambiguous game lookup for ${owner}/${repo}; matching repos: ` +
        `${repoMatches.map(match => `${match.owner}/${match.repo}`).join(', ')}`
      );
      return null;
    }

    if (fs.existsSync(exactDir)) {
      console.error(`[${new Date()}] game.json file does not exist for ${owner}/${repo}!`);
      return null;
    }

    console.error(`[${new Date()}] Game '${exactDir}' does not exist!`);
    return null;
  }

  private resolveDevelopmentLocalFallback(repo: string): ResolvedGame | null {
    const localBaseDir = path.join(this.dir, '..', '..', '..', '..')
    const fallbackRepos = DEVELOPMENT_REPO_ALIASES[repo] ?? [repo]

    for (const fallbackRepo of fallbackRepos) {
      const gameDir = this.resolveCaseInsensitiveDir(localBaseDir, fallbackRepo)
      if (!gameDir || !this.isReadyGameDir(gameDir)) {
        continue
      }

      console.warn(
        `[${new Date()}] Falling back from installed game lookup to local/${fallbackRepo}`
      )
      return { owner: 'local', repo: fallbackRepo.toLowerCase(), gameDir }
    }

    return null
  }

  private resolveGame(owner: string, repo: string): ResolvedGame | null {
    owner = owner.toLowerCase();
    repo = repo.toLowerCase();

    if (owner == 'local' && !isDevelopment) {
      console.error(`[${new Date()}] No local games in production mode.`);
      return null;
    }

    let game_dir: string | null = null
    if(owner == 'local') {
      game_dir = this.resolveCaseInsensitiveDir(
        path.join(this.dir, '..', '..', '..', '..'),
        repo
      )
    } else if (owner == 'test') {
      game_dir = this.resolveCaseInsensitiveDir(
        path.join(this.dir, '..', '..', '..', 'cypress'),
        repo
      )
      console.debug(game_dir)
    } else {
      const installedGame = this.resolveInstalledGame(owner, repo);
      if (installedGame) {
        return installedGame;
      }
      if (isDevelopment) {
        return this.resolveDevelopmentLocalFallback(repo);
      }
      return null;
    }

    if (!game_dir || !fs.existsSync(game_dir)) {
      console.error(`[${new Date()}] Game for ${owner}/${repo} does not exist!`);
      return null;
    }

    let game_json: string = path.join(game_dir, ".lake", "gamedata", "game.json")

    if (!fs.existsSync(game_json)) {
      console.error(`[${new Date()}] game.json file does not exist for ${owner}/${repo}!`);
      return null;
    }

    return { owner, repo, gameDir: game_dir };
  }

  getGameDir(owner: string, repo: string) {
    return this.resolveGame(owner, repo)?.gameDir ?? "";
  }

  getTagString(tag: Tag) {
    return `g/${tag.owner.toLowerCase()}/${tag.repo.toLowerCase()}`;
  }

  private resolveCaseInsensitiveDir(baseDir: string, repo: string): string | null {
    if (!fs.existsSync(baseDir)) {
      return null
    }

    const exactDir = path.join(baseDir, repo)
    if (fs.existsSync(exactDir)) {
      return exactDir
    }

    const match = fs.readdirSync(baseDir, { withFileTypes: true })
      .find(entry => entry.isDirectory() && entry.name.toLowerCase() === repo)

    return match ? path.join(baseDir, match.name) : null
  }
}
