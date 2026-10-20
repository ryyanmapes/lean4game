/** The events this module produces: a subset of `TelemetryEvent`
 * (utils/telemetry.ts), which adds consent, identity and transport. */
export interface VisualTelemetryEvent {
  event_type: 'level_start' | 'proof_step' | 'level_complete'
  game_id: string
  world_id: string
  level_id: number
  attempt_uuid: string
  mode: 'visual'
  sequence: number
  elapsed_ms: number
  step_type?: 'command' | 'undo' | 'reset' | 'rejected' | 'view'
  command?: string
  reason?: string
  error?: string
  initial_script?: string
  source_attempt_uuid?: string
  play_script?: string
  lean_script?: string
}

/** The collector's ceiling for `error`, as for `command` (UTF-16 code units). */
const MAX_ERROR_LENGTH = 65536

/** A gesture that changed nothing in the proof but is worth recording: one
 * that was refused (by the canvas or by Lean), or a switch between the canvas
 * and Transformation or Construction Mode. */
export type VisualGesture =
  | { kind: 'rejected'; command: string; reason: string; error?: string }
  | { kind: 'view'; command: string }

interface Attempt {
  id: string
  startedAt: number
  sequence: number
  /** The proof as the collector replays it: one entry per recorded command. */
  commands: string[]
  initialCommands: string[]
  sourceAttemptId?: string
  startSent: boolean
  /** A `level_complete` was sent for this attempt. */
  completed: boolean
  /** The canvas opened on a proof solved in an earlier visit. */
  restoredSolved: boolean
}

export interface VisualAttemptLogOptions {
  gameId: string
  worldId: string
  levelId: number
  /** The proof restored from autosave, one entry per proof step. */
  restoredCommands?: string[]
  restoredSolved?: boolean
  /** Queues one event; false when it was not queued (no consent, no endpoint). */
  send: (event: VisualTelemetryEvent) => boolean
  createId: () => string
  now?: () => number
}

/** Visual-mode telemetry for one level visit (collector protocol: lean4.js
 * telemetry/docs/protocol.md).
 *
 * An attempt ends at its completion: a player who solves a level and then
 * undoes or resets is playing a new attempt, which starts from the solved
 * proof and names the completed one as its source. Re-sending a completion
 * under the old attempt was refused by the collector (`already_completed`).
 *
 * A canvas restored already solved is not a completion. Its attempt starts
 * from the restored proof and reports a completion only once the player
 * changes the proof and solves it again. */
export class VisualAttemptLog {
  private attempt: Attempt

  constructor(private readonly options: VisualAttemptLogOptions) {
    this.attempt = this.newAttempt(options.restoredCommands ?? [], undefined, Boolean(options.restoredSolved))
  }

  get attemptId(): string {
    return this.attempt.id
  }

  /** Queue the attempt's `level_start` unless it already is. Safe to call
   * again, e.g. once telemetry consent is given. */
  start(): void {
    const attempt = this.attempt
    if (attempt.startSent) return
    attempt.startSent = this.send({
      event_type: 'level_start',
      // The counter when the attempt began, even if consent came later.
      sequence: 0,
      ...(attempt.initialCommands.length > 0 ? { initial_script: JSON.stringify(attempt.initialCommands) } : {}),
      ...(attempt.sourceAttemptId ? { source_attempt_uuid: attempt.sourceAttemptId } : {}),
    })
  }

  /** A change to the proof. */
  step(stepType: 'command' | 'undo' | 'reset', command: string): void {
    if (this.attempt.completed) {
      const previous = this.attempt
      this.attempt = this.newAttempt(previous.commands, previous.id, false)
      this.start()
    }
    const attempt = this.attempt
    attempt.restoredSolved = false
    this.send({ event_type: 'proof_step', sequence: ++attempt.sequence, step_type: stepType, command })
    if (stepType === 'command') attempt.commands.push(command)
    else if (stepType === 'undo') attempt.commands.pop()
    else attempt.commands = []
  }

  /** The player undid a reset, bringing back the proof it cleared. The
   * collector replays `undo` as removing one step, which can't express that,
   * so a new attempt starts from the restored proof and names this one as its
   * source. A proof that comes back solved is not a new completion. */
  resetUndone(commands: string[], solved: boolean): void {
    const previous = this.attempt
    this.attempt = this.newAttempt(commands, previous.id, solved)
    this.start()
  }

  /** The proof was solved. Reported once per attempt, never for a restored
   * solved canvas the player has not changed. */
  complete(proof: { playScript: string; leanScript: string }): void {
    const attempt = this.attempt
    if (attempt.completed || attempt.restoredSolved) return
    attempt.completed = true
    this.send({
      event_type: 'level_complete',
      sequence: ++attempt.sequence,
      play_script: proof.playScript,
      lean_script: proof.leanScript,
    })
  }

  /** A refused gesture or a mode switch; the proof is unchanged. */
  gesture(gesture: VisualGesture): void {
    const attempt = this.attempt
    this.send({
      event_type: 'proof_step',
      sequence: ++attempt.sequence,
      step_type: gesture.kind,
      command: gesture.command,
      ...(gesture.kind === 'rejected' ? { reason: gesture.reason } : {}),
      // An error over the collector's limit would make it refuse the whole
      // event; the gesture and reason are still worth having without it.
      ...(gesture.kind === 'rejected' && gesture.error && gesture.error.length <= MAX_ERROR_LENGTH
        ? { error: gesture.error }
        : {}),
    })
  }

  private newAttempt(commands: string[], sourceAttemptId: string | undefined, restoredSolved: boolean): Attempt {
    return {
      id: this.options.createId(),
      startedAt: this.now(),
      sequence: 0,
      commands: [...commands],
      initialCommands: [...commands],
      sourceAttemptId,
      startSent: false,
      completed: false,
      restoredSolved,
    }
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }

  private send(event: Omit<VisualTelemetryEvent, 'game_id' | 'world_id' | 'level_id' | 'attempt_uuid' | 'mode' | 'elapsed_ms'>): boolean {
    return this.options.send({
      ...event,
      game_id: this.options.gameId,
      world_id: this.options.worldId,
      level_id: this.options.levelId,
      attempt_uuid: this.attempt.id,
      mode: 'visual',
      elapsed_ms: this.now() - this.attempt.startedAt,
    })
  }
}
