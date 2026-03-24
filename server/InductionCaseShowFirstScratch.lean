example (n : Nat) : n + 0 = n := by
  induction n
  case zero =>
    show 0 + 0 = 0
    rfl
  case succ n ih =>
    show Nat.succ n + 0 = Nat.succ n
    rfl
