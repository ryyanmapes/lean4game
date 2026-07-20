import assert from 'node:assert/strict'
import test from 'node:test'

const { interactionToPlayTactic } = await import('../../tmp-interaction-tests/interactionToTactic.js')

test('revert drops on hypotheses emit bare revert syntax', () => {
  assert.equal(
    interactionToPlayTactic({ type: 'drag_tactic', tacticName: 'revert', targetHypName: 'h' }),
    'revert h',
  )
})

test('non-revert tactic drops still use at-syntax on hypotheses', () => {
  assert.equal(
    interactionToPlayTactic({ type: 'drag_tactic', tacticName: 'symm', targetHypName: 'h' }),
    'symm at h',
  )
})

test('induction supplies stable names for the successor and induction hypothesis', () => {
  assert.equal(
    interactionToPlayTactic({
      type: 'drag_induction',
      hypName: 'n',
      predecessorName: 'd',
      inductionHypName: 'hd',
    }),
    'induction n with d hd',
  )
})
