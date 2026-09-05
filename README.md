# 2048
A small clone of [1024](https://play.google.com/store/apps/details?id=com.veewo.a1024), based on [Saming's 2048](http://saming.fr/p/2048/) (also a clone).

Made just for fun. [Play it here!](http://gabrielecirulli.github.io/2048/)

### ⚡ SUPER MODE

This fork's undo button re-randomizes the spawn seed, which makes something
delightful possible: an AI that plays a *perfect* game. Hit **SUPER MODE**
and it builds the perfect spiral — 4, 8, 16 … 65536 snaked into your chosen
corner — undoing every unlucky spawn along the way (watch the undo counter).
When the spiral is complete, one final 4 drops into the last free cell and
the whole chain folds into **131072**, the highest tile 2048's rules allow.

- Pick the target corner (bottom-right by default) on the mini-board.
- Pick a speed: **1×–5×**, **AFAP** (as fast as possible), or
  **🧮 HEADLESS** — the renderer is fully off: the *entire* game
  (planner, moves, spawn odds, undo re-rolls) runs as flat arrays
  inside the Web Worker while the board sits dimmed and frozen. Only
  the live counters move; the final position installs into the real
  game at the end (or the moment you stop). Because nothing depends on
  animation frames, it runs at full speed even in a hidden background
  tab, where browsers throttle rendered modes to a crawl.
- Pick a flavor:
  - **🎲 SUPER** — spawns stay honest (90% twos, random cells); every
    unlucky one gets undone and re-rolled. About 1.8 million undos per
    perfect game.
  - **🔮 PREDICTABLE** — the AI decides which tile comes next *and where
    it lands*. Zero undos, zero luck.
  - **👑 PERFECT** — the move-minimal game, *computed rather than
    played*: it always runs as pure matrix data (no rendering — the
    board dims and holds still until the finished position lands), the
    game only ever moves forward (**zero undos**), every spawn from the
    very first two tiles is a 4, and the line is **exactly 32,781
    moves** — the provable minimum (derivation below). It isn't even
    searched at runtime: the perfect games are *constants of 2048*, so
    they were generated once (`test/gen_perfect.js`) and shipped as
    data (`js/perfect_line.js`) — the 32,781-move line to the tile,
    the 65,533-move line to the full spiral, and the 129,333-move
    maximum-score line — replayed, and re-verified move by move,
    through the real engine in a fraction of a second.
    The other three corners are the same lines mirrored. The ending
    still gets eyes on it: the finale replays on the real board in slow
    motion and holds the pose. And if you'd rather *watch the whole
    thing*, pick a rendered speed (1×–5× or AFAP) — the book plays out
    on the visible grid move by move, zero undos, finale in slow
    motion; 🧮 HEADLESS stays the instant default.
- The finale always plays out in slow motion. It's the money shot.

And a goal picker:

- **🏁 131072 SPRINT** — straight to the tile, 4-feeds, done.
- **🌀 131072 SPIRAL** — don't stop at the tile: keep building until
  **every power of two from 131072 down to 4 sits on the board at
  once** — the complete spiral, the prettiest position the game has,
  and a board that is dead by construction (adjacent cells always
  differ). 4-feeds make it the fewest-moves road there: exactly
  **65,533 moves** in PERFECT mode, ending frozen on the money shot.
- **💯 MAX SCORE** — score is merge history: a spawned 2 is worth 0 and
  every spawned 4 forfeits 4 points. So this run feeds twos, and after
  folding the first spiral into 131072 it *keeps playing*, stacking the
  full descending chain beside it until the board dies full and
  mergeless. The mass-only ceiling is 3,932,156 — but it turns out the
  board's geometry cannot pay it (derivation below): the computed
  PERFECT line proves **3,925,224 points in 129,333 moves**, 99.82% of
  the ceiling and the highest constructively verified score here. Same
  death board as the SPIRAL goal — one final position, reached two
  perfect ways.

The engine (`js/super_ai.js`) is a checkpoint search over controlled
outcomes: it plans a line of moves together with the spawn each move
needs, then either re-rolls reality until it matches (super) or simply
places the planned tile (predictable). Every state on screen is a real,
legal game state reached by real moves. All searching runs in a Web
Worker (`js/super_worker.js`), one line prefetched ahead, so the page
stays at 60fps even while the planner thinks hard.

`node test/run.js [corner]` drives the same engine headless as proof
(`PREDICTABLE=1` for controlled spawns, `GOAL=score` for the max-score
run), and `node test/bench.js {standard|undo|perfect}` is a pure-array
speed benchmark of the three rulesets. Measured on one 4-core box, all
four runs below executing **simultaneously** (one core each):

| run | result | moves | undo re-rolls | wall time | planning | engine |
|---|---|---|---|---|---|---|
| bench, undo rules | 131072 | 36,561 | 1,798,095 | 22.9 min | 1376.1s | 0.1s |
| bench, perfect rules | 131072 | 36,569 | 0 | 22.7 min | 1364.6s | 0.0s |
| real engine, predictable | 131072 | 36,561 | 0 | 23.0 min | — | — |
| real engine, super | 131072 | 36,563 | 1,785,117 | 23.0 min | — | — |
| **PERFECT (the book)** | 131072 | **32,781** | **0** | **0.1 s** | 0s | 0.1s |
| **PERFECT SPIRAL (the book)** | full chain, score 3,670,024 | **65,533** | **0** | **0.2 s** | 0s | 0.2s |
| **PERFECT MAX SCORE (the book)** | full chain, score **3,925,224** | **129,333** | **0** | **0.3 s** | 0s | 0.3s |
| honest expectimax (no undo, no control) | 1024–2048 | — | — | ~2s/game | — | — |

The story the numbers tell: the board engine is effectively free (1.8M
re-rolls cost 0.1s — about 18 million engine steps per second); ~99.99%
of the time is the planner thinking. That's also why the undo and
perfect rulesets finish in a dead heat, and why an honest game — no
undo, no control — tops out around 2048: perfection needs the re-roll.

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
move), which is why plain PREDICTABLE runs land ~36,900: they allow 2s
whenever convenient, roughly 8,200 of them. PERFECT allows none — and
because a lone 2 could never merge again in an all-4 world, even the
two starting tiles must be 4s.

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

**Highest score — and why the folklore ceiling can't be paid.** Score
is merge history: building 2^k entirely from 2s banks (k−1)·2^k
points, and every spawned 4 skips a 2+2 merge, forfeiting exactly 4
points. The maximum-score death board is *that same full chain*, worth
Σₖ₌₂¹⁷ (k−1)·2^k = 3,932,164 points — and the usual derivation
subtracts 8 for two "structurally forced" 4-spawns to get the widely
quoted ceiling of **3,932,156**. That derivation only counts mass. It
never asks whether the moves *fit on the board*, and they don't:
staging 2^k from pure 2s occupies **k cells at its tightest moment**
(the [16, 8, 4, 2, 2] instant is unavoidable — eager merging cannot
compress it), and on the 15 cells beside the 131072 every "second
half" of the rebuild is one cell short at every recursion level. Each
shortfall can only be resolved by a spawned 4, and each spawned 4
costs exactly 4 points. Generating the line under a strict
last-resort-4 discipline (4s granted per decision only after every
pure-2 option provably dies) lands at **1,735 four-spawns**: exactly
**129,333 moves** and **3,925,224 points**, pinned by the identities
moves = 131,068 − n₄ and score = 3,932,164 − 4·n₄, and verified by
full replay in all four corners. That is the highest constructively
verified score for this board; the true minimum n₄ (somewhere between
2 and 1,735) is, as far as we know, an open question.

So the perfections pull the same lever opposite ways on the same final
board: **spawn 4s for the fewest moves (65,533, scoring 3,670,024),
spawn 2s for the most points (3,925,224, in 129,333 moves).** One
dial, both extremes, and SUPER MODE plays each of them to its bound.

`PERFECT=1 node test/run.js br bl tr tl` proves the tile line in about
a tenth of a second per corner: it replays the shipped data through
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
and the community derivations of the maximum score (e.g. [Ask
MetaFilter](https://ask.metafilter.com/269599/In-a-2048-or-Threes-like-game-what-is-the-highest-possible-score)).

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
