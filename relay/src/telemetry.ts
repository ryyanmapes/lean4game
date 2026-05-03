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
    event_type   TEXT    NOT NULL,
    game_id      TEXT    NOT NULL,
    world_id     TEXT    NOT NULL,
    level_id     INTEGER NOT NULL,
    play_script  TEXT,
    lean_script  TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_uuid);
  CREATE INDEX IF NOT EXISTS idx_events_game_level ON events(game_id, world_id, level_id);
`)

const insertStmt = db.prepare(`
  INSERT INTO events (ts, user_uuid, event_type, game_id, world_id, level_id, play_script, lean_script)
  VALUES (@ts, @user_uuid, @event_type, @game_id, @world_id, @level_id, @play_script, @lean_script)
`)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const GAME_ID_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
const WORLD_ID_RE = /^[A-Za-z0-9._-]+$/

type EventBody = {
  ts?: unknown
  user_uuid?: unknown
  event_type?: unknown
  game_id?: unknown
  world_id?: unknown
  level_id?: unknown
  play_script?: unknown
  lean_script?: unknown
}

function validate(body: EventBody): {
  ts: string
  user_uuid: string
  event_type: 'level_start' | 'level_complete'
  game_id: string
  world_id: string
  level_id: number
  play_script: string | null
  lean_script: string | null
} | null {
  if (typeof body.ts !== 'string' || isNaN(Date.parse(body.ts))) return null
  if (typeof body.user_uuid !== 'string' || !UUID_RE.test(body.user_uuid)) return null
  if (body.event_type !== 'level_start' && body.event_type !== 'level_complete') return null
  if (typeof body.game_id !== 'string' || !GAME_ID_RE.test(body.game_id)) return null
  if (typeof body.world_id !== 'string' || !WORLD_ID_RE.test(body.world_id)) return null
  if (typeof body.level_id !== 'number' || !Number.isInteger(body.level_id) || body.level_id < 0) return null

  const playScript = body.event_type === 'level_complete' && typeof body.play_script === 'string'
    ? body.play_script.slice(0, 64 * 1024)
    : null
  const leanScript = body.event_type === 'level_complete' && typeof body.lean_script === 'string'
    ? body.lean_script.slice(0, 64 * 1024)
    : null

  return {
    ts: body.ts,
    user_uuid: body.user_uuid,
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
    insertStmt.run(event)
    res.status(204).end()
  } catch (err) {
    console.error(`[${new Date()}] telemetry insert failed:`, err)
    res.status(500).end()
  }
})

console.log(`[${new Date()}] Telemetry DB at ${dbPath}`)
