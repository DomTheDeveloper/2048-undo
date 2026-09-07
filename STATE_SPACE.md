# The reachable state space of continued 4x4 2048

This note separates three questions that are often conflated:

1. **labeled positions**: the 16 board cells are distinct;
2. **positions modulo the eight symmetries of the square** (`D4` orbits);
3. **afterstates**: boards after the slide/merges but before the mandatory 2/4 spawn.

The counts below concern ordinary **post-spawn positions**, including the ordinary two-tile openings. Continued play is allowed after 2048. The exact number of reachable 4x4 positions is still open; the purpose of this note is to prove a finite structural envelope that any exact enumeration must lie inside.

The executable counts are in:

```sh
python3 test/state_space_bounds.py
node verify/verify_state_space_bounds.js
```

The two programs are independent implementations (Python arbitrary-precision integers and Node `BigInt`) and assert the same exact integers.

## 1. Age and a finite endpoint

For a board `B`, write

\[
A(B)=\sum_{x\in B}x
\]

for its **mass** (called the *age* in the exact-solving literature). A legal slide/merge preserves mass, and the mandatory spawn increases it by exactly 2 or 4. Thus the post-spawn state graph is a directed acyclic graph graded by mass.

### Theorem 1 (age barrier)

On a standard 2048 board with `c >= 2` cells,

\[
A(B)\le 2^{c+2}-4
\]

for every reachable post-spawn position `B`. Consequently no tile can exceed `2^(c+1)`.

For 4x4,

\[
\boxed{A(B)\le262140},\qquad
\boxed{\max(B)\le131072}.
\]

#### Proof

Every nonzero tile is a power of two: the initial/spawned values are 2 and 4, and merging two equal powers of two produces the next power of two.

Put `M = 2^(c+2)` and suppose a play first crosses from mass below `M` to mass at least `M`. Since a round adds 2 or 4 and all masses are even, the preceding post-spawn mass must be `M-2` or `M-4`.

* `M-2 = 2 + 4 + 8 + ... + 2^(c+1)` has binary popcount `c+1`. A sum of at most `c` powers of two has binary popcount at most `c`, so no `c`-cell board has mass `M-2`.
* `M-4 = 4 + 8 + ... + 2^(c+1)` has binary popcount `c`. Any representation of it by at most `c` powers of two must therefore use exactly `c` summands and incur no binary carries. Hence the board is full and its tile multiset is exactly

  \[
  \{4,8,16,\ldots,2^{c+1}\}.
  \]

  All values are distinct and there are no empty cells, so no slide can move a tile and no merge is available. The position is dead and cannot be followed by another spawn.

Neither possible predecessor of a first crossing can cross. Contradiction. Therefore no mass `>= M` is reachable, and the greatest possible mass is at most `M-4`. A tile of value `2^(c+2)` alone would already exceed this mass, so the largest possible tile is at most `2^(c+1)`. QED.

This is an elementary age-layer proof of the upper bound. The paper gives a stronger Strahler/tight-moment proof that also constrains every tile in the final position. The shipped 4x4 certificate supplies the other direction by actually reaching 131072.

A weaker but immediate game-length corollary is that a play beginning at minimum mass 4 has at most `2^(c+1)-4` rounds, because every round adds at least 2 mass. The paper's Strahler/4-spawn argument improves this to `2^(c+1)-4-c` (131,052 on 4x4).

## 2. A rank envelope for every reachable position

Write each nonzero tile as `2^r`, and sort the ranks of an arbitrary reachable position as

\[
r_1\ge r_2\ge\cdots\ge r_m,
\qquad m\le c.
\]

The paper's score theorem proves, by ordering the merge trees by their tight moments, that each final tile can be assigned to a slot `p` with

\[
k_p\le c+1-p+h_p\le c+2-p,
\]

where `h_p` records whether that tile's merge tree contains a spawned 4. Matching the largest ranks to the largest slot bounds gives the following state-only consequence.

### Theorem 2 (rank envelope)

Every reachable `c`-cell position satisfies

\[
\boxed{r_p\le c+2-p\quad(p=1,\ldots,m).}
\]

Equivalently,

\[
\#\{\text{tiles of rank at least }q\}\le c+2-q.
\]

For 4x4 this says

\[
\#\{r\ge q\}\le18-q,\qquad q=2,\ldots,17.
\]

In particular there is at most one 131072 tile, at most two tiles of rank at least 16, at most three of rank at least 15, and so on. The full chain `131072,65536,...,4` is the unique multiset that saturates every inequality.

#### Why sorting is legitimate

The tight-moment proof gives some assignment of tiles to decreasing capacities `c+1,c,...`. If the `j`-th largest rank exceeded `c+2-j`, then at least `j` tiles would exceed the capacity of every slot numbered `j` or later, but there are only `j-1` earlier slots. No assignment could exist. Thus the sorted inequalities are necessary.

## 3. The last-spawn geometric filter

The rank envelope ignores geometry. There is a second necessary condition that comes directly from the global-slide rule.

Call a board **compact toward a wall** when, in every row (left/right) or every column (up/down), all nonempty cells form a contiguous block against that wall.

### Theorem 3 (last-spawn normal form)

