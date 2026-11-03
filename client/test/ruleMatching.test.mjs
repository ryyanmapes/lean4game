import test from 'node:test'
import assert from 'node:assert/strict'

const { parse, findNodeById, printExpression } = await import('../../tmp-path-map-tests/visual/expr-engine.js')
const { ruleClickTargetId, ruleMatchesNode, ruleMatching } =
  await import('../../tmp-path-map-tests/visual/ruleMatching.js')

const print = (root, id) => printExpression(findNodeById(root, id))

test('a ∀ hypothesis matches by pattern on its bound variables only', () => {
  const matching = ruleMatching('hyp_1', { forallFooter: '∀ (a b : ℕ)' })
  assert.equal(matching.isPattern, true)
  assert.deepEqual([...matching.wildcards].sort(), ['a', 'b'])
  const from = parse('a + b')
  assert.equal(ruleMatchesNode(parse('(1 + 2) + 3'), from, matching), true)
  // A free variable of the rule must appear as itself.
  const onlyA = ruleMatching('hyp_2', { forallFooter: '∀ (a : ℕ)' })
  assert.equal(ruleMatchesNode(parse('x + y'), from, onlyA), false)
  assert.equal(ruleMatchesNode(parse('x + b'), from, onlyA), true)
})

test('plain hypotheses match exactly and theorem cards match any variable', () => {
  assert.deepEqual(ruleMatching('hyp_1', {}), { isPattern: false })
  assert.deepEqual(ruleMatching('thm_add_comm', {}), { isPattern: true })
  assert.equal(ruleMatchesNode(parse('x'), parse('x'), { isPattern: false }), true)
  assert.equal(ruleMatchesNode(parse('y'), parse('x'), { isPattern: false }), false)
})

test('a rule click rewrites the first match reading left to right', () => {
  const lhs = parse('((b + b) + a) + a')
  const rhs = parse('d')
  const assoc = parse('(a + b) + c')
  const matching = ruleMatching('hyp_assoc', { forallFooter: '∀ (a b c : ℕ)' })
  // The outer term comes before the terms inside it.
  assert.equal(print(lhs, ruleClickTargetId(lhs, rhs, assoc, matching)), '((b + b) + a) + a')
  const comm = parse('a + b')
  const commMatching = ruleMatching('hyp_comm', { forallFooter: '∀ (a b : ℕ)' })
  const left = parse('x')
  const right = parse('3 + (2 + 1)')
  // With no match on the left, the right side is read.
  assert.equal(print(right, ruleClickTargetId(left, right, comm, commMatching)), '3 + (2 + 1)')
  assert.equal(ruleClickTargetId(parse('x'), parse('y'), parse('z'), { isPattern: false }), null)
})
