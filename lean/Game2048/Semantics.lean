import Game2048.Basic

/-! A declarative specification of pair merging, and exact mass conservation.
These connect the executable row procedure to an independently stated rule.
-/
namespace Game2048

/-- Read from the wall towards which the tiles move. Each input can be
consumed once, and a produced tile is never compared with the next input. -/
inductive PairMerge : List Nat → List Nat → Prop where
  | nil : PairMerge [] []
  | single (a : Nat) : PairMerge [a] [a]
  | equal {a : Nat} {xs ys : List Nat} :
      PairMerge xs ys → PairMerge (a :: a :: xs) ((a+a) :: ys)
  | different {a b : Nat} {xs ys : List Nat} :
      a ≠ b → PairMerge (b :: xs) ys → PairMerge (a :: b :: xs) (a :: ys)

/-- The structurally recursive implementation obeys the declarative rule. -/
theorem merge_spec (xs : List Nat) : PairMerge xs (merge xs) := by
  cases xs with
  | nil => exact PairMerge.nil
  | cons a xs =>
    cases xs with
    | nil => exact PairMerge.single a
    | cons b rest =>
      by_cases h : a = b
      · subst b
        rw [merge_pair, if_pos rfl]
        exact PairMerge.equal (merge_spec rest)
      · rw [merge_pair, if_neg h]
        exact PairMerge.different h (merge_spec (b :: rest))
termination_by xs.length

theorem PairMerge.mass_eq {xs ys : List Nat} (h : PairMerge xs ys) :
    heavyList 0 ys = heavyList 0 xs := by
  induction h with
  | nil => rfl
  | single a => rfl
  | equal h ih =>
    simp only [heavyList, heavyTile_at_zero] at *
    omega
  | different hab h ih =>
    simp only [heavyList, heavyTile_at_zero] at *
    omega

theorem Row.ofList_heavy_eq (xs : List Nat) (k : Nat) (h : xs.length ≤ 4) :
    (Row.ofList xs).heavy k = heavyList k xs := by
  cases xs with
  | nil => simp [Row.ofList, Row.heavy, heavyList]
  | cons a xs =>
    cases xs with
    | nil => simp [Row.ofList, Row.heavy, heavyList]
    | cons b xs =>
      cases xs with
      | nil => simp [Row.ofList, Row.heavy, heavyList]
      | cons c xs =>
        cases xs with
        | nil => simp [Row.ofList, Row.heavy, heavyList, Nat.add_assoc]
        | cons d xs =>
          have hx : xs = [] := by
            have hl : xs.length = 0 := by simp only [List.length_cons] at h; omega
            exact List.length_eq_zero_iff.mp hl
          subst xs
          simp [Row.ofList, Row.heavy, heavyList, Nat.add_assoc]

theorem Row.left_mass_eq (r : Row) : r.left.heavy 0 = r.heavy 0 := by
  unfold Row.left
  rw [Row.ofList_heavy_eq _ _ (Row.left_length r)]
  rw [PairMerge.mass_eq (merge_spec (compact r.toList))]
  rw [compact_heavy, Row.toList_heavy]

theorem Row.right_mass_eq (r : Row) : r.right.heavy 0 = r.heavy 0 := by
  unfold Row.right
  rw [Row.reverse_heavy, Row.left_mass_eq, Row.reverse_heavy]

theorem Board.map_left_mass_eq (b : Board) :
    (b.mapRows Row.left).heavy 0 = b.heavy 0 := by
  change b.r0.left.heavy 0 + b.r1.left.heavy 0 +
    b.r2.left.heavy 0 + b.r3.left.heavy 0 = _
  rw [Row.left_mass_eq, Row.left_mass_eq, Row.left_mass_eq, Row.left_mass_eq]
  rfl

theorem Board.map_right_mass_eq (b : Board) :
    (b.mapRows Row.right).heavy 0 = b.heavy 0 := by
  change b.r0.right.heavy 0 + b.r1.right.heavy 0 +
    b.r2.right.heavy 0 + b.r3.right.heavy 0 = _
  rw [Row.right_mass_eq, Row.right_mass_eq, Row.right_mass_eq, Row.right_mass_eq]
  rfl

theorem Board.slide_mass_eq (b : Board) (d : Dir) : (b.slide d).mass = b.mass := by
  cases d with
  | left => exact Board.map_left_mass_eq b
  | right => exact Board.map_right_mass_eq b
  | up =>
    change (b.transpose.mapRows Row.left).transpose.heavy 0 = b.heavy 0
    rw [Board.transpose_heavy, Board.map_left_mass_eq, Board.transpose_heavy]
  | down =>
    change (b.transpose.mapRows Row.right).transpose.heavy 0 = b.heavy 0
    rw [Board.transpose_heavy, Board.map_right_mass_eq, Board.transpose_heavy]

/-- No round loses or creates mass except for its one prescribed spawn. -/
theorem step_mass_exact {b c : Board} {s : Step} (h : step b s = some c) :
    c.mass = b.mass + s.value := by
  obtain ⟨_,_,hz,rfl⟩ := step_spec h
  have hset := Board.set_heavy (b.slide s.dir) s.row s.col s.value 0 hz
  have hs := Board.slide_mass_eq b s.dir
  simp only [Board.mass, heavyTile_at_zero] at *
  omega

#print axioms merge_spec
#print axioms Board.slide_mass_eq
#print axioms step_mass_exact

end Game2048
