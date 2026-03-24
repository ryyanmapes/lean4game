import GameServer.Tactic.Visual

open Nat

example : 0 + 0 = 0 := by
  drag_rw_lhs [Nat.add_zero]
  show 0 = 0
  rfl

example (n : Nat) : n + 0 = n := by
  induction n with
  | zero =>
      drag_rw_lhs [Nat.add_zero]
      show 0 = 0
      rfl
  | succ n ih =>
      drag_rw_lhs [Nat.add_succ]
      show Nat.succ (n + 0) = Nat.succ n
      exact congrArg Nat.succ ih
