import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const {
  compareBucketTheorems,
  compareCombiningTheoremNames,
  compareTheoremNames,
  COMBINING_THEOREM_ENTRIES,
  COMBINING_THEOREM_ORDER,
  mirroredTheoremGroupKey,
  TRANSFORM_THEOREM_ENTRIES,
  TRANSFORM_THEOREM_ORDER,
  theoremBucket,
  THEOREM_BUCKETS,
} = await import('../../tmp-theorem-ordering-tests/theoremOrdering.js')

async function editableOrder(filename) {
  const contents = await readFile(new URL(`../../${filename}`, import.meta.url), 'utf8')
  return contents.split(/\r?\n/u)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map((line, index) => {
      const fields = line.split('|').map(field => field.trim())
      assert.equal(fields.length, 3, `${filename}:${index + 1} has category | name | statement`)
      assert.ok(fields[0], `${filename}:${index + 1} has a category`)
      assert.ok(fields[1], `${filename}:${index + 1} has a theorem name`)
      assert.ok(fields[2], `${filename}:${index + 1} has a theorem statement`)
      return { category: fields[0], name: fields[1], statement: fields[2] }
    })
}

test('editable theorem-order files are complete and synchronized downstream', async () => {
  const transforms = await editableOrder('all_transforms.txt')
  const theorems = await editableOrder('all_theorems.txt')
  assert.deepEqual(transforms, [...TRANSFORM_THEOREM_ENTRIES])
  assert.deepEqual(theorems, [...COMBINING_THEOREM_ENTRIES])
  assert.deepEqual(transforms.map(entry => entry.name), TRANSFORM_THEOREM_ORDER)
  assert.deepEqual(theorems.map(entry => entry.name), COMBINING_THEOREM_ORDER)
  assert.equal(new Set(transforms.map(entry => entry.name)).size, transforms.length)
  assert.equal(new Set(theorems.map(entry => entry.name)).size, theorems.length)
  assert.equal(transforms.length, 34)
  assert.equal(theorems.length, 31)
  // The two Peano-tab facts lead the global order, in that order.
  assert.equal(theorems.findIndex(entry => entry.name === 'reflection') + 1,
    theorems.findIndex(entry => entry.name === 'peano_cases'))
})

test('multiplication category takes precedence over additive and order notation', () => {
  assert.equal(theoremBucket({ category: '*', theoremName: 'mul_le_mul_right', proposition: 'a * t ≤ b * t' }), 'mul')
  assert.equal(theoremBucket({ theoremName: 'mul_add', proposition: 'a * (b + c) = a * b + a * c' }), 'mul')
})

test('combining categories recognize unlocked theorem metadata and fallbacks', () => {
  assert.equal(theoremBucket({ category: '+', theoremName: 'add_zero' }), 'add')
  assert.equal(theoremBucket({ category: '≠', theoremName: 'zero_ne_one' }), 'ne')
  assert.equal(theoremBucket({ category: '≤', theoremName: 'le_refl' }), 'le')
  assert.equal(theoremBucket({ category: 'Peano', theoremName: 'reflection' }), 'peano')
  // Without a category the name shape still decides, so an uncategorised
  // `succ_inj` stays additive.
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

test('transformation tabs preserve the global transform order', () => {
  const shuffled = [...TRANSFORM_THEOREM_ORDER].reverse().sort(compareTheoremNames)
  assert.deepEqual(shuffled, TRANSFORM_THEOREM_ORDER)
  const multiplicationTab = shuffled.filter(name => [
    'add_mul', 'mul_add', 'mul_assoc', 'mul_comm', 'mul_one', 'one_mul',
    'mul_succ', 'succ_mul', 'two_mul', 'mul_zero', 'zero_mul',
  ].includes(name))
  assert.deepEqual(
    multiplicationTab,
    TRANSFORM_THEOREM_ORDER.filter(name => multiplicationTab.includes(name)),
  )
})

test('combining bucket sorting follows the editable global order without special cases', () => {
  const theoremNames = ['add_right_cancel', 'succ_inj', 'add_left_eq_zero']
  const theorems = theoremNames
    .map(theoremName => ({ theoremName }))
    .sort((left, right) => compareBucketTheorems(left, right, 'add'))
    .map(theorem => theorem.theoremName)
  assert.deepEqual(
    theorems,
    COMBINING_THEOREM_ORDER.filter(name => theoremNames.includes(name)),
  )
})

test('every combining tab preserves the global theorem order', () => {
  const unlocked = [...COMBINING_THEOREM_ORDER].reverse().map(theoremName => ({ theoremName }))
  const globallyOrdered = [...unlocked].sort(compareCombiningTheoremNames).map(item => item.theoremName)
  assert.deepEqual(globallyOrdered, COMBINING_THEOREM_ORDER)

  const additionNames = new Set([
    'add_left_cancel', 'add_right_cancel', 'add_left_eq_self',
    'add_right_eq_self', 'add_left_eq_zero', 'add_right_eq_zero', 'reflection', 'succ_inj',
  ])
  const additionTab = unlocked
    .filter(item => additionNames.has(item.theoremName))
    .sort(compareCombiningTheoremNames)
    .map(item => item.theoremName)
  assert.deepEqual(
    additionTab,
    COMBINING_THEOREM_ORDER.filter(name => additionNames.has(name)),
  )
})

test('Peano axioms get their own bucket, first after All', () => {
  assert.equal(THEOREM_BUCKETS[0]?.id, 'peano')
  assert.equal(THEOREM_BUCKETS[0]?.label, 'Peano')
  // The explicit category wins over the name-shape fallbacks, which would
  // otherwise file `reflection` and `succ_inj` under `+`.
  assert.equal(theoremBucket({ category: 'Peano', theoremName: 'MyNat.reflection' }), 'peano')
  // Classic mode files these under Peano too, but the visual tab keeps the
  // two foundational facts only.
  assert.equal(theoremBucket({ category: 'Peano', theoremName: 'MyNat.succ_inj' }), 'add')
  assert.equal(theoremBucket({ category: 'Peano', theoremName: 'MyNat.zero_ne_succ' }), 'ne')
  assert.equal(
    theoremBucket({ category: 'Peano', theoremName: 'MyNat.peano_cases',
      proposition: '∀ (a : ℕ), a = 0 ∨ ∃ b, a = succ b' }),
    'peano',
  )
  // Other categories are untouched.
  assert.equal(theoremBucket({ category: '+', theoremName: 'MyNat.add_comm' }), 'add')
  assert.equal(theoremBucket({ category: '*', theoremName: 'MyNat.mul_comm' }), 'mul')
})
