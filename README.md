# 2048 Superintelligence
A small clone of [1024](https://play.google.com/store/apps/details?id=com.veewo.a1024), based on [Saming's 2048](http://saming.fr/p/2048/) (also a clone), with Alok Menghrajani's undo mod — and an AI panel on top. [Play it here!](https://domthedeveloper.github.io/2048-undo/)

### 🤖 The AI panel

Hit **RUN AI** and the AI plays the board in front of you. The rows
above the board decide what kind of game that is:

- **TILES** — where the new tiles come from.
  - **😈 EVIL** — AJ Richardson's Evil generator, ported from his
    [2048-AI](https://github.com/aj-r/2048-AI): every new tile lands
    on the edge the last move packed the board against, in the line
    whose nearest neighbours are largest (nothing for it to merge
    with), as a 2 unless those neighbours are 2s — then a 4.
  - **🎲 REGULAR** — honest 2048: a random empty cell, 90% twos.
  - **👑 PERFECT** — the AI places every tile itself: the computed
    perfect line (below), zero undos.
- **UNDO** (regular tiles) — what the undo button is for.
  - **🚫 DISABLED** — the run ends when the board dies.
  - **↩️ REGULAR** — the button as a human uses it: only to escape game
    over. Each death takes back a growing number of moves (1, 2, 4 …
    64) and play resumes with fresh luck; a new best score resets the
    ladder. Forty deaths in a row without a new best and the run is
    *out of luck*.
  - **⚡ PERFECT** — the button as a superpower: every spawn that is not
    on the computed perfect line gets undone and re-rolled, the opening
    pair included (two 4s seated in the corner is a one-in-twelve-
    thousand deal, so the run restarts about 12,000 times before its
    first move). Exactly 32,781 moves and about 1.9 million undos to
    131072, every one of them counted.
- **AI** (honest play) — who moves.
  - **🧠 GENIUS** — this fork's own: a depth-adaptive expectimax over
    row tables (every row and column is one table lookup), scoring
    empty cells, available merges, monotonicity and tile sum in the
    nneonneo tradition, with a pull toward your corner. Against Evil
    tiles it searches the Evil rule itself instead of averaging over
    luck.
  - **🎓 SMART**, **🔁 ALGORITHM**, **📋 PRIORITY**, **🎰 RANDOM** — AJ
    Richardson's four, ported over the same flat-array engine
    (`js/honest_ai.js`) and made corner-relative (his chase the
    top-left): Smart looks three moves ahead against the worst
    adjacent 2, judged by monotonicity and empty cells; Algorithm
    alternates up, left, up, left; Priority takes the first legal move
    of up > left > right > down; Random is a random legal move.
- **GOAL** — **🏁 MAX BLOCK** or **💯 MAX SCORE**, and for perfect play
  **🌀 FULL SPIRAL**. Perfect play has an exact answer to each (below);
  honest play goes as far as it gets, MAX SCORE with GENIUS weighing
  survival a little more heavily.
- **SPEED** — **1×–5×, 10×, 20×, 50×, 100×**, **AFAP** (as fast as
  possible while still drawing every move) or **🧮 HEADLESS**: the
  renderer is fully off — the *entire* game (thinking, moves, spawn
  odds, undos) runs as flat arrays inside the Web Worker while the
  board sits dimmed and frozen. Only the live counters move; the final
  position installs into the real game at the end (or the moment you
  stop). Because nothing depends on animation frames, it runs at full
  speed even in a hidden background tab.
- **FINALE** (perfect play) — **🎬 SLOW MOTION** plays the ending at a
  readable pace and holds the pose on the finished spiral;
  **⚡ HYPERCOMPLETE** just finishes.
- Two pickers: the **corner** grid says where the biggest tile lives,
  and the **spiral** grids draw both snakes out of that corner — along
  its row (65536 beside the 131072) or along its column (65536 above or
  below it) — so you click the shape you want. Eight spirals, all
  exact: the shipped lines are one line and the seven symmetries of
  the square (`ORIENT=col` in the harness picks the column-first ones).
- **Try again** above the board restarts at any time, and the game-over
  screen has a **Close** button that leaves the dead board on show (Z
  still takes moves back).

### 🧠 How far honest play gets

`node test/honest.js [algo|all] [games]` plays headless games
(`TILES=evil`, `UNDO=regular`, `GOAL=score`, `CORNER=…`), and
`node test/honest_drive.js` drives the same AIs through the real game
engine — real moves, the real undo button for the death ladder, the
Evil spawner patched in exactly as the page does it. Ten games each,
bottom-right corner (max tile reached, average score):

| AI | regular tiles | Evil tiles | regular tiles, undo regular |
|---|---|---|---|
| **🧠 GENIUS** | 16384 ×1, 8192 ×5, 4096 ×3, 1024 ×1 — 130,131 | 4096 ×6, 2048 ×4 — 56,850 | **32768 ×2** (2 games, 15,000-move cap) — 455,038 |
| 🎓 SMART | 4096 ×3, 2048 ×6, 1024 ×1 — 46,029 | 1024 ×4, 512 ×4, 256 ×2 — 8,410 | 16384 ×3, 8192 ×2 (5 games) — 265,873 |
| 🔁 ALGORITHM | 512 ×5, 256 ×2, 128 ×3 — 4,256 | 256 ×4, 128 ×4, 64 ×2 — 2,011 | 1024 ×6, 512 ×4 — 9,209 |
| 📋 PRIORITY | 512 ×1, 256 ×6, 128 ×2, 16 ×1 — 2,952 | 128 ×7, 64 ×3 — 1,284 | — |
| 🎰 RANDOM | 128 ×6, 64 ×3, 32 ×1 — 983 | 128 ×1, 64 ×5, 32 ×4 — 508 | 256 ×9, 512 ×1 — 1,431 |

GENIUS thinks for 5 ms a move on average in Node (about
200 moves/s; against Evil tiles the tree is narrower and it is
three times faster), SMART well under a millisecond, the other three
are instant. Undo regular is where the button shows its worth: the
same SMART that dies at 4096 climbs to 16384 with a few thousand
escapes, and GENIUS reaches 32768.

### ⚡ Perfect play

This fork's undo button re-randomizes the spawn seed, which makes
something delightful possible: an AI that plays a *perfect* game.
PERFECT tiles, or REGULAR tiles with PERFECT undo, build the perfect
spiral — 4, 8, 16 … 65536 snaked into your chosen corner — undoing
every unlucky spawn along the way in the second case (watch the undo
counter). When the spiral is complete, one final 4 drops into the last
free cell and the whole chain folds into **131072**, the highest tile
2048's rules allow.

The two ways play the *same computed lines* — the books, below — and
differ only in how the spawns are made to match:

- **👑 PERFECT tiles** — the move-minimal game, *computed rather than
  played*: it runs as pure matrix data by default (HEADLESS — the
  board dims and holds still until the finished position lands), the
  game only ever moves forward (**zero undos**), every spawn from the
  very first two tiles is a 4, and the line is **exactly 32,781
  moves** — the provable minimum (derivation below). It isn't even
  searched at runtime: the perfect games are *constants of 2048*, so
  they were generated once (`test/gen_perfect.js`) and shipped as data
  (`js/perfect_line.js`) — the 32,781-move line to the tile, the
  65,533-move line to the full spiral, and the 129,333-move
  maximum-score line — replayed, and re-verified move by move, through
  the real engine in a fraction of a second. The other three corners
  are the same lines mirrored. The ending still gets eyes on it: with
  🎬 SLOW MOTION the finale replays on the real board in slow motion
  and holds the pose. And if you'd rather *watch the whole thing*, pick
  a rendered speed (1×–100× or AFAP) — the book plays out on the
  visible grid move by move, zero undos.
- **🎲 REGULAR tiles + ⚡ PERFECT undo** — the same line with honest
  spawns re-rolled onto it: about 1.9 million undos, the opening pair
  included.

And the goal picker:

- **🏁 MAX BLOCK** — straight to the 131072 tile, 4-feeds, done.
- **🌀 FULL SPIRAL** — don't stop at the tile: keep building until
  **every power of two from 131072 down to 4 sits on the board at
  once** — the complete spiral, the prettiest position the game has,
  and a board that is dead by construction (adjacent cells always
  differ). 4-feeds make it the fewest-moves road there: exactly
  **65,533 moves**, ending frozen on the money shot.
- **💯 MAX SCORE** — score is merge history: a spawned 2 is worth 0 and
  every spawned 4 forfeits 4 points. So this run feeds twos, and after
  folding the first spiral into 131072 it *keeps playing*, stacking the
  full descending chain beside it until the board dies full and
  mergeless. The ceiling is **3,932,100** — proved below: every one of
  the sixteen tiles of the final chain needs at least one spawned 4 —
  and the computed line scores **3,925,224 in 129,333 moves**, 99.83% of
  it. Same death board as the SPIRAL goal — one final position, reached
  two perfect ways.

The engine (`js/super_ai.js`) plans a line of moves together with the
spawn each move needs, then either re-rolls reality until it matches
(perfect undo) or simply places the planned tile (perfect tiles). Since
the perfect games are shipped as data, the line normally *is* the book
— served in 2,000-move chunks and re-verified against the real game
move by move — and the checkpoint search over controlled outcomes
underneath only wakes up for a board that isn't on it (or when no line
is shipped for the goal; `NOBOOK=1` in the harness forces that, the
pre-book behaviour). Every state on screen is a real, legal game state
reached by real moves. All planning runs in a Web Worker
(`js/super_worker.js`), one chunk prefetched ahead, so the page stays
at 60fps.

`node test/run.js [corner]` drives the same engine headless as proof
(`PREDICTABLE=1` for placed spawns, `GOAL=spiral|score` for the other
goals, `NOBOOK=1` to make the planner search the whole game), and
`node test/bench.js {standard|undo|perfect}` is a pure-array speed
benchmark of the three rulesets, searched. The searched rows below were
measured on one 4-core box, all four executing **simultaneously** (one
core each); the book rows are the same harness with the shipped lines:

| run | result | moves | undo re-rolls | wall time | planning | engine |
|---|---|---|---|---|---|---|
| bench, undo rules (searched) | 131072 | 36,561 | 1,798,095 | 22.9 min | 1376.1s | 0.1s |
| bench, perfect rules (searched) | 131072 | 36,569 | 0 | 22.7 min | 1364.6s | 0.0s |
| real engine, placed spawns (searched) | 131072 | 36,561 | 0 | 23.0 min | — | — |
| real engine, undo re-rolls (searched) | 131072 | 36,563 | 1,785,117 | 23.0 min | — | — |
| **real engine, placed spawns (the book)** | 131072 | **32,781** | **0** | **0.2 s** | 0s | 0.2s |
| **real engine, undo re-rolls (the book)** | 131072 | **32,781** | **1,912,116** | **7.9 s** | 0s | 7.9s |
| **real engine, undo re-rolls, max score (the book)** | full chain, score **3,925,224** | **129,333** | 662,805 | 4.0 s | 0s | 4.0s |
| **PERFECT (the book)** | 131072 | **32,781** | **0** | **0.1 s** | 0s | 0.1s |
| **PERFECT SPIRAL (the book)** | full chain, score 3,670,024 | **65,533** | **0** | **0.2 s** | 0s | 0.2s |
| **PERFECT MAX SCORE (the book)** | full chain, score **3,925,224** | **129,333** | **0** | **0.3 s** | 0s | 0.3s |
| honest expectimax (no undo, no control) | 1024–2048 | — | — | ~2s/game | — | — |

The story the numbers tell: the board engine is effectively free (1.8M
re-rolls cost 0.1s in flat arrays — about 18 million engine steps per
second — and 7.9s through the real GameManager with its tile objects
and undo stack); searched, ~99.99% of the time is the planner thinking,
which is why the undo and perfect rulesets finish in a dead heat, and
why an honest game — no undo, no control — tops out around 2048:
perfection needs the re-roll. With the books the planner is gone and
every perfect run is engine-bound. In the browser that means 🧮
HEADLESS finishes in about a tenth of a second (≈230,000 moves/s for
the tile line inside the worker), and a rendered AFAP run is bound by
the real game plus one paint per frame, ≈2,000 moves/s: 16 s for the
32,781-move line, 23 s with the 1.9 million undos.

### 👑 The mathematics of a perfect game

Slides conserve tile mass (2+2 → 4), so the board's total only ever
grows by spawns — one per move, +4 or +2. That single invariant decides
everything.

**Fewest moves to 131072.** Right before the final merge the board must
hold two 65536s plus whatever junk arrived along the way, so every move
should carry the maximum +4. Feeding *only* 4s, and starting from two
4s (mass 8), the build of the primed spiral — the full descending chain
65536 … 4 plus one spawned 4 in the last cell, total mass exactly
131072 — takes **exactly (131072 − 8) / 4 = 32,766 moves**, no matter
what order the merges happen in. That "no matter what" is the deep
part: since every legal all-4 move adds exactly 4 mass and the spiral's
mass is fixed, *any* route that reaches it is automatically minimal —
minimality is forced by the ledger, and only *reachability* has to be
constructed. The generator does that by walking a binary counter along
the snake (each move: one carry-merge, one planted 4; drop-feeds over
the tail row; a two-slide dance where the top row has no room), which
is also a tidy accounting identity: the tile count (2 at the start, 16
at the death of the build, +1 per spawn, −1 per merge) says the build
performs exactly 32,752 merges across its 32,766 moves — carries
almost every single move, with just a handful of merge-free
repositioning slides. Then the spiral folds: the
cascade 8, 16, 32, … 131072 is 15 forced merges, one per move (a slide
merges equal *adjacent* pairs only, and the chain offers exactly one
per step), proven minimal by exhaustive search. Total:

> **minMoves(2^n) = (2^n − 8)/4 + (n − 2)**, so
> **minMoves(131072) = 32,766 + 15 = 32,781 = 2^15 + 13.**

The same formula gives **519** for the 2048 tile (510 + 9) — exactly
the known minimum from Lees-Miller's Markov-chain analysis of 2048,
which also puts honest random play at ~939 moves on average. Every 2
that sneaks into a build costs half a move (a pair of 2s is one extra
move), which is why the planner's own searched lines land ~36,500 (the
searched rows above): they allow 2s whenever convenient, roughly 8,200
of them. The books allow none — and because a lone 2 could never merge
again in an all-4 world, even the two starting tiles must be 4s (which
is exactly why PERFECT undo has to re-roll its opening).

