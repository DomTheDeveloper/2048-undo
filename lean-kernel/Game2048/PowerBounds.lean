import Game2048.LowerBound

namespace Game2048

/-- All powers of two have the same delay bound, on the actual slide rules. -/
theorem lower_bound_power {a b : Board} {moves : Nat}
    (hi : IsInitial a) (p : Plays a moves b) (j : Nat)
    (hit : b.Contains (2^(j+4))) :
    2^(j+2) + j ≤ moves := by
  have hm := initial_mass_le hi
  have allBig : ∀ k : Nat, 8 < 2^(k+4) := by
    intro k
    induction k with
    | zero => decide
    | succ k ih =>
      rw [show k+1+4 = (k+4)+1 by omega, Nat.pow_succ]
      omega
  have big := allBig j
  have pos : 0 < 2^(j+3) := by
    have hpow : 2^(j+4) = 2^(j+3)*2 := by
      rw [show j+4 = (j+3)+1 by omega, Nat.pow_succ]
    omega
  have hc : cutoff (j+2) < 2^(j+4) := by
    rw [cutoff_eq_pow]
    have hpow : 2^(j+4) = 2^(j+3)*2 := by
      rw [show j+4 = (j+3)+1 by omega, Nat.pow_succ]
    have he : j+2+1 = j+3 := by omega
    rw [he]
    omega
  have hlarge : a.mass < 2^(j+4) := by omega
  have bound := Plays.target_deadline p (j+2) (2^(j+4)) hc hlarge hit
  have he : 2^(j+4) = 4*2^(j+2) := by
    rw [show j+4 = (j+2)+1+1 by omega, Nat.pow_succ, Nat.pow_succ]
    omega
  rw [he] at bound
  omega

/-- Rank formulation for target tiles at least 16. -/
theorem lower_bound_rank {a b : Board} {moves : Nat}
    (hi : IsInitial a) (p : Plays a moves b) (rank : Nat) (hr : 4 ≤ rank)
    (hit : b.Contains (2^rank)) :
    2^(rank-2) + rank ≤ moves + 4 := by
  have he : rank-4+4 = rank := by omega
  have hit' : b.Contains (2^((rank-4)+4)) := by simpa [he] using hit
  have hh := lower_bound_power hi p (rank-4) hit'
  have he2 : rank-4+2 = rank-2 := by omega
  rw [he2] at hh
  omega

#print axioms lower_bound_power
#print axioms lower_bound_rank
end Game2048
