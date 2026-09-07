# Completed full kernel audit

The whole proof, not just a smoke test, passed at commit
`86bd902861306f43a5697edcf86ccd3f96028aef`.

- Run: https://github.com/DomTheDeveloper/2048-undo/actions/runs/34092192490
- Job: `101647913133`
- Final theorem accepted: September 7, 2026, 06:57:21 UTC
  (September 6, 2026, 23:57:21 America/Los_Angeles).
- Lean: `4.19.0`, `x86_64-unknown-linux-gnu`, commit `6caaee842e94`, Release.
- Full source/log artifact: https://github.com/DomTheDeveloper/2048-undo/actions/runs/34092192490/artifacts/10007565658
- Artifact ZIP SHA-256: `023e48b3299f537262e3caef4100f018a68d17aa974e67b1c4924c2b44b808a9`.

All 32,781 transition proofs, 258 composed blocks, and 17 generated modules
compiled successfully. The final compilation output was:

```text
Game2048/Generated/Certificate.lean: exit 0
'Game2048.Cert131072.certified_play' does not depend on any axioms

Game2048/Main.lean: exit 0
'Game2048.reachable_131072' does not depend on any axioms
'Game2048.standard2048_exact_131072' depends on axioms: [propext, Quot.sound]

KERNEL VERIFIED: 131072 is reachable in 32781 rounds, and no legal play is shorter.
```

The separately compiled universal lower bounds report:

```text
'Game2048.lower_bound_131072' depends on axioms: [propext, Quot.sound]
'Game2048.lower_bound_2048' depends on axioms: [propext, Quot.sound]
```

The negative kernel test was rejected with Lean's diagnostic that the
proposed empty-board transition is false.

## Exact source identity after relocation

The verified files were moved from `lean/` to `lean-kernel/` to avoid
colliding with concurrent work. The following Git blob IDs are unchanged:

| File | Git blob |
| --- | --- |
| `Game2048/Basic.lean` | `47c32435a864156d152c3747459ec01446882ccc` |
| `Game2048/LowerBound.lean` | `c292c8108ae7b299f7b406a1c3f68fbdf5610b70` |
| `Game2048/Main.lean` | `ac54df4941b57d58cf3c32ac2f50a6801eb320ea` |
| `build_certificate.py` | `4fdd19d71bbc96abb9be0d1619d487c0813afd9e` |

`witness/131072.txt` SHA-256:
`4f49c437f0946f17b6afb9c4c97c62ef1a44ee7595ad75888d3806c3291afe9e`.

Its final board is:

```text
4  2  4       2
2  4  8       4
4  2  4       2
2  0  0  131072
```

The Python producer's additional accounting reports eight spawned 2s,
32,775 spawned 4s including the opening, and score 1,966,092. These counters
are not claimed as separate Lean score theorems.

Rebuild with `bash lean-kernel/check.sh`. The generated proof source is
available in the full audit artifact and is reproducible from the witness.
