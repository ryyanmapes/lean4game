import assert from 'node:assert/strict'
import test from 'node:test'

const { instrumentBrowserProof } = await import('../../tmp-browser-proof-tests/browserProof.js')

test('probes an unfinished induction branch inside its case scope', () => {
  assert.equal(
    instrumentBrowserProof(`induction n with d hd
case succ =>
  drag_rw_lhs [MyNat.add_succ]`),
    `induction n with d hd
case succ =>
  rw [MyNat.add_succ]
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
  rw [MyNat.add_succ]
  all_goals browser_report_state
  all_goals sorry`,
  )
})

test('uses Lean core rewriting on the selected side for nested add_zero', () => {
  assert.equal(
    instrumentBrowserProof(`case zero =>
  drag_rw_rhs_at [MyNat.add_zero] [2]`),
    `case zero =>
  conv => rhs; rw [MyNat.add_zero]
  all_goals browser_report_state
  all_goals sorry`,
  )
})
