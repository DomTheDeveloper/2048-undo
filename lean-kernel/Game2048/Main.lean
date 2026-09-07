import Game2048.LowerBound
import Game2048.Generated.Certificate

namespace Game2048

/-- A concrete, legal 32,781-round play reaches 131072 from an ordinary opening. -/
theorem reachable_131072 :
    ∃ initial terminal : Board,
      IsInitial initial ∧ Plays initial 32781 terminal ∧ terminal.Contains 131072 := by
  exact ⟨Cert131072.initial, Cert131072.terminal,
    Cert131072.start_valid, Cert131072.certified_play, Cert131072.contains_terminal⟩

/-- Complete exact-optimum statement for standard 4 x 4 2048.

The first conjunct is a kernel-checked constructive witness.
The second quantifies over ALL ordinary two-tile openings and ALL legal
plays, not just the shipped certificate, a snake policy, or all-4 spawns.
A round includes the obligatory spawn after the slide. Continuing past
2048 is allowed; no undo, reset, or board-edit operation exists in Plays.
-/
theorem standard2048_exact_131072 :
    (∃ initial terminal : Board,
      IsInitial initial ∧ Plays initial 32781 terminal ∧ terminal.Contains 131072)
    ∧
    (∀ (initial terminal : Board) (rounds : Nat),
      IsInitial initial → Plays initial rounds terminal → terminal.Contains 131072 →
      32781 ≤ rounds) := by
  constructor
  · exact reachable_131072
  · intro initial terminal rounds hi hp ht
    exact lower_bound_131072 hi hp ht

#print axioms reachable_131072
#print axioms standard2048_exact_131072

end Game2048
