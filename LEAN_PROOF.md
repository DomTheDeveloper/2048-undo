# Lean proof: 131072 in exactly 32,781 rounds

## Reproduce

With Python 3 and the pinned Lean toolchain installed, run from the repository:

```sh
bash check-lean.sh
```

The toolchain is pinned by `lean-toolchain` to Lean 4.19.0. No Mathlib or
third-party Lean package is required. The script rebuilds the handwritten
modules, generates the certificate modules, checks every transition with
Lean's kernel, compiles the final theorem, checks its axiom dependencies,
and writes `lean/verification.json` only after all checks succeed.

The main theorem is `Game2048.standard2048_exact_131072` in
`lean/Game2048/Main.lean`:

```lean
(∃ initial terminal : Board,
  IsInitial initial ∧ Plays initial 32781 terminal ∧
  terminal.Contains 131072)
∧
(∀ (initial terminal : Board) (rounds : Nat),
  IsInitial initial → Plays initial rounds terminal →
  terminal.Contains 131072 → 32781 ≤ rounds)
```

This is both an attained upper bound and a universal lower bound, not just
a statement that a particular transcript passed a Boolean check.

## Rules and scope

`Basic.lean` defines a 4×4 board with natural-number tile values. `Ix` has
exactly four constructors. A row slide removes zeros, merges equal adjacent
inputs once, and pads with zeros; a newly created tile cannot merge again
in the same slide. Columns are handled by transposition. The recursive
merge evaluator is proved to satisfy a separate declarative `PairMerge`
relation. `Row.left_length` proves that padding never truncates a tile.

A `Step` has a direction, row, column, and value. It is accepted only if:

* the value is 2 or 4;
* the slide changes the board;
* the chosen cell is empty after the slide.

Exactly one tile is then inserted. A round includes this obligatory spawn.
There is no undo, restart, deletion, arbitrary board edit, selective line
move, or multiple-merge-per-tile operation in `Plays`.

`IsInitial` permits all choices of two distinct cells and two values from
{2,4}. The certificate uses two 4s in cells (3,2) and (3,3). The lower bound
quantifies over **every** ordinary opening, including two-2 openings, and
over **all** legal plays, not just snake strategies or all-4 spawns.
Continuation after first obtaining 2048 is allowed.

The result concerns existential possible play. It does not assert that a
player can force the spawn sequence, win with probability one, or achieve
an optimal expected score. Every finite transcript of permitted random
outcomes has positive probability under the usual random-spawn model;
that probability interpretation is not separately formalized here.

This development does not claim to formalize the whole paper. In particular,
it does not prove the maximum-score bound, the longest-game bound, a
uniform strategy on arbitrary rectangles, or impossibility of tiles larger
than 131072. Its exact theorem is reachability and minimum round count for
the target 131072 on the standard 4×4 board.

## Universal lower bound: threshold mass

For a board B and threshold k, define H_k(B) to be the sum of the values of
tiles strictly greater than k. A slide satisfies

    H_(2k)(slide(B)) ≤ H_k(B).

A merged pair crosses threshold 2k only if each input already exceeded k;
an unmerged tile counted on the left is counted on the right. Since each
tile can merge only once in a slide, no repeated doubling is possible in
one round. For k≥2 a newly spawned 2 or 4 contributes nothing above 2k,
so the inequality also holds for a complete round.

`cutoff n = 2^(n+1)`. Iterating the inequality through the last k rounds,
and using the bound of four new mass units per earlier round, proves

    H_(cutoff k)(terminal) ≤ initial.mass + 4*(rounds-k)

when k≤rounds. The remaining case rounds<k is handled by a separate
latency inequality, rather than silently assuming enough rounds exist.
For a 131072 target take k=15, so cutoff k=65536. All standard openings
have mass at most 8, giving

    131072 ≤ 8 + 4*(rounds-15),
    rounds ≥ 32781.

`LowerBound.lean` proves this without assuming a primed configuration,
merge-tree ancestry, a snake invariant, or a particular spawn policy.
The same development proves the 519-round lower bound for 2048 and a
general target/deadline inequality.

## Constructive upper bound: kernel-checked transcript

The source is `witness/131072.txt`, SHA-256:

```
4f49c437f0946f17b6afb9c4c97c62ef1a44ee7595ad75888d3806c3291afe9e
```

`lean/build_certificate.py` proposes each concrete intermediate board and
emits one ordinary Lean theorem per transition, of the form

```lean
theorem next_prefix : Plays block_start n next_board :=
  Plays.snoc previous_prefix prescribed_step (by decide +kernel)
```

The `decide +kernel` proof checks the full step function in the kernel,
not by native compilation or by trusting Python's answer. Transition
proofs are grouped into bounded modules and composed with `Plays.append`.
The final certificate proves a legal play of exactly 32,781 rounds and
that its terminal board contains 131072. It also records the legal
32,766-round prefix ending at the primed board.

Python's independent replay reports eight spawned 2s and 32,775 spawned
4s (including the opening), and score 1,966,092. These bookkeeping outputs
are not presented as separate Lean score theorems.

## Audit and trust boundary

The builder prints and checks the transitive axiom dependencies of
`certified_play`, `reachable_131072`, and `standard2048_exact_131072`.
Only the standard foundational axioms `propext`, `Classical.choice`, and
`Quot.sound` are allowed. Source scans reject unfinished proofs and
native decision shortcuts; the final axiom whitelist rejects compiler-
trusted evaluation and any other custom axiom.

A negative test deliberately fabricates a move on an empty board. Lean
must reject it. Successful compilation of a false-looking input is not
silently treated as a valid test result.

The generator and Python replay are untrusted proof producers. Incorrect
intermediate boards cannot establish the theorem unless the corresponding
Lean step checks succeed. The remaining mathematical trust boundary is
Lean's logic and kernel, the correctness of the pinned toolchain, and
human review that the formal rule definitions express standard 2048.
No claim of absolute historical priority or peer review is made here.

Generated Lean source is kept under `lean/Game2048/Generated/` and is
included in the GitHub Actions audit artifact. Generated source is
reproducible; precompiled `.olean` files are not used as external evidence.
