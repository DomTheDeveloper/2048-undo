import Game2048.Basic

/-! Small kernel-checked tests and exact mass conservation for the rules. -/
namespace Game2048

example : Row.left ⟨2,2,2,2⟩ = ⟨4,4,0,0⟩ := by decide +kernel
example : Row.left ⟨2,2,4,0⟩ = ⟨4,4,0,0⟩ := by decide +kernel
example : Row.left ⟨2,2,2,0⟩ = ⟨4,2,0,0⟩ := by decide +kernel
example : Row.right ⟨2,2,2,0⟩ = ⟨0,0,2,4⟩ := by decide +kernel
example : Row.left ⟨4,0,4,4⟩ = ⟨8,4,0,0⟩ := by decide +kernel
example : Row.left ⟨4,4,8,8⟩ = ⟨8,16,0,0⟩ := by decide +kernel
example : step Board.empty ⟨.left, .i0, .i0, 4⟩ = none := by decide +kernel
example : step (Board.empty.set .i0 .i0 2) ⟨.right, .i0, .i0, 8⟩ = none := by decide +kernel
example : step (Board.empty.set .i0 .i0 2) ⟨.right, .i0, .i3, 4⟩ = none := by decide +kernel
example : step (Board.empty.set .i0 .i0 2) ⟨.left, .i3, .i3, 4⟩ = none := by decide +kernel
example : step (Board.empty.set .i0 .i0 2) ⟨.right, .i0, .i0, 4⟩ =
    some ((Board.empty.set .i0 .i3 2).set .i0 .i0 4) := by decide +kernel

/-- Every declarative merge preserves the total tile value. -/
theorem PairMerge.mass_eq {xs ys : List Nat} (h : PairMerge xs ys) :
    heavyList 0 ys = heavyList 0 xs := by
  induction h with
  | nil => rfl
  | single => rfl
  | equal h ih =>
    simp only [heavyList, heavyTile_at_zero] at *
    omega
  | different h hrest ih =>
    simp only [heavyList, heavyTile_at_zero] at *
    omega

namespace Row

/-- Padding a row changes no mass and does not discard any input. -/
theorem ofList_heavy_eq (xs : List Nat) (k : Nat) (h : xs.length ≤ 4) :
    (ofList xs).heavy k = heavyList k xs := by
  cases xs with
  | nil => simp [ofList, heavy, heavyList]
  | cons a xs =>
    cases xs with
    | nil => simp [ofList, heavy, heavyList]
    | cons b xs =>
      cases xs with
      | nil => simp [ofList, heavy, heavyList]
      | cons c xs =>
        cases xs with
        | nil => simp [ofList, heavy, heavyList, Nat.add_assoc]
        | cons d xs =>
          have hz : xs.length = 0 := by simp only [List.length_cons] at h; omega
          have hn : xs = [] := List.length_eq_zero_iff.mp hz
          subst xs
          simp [ofList, heavy, heavyList, Nat.add_assoc]

theorem left_mass_eq (r : Row) : r.left.heavy 0 = r.heavy 0 := by
  unfold left
  rw [ofList_heavy_eq _ 0 (left_length r)]
  rw [PairMerge.mass_eq (merge_spec _), compact_heavy, toList_heavy]

theorem right_mass_eq (r : Row) : r.right.heavy 0 = r.heavy 0 := by
  unfold right
  rw [reverse_heavy, left_mass_eq, reverse_heavy]

end Row

namespace Board

theorem slide_mass_eq (b : Board) (d : Dir) : (b.slide d).mass = b.mass := by
  cases d with
  | left => simp [slide, mapRows, mass, heavy, Row.left_mass_eq]
  | right => simp [slide, mapRows, mass, heavy, Row.right_mass_eq]
  | up =>
    change (b.transpose.mapRows Row.left).transpose.heavy 0 = b.heavy 0
    rw [transpose_heavy]
    calc
      (b.transpose.mapRows Row.left).heavy 0 = b.transpose.heavy 0 := by
        simp only [mapRows, heavy, Row.left_mass_eq]
      _ = b.heavy 0 := transpose_heavy b 0
  | down =>
    change (b.transpose.mapRows Row.right).transpose.heavy 0 = b.heavy 0
    rw [transpose_heavy]
    calc
      (b.transpose.mapRows Row.right).heavy 0 = b.transpose.heavy 0 := by
        simp only [mapRows, heavy, Row.right_mass_eq]
      _ = b.heavy 0 := transpose_heavy b 0

end Board

/-- A legal round increases mass by exactly its one spawned tile. -/
theorem step_mass_exact {b c : Board} {s : Step} (h : step b s = some c) :
    c.mass = b.mass + s.value := by
  obtain ⟨_,_,hz,rfl⟩ := step_spec h
  have he := Board.set_heavy (b.slide s.dir) s.row s.col s.value 0 hz
  have hm := Board.slide_mass_eq b s.dir
  simp only [heavyTile_at_zero] at he
  exact he.trans (congrArg (· + s.value) hm)

#print axioms Board.slide_mass_eq
#print axioms step_mass_exact
end Game2048
