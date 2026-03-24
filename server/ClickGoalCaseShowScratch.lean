import GameServer.Tactic.Visual

open Nat

example (n : Nat) : n + 0 = n := by
  induction n
  case zero =>
    drag_rw_lhs [Nat.add_zero]
    show 0 = 0
    rfl
  case succ n ih =>
    drag_rw_lhs [Nat.add_succ]
    show Nat.succ (n + 0) = Nat.succ n
    exact congrArg Nat.succ ih
