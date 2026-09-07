import Game2048.LowerBound

namespace Game2048

/-- The ordinary opening conditioned on both initial values being 2. -/
def IsTwoTwos (b : Board) : Prop :=
  ∃ r1 c1 r2 c2 : Ix, (r1 ≠ r2 ∨ c1 ≠ c2) ∧
    b = (Board.empty.set r1 c1 2).set r2 c2 2

theorem two_twos_initial {b : Board} (h : IsTwoTwos b) : IsInitial b := by
  obtain ⟨r1,c1,r2,c2,hne,rfl⟩ := h
  exact ⟨r1,c1,r2,c2,2,2,Or.inl rfl,Or.inl rfl,hne,rfl⟩

theorem two_twos_mass_le {b : Board} (h : IsTwoTwos b) : b.mass ≤ 4 := by
  obtain ⟨r1,c1,r2,c2,_,rfl⟩ := h
  have h1 := Board.set_heavy_le Board.empty r1 c1 2 0
  have h2 := Board.set_heavy_le (Board.empty.set r1 c1 2) r2 c2 2 0
  have h0 : Board.empty.heavy 0 = 0 := by decide
  simp only [heavyTile_at_zero, h0] at h1 h2
  unfold Board.mass
  omega

theorem lower_bound_two_twos {a b : Board} {n : Nat}
    (hi : IsTwoTwos a) (p : Plays a n b) (hit : b.Contains 131072) :
    32782 ≤ n := by
  have hm := two_twos_mass_le hi
  have hlarge : a.mass < 131072 := by omega
  have h := Plays.target_deadline p 15 131072 (by decide) hlarge hit
  omega

/-- A fastest game must start with the maximum initial mass of 8. -/
theorem optimal_initial_mass {a b : Board}
    (hi : IsInitial a) (p : Plays a 32781 b) (hit : b.Contains 131072) :
    a.mass = 8 := by
  have hm := initial_mass_le hi
  have hlarge : a.mass < 131072 := by omega
  have h := Plays.target_deadline p 15 131072 (by decide) hlarge hit
  omega

def twoTwosStart : Board := (Board.empty.set .i3 .i2 2).set .i3 .i3 2

theorem twoTwosStart_valid : IsTwoTwos twoTwosStart := by
  refine ⟨.i3,.i2,.i3,.i3,?_,?_⟩ <;> decide +kernel

#print axioms lower_bound_two_twos
#print axioms optimal_initial_mass
end Game2048
