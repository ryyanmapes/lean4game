import Lean.Elab.Tactic.Rewrite

/-!
A browser-safe implementation of Mathlib's `nth_rewrite` surface syntax.

The tactic is only a convenient spelling of Lean's core occurrence-filtered
`rw`. Keeping the spelling here preserves authored NNG levels and player
scripts without linking Mathlib's larger tactic runtime into the browser.
-/

open Lean Parser Tactic

syntax (name := browserNthRewrite) "nth_rewrite " num rwRuleSeq (location)? : tactic

macro_rules
  | `(tactic| nth_rewrite $n:num $rules:rwRuleSeq $[$loc:location]?) =>
      `(tactic| rw (occs := .pos [$n]) $rules:rwRuleSeq $[$loc:location]?)

