import Lean.Elab.Tactic.Rewrite

/-!
A browser-safe implementation of Mathlib's `nth_rewrite` surface syntax.

The tactic is only a convenient spelling of Lean's core occurrence-filtered
`rewrite`. Keeping the spelling here preserves authored NNG levels and player
scripts without linking Mathlib's larger tactic runtime into the browser.

It must expand to `rewrite` rather than `rw`: `rw` appends a `with_reducible
rfl`, so a rewrite that happens to finish the goal closes it, and the next
authored `rfl` then lands on the following goal. Mathlib's `nth_rewrite` never
closes the goal, and the exported proofs are written against that behaviour.
-/

open Lean Parser Tactic

syntax (name := browserNthRewrite) "nth_rewrite " num rwRuleSeq (location)? : tactic

macro_rules
  | `(tactic| nth_rewrite $n:num $rules:rwRuleSeq $[$loc:location]?) =>
      `(tactic| rewrite (occs := .pos [$n]) $rules:rwRuleSeq $[$loc:location]?)

