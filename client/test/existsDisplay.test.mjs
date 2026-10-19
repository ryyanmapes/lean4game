import assert from 'node:assert/strict'
import test from 'node:test'

import {
  contextualizeExistsDisplay,
  contextualizeReductionForms,
  inferAtomicReductionForms,
  replaceIdentifier,
  selectAtomicReductionForm,
} from '../../tmp-exists-display-tests/existsDisplay.js'

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
  assert.deepEqual(
    inferAtomicReductionForms('x ≤ y → (y ≤ z → x ≤ z)'),
    [],
  )
  assert.deepEqual(
    inferAtomicReductionForms('x ≤ 0 → x = 0'),
    [],
  )
  assert.deepEqual(inferAtomicReductionForms('a = b'), [])
})

test('only unfolds ≠ when it is the principal connective', () => {
  // `d ≠ 0 → d * b = d * c → b = c` is an implication, not a disequality.
  assert.deepEqual(inferAtomicReductionForms('d ≠ 0 → d * b = d * c → b = c'), [])
  assert.equal(
    selectAtomicReductionForm('d ≠ 0 → d * b = d * c → b = c', ['d = 0 → False'], []),
    null,
  )
  assert.deepEqual(inferAtomicReductionForms('a ≠ b ∧ c = d'), [])
  assert.deepEqual(inferAtomicReductionForms('a ≠ b ↔ c ≠ d'), [])
  assert.deepEqual(inferAtomicReductionForms('∀ n, n ≠ 0'), [])
  assert.deepEqual(inferAtomicReductionForms('(a * b ≠ 0)'), ['a * b = 0 → False'])
  assert.deepEqual(inferAtomicReductionForms('f (a ≠ b) ≠ c'), ['f (a ≠ b) = c → False'])
})

test('only unfolds ≤ when it is the principal connective', () => {
  assert.deepEqual(inferAtomicReductionForms('a ≤ b ↔ c = d'), [])
  assert.deepEqual(inferAtomicReductionForms('∃ n, n ≤ b'), [])
})

test('¬ only covers the text up to the first top-level connective', () => {
  // `¬ a = b → c` is `(¬ a = b) → c`, never `(a = b → c) → False`.
  assert.deepEqual(contextualizeReductionForms(['¬ a = b → c'], []), ['¬ a = b → c'])
  assert.deepEqual(
    contextualizeReductionForms(['¬ (a = b → c)'], []),
    ['¬ (a = b → c)', '(a = b → c) → False'],
  )
})

test('a shadowed name is not an occurrence of the plain name', () => {
  assert.equal(replaceIdentifier('c✝ + c = c', 'c', 'x'), 'c✝ + x = x')
})

test('an ∃ binder named like a hypothesis no longer hides that hypothesis', () => {
  // AdvMultiplication 1, report of 16 Oct: `≤` unfolds to `∃ c, …` beside a
  // hypothesis `c`, so Lean prints the hypothesis as `c✝`.
  const displayed = contextualizeExistsDisplay(
    { varName: 'c', body: 'a * d + a + (c✝ + c1) = a * d + a + c' },
    ['a', 'b', 'd', 'c', 'c1', 'h1', 'h2'],
  )
  assert.deepEqual(displayed, { varName: 'c2', body: 'a * d + a + (c + c1) = a * d + a + c2' })
  assert.equal(
    replaceIdentifier(displayed.body, displayed.varName, '(c + c1)'),
    'a * d + a + (c + c1) = a * d + a + (c + c1)',
  )
})

test('an ∃ binder the server already named apart is shown as sent', () => {
  const info = { varName: 'c2', body: 'a * d + a + (c + c1) = a * d + a + c2' }
  assert.equal(contextualizeExistsDisplay(info, ['a', 'b', 'd', 'c', 'c1']), info)
})