**The full spiral, fewest moves.** The complete chain — 131072,
65536, … 4, one power per cell — has mass 2^18 − 4 = 262,140, so an
all-4 game that ends on it takes **exactly (262,140 − 8)/4 = 65,533
moves**, again independent of route. Its score is path-independent
too: every tile 2^k built from 4s banks (k−2)·2^k, and the chain sums
to **exactly 3,670,024 points**. One measured curiosity from the
generated line: under the all-4 discipline the 131072 first forms at
move **32,784**, three later than the standalone minimum — a pure-4
fold needs a few junk consolidations that 2-junk avoids, and the
ledger silently absorbs them into the total.

**Highest score.** Score is merge history: building 2^k entirely from
2s banks (k−1)·2^k points, and every spawned 4 skips a 2+2 merge,
forfeiting exactly 4 points — at every moment of every game,
score = Σ (k−1)·2^k over the tiles on the board − 4·(spawned 4s). The
maximum-score death board is *that same full chain*, worth
Σₖ₌₂¹⁷ (k−1)·2^k = 3,932,164, so the question is how many spawned 4s a
game that ends on it must contain. Folklore offers 3,932,164 (none),
3,932,156 (two) and 3,932,100 (sixteen, one per tile). The third is
right, and it is a theorem (`paper/main.tex`): building a tile 2^k from
2s alone needs k cells at once — its merge tree has Strahler number k,
the register count of Ershov and Sethi–Ullman — and any spawned 4 in the
tree drops that to k−1; the sixteen tiles of the final chain must take
their tight moments in order of size on a board the bigger ones already
sit on, which leaves the tile 2^k exactly k−1 cells. So each of the
sixteen owns a spawned 4, and **score ≤ 3,932,164 − 64 = 3,932,100** on
any 16-cell board. The same argument gives Φ_c − 4c on c cells, and
exhaustive enumeration (`node test/solve.js 2x2|2x3|2x4|3x3`) shows it
is attained on every board up to nine cells — always on the full chain,
always with exactly one 4 per tile. The shipped 4×4 line, generated
under a strict last-resort-4 discipline, lands at **1,735 four-spawns**:
**129,333 moves** and **3,925,224 points**, pinned by the identities
moves = 131,068 − n₄ and score = 3,932,164 − 4·n₄ and verified by full
replay in every corner and both spiral orientations. It spends one 4 on
the 131072 and all the rest inside the second act — the chain on the
fifteen cells beside it — where overflow cascades leave junk the
generator's bounded look-ahead cannot always digest with 2s. We
conjecture the ceiling is attainable; the 6,876 missing points are an
open search problem.

