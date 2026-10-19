import assert from 'node:assert/strict'
import test from 'node:test'

import { VisualAttemptLog } from '../../tmp-visual-telemetry-tests/visualTelemetry.js'

function harness({ restoredCommands, restoredSolved, consent = true } = {}) {
  const events = []
  let ids = 0
  let clock = 1000
  const log = new VisualAttemptLog({
    gameId: 'g/local/NNG4',
    worldId: 'Tutorial',
    levelId: 1,
    restoredCommands,
    restoredSolved,
    send: event => {
      if (!consent) return false
      events.push(event)
      return true
    },
    createId: () => `attempt-${++ids}`,
    now: () => (clock += 10),
  })
  return { log, events, giveConsent: () => { consent = true } }
}

const SOLVED = { playScript: 'click_goal', leanScript: 'rfl' }

test('a fresh attempt starts from the empty proof and completes once', () => {
  const { log, events } = harness()
  log.start()
  log.step('command', 'click_goal')
  log.complete(SOLVED)
  log.complete(SOLVED)
  assert.deepEqual(events.map(event => [event.event_type, event.attempt_uuid, event.sequence]), [
    ['level_start', 'attempt-1', 0],
    ['proof_step', 'attempt-1', 1],
    ['level_complete', 'attempt-1', 2],
  ])
  assert.equal(events[0].initial_script, undefined)
  assert.equal(events[0].source_attempt_uuid, undefined)
})

test('undoing after a solve starts a new attempt from the solved proof', () => {
  // The collector refused the second completion of one attempt as
  // `already_completed`: solve, undo, solve again on the same page.
  const { log, events } = harness()
  log.start()
  log.step('command', 'intro h')
  log.step('command', 'pick_goal 2\nexact h')
  log.complete(SOLVED)
  log.step('undo', 'undo')
  log.step('command', 'exact h')
  log.complete(SOLVED)
  const restart = events.findIndex(event => event.attempt_uuid === 'attempt-2')
  assert.deepEqual(events.slice(restart).map(event => [event.event_type, event.step_type, event.sequence]), [
    ['level_start', undefined, 0],
    ['proof_step', 'undo', 1],
    ['proof_step', 'command', 2],
    ['level_complete', undefined, 3],
  ])
  // One entry per recorded command, so a replay can undo a two-line command.
  assert.equal(events[restart].initial_script, JSON.stringify(['intro h', 'pick_goal 2\nexact h']))
  assert.equal(events[restart].source_attempt_uuid, 'attempt-1')
  assert.equal(events.filter(event => event.event_type === 'level_complete' && event.attempt_uuid === 'attempt-1').length, 1)
})

test('resetting after a solve starts a new attempt too', () => {
  const { log, events } = harness()
  log.start()
  log.step('command', 'click_goal')
  log.complete(SOLVED)
  log.step('reset', 'reset')
  log.step('command', 'click_goal')
  assert.deepEqual(
    events.filter(event => event.attempt_uuid === 'attempt-2').map(event => [event.event_type, event.step_type]),
    [['level_start', undefined], ['proof_step', 'reset'], ['proof_step', 'command']],
  )
})

test('re-opening a solved level is not a completion', () => {
  const { log, events } = harness({ restoredCommands: ['click_goal'], restoredSolved: true })
  log.start()
  log.complete(SOLVED)
  assert.deepEqual(events.map(event => event.event_type), ['level_start'])
  assert.equal(events[0].initial_script, JSON.stringify(['click_goal']))
  // Changing the restored proof and solving it again is a real completion of
  // the same attempt.
  log.step('undo', 'undo')
  log.step('command', 'click_goal')
  log.complete(SOLVED)
  assert.deepEqual(events.map(event => [event.event_type, event.attempt_uuid]), [
    ['level_start', 'attempt-1'],
    ['proof_step', 'attempt-1'],
    ['proof_step', 'attempt-1'],
    ['level_complete', 'attempt-1'],
  ])
})

test('the start is sent once consent arrives, with the sequence it began at', () => {
  const { log, events, giveConsent } = harness({ consent: false })
  log.start()
  log.step('command', 'click_goal')
  giveConsent()
  log.start()
  log.start()
  assert.deepEqual(events.map(event => [event.event_type, event.sequence]), [['level_start', 0]])
})

test('rejected gestures and view switches are recorded without changing the proof', () => {
  const { log, events } = harness()
  log.start()
  log.gesture({ kind: 'view', command: 'transform goal' })
  log.gesture({ kind: 'rejected', command: 'drag_goal add_right_cancel', reason: 'statement-does-not-fit-goal' })
  log.gesture({ kind: 'rejected', command: 'cases c', reason: 'lean-error', error: 'unknown identifier' })
  log.step('command', 'click_goal')
  log.complete(SOLVED)
  assert.deepEqual(events.slice(1).map(event => [event.step_type ?? event.event_type, event.command, event.reason, event.error]), [
    ['view', 'transform goal', undefined, undefined],
    ['rejected', 'drag_goal add_right_cancel', 'statement-does-not-fit-goal', undefined],
    ['rejected', 'cases c', 'lean-error', 'unknown identifier'],
    ['command', 'click_goal', undefined, undefined],
    ['level_complete', undefined, undefined, undefined],
  ])
  assert.deepEqual(events.map(event => event.sequence), [0, 1, 2, 3, 4, 5])
})

test('a gesture after a solve stays in the solved attempt', () => {
  const { log, events } = harness()
  log.start()
  log.step('command', 'click_goal')
  log.complete(SOLVED)
  log.gesture({ kind: 'view', command: 'transform goal' })
  assert.ok(events.every(event => event.attempt_uuid === 'attempt-1'))
})
