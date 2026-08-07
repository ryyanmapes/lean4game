import assert from 'node:assert/strict'
import test from 'node:test'

const { instrumentBrowserProof } = await import('../../tmp-browser-proof-tests/browserProof.js')

test('uses Lean propositional simplification for the browser tauto action', () => {
  assert.equal(instrumentBrowserProof('tauto'), 'simp_all')
})

test('splits both equality cases for the mul_eq_zero tauto action', () => {
  assert.equal(
    instrumentBrowserProof(`have h2 := mul_ne_zero a b
tauto`),
    `have h2 := mul_ne_zero a b
by_cases ha : a = 0 <;> by_cases hb : b = 0 <;> simp_all`,
  )
})

test('probes an unfinished induction branch inside its case scope', () => {
  assert.equal(
    instrumentBrowserProof(`induction n with d hd
case succ =>
  drag_rw_lhs [MyNat.add_succ]`),
    `induction n with d hd
case succ =>
  conv => lhs; rw [MyNat.add_succ]
  all_goals browser_report_state
  all_goals sorry`,
  )
})

test('probes sibling case blocks independently', () => {
  assert.equal(
    instrumentBrowserProof(`induction n with d hd
case zero =>
  click_goal
case succ =>
  drag_rw_lhs [MyNat.add_succ]`),
    `induction n with d hd
case zero =>
  click_goal
  all_goals browser_report_state
  all_goals sorry
case succ =>
  conv => lhs; rw [MyNat.add_succ]
  all_goals browser_report_state
  all_goals sorry`,
  )
})

test('uses Lean core rewriting on the selected side for nested add_zero', () => {
  assert.equal(
    instrumentBrowserProof(`case zero =>
  drag_rw_rhs_at [MyNat.add_zero] [2]`),
    `case zero =>
  conv => rhs; arg 2; rw [MyNat.add_zero]
  all_goals browser_report_state
  all_goals sorry`,
  )
})

test('uses Lean core rewriting for a reverse rewrite on the selected side', () => {
  assert.equal(
    instrumentBrowserProof('drag_rw_rhs [← MyNat.succ_eq_add_one]'),
    'conv => rhs; rw [← MyNat.succ_eq_add_one]',
  )
})

test('does not descend through add_zero wildcard arguments when rewriting in reverse', () => {
  assert.equal(
    instrumentBrowserProof('drag_rw_rhs_at [← MyNat.add_zero] [1]'),
    'conv => rhs; rw [← MyNat.add_zero]',
  )
  assert.equal(
    instrumentBrowserProof('drag_rw_hyp_lhs_at h [← add_zero] [2, 1]'),
    'conv at h => lhs; rw [← add_zero]',
  )
})
