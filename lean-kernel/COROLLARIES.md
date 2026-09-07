# Additional kernel-checked results

These additions were compiled locally with Lean 4.19.0 against a complete
local rebuild of the 32,781-move kernel certificate. The core proof,
semantics, generator and witness are unchanged. The full core theorem
also passed GitHub Actions run 34092192490; see AUDIT.md.

## Two starting 2s: exact minimum 32,782

`Game2048.standard2048_two_twos_exact` in `Game2048/Corollaries.lean`
proves both existence in 32,782 legal rounds and impossibility in fewer
rounds from any opening with two 2s.

The construction is simple: place the two initial 2s at (3,2) and (3,3).
Slide right, merging them into 4 at (3,3), then spawn 4 at (3,2).
This is exactly the initial board of the original 32,781-round witness.
One round followed by that certificate gives 32,782.

The mathematical lower bound is `lower_bound_two_twos`. The threshold-mass
proof gives `131072 + 4*15 <= initial_mass + 4*rounds`; initial mass is at
most 4 here, so at least 32,782 rounds are necessary.

This does not claim that every arrangement of the two starting 2s attains
the bound. Existence uses the specified arrangement; the lower bound
covers all arrangements.

## General rank bounds and exact semantics

`PowerBounds.lean` proves `2^(r-2) + r <= rounds + 4` for any target rank
`r >= 4` on this board. `TwoTwos.lean` also proves that any 32,781-round
success must start with mass exactly 8.

`SemanticsChecks.lean` proves exact mass conservation through slides and
legal rounds, and checks merge ordering, non-chaining merges, and invalid
moves/spawns. For example `[2,2,4,0]` slides left to `[4,4,0,0]`, not `[8,0,0,0]`.

## Actual local axiom audit

```text
'Game2048.lower_bound_power' depends on axioms: [propext, Quot.sound]
'Game2048.lower_bound_rank' depends on axioms: [propext, Quot.sound]
'Game2048.Board.slide_mass_eq' depends on axioms: [propext, Quot.sound]
'Game2048.step_mass_exact' depends on axioms: [propext, Quot.sound]
'Game2048.lower_bound_two_twos' depends on axioms: [propext, Quot.sound]
'Game2048.optimal_initial_mass' depends on axioms: [propext, Quot.sound]
'Game2048.standard2048_two_twos_exact' depends on axioms: [propext, Quot.sound]
'Game2048.standard2048_exact_131072' depends on axioms: [propext, Quot.sound]
```

The concrete original certificate and `reachable_131072` continue to have
no axiom dependencies. There are no unfinished proofs, custom axioms, or
native-evaluation/compiler-trust assumptions in these theorem dependencies.

Rebuild from the repository root with `bash lean-kernel/check.sh`.
This requires every module, checks every concrete transition, composes the
full proof, and audits the core and supplementary theorem dependencies.
No Mathlib dependency is needed. It writes `lean-kernel/verification.json`
only after the core verification, and augments that report with the
separately checked two-2s corollary. A failed command exits nonzero.
