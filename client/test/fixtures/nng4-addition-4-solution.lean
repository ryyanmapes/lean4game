-- Verbatim complete proof from NNG4/Game/Levels/Addition/L04add_assoc.lean.
by
  induction c with d hd
  · rw [add_zero, add_zero]
    rfl
  · rw [add_succ, add_succ, hd, add_succ]
    rfl
