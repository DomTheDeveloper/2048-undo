import Std
import Std.Tactic

namespace Game2048

/--
Source ids encode the only tiles that can enter a standard game:
0 and 1 are the two initial tiles; source k+2 is the tile spawned
at the end of move k+1.  Thus at most c+2 distinct sources exist
by move c.
-/
def sourceTime (source : Nat) : Nat :=
  if source < 2 then 0 else source - 1

theorem source_lt_time_add_two (source : Nat) :
    source < sourceTime source + 2 := by
  unfold sourceTime
  split
  · omega
  · omega

/-- The ancestry of one tile. Internal nodes record the move on which the merge occurred. -/
inductive MergeTree where
  | leaf (source rank : Nat)
  | merge (time : Nat) (left right : MergeTree)
  deriving Repr

namespace MergeTree

def rank : MergeTree → Nat
  | .leaf _ r => r
  | .merge _ l _ => l.rank + 1

def createdAt : MergeTree → Nat
  | .leaf s _ => sourceTime s
  | .merge t _ _ => t

def sources : MergeTree → Finset Nat
  | .leaf s _ => {s}
  | .merge _ l r => l.sources ∪ r.sources

/--
A valid ancestry uses only spawned 2/4 leaves; merges equal-valued children;
a child must exist strictly before the move that merges it; and the two
children have disjoint source tiles.  Geometry is deliberately omitted,
so this is a relaxation of standard 2048: every actual tile history is valid
here, while some histories admitted here may be geometrically impossible.
-/
inductive Valid : MergeTree → Prop where
  | leaf (source rank : Nat) (hrank : rank = 1 ∨ rank = 2) :
      Valid (.leaf source rank)
  | merge (time : Nat) (left right : MergeTree)
      (hl : Valid left) (hr : Valid right)
      (heq : left.rank = right.rank)
      (hlt : left.createdAt < time)
      (hrt : right.createdAt < time)
      (hdisj : Disjoint left.sources right.sources) :
      Valid (.merge time left right)

private theorem rank_pos {tr : MergeTree} (h : tr.Valid) : 0 < tr.rank := by
  induction h with
  | leaf source r hrank =>
      rcases hrank with rfl | rfl <;> decide
  | merge time l r hl hr heq hlt hrt hdisj ihl ihr =>
      simp [rank]

/-- A rank-r tile needs enough distinct source tiles: 2^r <= 4 * #sources. -/
theorem value_le_four_mul_sources {tr : MergeTree} (h : tr.Valid) :
    2 ^ tr.rank ≤ 4 * tr.sources.card := by
  induction h with
  | leaf source r hrank =>
      rcases hrank with rfl | rfl <;> simp [rank, sources]
  | merge time l r hl hr heq hlt hrt hdisj ihl ihr =>
      have ihr' : 2 ^ l.rank ≤ 4 * r.sources.card := by
        simpa [heq] using ihr
      have hcard : (l.sources ∪ r.sources).card = l.sources.card + r.sources.card :=
        Finset.card_union_of_disjoint hdisj
      simp only [rank, sources, Nat.pow_succ]
      rw [hcard]
      omega

/--
Causality: every source leaf of a rank-r tile was born early enough to
survive r-2 successive doublings.  This is the formal "one doubling per
move" part of the paper's minimum-move argument.
-/
theorem source_delay {tr : MergeTree} (h : tr.Valid) :
    ∀ s ∈ tr.sources, sourceTime s + (tr.rank - 2) ≤ tr.createdAt := by
  induction h with
  | leaf source r hrank =>
      intro s hs
      simp [sources] at hs
      subst s
      rcases hrank with rfl | rfl <;> simp [rank, createdAt]
  | merge time l r hl hr heq hlt hrt hdisj ihl ihr =>
      intro s hs
      simp only [sources, Finset.mem_union] at hs
      rcases hs with hs | hs
      · have hd := ihl s hs
        have hp := rank_pos hl
        simp only [rank, createdAt]
        omega
      · have hd := ihr s hs
        have hp := rank_pos hr
        have heq' : r.rank = l.rank := heq.symm
        simp only [rank, createdAt]
        omega

/-- Every source of a rank-17 tile created at move T lies among the first T-15 moves plus the starts. -/
theorem rank17_sources_subset {tr : MergeTree} (h : tr.Valid)
    (hrank : tr.rank = 17) :
    tr.sources ⊆ Finset.range (tr.createdAt - 15 + 2) := by
  intro s hs
  have hd := h.source_delay s hs
  rw [hrank] at hd
  have htime : sourceTime s ≤ tr.createdAt - 15 := by omega
  apply Finset.mem_range.mpr
  have hsrc := source_lt_time_add_two s
  omega

/-- A valid rank-17 ancestry cannot finish before move 32,781. -/
theorem rank17_minimum_moves {tr : MergeTree} (h : tr.Valid)
    (hrank : tr.rank = 17) :
    32781 ≤ tr.createdAt := by
  have hvalue := h.value_le_four_mul_sources
  rw [hrank] at hvalue
  norm_num at hvalue
  have hsub := h.rank17_sources_subset hrank
  have hcard := Finset.card_le_card hsub
  simp only [Finset.card_range] at hcard
  omega

end MergeTree

end Game2048
