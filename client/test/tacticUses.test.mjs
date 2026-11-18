import test from 'node:test'
import assert from 'node:assert/strict'

const { tacticUsesOnBranch, playTacticName } = await import('../../tmp-path-map-tests/visual/tacticUses.js')

// A proof tree keeps a node's id while its stream moves on and when it branches.
const leaf = (id, streamId) => ({ id, streamId, label: null, completed: false, children: [] })
const branch = (id, children) => ({ id, streamId: null, label: null, completed: false, children })

test('the tactic of a play command is its first word', () => {
  assert.equal(playTacticName('induction n with d hd'), 'induction')
  assert.equal(playTacticName('  click_goal '), 'click_goal')
})

test('an induction counts for its own branches, not for a branch beside it', () => {
  // ∧ goal split into two branches; induction in the left one.
  const initial = leaf('root', 's0')
  const split = branch('root', [leaf('left', 's1'), leaf('right', 's2')])
  const inducted = branch('root', [
    branch('left', [leaf('zero', 's3'), leaf('succ', 's4')]),
    leaf('right', 's2'),
  ])
  const steps = [
    { playTactic: 'click_goal', treeSnapshot: split, activeStreamIdBefore: 's0' },
    { playTactic: 'induction n with d hd', treeSnapshot: inducted, activeStreamIdBefore: 's1' },
  ]
  assert.equal(tacticUsesOnBranch(steps, initial, inducted, 's3', 'induction'), 1)
  assert.equal(tacticUsesOnBranch(steps, initial, inducted, 's4', 'induction'), 1)
  assert.equal(tacticUsesOnBranch(steps, initial, inducted, 's2', 'induction'), 0)
  assert.equal(tacticUsesOnBranch(steps, initial, inducted, 's3', 'cases'), 0)
  // Undone, the use is given back.
  assert.equal(tacticUsesOnBranch(steps.slice(0, 1), initial, split, 's1', 'induction'), 0)
})

test('a use still counts once its branch has moved on to another stream', () => {
  const initial = leaf('root', 's0')
  const inducted = branch('root', [leaf('zero', 's1'), leaf('succ', 's2')])
  // The inductive step is rewritten: same node, new stream.
  const rewritten = branch('root', [leaf('zero', 's1'), leaf('succ', 's5')])
  const steps = [
    { playTactic: 'induction n with d hd', treeSnapshot: inducted, activeStreamIdBefore: 's0' },
    { playTactic: 'drag_rw_lhs [add_succ]', treeSnapshot: rewritten, activeStreamIdBefore: 's2' },
  ]
  assert.equal(tacticUsesOnBranch(steps, initial, rewritten, 's5', 'induction'), 1)
  // Two inductions on the way to a branch are two uses.
  const twice = branch('root', [leaf('zero', 's1'), branch('succ', [leaf('zero2', 's6'), leaf('succ2', 's7')])])
  const more = [...steps, { playTactic: 'induction m with e he', treeSnapshot: twice, activeStreamIdBefore: 's5' }]
  assert.equal(tacticUsesOnBranch(more, initial, twice, 's7', 'induction'), 2)
  assert.equal(tacticUsesOnBranch(more, initial, twice, 's1', 'induction'), 1)
})
