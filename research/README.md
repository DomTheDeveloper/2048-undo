# Research extension: mass barriers and certified arrangements

Baseline: `c14c2585938fb3e1c083d57fc32cd8c68c8280bc` in `DomTheDeveloper/2048-undo`.
The original Lean-certified 131072 optimum, original witnesses, and completed
2x5 enumeration are retained. This directory adds the results below.

## Resolved questions from the earlier manuscript

Two complete 65,533-round witnesses reach full chains with (a) 4 in the corner
opposite 131072 and (b) 131072 in a noncorner boundary cell. Both round counts
are minimum by the mass ledger. Sixteen base constructions, all replayed by
both independent checkers with exact endpoints checked, have 128 distinct
images under square symmetry. The largest tile occurs at every boundary cell.
This is a lower bound on the number of reachable arrangements, NOT a complete
classification. Interior placement in a full chain remains unresolved here.

`arrangement_endings.py` enumerates the 16-round all-4 suffix (199 states,
eight endpoints). `noncorner-splice.json` records a 70-round legal bridge
between checkpoints 49166 and 49236 of a reflected, inert-label-permuted
suffix. `spliced_certificates.py` reconstructs all sixteen games without
heuristic search and invokes both independent verifiers. It writes the two
representative plaintext witnesses and the complete endpoint report.

## Conventional proofs in paper/deductions.tex

In mass units of 2, a c-cell board with popcount(m)=c is full and has distinct
tiles, hence cannot move. A play must skip each lower terminal barrier with
a 4-spawn. This gives a second proof of the mass, score, and game-length
ceilings and a fixed spawn-value word equivalent to attainment of the 4x4
score ceiling. The legal geometry for that word is NOT yet constructed.

For one honest game, with 4-probability p and independent spawn types, we
solve the necessary mass-only crossing process:

- Top-tile probability <= p/(1+p) * (1+p^(2^c-1)).
- Full-chain probability <= product(j=1..c) p/(1+p)*(1+p^(2^j-1)).
- A generating function additionally tracks the number of 4s and thus score
  and game length at the full chain.
- A scalar mass Bellman recurrence yields upper bounds on optimal expected
  score and length. For standard 4x4: score < 1,915,854.958 and mean length
  < 62,412.330. These are upper bounds, NOT a strong solution.

`mass_barriers.py` checks the product and every generating-function
coefficient against a separate exact rational dynamic program for c=2..6.
`mass_interval.py` evaluates the Bellman recurrence with 50-digit outward
rounding. It supplies enclosing intervals, not a proof-assistant audit of
Python arithmetic. Initial random spawns count in all probability calculations;
undo, restarts, and deliberately selecting favourable starting values do not.

## New kernel-checked deterministic result

`lean-kernel/Game2048/DeadlineSlack.lean` proves the exact prefix mass ledger,
a general target/prefix budget inequality, and the 131072 deadline inequality:

    2 * earlyTwos(prefix) + (8 - opening.mass) <= 4*d

for any actual legal replay whose prefix has 32766+d rounds and whose final
15 rounds reach 131072. Thus at most 2*d of the first 32768+d spawn events,
including the opening, can be 2s. The binomial probability corollary in the
paper is a conventional mathematical deduction, not a Lean probability proof.
The new theorem dependencies are recorded in `deadline-axioms.json`; they use
only standard foundational Lean axioms. No original proof statement is weakened.

## Corrections and historical credit

The old score theorem's equality clause was too restrictive: replacing the
last spawned 4 by a 2 preserves the score and length. The corrected theorem
allows both endings. `score_equality_test.py` independently enumerates all
662 raw 2x2 states and produces a 24-round, 180-point counterexample ending
with [32,8;16,2]. The separate dual-rules checker replays that certificate.

Marco Ripa's 14 June 2014 Matematicamente article already gives the numerical
score formula, the 131052-move figure, and the rare score-ceiling value-word
probability; OEIS A244056 and the 3 July 2014 Qiita account are also credited.
We do not claim those numerical formulas as new, or infer priority from
successful compilation. The failed naive snake is not a disproof of Das-Paul.
The manuscript's minimum-undo discussion was corrected as well: for one
prescribed cell the expected cost e/q-1 increases with e, not decreases.

## Reproduce

With Python 3, Node, and pinned Lean 4.19.0:

```sh
bash research/check.sh
cd paper && latexmk -pdf main.tex
```

No Mathlib is required. These checks rebuild the new deterministic lemmas,
not the previously audited 32781-step Lean certificate. The original formal
proof inputs are unchanged. The checks do not rerun the billion-state 2x5
solve and do not prove attainability of the 4x4 maximum-score conjecture.
