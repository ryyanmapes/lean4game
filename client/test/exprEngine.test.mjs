import test from 'node:test'
import assert from 'node:assert/strict'

const { formatFormulaText } = await import('../../tmp-expr-tests/visual/expr-engine.js')

const AND = '\u2227'
const OR = '\u2228'
const IMPLIES = '\u2192'
const INT_EQ = '\u2261\u1d62'
const FORMAL_DIFF = '\u2014\u2014'

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
  assert.equal(formatFormulaText(`A ${AND} B ${AND} C`), `(A ${AND} B) ${AND} C`)
})

test('keeps disjunction associativity explicit', () => {
  assert.equal(formatFormulaText(`A ${OR} B ${OR} C`), `(A ${OR} B) ${OR} C`)
})

test('parenthesizes logical subexpressions even when precedence would suffice', () => {
  assert.equal(formatFormulaText(`A ${OR} B ${AND} C`), `A ${OR} (B ${AND} C)`)
})

test('omits precedence parentheses around equality expressions inside disjunctions', () => {
  assert.equal(formatFormulaText(`x = 0 ${OR} x = 1 ${OR} x = 2`), `(x = 0 ${OR} x = 1) ${OR} x = 2`)
})

test('keeps implication associativity explicit', () => {
  assert.equal(formatFormulaText(`A ${IMPLIES} B ${IMPLIES} C`), `A ${IMPLIES} (B ${IMPLIES} C)`)
})

test('accepts LaTeX-style implication aliases', () => {
  assert.equal(formatFormulaText('A \\implies B \\implies C'), `A ${IMPLIES} (B ${IMPLIES} C)`)
})

test('wraps negated formal differences so integer negation stays visually unambiguous', () => {
  assert.equal(
    formatFormulaText(`-a ${FORMAL_DIFF} b ${INT_EQ} -a' ${FORMAL_DIFF} b'`),
    `-(a ${FORMAL_DIFF} b) ${INT_EQ} -(a' ${FORMAL_DIFF} b')`,
  )
})
