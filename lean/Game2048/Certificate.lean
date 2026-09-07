import Game2048.WitnessData

namespace Game2048
open WitnessData

/-- The committed standard-game witness is a legal 32,781-move play. -/
theorem certificate_replays :
    replay witnessStart witnessSteps = some cp129 :=
  witness_replay

/-- The committed witness has exactly 32,781 moves. -/
theorem certificate_length : witnessSteps.length = 32781 :=
  witness_length

/-- The final state of the committed witness contains a 131072 tile. -/
theorem certificate_has_131072 : containsRank cp129 17 = true :=
  witness_has_131072

/-- Constructive reachability in the exact standard 4x4 operational semantics. -/
theorem reachable_131072_in_32781 :
    ∃ steps final,
      steps.length = 32781 ∧
      replay witnessStart steps = some final ∧
      containsRank final 17 = true := by
  exact ⟨witnessSteps, cp129, certificate_length,
    certificate_replays, certificate_has_131072⟩

end Game2048
