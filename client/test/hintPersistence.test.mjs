import test from 'node:test'
import assert from 'node:assert/strict'

const { persistHints } = await import('../../tmp-path-map-tests/visual/hintPersistence.js')

const isEmpty = hints => hints.length === 0
const keep = hints => hints.filter(hint => !hint.onlyWhile)

/** Play the matched hints of each step in turn; return what is shown at each. */
function play(steps) {
  let records = []
  return steps.map(([step, matched]) => {
    const result = persistHints(records, step, matched, isEmpty, keep)
    records = result.records
    return result.shown.map(hint => hint.text)
  })
}

const first = { text: 'first' }
const second = { text: 'second' }
const onlyWhile = { text: 'only while', onlyWhile: true }

test('a hint stays up after the step it was written for, until the next one', () => {
  assert.deepEqual(play([[0, [first]], [1, []], [2, []], [3, [second]], [4, []]]),
    [['first'], ['first'], ['first'], ['second'], ['second']])
})

test('undo brings back the hint of the state it returns to', () => {
  // Rewrite 0: the opening hint, no hint after one rewrite, the check-mark hint
  // after two. Undoing the second rewrite must not keep the check-mark hint.
  assert.deepEqual(play([[0, [first]], [1, []], [2, [second]], [1, []], [0, [first]]]),
    [['first'], ['first'], ['second'], ['first'], ['first']])
})

test('a different move after an undo forgets the undone hints', () => {
  assert.deepEqual(play([[0, [first]], [1, [second]], [0, [first]], [1, []]]),
    [['first'], ['second'], ['first'], ['first']])
})

test('a hint that only shows while it matches leaves, and does not bring back older ones', () => {
  assert.deepEqual(play([[0, [first]], [1, [onlyWhile]], [2, []]]),
    [['first'], ['only while'], []])
})
