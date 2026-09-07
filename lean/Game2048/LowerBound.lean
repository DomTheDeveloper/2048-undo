import Game2048.Basic

/-!
A latency proof without tagged tiles or assumed merge trees.
Heavy mass above twice a threshold after a round is bounded by heavy
mass above the old threshold before the round. A spawn is at most 4,
so it contributes nothing when the new threshold is at least 4.
Iterating through k final rounds bounds a large target by the mass
that was already present k rounds earlier.
-/
namespace Game2048

/-- 2, 4, 8, ... . After fifteen rounds this threshold is 65536. -/
def cutoff : Nat → Nat
  | 0 => 2
  | n+1 => 2 * cutoff n

theorem cutoff_ge_two (n : Nat) : 2 ≤ cutoff n := by
  induction n with
  | zero => decide
  | succ n ih => simp only [cutoff]; omega

theorem cutoff_mono {n m : Nat} (h : n ≤ m) : cutoff n ≤ cutoff m := by
  induction m generalizing n with
  | zero =>
    have hn : n = 0 := by omega
    subst n
    exact Nat.le_refl _
  | succ m ih =>
    by_cases hn : n ≤ m
    · have hnm := ih hn
      simp only [cutoff]
      omega
    · have heq : n = m+1 := by omega
      subst n
      exact Nat.le_refl _

theorem cutoff_eq_pow (n : Nat) : cutoff n = 2^(n+1) := by
  induction n with
  | zero => decide
  | succ n ih =>
    simp [cutoff, ih, Nat.pow_succ, Nat.mul_comm, Nat.add_assoc]

namespace Plays

/-- No mass from new spawns can cross the exponentially increasing threshold. -/
theorem latency_bound {a b : Board} {n : Nat} (p : Plays a n b) :
    b.heavy (cutoff n) ≤ a.heavy 2 := by
  induction p with
  | refl => exact Nat.le_refl _
  | @snoc n b c p s hs ih =>
    have hh := step_heavy_le hs (cutoff n) (cutoff_ge_two n)
    change c.heavy (2 * cutoff n) ≤ a.heavy 2
    exact Nat.le_trans hh ih

/-- The last k rounds cannot add mass to a tile above cutoff k. -/
theorem tail_mass_bound {a b : Board} {n : Nat} (p : Plays a n b) :
    ∀ k : Nat, k ≤ n → b.heavy (cutoff k) ≤ a.mass + 4*(n-k) := by
  induction p with
  | refl =>
    intro k hk
    have hk0 : k = 0 := by omega
    subst k
    simpa [cutoff] using Board.heavy_le_mass a 2
  | @snoc n b c p s hs ih =>
    intro k hk
    cases k with
    | zero =>
      have h1 := Board.heavy_le_mass c 2
      have h2 := Plays.mass_bound (Plays.snoc p s hs)
      simpa [cutoff] using Nat.le_trans h1 h2
    | succ k =>
      have hk' : k ≤ n := by omega
      have h1 := step_heavy_le hs (cutoff k) (cutoff_ge_two k)
      have h2 := ih k hk'
      change c.heavy (2 * cutoff k) ≤ a.mass + 4*((n+1)-(k+1))
      omega

/-- General target/deadline inequality, valid for every starting board.
    In particular it does not assume a snake arrangement or a primed board. -/
theorem target_deadline {a b : Board} {n : Nat} (p : Plays a n b)
    (k target : Nat) (hcut : cutoff k < target) (hlarge : a.mass < target)
    (hit : b.Contains target) : target + 4*k ≤ a.mass + 4*n := by
  by_cases hk : k ≤ n
  · have ht := tail_mass_bound p k hk
    have hl := Board.contains_heavy_lower b (cutoff k) target hcut hit
    omega
  · have hnk : n ≤ k := by omega
    have hc := cutoff_mono hnk
    have hcn : cutoff n < target := by omega
    have hl := Board.contains_heavy_lower b (cutoff n) target hcn hit
    have ht := latency_bound p
    have hm := Board.heavy_le_mass a 2
    omega

end Plays

/-- Every legal play from any standard two-tile start needs at least
    32,781 rounds to contain 131072. -/
theorem lower_bound_131072 {a b : Board} {n : Nat}
    (hi : IsInitial a) (p : Plays a n b) (hit : b.Contains 131072) :
    32781 ≤ n := by
  have hm := initial_mass_le hi
  have hlarge : a.mass < 131072 := by omega
  have h := Plays.target_deadline p 15 131072 (by decide) hlarge hit
  omega

/-- The same proof gives the familiar 519-move lower bound for 2048. -/
theorem lower_bound_2048 {a b : Board} {n : Nat}
    (hi : IsInitial a) (p : Plays a n b) (hit : b.Contains 2048) :
    519 ≤ n := by
  have hm := initial_mass_le hi
  have hlarge : a.mass < 2048 := by omega
  have h := Plays.target_deadline p 9 2048 (by decide) hlarge hit
  omega

#print axioms lower_bound_131072
#print axioms lower_bound_2048

end Game2048
