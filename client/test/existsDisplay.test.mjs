import assert from 'node:assert/strict'
import test from 'node:test'

import { contextualizeReductionForms, inferAtomicReductionForms, selectAtomicReductionForm } from '../../tmp-exists-display-tests/existsDisplay.js'

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

test('selects atomic forms only for negation, inequality, and less-or-equal cards', () => {
  assert.equal(selectAtomicReductionForm('x ≠ y', ['¬ x = y'], []), 'x = y → False')
  assert.equal(selectAtomicReductionForm('¬ P', ['¬ P'], []), 'P → False')
  assert.equal(selectAtomicReductionForm('x ≤ y', ['∃ c, y = x + c'], []), '∃ c, y = x + c')
  assert.equal(selectAtomicReductionForm('x = y', ['x = y'], []), null)
})

test('accepts the expanded Exists form emitted for less-or-equal statements', () => {
  assert.equal(
    selectAtomicReductionForm('x ≤ y', ['Exists fun c => y = x + c'], []),
    'Exists fun c => y = x + c',
  )
})

test('infers atomic forms for static proposition theorem cards', () => {
  assert.deepEqual(inferAtomicReductionForms('0 ≠ 1'), ['0 = 1 → False'])
  assert.deepEqual(inferAtomicReductionForms('a ≤ b'), ['∃ c, b = a + c'])
  assert.deepEqual(inferAtomicReductionForms('a = b'), [])
})