So the perfections pull the same lever opposite ways on the same final
board: **spawn 4s for the fewest moves (65,533, scoring 3,670,024),
spawn 2s for the most points (3,925,224, in 129,333 moves).** One
dial, both extremes, and perfect play takes each of them to its bound.

`node test/solve.js 3x3` (also `2x2`, `2x3`, `2x4`) enumerates every
reachable position of a small board layer by layer — the mass grows by
exactly the spawned value each move, so the state graph is graded — and
reports the exact maximum score, the fewest moves to every tile, the
fewest spawned 4s to the full chain, and, running the same layers
backwards, the optimal expected score and tile odds of the honest game.
The 3×3 count of 48,713,519 positions (up to symmetry) matches the one
Yamashita, Kaneko and Nakayashiki published when they strongly solved
that board; Kaneko and Yamashita's 4×3 (1.15 trillion positions) is
out of this machine's reach.
`PERFECT=1 node test/run.js br bl tr tl` (add `ORIENT=col` for the
column-first spirals) proves the tile line in about a tenth of a
second per corner: it replays the shipped data through
the real engine — every slide must actually move, every spawn cell
must be empty — and asserts exactly 32,781 moves with zero undos.
`PERFECT=1 GOAL=spiral` does the same for the full spiral: 65,533
moves, zero undos, the exact chain, score exactly 3,670,024. And
`PERFECT=1 GOAL=score` replays the maximum-score line: 129,333 moves,
zero undos, the full chain dead, score exactly 3,925,224.
`node test/gen_perfect.js` (`TARGET=tile`, `TARGET=full` or
`TARGET=score`) regenerates and re-verifies any line from nothing.

