import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { statementCanTargetGoal } = require('../../tmp-stream-tests/visual/goalApplication.js')

test('accepts exact and implication theorem applications', () => {
  assert.equal(statementCanTargetGoal('x = y', 'x = y'), true)
  assert.equal(statementCanTargetGoal('P → Q → x = y', 'x = y'), true)
})

test('matches only explicitly quantified theorem variables', () => {
  assert.equal(
    statementCanTargetGoal('succ(a) = succ(b) → a = b', 'x = y', '∀ (a b : ℕ)'),
    true,
  )
  assert.equal(statementCanTargetGoal('x = y', 'a = b'), false)
})

test('rejects incompatible conclusions and False elimination', () => {
  assert.equal(statementCanTargetGoal('a + 0 = a', 'x ≤ y', '∀ (a : ℕ)'), false)
  assert.equal(statementCanTargetGoal('False', 'x = y'), false)
  assert.equal(statementCanTargetGoal('False', 'False'), true)
})

test('accepts either usable side of an iff', () => {
  assert.equal(statementCanTargetGoal('a = b ↔ b = a', 'x = y', '∀ (a b : ℕ)'), true)
})

test('a disequality hypothesis can be applied to a False goal', () => {
  // `a * b ≠ 0` is notation for `a * b = 0 → False`, so dragging it onto a
  // `False` goal is ordinary implication use even with no arrow written.
  assert.equal(statementCanTargetGoal('a * b ≠ 0', 'False'), true)
  assert.equal(statementCanTargetGoal('b ≠ 0', 'False'), true)
  // It must not become a universal donor: the conclusion is False, nothing else.
  assert.equal(statementCanTargetGoal('a * b ≠ 0', 'b = 0'), false)
})
