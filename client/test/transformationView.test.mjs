import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const {
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
