import GameServer.Tactic.Visual

open Nat

example (n : Nat) : n + 0 = n := by
  induction n
  case zero =>
    drag_rw_lhs [Nat.add_zero]
    click_goal
  case succ n ih =>
    drag_rw_lhs [Nat.add_succ]
    exact congrArg Nat.succ ih
