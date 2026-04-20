import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const {
  parseTransformTarget,
  parseGoalEquality,
  parseEqualityHyp,
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
