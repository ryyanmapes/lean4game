import assert from 'node:assert/strict'
import test from 'node:test'

const {
  compareBucketTheorems,
  compareTheoremNames,
  mirroredTheoremGroupKey,
  theoremBucket,
} = await import('../../tmp-theorem-ordering-tests/theoremOrdering.js')

test('multiplication category takes precedence over additive and order notation', () => {
  assert.equal(theoremBucket({ category: '*', theoremName: 'mul_le_mul_right', proposition: 'a * t ≤ b * t' }), 'mul')
  assert.equal(theoremBucket({ theoremName: 'mul_add', proposition: 'a * (b + c) = a * b + a * c' }), 'mul')
})

test('combining categories recognize unlocked theorem metadata and fallbacks', () => {
  assert.equal(theoremBucket({ category: '+', theoremName: 'add_zero' }), 'add')
  assert.equal(theoremBucket({ category: '≠', theoremName: 'zero_ne_one' }), 'ne')
  assert.equal(theoremBucket({ category: '≤', theoremName: 'le_refl' }), 'le')
  assert.equal(theoremBucket({ theoremName: 'succ_inj' }), 'add')
})

test('mirrored theorem pairs are adjacent in deterministic listings', () => {
  assert.equal(mirroredTheoremGroupKey('add_zero'), mirroredTheoremGroupKey('zero_add'))
  assert.equal(mirroredTheoremGroupKey('add_succ'), mirroredTheoremGroupKey('succ_add'))
  const names = ['add_assoc', 'succ_add', 'zero_add', 'add_succ', 'add_zero']
    .sort(compareTheoremNames)
  assert.equal(Math.abs(names.indexOf('add_zero') - names.indexOf('zero_add')), 1)
  assert.equal(Math.abs(names.indexOf('add_succ') - names.indexOf('succ_add')), 1)
})

test('succ_inj is last in the addition bucket', () => {
  const theorems = ['succ_inj', 'add_zero', 'zero_add']
    .map(theoremName => ({ theoremName }))
    .sort((left, right) => compareBucketTheorems(left, right, 'add'))
  assert.equal(theorems.at(-1).theoremName, 'succ_inj')
})
