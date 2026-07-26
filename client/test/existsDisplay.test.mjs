import assert from 'node:assert/strict'
import test from 'node:test'

import { contextualizeReductionForms } from '../../tmp-exists-display-tests/existsDisplay.js'

test('adds the implication form below a negated equality', () => {
  assert.deepEqual(
    contextualizeReductionForms(['\u00ac x = y'], []),
    ['\u00ac x = y', 'x = y \u2192 False'],
  )
})

test('does not duplicate an implication form already supplied by Lean', () => {
  assert.deepEqual(
    contextualizeReductionForms(['\u00ac x = y', 'x = y \u2192 False'], []),
    ['\u00ac x = y', 'x = y \u2192 False'],
  )
})

test('leaves unrelated reduction forms unchanged', () => {
  assert.deepEqual(contextualizeReductionForms(['x + 0 = x'], []), ['x + 0 = x'])
})

test('parenthesizes a negated implication before adding False', () => {
  assert.deepEqual(
    contextualizeReductionForms(['\u00ac (P \u2192 Q)'], []),
    ['\u00ac (P \u2192 Q)', '(P \u2192 Q) \u2192 False'],
  )
})
