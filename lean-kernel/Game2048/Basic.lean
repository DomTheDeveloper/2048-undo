import Lean

/-!
Standard 4 x 4 2048, with continuation after the 2048 tile.
A round is a nontrivial slide followed by exactly one 2/4 spawn in an
empty cell. Coordinates have four constructors, so out-of-board positions
cannot be expressed. Nothing here imports the searcher or either checker.
-/
namespace Game2048

inductive Ix where
  | i0 | i1 | i2 | i3
  deriving DecidableEq, Repr

inductive Dir where
  | up | right | down | left
  deriving DecidableEq, Repr

/-- Mass contributed by a tile strictly above a threshold. -/
def heavyTile (k v : Nat) : Nat := if k < v then v else 0

@[simp] theorem heavyTile_zero (k : Nat) : heavyTile k 0 = 0 := by
  simp [heavyTile]

@[simp] theorem heavyTile_at_zero (v : Nat) : heavyTile 0 v = v := by
  by_cases h : v = 0
  · simp [h]
  · have hv : 0 < v := by omega
    simp [heavyTile, hv]

theorem heavyTile_le (k v : Nat) : heavyTile k v ≤ v := by
  unfold heavyTile
  split <;> omega

theorem heavyTile_vanish (k v : Nat) (h : v ≤ k) : heavyTile k v = 0 := by
  simp [heavyTile, Nat.not_lt_of_ge h]

