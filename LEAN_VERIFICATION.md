# Completed Lean kernel verification

The complete 131072 reachability and exact-minimum proof passed the pinned
Lean 4.19.0 kernel audit. This is the full 32,781-round certificate, not the
separate sampled-move smoke test.

- Verified proof commit: `86bd902861306f43a5697edcf86ccd3f96028aef`
- Successful full run: https://github.com/DomTheDeveloper/2048-undo/actions/runs/34092192490
- Job: `101647913133`
- Final theorem checked: September 7, 2026 at 06:57:21 UTC
  (September 6, 2026 at 23:57:21 America/Los_Angeles).
- Toolchain: `Lean (version 4.19.0, x86_64-unknown-linux-gnu, commit 6caaee842e94, Release)`
- Proof source and log artifact: https://github.com/DomTheDeveloper/2048-undo/actions/runs/34092192490/artifacts/10007565658
- Artifact ZIP SHA-256: `023e48b3299f537262e3caef4100f018a68d17aa974e67b1c4924c2b44b808a9`

The proof files and certificate generator were unchanged by the subsequent
addition of reproduction instructions, toolchain pin, smoke tests, ignore
rules, and this audit record.

## Actual final audit output

```text
Game2048/Generated/Certificate.lean: exit 0
'Game2048.Cert131072.certified_play' does not depend on any axioms

Game2048/Main.lean: exit 0
'Game2048.reachable_131072' does not depend on any axioms
'Game2048.standard2048_exact_131072' depends on axioms: [propext, Quot.sound]

KERNEL VERIFIED: 131072 is reachable in 32781 rounds, and no legal play is shorter.
```

Both universal lower bounds compiled too:

```text
'Game2048.lower_bound_131072' depends on axioms: [propext, Quot.sound]
'Game2048.lower_bound_2048' depends on axioms: [propext, Quot.sound]
```

`propext` and `Quot.sound` are standard Lean foundational axioms. There are
no problem-specific assumptions, unfinished proofs, or compiler-trust
axioms in these theorem dependencies. The reachability theorem has no
axiom dependencies at all.

## What was checked

All 32,781 prescribed slides and subsequent spawns were checked individually
with `decide +kernel`, then composed into 258 blocks across 17 generated
modules. Every module exited successfully. The final proof establishes:

1. A standard opening has a legal 32,781-round play ending with 131072.
2. For every standard opening and every legal play ending with 131072,
   the round count is at least 32,781.

The second statement is a mathematical theorem about arbitrary legal plays,
not an exhaustive-search claim and not an assumption about the witness.
The upper-bound witness starts with two 4s; the lower bound covers all
ordinary two-tile openings. This is an existential optimum over openings,
not a claim that every opening attains that same minimum.

The input witness is `witness/131072.txt`, SHA-256
`4f49c437f0946f17b6afb9c4c97c62ef1a44ee7595ad75888d3806c3291afe9e`.
Its final board is:

```text
4  2  4       2
2  4  8       4
4  2  4       2
2  0  0  131072
```

A deliberate false claim that a slide of an empty board is a legal round
was rejected by Lean with the diagnostic that the proposition is false.
The Python producer's independent bookkeeping also reports 8 spawned 2s,
32,775 spawned 4s (including the opening), and score 1,966,092. These score
and spawn counters are not advertised as separate Lean theorems.

## Rebuild and scope

Run `bash check-lean.sh`; see `LEAN_PROOF.md` for definitions, the threshold-
mass lower-bound argument, and the trust boundary.

The implemented theorem proves reachability and optimal round count for
the 131072 target on the fixed 4×4 board. It does not formalize the entire
paper, an optimal expected-score strategy, the maximum-score bound, the
largest-tile upper bound, or reachability on every rectangular or
higher-dimensional board. No claim of historical priority follows merely
from successful compilation.
