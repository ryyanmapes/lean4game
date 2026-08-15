import assert from 'node:assert/strict'
import test from 'node:test'

const { instrumentBrowserProof } = await import('../../tmp-browser-proof-tests/browserProof.js')

test('checks displayed rw_nth steps through the established NNG nth_rewrite tactic', () => {
  assert.equal(
    instrumentBrowserProof(`rw_nth 2 [MyNat.two_eq_succ_one]
  rw_nth 1 [MyNat.add_zero] at h`),
    `nth_rewrite 2 [MyNat.two_eq_succ_one]
  nth_rewrite 1 [MyNat.add_zero] at h`,
  )
})

test('uses Lean propositional simplification for the browser tauto action', () => {
  assert.equal(instrumentBrowserProof('tauto'), 'first | contradiction | simp_all')
})

test('splits both equality cases for the mul_eq_zero tauto action', () => {
  assert.equal(
    instrumentBrowserProof(`have h2 := mul_ne_zero a b
tauto`),
    `have h2 := mul_ne_zero a b
by_cases hVisualTautoA : a = 0 <;> by_cases hVisualTautoB : b = 0 <;> simp_all`,
  )
})

test('recognizes the player-generated mul_ne_zero specialization before tauto', () => {
  assert.equal(
    instrumentBrowserProof(`specialize_forall_as thm_h2 MyNat.mul_ne_zero a (a)
specialize_forall_as thm_thm_h22 thm_h2 b (b)
tauto`),
    `specialize_forall_as thm_h2 MyNat.mul_ne_zero a (a)
specialize_forall_as thm_thm_h22 thm_h2 b (b)
by_cases hVisualTautoA : a = 0 <;> by_cases hVisualTautoB : b = 0 <;> simp_all`,
  )
})

test('probes an unfinished induction branch inside its case scope', () => {
  assert.equal(
    instrumentBrowserProof(`induction n with d hd
case succ =>
  drag_rw_lhs [MyNat.add_succ]`),
    `induction n with d hd
case succ =>
  drag_rw_lhs [MyNat.add_succ]
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
  drag_rw_lhs [MyNat.add_succ]
  all_goals browser_report_state
  all_goals sorry`,
  )
})

test('does not silently complete the base branch before the successor rewrite', () => {
  const proof = `induction n with d hd
drag_rw_lhs [MyNat.add_zero]
rfl
drag_rw_lhs [MyNat.add_succ]`
  assert.equal(
    instrumentBrowserProof(proof),
    proof,
    'browser compilation must preserve the same four player-selected goals',
  )
})

test('preserves the visual goal rewrite so a reflexive result is not auto-closed', () => {
  assert.equal(
    instrumentBrowserProof(`case zero =>
  drag_rw_rhs_at [MyNat.add_zero] [2]`),
    `case zero =>
  drag_rw_rhs_at [MyNat.add_zero] [2]
  all_goals browser_report_state
  all_goals sorry`,
  )
})

test('preserves a reverse visual goal rewrite on the selected side', () => {
  assert.equal(
    instrumentBrowserProof('drag_rw_rhs [← MyNat.succ_eq_add_one]'),
    'drag_rw_rhs [← MyNat.succ_eq_add_one]',
  )
})

test('preserves selected paths through reverse add_zero rewrites', () => {
  assert.equal(
    instrumentBrowserProof('drag_rw_rhs_at [← MyNat.add_zero] [1]'),
    'drag_rw_rhs_at [← MyNat.add_zero] [1]',
  )
  assert.equal(
    instrumentBrowserProof('drag_rw_hyp_lhs_at h [← add_zero] [2, 1]'),
    'drag_rw_hyp_lhs_at h [← add_zero] [2, 1]',
  )
})

test('keeps the selected side path when expanding a variable with reverse add_zero', () => {
  assert.equal(
    instrumentBrowserProof('drag_rw_rhs_at [← add_zero] [2]'),
    'drag_rw_rhs_at [← add_zero] [2]',
  )
})
