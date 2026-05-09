import express, { Router } from 'express'
import path from 'path'
import fs from 'fs'
import Database from 'better-sqlite3'

const dbPath = process.env.TELEMETRY_DB_PATH
  || path.join(process.cwd(), 'telemetry-data', 'telemetry.sqlite')

fs.mkdirSync(path.dirname(dbPath), { recursive: true })

const db = new Database(dbPath)
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ts           TEXT    NOT NULL,
    server_ts    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    user_uuid    TEXT    NOT NULL,
    solving_uuid TEXT,
    event_type   TEXT    NOT NULL,
    game_id      TEXT    NOT NULL,
    world_id     TEXT    NOT NULL,
    level_id     INTEGER NOT NULL,
    play_script  TEXT,
    lean_script  TEXT
  );
  CREATE TABLE IF NOT EXISTS proof_steps (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    ts                    TEXT    NOT NULL,
    server_ts             TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    user_uuid             TEXT    NOT NULL,
    solving_uuid          TEXT    NOT NULL,
    game_id               TEXT    NOT NULL,
    world_id              TEXT    NOT NULL,
    level_id              INTEGER NOT NULL,
    step_type             TEXT    NOT NULL,
    interactive_lean_code TEXT    NOT NULL
  );
`)

function ensureColumn(table: 'events' | 'proof_steps', column: string, definition: string) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!rows.some(row => row.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

ensureColumn('events', 'solving_uuid', 'TEXT')

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_uuid);
  CREATE INDEX IF NOT EXISTS idx_events_solving ON events(solving_uuid);
  CREATE INDEX IF NOT EXISTS idx_events_game_level ON events(game_id, world_id, level_id);
  CREATE INDEX IF NOT EXISTS idx_proof_steps_user ON proof_steps(user_uuid);
  CREATE INDEX IF NOT EXISTS idx_proof_steps_solving ON proof_steps(solving_uuid);
  CREATE INDEX IF NOT EXISTS idx_proof_steps_game_level ON proof_steps(game_id, world_id, level_id);
`)

const insertEventStmt = db.prepare(`
  INSERT INTO events (ts, user_uuid, solving_uuid, event_type, game_id, world_id, level_id, play_script, lean_script)
  VALUES (@ts, @user_uuid, @solving_uuid, @event_type, @game_id, @world_id, @level_id, @play_script, @lean_script)
`)

const insertProofStepStmt = db.prepare(`
  INSERT INTO proof_steps (ts, user_uuid, solving_uuid, game_id, world_id, level_id, step_type, interactive_lean_code)
  VALUES (@ts, @user_uuid, @solving_uuid, @game_id, @world_id, @level_id, @step_type, @interactive_lean_code)
`)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// gameId comes from app.tsx as "g/<owner>/<repo>" (three segments). Allow any
// number of slash-separated path-safe segments for flexibility.
const GAME_ID_RE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+$/
const WORLD_ID_RE = /^[A-Za-z0-9._-]+$/

type EventBody = {
  ts?: unknown
  user_uuid?: unknown
  solving_uuid?: unknown
  event_type?: unknown
  game_id?: unknown
  world_id?: unknown
  level_id?: unknown
  play_script?: unknown
  lean_script?: unknown
  interactive_lean_code?: unknown
}

function validate(body: EventBody): {
  kind: 'level'
  ts: string
  user_uuid: string
  solving_uuid: string
  event_type: 'level_start' | 'level_complete'
  game_id: string
  world_id: string
  level_id: number
  play_script: string | null
  lean_script: string | null
} | {
  kind: 'proof_step'
  ts: string
  user_uuid: string
  solving_uuid: string
  game_id: string
  world_id: string
  level_id: number
  step_type: 'line' | 'undo'
  interactive_lean_code: string
} | null {
  if (typeof body.ts !== 'string' || isNaN(Date.parse(body.ts))) return null
  if (typeof body.user_uuid !== 'string' || !UUID_RE.test(body.user_uuid)) return null
  if (typeof body.solving_uuid !== 'string' || !UUID_RE.test(body.solving_uuid)) return null
  if (typeof body.game_id !== 'string' || !GAME_ID_RE.test(body.game_id)) return null
  if (typeof body.world_id !== 'string' || !WORLD_ID_RE.test(body.world_id)) return null
  if (typeof body.level_id !== 'number' || !Number.isInteger(body.level_id) || body.level_id < 0) return null

  if (body.event_type === 'proof_step') {
    if (typeof body.interactive_lean_code !== 'string') return null
    const interactiveLeanCode = body.interactive_lean_code.slice(0, 64 * 1024)
    return {
      kind: 'proof_step',
      ts: body.ts,
      user_uuid: body.user_uuid,
      solving_uuid: body.solving_uuid,
      game_id: body.game_id,
      world_id: body.world_id,
      level_id: body.level_id,
      step_type: interactiveLeanCode === 'undo' ? 'undo' : 'line',
      interactive_lean_code: interactiveLeanCode,
    }
  }

  if (body.event_type !== 'level_start' && body.event_type !== 'level_complete') return null

  const playScript = body.event_type === 'level_complete' && typeof body.play_script === 'string'
    ? body.play_script.slice(0, 64 * 1024)
    : null
  const leanScript = body.event_type === 'level_complete' && typeof body.lean_script === 'string'
    ? body.lean_script.slice(0, 64 * 1024)
    : null

  return {
    kind: 'level',
    ts: body.ts,
    user_uuid: body.user_uuid,
    solving_uuid: body.solving_uuid,
    event_type: body.event_type,
    game_id: body.game_id,
    world_id: body.world_id,
    level_id: body.level_id,
    play_script: playScript,
    lean_script: leanScript,
  }
}

export const telemetryRouter: Router = express.Router()

telemetryRouter.post('/', express.json({ limit: '256kb' }), (req, res) => {
  const event = validate(req.body ?? {})
  if (!event) {
    res.status(400).end()
    return
  }
  try {
    if (event.kind === 'proof_step') {
      insertProofStepStmt.run(event)
    } else {
      insertEventStmt.run(event)
    }
    res.status(204).end()
  } catch (err) {
    console.error(`[${new Date()}] telemetry insert failed:`, err)
    res.status(500).end()
  }
})

console.log(`[${new Date()}] Telemetry DB at ${dbPath}`)