Let `B` be any post-spawn position reached after at least one ordinary round. Then `B` contains a 2 or 4 in a cell `x` such that deleting `x` leaves a board compact toward at least one of the four walls.

#### Proof

Take the last round. It consists of a nontrivial slide in some direction `d`, followed by one spawn `s in {2,4}` in an empty cell `x`. Delete that newest tile from `B`. The resulting board is exactly the afterstate of the slide. A slide packs every row/column parallel to `d` against the destination wall, so the afterstate is compact toward that wall. QED.

This formalizes the geometric obstruction noted by Jonathan Lees-Miller in 2017: many boards satisfy tile-count/mass restrictions but cannot possibly be the result of a previous global swipe.

There are only `2^16 = 65,536` occupancy masks. Exactly **11,743** masks with at least two occupied cells have at least one cell whose deletion leaves a compact mask. The remaining work is exact integer counting of rank assignments under Theorem 2.

## 4. Exact counts of the proven supersets

The scripts perform the following finite dynamic program.

For a fixed occupancy mask with `m` occupied cells and `a` cells eligible to be the last spawn, ranks 17 down to 3 are placed subject to the cumulative constraints

\[
\#\{r\ge q\}\le18-q.
\]

Every unfilled occupied cell then receives rank 1 or 2. At least one of the `a` eligible cells must remain for that low rank. This counts every value assignment satisfying Theorems 2 and 3, without attempting to decide whether its predecessor was itself reachable.

### Rank envelope alone

Requiring only Theorem 2, at least two occupied cells, and the fact that every post-spawn position contains a 2 or 4 gives

\[
\boxed{42,680,958,038,114,579,072}
\]

labeled boards.

Burnside's lemma over the eight elements of `D4` gives exactly

\[
\boxed{5,335,119,967,984,859,212}
\]

symmetry classes in this rank-envelope superset.

### Rank envelope + last-spawn geometry

For positions reached after at least one round, imposing Theorem 3 reduces the finite superset to

\[
23,408,633,018,322,063,456
\]

labeled boards and

\[
2,926,079,231,642,763,759
\]

`D4` orbits.

There are 480 ordinary labeled two-tile openings. Exactly 24 of them (six `D4` orbits) lie outside the last-spawn geometric set, because openings do not themselves need a previous slide. Adding only those missing openings gives the final rigorous bounds

\[
\boxed{N_{\rm labeled}\le
23,408,633,018,322,063,480}
\]

and

\[
\boxed{N_{/D_4}\le
2,926,079,231,642,763,765}.
\]

These are **upper bounds on the full continued-play 4x4 reachable state space**, not estimates and not exact reachable counts.

The Python and JavaScript implementations independently reproduce the following Burnside fixed-point counts (element order: identity, 90-degree rotation, 180, 270, vertical reflection, horizontal reflection, the two diagonal reflections):

```text
rank envelope:
42,680,958,038,114,579,072
15,664
2,271,276,544
15,664
2,271,276,544
2,271,276,544
849,475,216,832
849,475,216,832

rank + last-spawn geometry:
23,408,633,018,322,063,456
9,616
1,074,436,428
9,616
1,321,984,404
1,321,984,404
415,550,811,074
415,550,811,074

initial-opening corrections:
24, 0, 4, 0, 4, 4, 6, 6
```

The sums are divisible by eight exactly, as Burnside requires.

## 5. What remains open

This does **not** solve the exact 4x4 counting problem. The local conditions above are necessary but not sufficient: a board can have a legal-looking last round whose predecessor is itself unreachable.

The exact route is therefore still layered enumeration by age:

1. canonicalize each position under `D4`;
2. process mass layers in increasing order;
3. a slide preserves age and the spawn sends age `A` only to `A+2` or `A+4`;
4. deduplicate each new layer;
5. retain only the recent open layers needed to generate successors;
6. record both orbit counts and orbit sizes to recover the labeled count;
7. publish per-layer counts and cryptographic digests so independent implementations can certify the computation.

Kaneko and Yamashita used this age decomposition to enumerate **1,152,817,492,752** reachable states of 4x3 2048. Lees-Miller's older 4x4 computation passed **1.3 trillion** symmetry-reduced states without completing the game. The exact full 4x4 count remains the target.

The next stronger *theoretical* filter is also clear. Theorem 3 checks only occupancy compaction. Deleting the proposed last spawn should in fact leave an afterstate that is the output of the exact one-merge-per-tile row/column transition relation. A four-cell line has only `18^4 = 104,976` rank patterns through rank 17, so the inverse-slide relation itself can be tabulated exhaustively and composed with the rank envelope before large-scale enumeration. Repeating this predecessor filter to depth `k` interpolates between the cheap one-round theorem here and full reachability.

## References

- Jonathan Lees-Miller, *The Mathematics of 2048: Counting States with Combinatorics* (2017), and *Counting States by Exhaustive Enumeration* (2017).
- Tomoyuki Kaneko and Shuhei Yamashita, *Strongly Solving 2048 4x3*, arXiv:2510.04580; ICGA Journal 48(1), 2026.
- See `paper/main.tex` for the merge-tree/Strahler proofs, literature discussion, and the certified 131072 trajectory.
