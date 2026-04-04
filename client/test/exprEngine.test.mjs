import test from 'node:test'
import assert from 'node:assert/strict'

const { formatFormulaText } = await import('../../tmp-expr-tests/visual/expr-engine.js')

test('keeps arithmetic associativity explicit within same-precedence chains', () => {
  assert.equal(formatFormulaText('A + B + C'), '(A + B) + C')
})

test('keeps arithmetic sides of equality in familiar form', () => {
  assert.equal(formatFormulaText('A + B = C * D'), 'A + B = C * D')
})

test('omits arithmetic parentheses when PEMDAS already settles the grouping', () => {
  assert.equal(formatFormulaText('A * B + C'), 'A * B + C')
})

test('keeps conjunction associativity explicit', () => {
  assert.equal(formatFormulaText('A ∧ B ∧ C'), '(A ∧ B) ∧ C')
})

test('keeps disjunction associativity explicit', () => {
  assert.equal(formatFormulaText('A ∨ B ∨ C'), '(A ∨ B) ∨ C')
})

test('parenthesizes logical subexpressions even when precedence would suffice', () => {
  assert.equal(formatFormulaText('A ∨ B ∧ C'), 'A ∨ (B ∧ C)')
})

test('keeps implication associativity explicit', () => {
  assert.equal(formatFormulaText('A → B → C'), 'A → (B → C)')
})

test('accepts LaTeX-style implication aliases', () => {
  assert.equal(formatFormulaText('A \\implies B \\implies C'), 'A → (B → C)')
})
