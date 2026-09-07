import Game2048.Main
import Game2048.TwoTwos
import Game2048.PowerBounds
import Game2048.SemanticsChecks

namespace Game2048

/-- One ordinary round turns the selected two-2s start into the certificate's two-4s start. -/
theorem two_twos_to_witness : Plays twoTwosStart 1 Cert131072.initial :=
  Plays.snoc Plays.refl ⟨.right,.i3,.i2,4⟩ (by decide +kernel)

theorem reachable_from_two_twos :
    ∃ initial terminal : Board,
      IsTwoTwos initial ∧ Plays initial 32782 terminal ∧ terminal.Contains 131072 := by
  refine ⟨twoTwosStart, Cert131072.terminal, twoTwosStart_valid, ?_, Cert131072.contains_terminal⟩
  exact Plays.append two_twos_to_witness Cert131072.certified_play

/-- The exact optimum is one round longer when both starting tiles must be 2. -/
theorem standard2048_two_twos_exact :
    (∃ initial terminal : Board,
      IsTwoTwos initial ∧ Plays initial 32782 terminal ∧ terminal.Contains 131072) ∧
    (∀ (initial terminal : Board) (rounds : Nat),
      IsTwoTwos initial → Plays initial rounds terminal → terminal.Contains 131072 →
      32782 ≤ rounds) := by
  constructor
  · exact reachable_from_two_twos
  · intro initial terminal rounds hi hp ht
    exact lower_bound_two_twos hi hp ht

#print axioms standard2048_two_twos_exact
#print axioms standard2048_exact_131072
end Game2048
