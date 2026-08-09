import test from 'node:test'
import assert from 'node:assert/strict'

const {
  applyTheoremRewrite,
  findDisambiguatingRewritePath,
  findMatchingNodeIds,
  formatFormulaText,
  matchAndCapture,
  matchesPattern,
  parse,
  printExpression,
  substituteVariables,
} = await import('../../tmp-expr-tests/visual/expr-engine.js')

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

test('renders Lean natural-number zero constructors as the numeral 0', () => {
  assert.equal(formatFormulaText('0 + zero = zero'), '0 + 0 = 0')
  assert.equal(formatFormulaText('MyNat.zero + Nat.zero = zero'), '0 + 0 = 0')
  assert.equal(formatFormulaText('zero_add n = n'), 'zero_add(n) = n')
})

test('removes Lean hygienic suffixes and dagger disambiguators from displayed formulas', () => {
  assert.equal(
    formatFormulaText('zero ≤ succ a† ∨ succ a._@._internal.0.2021293395._hygCtx._hyg.31 ≤ zero'),
    `0 ≤ succ(a) ${OR} succ(a) ≤ 0`,
  )
})

test('add_succ matches and rewrites the induction successor goal', () => {
  const goal = parse('0 + succ d')
  const lhs = parse('a + succ(d)')
  const rhs = parse('succ(a + d)')

  assert.equal(matchesPattern(goal, lhs), true)
  assert.equal(printExpression(applyTheoremRewrite(goal, goal.id, lhs, rhs, false)), 'succ(0 + d)')
})

test('instantiates an implication result from the theorem card target', () => {
  // Negated equalities use the same expression shape after the caller
  // normalizes their relation token for structural matching.
  const bindings = matchAndCapture(parse('x * y = 0'), parse('a * b = 0'))
  assert.ok(bindings)
  assert.equal(
    printExpression(substituteVariables(parse('a ≤ a * b'), bindings)),
    'x ≤ x * y',
  )
})

test('finds one automatic rewrite target only when the highlighted match is unambiguous', () => {
  const lhs = parse('a + 0')
  const uniqueGoal = parse('(a + b) + 0')
  const ambiguousGoal = parse('(a + 0) + (b + 0)')

  assert.equal(
    findMatchingNodeIds(uniqueGoal, node => matchesPattern(node, lhs)).length,
    1,
  )
  assert.equal(
    findMatchingNodeIds(ambiguousGoal, node => matchesPattern(node, lhs)).length,
    2,
  )
})

test('omits backend paths for a unique nested rewrite but keeps them for ambiguous matches', () => {
  const lhs = parse('a + succ(d)')
  const uniqueGoal = parse('(a + succ(d)) + b')
  const uniqueTarget = uniqueGoal.left
  assert.equal(
    findDisambiguatingRewritePath(uniqueGoal, uniqueTarget.id, node => matchesPattern(node, lhs)),
    undefined,
  )

  const ambiguousGoal = parse('(a + succ(d)) + (b + succ(d))')
  const ambiguousTarget = ambiguousGoal.right
  assert.deepEqual(
    findDisambiguatingRewritePath(ambiguousGoal, ambiguousTarget.id, node => matchesPattern(node, lhs)),
    [2],
  )
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