References: [The Mathematics of 2048: Minimum Moves to Win with Markov
Chains](https://jdlm.info/articles/2017/08/05/markov-chain-2048.html)
(519 minimum, ~939 average), [Optimal Play with Markov Decision
Processes](https://jdlm.info/articles/2018/03/18/markov-decision-process-2048.html),
[Threes!, Fives, 1024!, and 2048 are Hard](https://arxiv.org/abs/1505.04274),
[Computational bounds for the 2048 game](https://arxiv.org/abs/2303.07266),
[Making Change in 2048](https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.FUN.2018.21)
(Eppstein, FUN 2018 — the change-making view of the binary counter),
[Strongly Solving 2048 4×3](https://arxiv.org/abs/2510.04580) (Kaneko
and Yamashita, ICGA Journal 2026), and the community derivations of the
maximum score (e.g. [Ask
MetaFilter](https://ask.metafilter.com/269599/In-a-2048-or-Threes-like-game-what-is-the-highest-possible-score)).
The write-up with proofs is `paper/main.pdf`.

### Contributions

 - [TimPetricola](https://github.com/TimPetricola) added best score storage
 - [chrisprice](https://github.com/chrisprice) added custom code for swipe handling on mobile

Many thanks to [rayhaanj](https://github.com/rayhaanj), [Mechazawa](https://github.com/Mechazawa), [grant](https://github.com/grant), [remram44](https://github.com/remram44) and [ghoullier](https://github.com/ghoullier) for the many other good contributions.

### Screenshot

[![Screenshot](http://pictures.gabrielecirulli.com/2048-20140309-234100.png)](http://pictures.gabrielecirulli.com/2048-20140309-234100.png)

That screenshot is fake, by the way. I never reached 2048 :smile:

## Contributing
Changes and improvements are more than welcome! Feel free to fork and open a pull request. Please make your changes in a specific branch and request to pull into `master`! If you can, please make sure the game fully works before sending the PR, as that will help speed up the process.

You can find the same information in the [contributing guide.](https://github.com/gabrielecirulli/2048/blob/master/CONTRIBUTING.md)

## License
2048 is licensed under the [MIT license.](https://github.com/gabrielecirulli/2048/blob/master/LICENSE.txt)

## Donations
I made this in my spare time, and it's hosted on GitHub (which means I don't have any hosting costs), but if you enjoyed the game and feel like buying me coffee, you can donate at my BTC address: `1Ec6onfsQmoP9kkL3zkpB6c5sA4PVcXU2i`. Thank you very much!
