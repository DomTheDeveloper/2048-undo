import Game2048.LowerBound
import Game2048.Certificate

namespace Game2048

/--
The exact 131072 result, split along the natural trust boundary.

* The left conjunct is constructive and uses the executable standard 4x4
  rules: the committed witness is a legal 32,781-move play ending in rank 17.
* The right conjunct is the universal lower bound in a relaxation of 2048
  that forgets geometry but retains the merge ancestry of every real tile.
  Hence any standard-game rank-17 tile also needs at least 32,781 moves.
-/
theorem exact_131072_certificate_and_lower_bound :
    (∃ steps final,
      steps.length = 32781 ∧
      replay witnessStart steps = some final ∧
      containsRank final 17 = true) ∧
    (∀ tr : MergeTree, tr.Valid → tr.rank = 17 → 32781 ≤ tr.createdAt) := by
  constructor
  · exact reachable_131072_in_32781
  · intro tr hvalid hrank
    exact MergeTree.rank17_minimum_moves hvalid hrank

end Game2048
