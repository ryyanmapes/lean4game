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

test('an implication with a disequality premise keeps its real conclusion', () => {
  // `d ≠ 0 → d * b = d * c → b = c` concludes `b = c`, not `False`.
  assert.equal(statementCanTargetGoal('d ≠ 0 → d * b = d * c → b = c', 'b = c'), true)
  assert.equal(statementCanTargetGoal('d ≠ 0 → d * b = d * c → b = c', 'False'), false)
  assert.equal(statementCanTargetGoal('a ≠ b ∧ c = d', 'False'), false)
})

test('refuses a theorem when the goal cannot determine one of its values', () => {
  // LessOrEqual 8: `add_right_cancel` dropped on `d2 + 1 = d + 1` matched
  // `a = b` but left `n` unknown: `⊢ d2 + 1 + ?n = d + 1 + ?n` and `⊢ ℕ`.
  assert.equal(statementCanTargetGoal('a + n = b + n → a = b', 'd2 + 1 = d + 1', '∀ (a b n : ℕ)'), false)
  assert.equal(statementCanTargetGoal('0 ≠ succ a', 'False', '∀ (a : ℕ)'), false)
  assert.equal(statementCanTargetGoal('a + n = b + n ↔ a = b', 'x = y', '∀ (a b n : ℕ)'), false)
  // Every value occurs in the matched part, so Lean learns all of them.
  assert.equal(statementCanTargetGoal('a = b → a + n = b + n', 'x + 1 = y + 1', '∀ (a b n : ℕ)'), true)
  assert.equal(statementCanTargetGoal('0 ≠ succ a', '0 ≠ succ (x + y)', '∀ (a : ℕ)'), true)
})

test('a proof binder in the footer becomes a goal of its own, not an unknown', () => {
  assert.equal(statementCanTargetGoal('a * b = a * c → b = c', 'x = 1', '∀ (a b c : ℕ) (ha : a ≠ 0)'), false)
  assert.equal(statementCanTargetGoal('b = c', 'x = 1', '∀ (b c : ℕ) (ha : b ≠ 0)'), true)
})
