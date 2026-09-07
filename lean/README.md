# Lean 4 proof: 131072 is reachable in exactly 32,781 moves

This development proves both halves of the exact minimum-move result for
standard 4 x 4 2048, allowing continuation after reaching the 2048 tile:

* There exists a legal play of 32,781 rounds, from an ordinary two-tile
  initial board, that contains a 131072 tile.
* Every legal play from every ordinary two-tile initial board needs at
  least 32,781 rounds to contain that tile.

The theorem is `Game2048.standard2048_exact_131072` in
`Game2048/Main.lean`. Its lower-bound quantifiers range over all legal
plays and all initial placements and values, not just the certificate,
all-4 spawning, snake arrangements, or an abstract ancestry model.

## Reproduce

Install Lean through elan, then run from the repository root:

```sh
bash lean/run.sh
```

`lean/lean-toolchain` pins Lean 4.19.0. Mathlib is not required. The script
compiles the rules, the universal lower bound, a declarative merge-rule
specification, exact mass conservation, and regression tests. It then
checks the complete witness and audits the resulting theorems. A negative
test requires Lean to reject a transition that spawns into an occupied cell.

The build produces `lean/verification.json`, diagnostic logs, and the
complete generated Lean source in `lean/Game2048/Generated/`.
`LEAN_JOBS=2` is the default; set it to 1 to reduce concurrent memory use.
Generated `.olean` files are build outputs, not trusted certificates that
need to be downloaded.

## Certificate and trust

The input is the original `witness/131072.txt`, SHA-256:

```
4f49c437f0946f17b6afb9c4c97c62ef1a44ee7595ad75888d3806c3291afe9e
```

It starts with 4s at (row 3, column 2) and (row 3, column 3). Coordinates
are zero-based. Python proposes intermediate boards and writes Lean
source. For each of the 32,781 rounds, Lean checks the exact successor
by equality reflexivity (`rfl`). A bad move, bad spawn, or mismatched
intermediate board cannot yield the generated proof. The source-file hash
records provenance; it is not a substitute for checking the transitions.

The verified axiom audit is:

```
'Game2048.Cert131072.certified_play' does not depend on any axioms
'Game2048.reachable_131072' does not depend on any axioms
'Game2048.standard2048_exact_131072' depends on axioms: [propext, Quot.sound]
```

There are no unfinished proofs, custom axioms, native-evaluation oracles,
or assumed bridges from the actual game to an abstract model. The two
axioms in the final theorem are standard foundational axioms of Lean.

## How the lower bound works

Let H_k(B) be the sum of tiles strictly greater than k. A slide satisfies
H_(2k)(slide(B)) <= H_k(B). Since a new tile is at most 4, for k >= 2 the
same inequality holds after the spawn. Iterating this through the final
15 rounds shows that a terminal 131072 tile requires 131072 units of
mass to have been present 15 rounds earlier. There is at most 8 starting
mass and at most 4 new mass per round, so

```
131072 <= 8 + 4 * (T - 15), hence T >= 32781.
```

The formal proof also handles T < 15 rather than assuming that case away.
`Semantics.lean` separately proves that the row implementation obeys a
declarative, non-chaining pair-merge relation and that slides conserve
mass exactly.

## Scope

A round is a nontrivial slide followed by exactly one spawn of 2 or 4 in
an empty square. No undo, restart, direct board edit, or removal action
exists in `Plays`. The existence result concerns favorable legal spawn
outcomes; it is not a winning strategy for every random outcome.

This proves the 131072 reachability/minimum-moves result. It does not
strongly solve 4 x 4 2048, prove the maximum-score conjecture, or establish
a uniform strategy for arbitrary board sizes. No priority claim is made
by this formal development.
