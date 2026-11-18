import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const {
  parseTransformTarget,
  parseGoalEquality,
  parseEqualityHyp,
  transformInfoMatchesGoal,
} = require('../../tmp-transformation-tests/visual/TransformationView.js')

test('parseGoalEquality accepts a top-level equality', () => {
  assert.deepEqual(parseGoalEquality('x * 0 = 1'), {
    lhsStr: 'x * 0',
    rhsStr: '1',
  })
})

test('parseGoalEquality rejects implications containing equalities', () => {
  assert.equal(parseGoalEquality('x * 0 = 1 → x = 1'), null)
})

test('reflexive back guidance follows any matching pair of transformed sides', () => {
  const info = {
    kind: 'back',
    goal: '(y + 1) * 5 = (y + 1) * 5',
    text: 'Return to Combining Mode',
  }
  assert.equal(
    transformInfoMatchesGoal(info, '5 * (y + 1) = 5 * (y + 1)', '=', true),
    true,
  )
  assert.equal(
    transformInfoMatchesGoal(info, '5 * (y + 1) = (y + 1) * 5', '=', false),
    false,
  )
  assert.equal(
    transformInfoMatchesGoal({ ...info, kind: 'info' }, '5 * y = y * 5', '=', false),
    false,
    'ordinary status guidance remains tied to its exact authored goal',
  )
})

test('parseEqualityHyp rejects implication hypotheses with equality premises', () => {
  assert.equal(parseEqualityHyp('x * 0 = 1 → x = 1', 'n_ih', 'hyp-1'), null)
})

test('parseTransformTarget accepts a top-level less-than comparison', () => {
  const parsed = parseTransformTarget('0 < x + 1')
  assert.equal(parsed?.relation, '<')
  assert.equal(parsed?.lhsStr, '0')
  assert.equal(parsed?.rhsStr, 'x + 1')
})

test('parseTransformTarget accepts a top-level greater-or-equal comparison', () => {
  const parsed = parseTransformTarget('x ≥ y / 2')
  assert.equal(parsed?.relation, '≥')
  assert.equal(parsed?.lhsStr, 'x')
  assert.equal(parsed?.rhsStr, 'y / 2')
})

test('parseTransformTarget accepts a top-level disequality', () => {
  const parsed = parseTransformTarget('a * b ≠ 0 + b')
  assert.equal(parsed?.relation, '≠')
  assert.equal(parsed?.lhsStr, 'a * b')
  assert.equal(parsed?.rhsStr, '0 + b')
})

test('a disequality is not an equality rewrite rule or equality goal', () => {
  assert.equal(parseGoalEquality('b ≠ 0'), null)
  assert.equal(parseEqualityHyp('b ≠ 0', 'h', 'hyp-1'), null)
})

test('parseTransformTarget rejects an implication whose premise is a disequality', () => {
  assert.equal(parseTransformTarget('d ≠ 0 → d * b = d * c'), null)
})

test('parseTransformTarget accepts an inequality with absolute values', () => {
  const parsed = parseTransformTarget('|x - x₀| ≤ δ')
  assert.equal(parsed?.relation, '≤')
  assert.equal(parsed?.lhsStr, '|x - x₀|')
  assert.equal(parsed?.rhsStr, 'δ')
})

test('parseTransformTarget accepts unary negation inside equality rewrites', () => {
  const parsed = parseTransformTarget('a - b = a + -b')
  assert.equal(parsed?.relation, '=')
  assert.equal(parsed?.lhsStr, 'a - b')
  assert.equal(parsed?.rhsStr, 'a + (-b)')
})

test('parseTransformTarget accepts a top-level comparison with unary negation', () => {
  const parsed = parseTransformTarget('-b ≤ a')
  assert.equal(parsed?.relation, '≤')
  assert.equal(parsed?.lhsStr, '-b')
  assert.equal(parsed?.rhsStr, 'a')
})

// The specialization view's terms (ConstructionView), compiled beside TransformationView.
const { termToLeanString, termDisplayText, countSlots } =
  require('../../tmp-transformation-tests/visual/ConstructionView.js')

test('a proposition built in the specialization view is bracketed as it was built', () => {
  const name = n => ({ kind: 'var', name: n, id: n })
  const slot = { kind: 'slot', id: 's' }
  const lem = { kind: 'or', left: name('P'), right: { kind: 'not', arg: name('P'), id: 'n' }, id: 'o' }
  assert.equal(termToLeanString(lem), 'P ∨ (¬P)')
  assert.equal(termDisplayText(lem), 'P ∨ (¬P)')
  const nested = {
    kind: 'imp',
    left: { kind: 'and', left: name('A'), right: name('B'), id: 'a' },
    right: { kind: 'iff', left: name('False'), right: slot, id: 'i' },
    id: 'm',
  }
  assert.equal(termToLeanString(nested), '(A ∧ B) → (False ↔ _)')
  assert.equal(termDisplayText(nested), '(A ∧ B) → (False ↔ ?)')
  assert.equal(countSlots(nested), 1)
  assert.equal(termToLeanString({ kind: 'not', arg: lem, id: 'x' }), '¬(P ∨ (¬P))')
  // Numbers are written as before.
  assert.equal(termToLeanString({ kind: 'succ', arg: { kind: 'num', value: 0, id: 'z' }, id: 'q' }, 'S'), 'S 0')
})