theorem heavyTile_mono_double (k v : Nat) : heavyTile (2*k) v ≤ heavyTile k v := by
  by_cases h : 2*k < v
  · have h' : k < v := by omega
    simp [heavyTile, h, h']
  · simp [heavyTile, h]

theorem heavyTile_double (k v : Nat) :
    heavyTile (2*k) (v+v) = heavyTile k v + heavyTile k v := by
  by_cases h : k < v
  · have h' : 2*k < v+v := by omega
    simp [heavyTile, h, h']
  · have h' : ¬ 2*k < v+v := by omega
    simp [heavyTile, h, h']

def heavyList (k : Nat) : List Nat → Nat
  | [] => 0
  | v :: vs => heavyTile k v + heavyList k vs

theorem heavyList_mono_double (xs : List Nat) (k : Nat) :
    heavyList (2*k) xs ≤ heavyList k xs := by
  induction xs with
  | nil => exact Nat.le_refl _
  | cons a xs ih =>
    have ha := heavyTile_mono_double k a
    simp only [heavyList]
    omega

/-- Remove empty cells, preserving the order of the other tiles. -/
def compact : List Nat → List Nat
  | [] => []
  | v :: vs => if v = 0 then compact vs else v :: compact vs

/-- Structural recursion on fuel. Each recursive call consumes at least
one input tile, so input length is sufficient fuel. A newly created tile
is prepended to the output and never merged again in the same slide. -/
def mergeFuel : Nat → List Nat → List Nat
  | 0, xs => xs
  | _+1, [] => []
  | _+1, [a] => [a]
  | fuel+1, a :: b :: rest =>
    if a = b then (a+b) :: mergeFuel fuel rest
    else a :: mergeFuel fuel (b :: rest)

def merge (xs : List Nat) : List Nat := mergeFuel xs.length xs

/-- Declarative left-to-right, non-chaining pair-merge rules. -/
inductive PairMerge : List Nat → List Nat → Prop where
  | nil : PairMerge [] []
  | single (a : Nat) : PairMerge [a] [a]
  | equal {a : Nat} {xs ys : List Nat} :
      PairMerge xs ys → PairMerge (a :: a :: xs) ((a+a) :: ys)
  | different {a b : Nat} {xs ys : List Nat} :
      a ≠ b → PairMerge (b :: xs) ys → PairMerge (a :: b :: xs) (a :: ys)

/-- The evaluator implements the declarative pair-merge rules whenever fuel suffices. -/
theorem mergeFuel_spec (fuel : Nat) (xs : List Nat) (h : xs.length ≤ fuel) :
    PairMerge xs (mergeFuel fuel xs) := by
  induction fuel generalizing xs with
  | zero =>
    have hx : xs = [] := List.length_eq_zero.mp (by omega)
    subst xs
    exact PairMerge.nil
  | succ fuel ih =>
    cases xs with
    | nil => exact PairMerge.nil
    | cons a xs =>
      cases xs with
      | nil => exact PairMerge.single a
      | cons b rest =>
        have htail : rest.length ≤ fuel := by simp only [List.length_cons] at h; omega
        have hrest : (b :: rest).length ≤ fuel := by simp only [List.length_cons] at *; omega
        by_cases hab : a = b
        · subst b
          simpa only [mergeFuel, if_pos rfl] using PairMerge.equal (a := a) (ih rest htail)
        · simpa only [mergeFuel, if_neg hab] using PairMerge.different hab (ih (b :: rest) hrest)

theorem merge_spec (xs : List Nat) : PairMerge xs (merge xs) :=
  mergeFuel_spec xs.length xs (Nat.le_refl _)

theorem compact_heavy (xs : List Nat) (k : Nat) :
    heavyList k (compact xs) = heavyList k xs := by
  induction xs with
  | nil => rfl
  | cons a xs ih =>
    by_cases h : a = 0
    · subst a
      simp [compact, heavyList, ih]
    · simp [compact, heavyList, h, ih]

theorem compact_length (xs : List Nat) : (compact xs).length ≤ xs.length := by
  induction xs with
  | nil => simp [compact]
  | cons a xs ih =>
    by_cases h : a = 0 <;> simp [compact, h] <;> omega

theorem mergeFuel_heavy (fuel : Nat) (xs : List Nat) (k : Nat) :
    heavyList (2*k) (mergeFuel fuel xs) ≤ heavyList k xs := by
  induction fuel generalizing xs with
  | zero => exact heavyList_mono_double xs k
  | succ fuel ih =>
    cases xs with
    | nil => simp [mergeFuel, heavyList]
    | cons a xs =>
      cases xs with
      | nil => simpa [mergeFuel, heavyList] using heavyTile_mono_double k a
      | cons b rest =>
        by_cases h : a = b
        · subst b
          have hh := Nat.add_le_add_left (ih rest) (heavyTile k a + heavyTile k a)
          simpa [mergeFuel, heavyList, heavyTile_double, Nat.add_assoc] using hh
        · have ht := ih (b :: rest)
          have ha := heavyTile_mono_double k a
          simp only [mergeFuel, if_neg h, heavyList] at *
          omega

/-- A merge cannot increase mass above a threshold that doubles this round. -/
theorem merge_heavy (xs : List Nat) (k : Nat) :
    heavyList (2*k) (merge xs) ≤ heavyList k xs :=
  mergeFuel_heavy xs.length xs k

theorem mergeFuel_length (fuel : Nat) (xs : List Nat) :
    (mergeFuel fuel xs).length ≤ xs.length := by
  induction fuel generalizing xs with
  | zero => exact Nat.le_refl _
  | succ fuel ih =>
    cases xs with
    | nil => simp [mergeFuel]
    | cons a xs =>
      cases xs with
      | nil => simp [mergeFuel]
      | cons b rest =>
        by_cases h : a = b
        · have ht := ih rest
          simp only [mergeFuel, if_pos h, List.length_cons] at *
          omega
        · have ht := ih (b :: rest)
          simp only [mergeFuel, if_neg h, List.length_cons] at *
          omega

theorem merge_length (xs : List Nat) : (merge xs).length ≤ xs.length :=
  mergeFuel_length xs.length xs

structure Row where
  a : Nat
  b : Nat
  c : Nat
  d : Nat
  deriving DecidableEq, Repr

namespace Row

def toList (r : Row) : List Nat := [r.a, r.b, r.c, r.d]

def ofList : List Nat → Row
  | [] => ⟨0,0,0,0⟩
  | [a] => ⟨a,0,0,0⟩
  | [a,b] => ⟨a,b,0,0⟩
  | [a,b,c] => ⟨a,b,c,0⟩
  | a :: b :: c :: d :: _ => ⟨a,b,c,d⟩

def reverse (r : Row) : Row := ⟨r.d,r.c,r.b,r.a⟩
def left (r : Row) : Row := ofList (merge (compact r.toList))
def right (r : Row) : Row := r.reverse.left.reverse

def get (r : Row) : Ix → Nat
  | .i0 => r.a | .i1 => r.b | .i2 => r.c | .i3 => r.d

def set (r : Row) (i : Ix) (v : Nat) : Row :=
  match i with
  | .i0 => { r with a := v }
  | .i1 => { r with b := v }
  | .i2 => { r with c := v }
  | .i3 => { r with d := v }

def heavy (r : Row) (k : Nat) : Nat :=
  heavyTile k r.a + heavyTile k r.b + heavyTile k r.c + heavyTile k r.d

theorem toList_heavy (r : Row) (k : Nat) : heavyList k r.toList = r.heavy k := by
  simp [toList, heavyList, heavy, Nat.add_assoc]

/-- In an actual row slide no truncation by `ofList` ever occurs. -/
theorem left_length (r : Row) : (merge (compact r.toList)).length ≤ 4 := by
  have hm := merge_length (compact r.toList)
  have hc := compact_length r.toList
  have ht : r.toList.length = 4 := rfl
  omega

theorem ofList_heavy (xs : List Nat) (k : Nat) : (ofList xs).heavy k ≤ heavyList k xs := by
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
          simp only [ofList, heavy, heavyList]
          omega

theorem reverse_heavy (r : Row) (k : Nat) : r.reverse.heavy k = r.heavy k := by
  simp only [reverse, heavy]
  omega

theorem left_heavy (r : Row) (k : Nat) : r.left.heavy (2*k) ≤ r.heavy k := by
  calc
    r.left.heavy (2*k) ≤ heavyList (2*k) (merge (compact r.toList)) :=
      ofList_heavy _ _
    _ ≤ heavyList k (compact r.toList) := merge_heavy _ _
    _ = heavyList k r.toList := compact_heavy _ _
    _ = r.heavy k := toList_heavy _ _

theorem right_heavy (r : Row) (k : Nat) : r.right.heavy (2*k) ≤ r.heavy k := by
  unfold right
  rw [reverse_heavy]
  calc
    r.reverse.left.heavy (2*k) ≤ r.reverse.heavy k := left_heavy _ _
    _ = r.heavy k := reverse_heavy _ _

theorem heavy_le_zero (r : Row) (k : Nat) : r.heavy k ≤ r.heavy 0 := by
  have ha := heavyTile_le k r.a
  have hb := heavyTile_le k r.b
  have hc := heavyTile_le k r.c
  have hd := heavyTile_le k r.d
  simp only [heavy, heavyTile_at_zero]
  omega

end Row

structure Board where
  r0 : Row
  r1 : Row
  r2 : Row
  r3 : Row
  deriving DecidableEq, Repr

namespace Board

def empty : Board := ⟨⟨0,0,0,0⟩,⟨0,0,0,0⟩,⟨0,0,0,0⟩,⟨0,0,0,0⟩⟩

def mapRows (b : Board) (f : Row → Row) : Board := ⟨f b.r0, f b.r1, f b.r2, f b.r3⟩

def transpose (b : Board) : Board :=
  ⟨⟨b.r0.a,b.r1.a,b.r2.a,b.r3.a⟩,
   ⟨b.r0.b,b.r1.b,b.r2.b,b.r3.b⟩,
   ⟨b.r0.c,b.r1.c,b.r2.c,b.r3.c⟩,
   ⟨b.r0.d,b.r1.d,b.r2.d,b.r3.d⟩⟩

def slide (b : Board) : Dir → Board
  | .left => b.mapRows Row.left
  | .right => b.mapRows Row.right
  | .up => (b.transpose.mapRows Row.left).transpose
  | .down => (b.transpose.mapRows Row.right).transpose

def get (b : Board) (r c : Ix) : Nat :=
  match r with
  | .i0 => b.r0.get c | .i1 => b.r1.get c
  | .i2 => b.r2.get c | .i3 => b.r3.get c

def set (b : Board) (r c : Ix) (v : Nat) : Board :=
  match r with
  | .i0 => { b with r0 := b.r0.set c v }
  | .i1 => { b with r1 := b.r1.set c v }
  | .i2 => { b with r2 := b.r2.set c v }
  | .i3 => { b with r3 := b.r3.set c v }

def heavy (b : Board) (k : Nat) : Nat :=
  b.r0.heavy k + b.r1.heavy k + b.r2.heavy k + b.r3.heavy k

def mass (b : Board) : Nat := b.heavy 0

def Contains (b : Board) (v : Nat) : Prop := ∃ r c, b.get r c = v

theorem transpose_heavy (b : Board) (k : Nat) : b.transpose.heavy k = b.heavy k := by
  simp only [transpose, heavy, Row.heavy]
  omega

theorem map_left_heavy (b : Board) (k : Nat) :
    (b.mapRows Row.left).heavy (2*k) ≤ b.heavy k := by
  have h0 := Row.left_heavy b.r0 k
  have h1 := Row.left_heavy b.r1 k
  have h2 := Row.left_heavy b.r2 k
  have h3 := Row.left_heavy b.r3 k
  simp only [mapRows, heavy]
  omega

theorem map_right_heavy (b : Board) (k : Nat) :
    (b.mapRows Row.right).heavy (2*k) ≤ b.heavy k := by
  have h0 := Row.right_heavy b.r0 k
  have h1 := Row.right_heavy b.r1 k
  have h2 := Row.right_heavy b.r2 k
  have h3 := Row.right_heavy b.r3 k
  simp only [mapRows, heavy]
  omega

/-- The geometric part of the latency argument, for all four directions. -/
theorem slide_heavy (b : Board) (d : Dir) (k : Nat) :
    (b.slide d).heavy (2*k) ≤ b.heavy k := by
  cases d with
  | left => exact map_left_heavy b k
  | right => exact map_right_heavy b k
  | up =>
    simp only [slide, transpose_heavy]
    calc
      (b.transpose.mapRows Row.left).heavy (2*k) ≤ b.transpose.heavy k := map_left_heavy _ _
      _ = b.heavy k := transpose_heavy _ _
  | down =>
    simp only [slide, transpose_heavy]
    calc
      (b.transpose.mapRows Row.right).heavy (2*k) ≤ b.transpose.heavy k := map_right_heavy _ _
      _ = b.heavy k := transpose_heavy _ _

theorem heavy_le_mass (b : Board) (k : Nat) : b.heavy k ≤ b.mass := by
  have h0 := Row.heavy_le_zero b.r0 k
  have h1 := Row.heavy_le_zero b.r1 k
  have h2 := Row.heavy_le_zero b.r2 k
  have h3 := Row.heavy_le_zero b.r3 k
  simp only [mass, heavy]
  omega

theorem set_heavy_le (b : Board) (r c : Ix) (v k : Nat) :
    (b.set r c v).heavy k ≤ b.heavy k + heavyTile k v := by
  cases r <;> cases c <;>
    simp only [set, Row.set, heavy, Row.heavy] <;> omega

theorem set_heavy (b : Board) (r c : Ix) (v k : Nat) (hz : b.get r c = 0) :
    (b.set r c v).heavy k = b.heavy k + heavyTile k v := by
  cases r <;> cases c <;>
    simp_all only [get, Row.get, set, Row.set, heavy, Row.heavy, heavyTile_zero] <;> omega

theorem cell_heavy_le (b : Board) (r c : Ix) (k : Nat) :
    heavyTile k (b.get r c) ≤ b.heavy k := by
  cases r <;> cases c <;>
    simp only [get, Row.get, heavy, Row.heavy] <;> omega

theorem contains_heavy_lower (b : Board) (k v : Nat)
    (hk : k < v) (h : b.Contains v) : v ≤ b.heavy k := by
  obtain ⟨r,c,hv⟩ := h
  have hc := cell_heavy_le b r c k
  simpa [hv, heavyTile, hk] using hc

end Board

def Small (v : Nat) : Prop := v = 2 ∨ v = 4
instance (v : Nat) : Decidable (Small v) := inferInstanceAs (Decidable (v = 2 ∨ v = 4))

theorem small_le_four {v : Nat} (h : Small v) : v ≤ 4 := by
  rcases h with rfl | rfl <;> decide

/-- Any of the ordinary two-tile starting boards, not just a selected opening. -/
def IsInitial (b : Board) : Prop :=
  ∃ r1 c1 r2 c2 : Ix, ∃ v1 v2 : Nat,
    Small v1 ∧ Small v2 ∧ (r1 ≠ r2 ∨ c1 ≠ c2) ∧
    b = (Board.empty.set r1 c1 v1).set r2 c2 v2

theorem initial_mass_le {b : Board} (h : IsInitial b) : b.mass ≤ 8 := by
  obtain ⟨r1,c1,r2,c2,v1,v2,hv1,hv2,_,rfl⟩ := h
  have h1 := Board.set_heavy_le Board.empty r1 c1 v1 0
  have h2 := Board.set_heavy_le (Board.empty.set r1 c1 v1) r2 c2 v2 0
  have h0 : Board.empty.heavy 0 = 0 := by decide
  have h3 := small_le_four hv1
  have h4 := small_le_four hv2
  simp only [heavyTile_at_zero, h0] at h1 h2
  unfold Board.mass
  omega

structure Step where
  dir : Dir
  row : Ix
  col : Ix
  value : Nat
  deriving DecidableEq, Repr

/-- Exactly the standard legal round, including the mandatory post-slide spawn. -/
def step (b : Board) (s : Step) : Option Board :=
  if Small s.value ∧ b.slide s.dir ≠ b ∧ (b.slide s.dir).get s.row s.col = 0
  then some ((b.slide s.dir).set s.row s.col s.value)
  else none

theorem step_spec {b c : Board} {s : Step} (h : step b s = some c) :
    Small s.value ∧ b.slide s.dir ≠ b ∧
    (b.slide s.dir).get s.row s.col = 0 ∧
    c = (b.slide s.dir).set s.row s.col s.value := by
  unfold step at h
  split at h
  · rename_i hs
    exact ⟨hs.1, hs.2.1, hs.2.2, (Option.some.inj h).symm⟩
  · cases h

theorem step_mass_le {b c : Board} {s : Step} (h : step b s = some c) :
    c.mass ≤ b.mass + 4 := by
  obtain ⟨hv,_,_,rfl⟩ := step_spec h
  have hs := Board.set_heavy_le (b.slide s.dir) s.row s.col s.value 0
  have hm := Board.slide_heavy b s.dir 0
  have hv4 := small_le_four hv
  simp only [heavyTile_at_zero, Nat.mul_zero] at hs hm
  unfold Board.mass
  omega

/-- With k >= 2, the new tile is too small to contribute above threshold 2*k. -/
theorem step_heavy_le {b c : Board} {s : Step}
    (h : step b s = some c) (k : Nat) (hk : 2 ≤ k) :
    c.heavy (2*k) ≤ b.heavy k := by
  obtain ⟨hv,_,_,rfl⟩ := step_spec h
  have hv4 := small_le_four hv
  have hvk : s.value ≤ 2*k := by omega
  have hs := Board.set_heavy_le (b.slide s.dir) s.row s.col s.value (2*k)
  have hz := heavyTile_vanish (2*k) s.value hvk
  have hm := Board.slide_heavy b s.dir k
  rw [hz] at hs
  omega

/-- A legal play of exactly n rounds. No claims about score or legality are assumed. -/
inductive Plays (start : Board) : Nat → Board → Prop where
  | refl : Plays start 0 start
  | snoc {n : Nat} {b c : Board} :
      Plays start n b → (s : Step) → step b s = some c → Plays start (n+1) c

namespace Plays

theorem mass_bound {a b : Board} {n : Nat} (p : Plays a n b) :
    b.mass ≤ a.mass + 4*n := by
  induction p with
  | refl => simp
  | snoc p s hs ih =>
    have hm := step_mass_le hs
    omega

theorem append {a b c : Board} {m n : Nat}
    (p : Plays a m b) (q : Plays b n c) : Plays a (m+n) c := by
  induction q with
  | refl => simpa using p
  | snoc q s hs ih =>
    simpa [Nat.add_assoc] using Plays.snoc ih s hs

end Plays

def replay : Board → List Step → Option Board
  | b, [] => some b
  | b, s :: ss =>
    match step b s with
    | none => none
    | some c => replay c ss

theorem replay_sound {b c : Board} {ss : List Step} (h : replay b ss = some c) :
    Plays b ss.length c := by
  induction ss generalizing b c with
  | nil =>
    simp only [replay, Option.some.injEq] at h
    subst c
    exact Plays.refl
  | cons s ss ih =>
    cases hs : step b s with
    | none => simp [replay, hs] at h
    | some d =>
      have ht : replay d ss = some c := by simpa [replay, hs] using h
      have p : Plays b 1 d := Plays.snoc Plays.refl s hs
      have q := ih ht
      simpa [List.length_cons, Nat.add_comm] using Plays.append p q

end Game2048
