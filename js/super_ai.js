// Super Mode AI for 2048-undo.
//
// Plays a provably-perfect game: it builds the full "perfect spiral"
// (snake) 4, 8, 16, ... 65536 into a chosen corner, then a final 4 spawns
// in the last free cell and the whole chain collapses into 131072 — the
// highest tile possible on a 4x4 board.
//
// The trick that makes perfection possible is the undo button: this fork
// re-randomizes the spawn seed on every undo, so whenever the random tile
// lands somewhere the plan doesn't want, the AI undoes the move and tries
// again. Every state on screen is a real, legal game state.
//
// This file is DOM-free so the same engine runs in the browser and in the
// Node test harness (test/run.js).

(function (global) {
  "use strict";

  var SIZE = 4;
  var CELLS = 16;

  // Direction codes match game_manager.js: 0 up, 1 right, 2 down, 3 left.

  // ------------------------------------------------------------------
  // Snake path
  // ------------------------------------------------------------------

  // Cells in build order for a corner ("tl","tr","bl","br"): S[0] is the
  // corner that ends up holding 131072, S[15] is where the final 4 spawns.
  // Flat index = y * 4 + x.
  function snakeCells(corner) {
    var cx = (corner === "tr" || corner === "br") ? 3 : 0;
    var cy = (corner === "bl" || corner === "br") ? 3 : 0;
    var ys = cy === 3 ? [3, 2, 1, 0] : [0, 1, 2, 3];
    var out = [];
    for (var k = 0; k < 4; k++) {
      var xs = cx === 3 ? [3, 2, 1, 0] : [0, 1, 2, 3];
      if (k % 2 === 1) xs.reverse();
      for (var i = 0; i < 4; i++) out.push(ys[k] * 4 + xs[i]);
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Board simulation (must match game_manager.js exactly)
  // ------------------------------------------------------------------

  // For each direction, the 16 cells as 4 lines of 4 flat indices, each
  // line ordered starting from the wall the tiles move toward.
  var LINES = (function () {
    var all = [];
    for (var dir = 0; dir < 4; dir++) {
      var lines = [];
      for (var i = 0; i < 4; i++) {
        var line = [];
        for (var j = 0; j < 4; j++) {
          var x, y;
          if (dir === 3) { y = i; x = j; }          // left
          else if (dir === 1) { y = i; x = 3 - j; } // right
          else if (dir === 0) { x = i; y = j; }     // up
          else { x = i; y = 3 - j; }                // down
          line.push(y * 4 + x);
        }
        lines.push(line);
      }
      all.push(lines);
    }
    return all;
  })();

  // Returns {board, moved, merges: [values...]} without touching the input.
  function simMove(b, dir) {
    var nb = b.slice();
    var moved = false;
    var merges = [];
    var lines = LINES[dir];
    for (var li = 0; li < 4; li++) {
      var line = lines[li];
      var vals = [];
      for (var j = 0; j < 4; j++) {
        var v = b[line[j]];
        if (v !== 0) vals.push(v);
      }
      var out = [];
      var i = 0;
      while (i < vals.length) {
        if (i + 1 < vals.length && vals[i] === vals[i + 1]) {
          out.push(vals[i] * 2);
          merges.push(vals[i] * 2);
          i += 2;
        } else {
          out.push(vals[i]);
          i += 1;
        }
      }
      for (j = 0; j < 4; j++) {
        var nv = j < out.length ? out[j] : 0;
        if (nb[line[j]] !== nv) moved = true;
        nb[line[j]] = nv;
      }
    }
    return { board: nb, moved: moved, merges: merges };
  }

  function emptyCells(b) {
    var out = [];
    for (var i = 0; i < CELLS; i++) if (b[i] === 0) out.push(i);
    return out;
  }

  function maxTile(b) {
    var m = 0;
    for (var i = 0; i < CELLS; i++) if (b[i] > m) m = b[i];
    return m;
  }

  // ------------------------------------------------------------------
  // Position evaluation
  // ------------------------------------------------------------------

  // Steep geometric weights along the snake: one tile at S[i] outweighs
  // everything that can fit behind it, so the search always prefers
  // extending the ordered chain from the corner.
  var W = (function () {
    var w = [];
    for (var i = 0; i < CELLS; i++) w.push(Math.pow(4, 15 - i));
    return w;
  })();

  // Walks the snake and scores the PACKED chain: contiguous tiles from
  // the corner, non-increasing, at most one equal (carry) pair. That's
  // the shape a perfect game maintains at all times. Everything else is
  // classified, not scored:
  //   floats   - tiles <= 4 near the frontier (feed/parking material, fine)
  //   leaked   - tiles <= 4 far from the frontier (mass drifting away)
  //   stranded - any tile >= 8 outside the packed chain (real damage)
  function analyze(b, S, loose, shop, pair44) {
    var N = S.length; // 16 for the full snake, 15 for the second act
    var prefixPhi = 0;
    var bigMass = 0;
    var structPhi = 0;
    var prev = Infinity;
    var pairUsed = false;
    var pair4Used = false;
    var pairAt = -1;
    var packedLen = 0;
    while (packedLen < N) {
      var v = b[S[packedLen]];
      if (v === 0) break;
      if (v > prev) break;
      if (v === prev) {
        // A healthy counter carries at most one equal (mergeable) pair;
        // runs of three-plus can't be merged without side damage. In a
        // 4-only game the walk may carry ONE extra pair of 4s: that's
        // the feed pair, and without a 2 to park instead it appears at
        // the tail whenever a carry pair is mid-cascade. Refusing it
        // starves the search of rests at exactly the turn motifs.
        if (pairUsed) {
          if (!(pair44 && v === 4 && !pair4Used)) break;
          pair4Used = true;
        } else {
          pairUsed = true;
          pairAt = packedLen;
        }
      }
      prefixPhi += v * W[packedLen];
      // The big-structure mass: feed smalls churn constantly, but the
      // >= 8 backbone (walk + docked train) only changes on structural
      // events, and merges within it preserve it exactly — the right
      // invariant to hold while a line rummages through the board.
      // structPhi is its positional cousin: the walk scored over big
      // tiles only. Progress ratchets (the backtrack ladder) must key
      // on THIS, not prefixPhi — feed smalls jitter prefixPhi upward
      // on every replay, and a ladder that resets on jitter can cycle
      // undo-replay forever without ever escalating its way out.
      if (v >= 8) { bigMass += v; structPhi += v * W[packedLen]; }
      prev = v;
      packedLen++;
    }
    var tailValue = packedLen > 0 ? b[S[packedLen - 1]] : Infinity;
    // In the [..pair, smalls | train] shape the trailing feed smalls
    // don't set the bar for the residue train — the pair's pending
    // merge is what reconnects it, and the smalls catch up quickly as
    // long as the train head stays strictly below the pair's value.
    // Behind a plain small tail (no pending pair), a bigger "train"
    // would just suffocate the tail's feed cells.
    var pairValue = pairUsed ? b[S[pairAt]] : 0;
    var smallsAfterPair = pairUsed;
    if (smallsAfterPair) {
      for (var sa = pairAt + 1; sa < packedLen; sa++) {
        if (b[S[sa]] > 4) { smallsAfterPair = false; break; }
      }
    }
    // Beyond the packed chain, everything must form ONE contiguous
    // "residue" segment along the snake: the pre-built future chain that
    // a climbing cascade leaves behind (its train plus in-flight feed
    // smalls). The segment must be internally non-increasing (equals
    // allowed — they self-consolidate under compression) and its head
    // must fit what it reconnects to: at most 2x a pending pair's value
    // (the pair's merge result), at most a real chain tail, or — in the
    // crowded late game — at most the last real chain value while a
    // small tail catches up. Any second segment, or any ordering break,
    // is damage: those merges land out of place.
    var floats = 0;
    var leaked = 0;
    var stranded = 0;
    var train = 0;
    var residueStart = -1;
    var residueEnd = -1;
    // The train ultimately slots in beneath the chain value ABOVE the
    // tail (the tail itself keeps doubling until it catches the train
    // head), so that value — not the tail — bounds the train. With a
    // pending pair, the pair's merge result is the bound.
    var ceil = Infinity;
    for (var cb = packedLen - 2; cb >= 0; cb--) {
      if (b[S[cb]] > 4) { ceil = b[S[cb]]; break; }
    }
    var headOK = pairUsed && smallsAfterPair ? 2 * pairValue :
                 (loose ? ceil : (tailValue > 4 ? tailValue : 0));
    // Train tiles must come before feed smalls in snake order: a small
    // sitting in front of the train spatially blocks both the train's
    // march and the tail's feeding. The sole exception is the very last
    // snake cell — nothing can ever spawn behind it, so a train tile
    // parked there tolerates smalls in front. Everything past the first
    // EMPTY snake cell is a different country though: that's the
    // workshop, where the feed cycle builds each next tile out of
    // spawns — construction is order-increasing by nature, and a column
    // pump's in-flight structure re-sorts on the drop anyway — so no
    // order is enforced out there.
    var trainPrev = -1;
    var inSmalls = false;
    var workshop = false;
    for (var j = packedLen; j < N; j++) {
      var jv = b[S[j]];
      if (jv === 0) { if (shop) workshop = true; continue; }
      if (jv <= 4) { floats++; inSmalls = true; continue; }
      if (workshop) {
        floats++;
        train++;
        bigMass += jv;
        continue;
      }
      var limit = trainPrev >= 0 ? trainPrev : headOK;
      if (jv <= limit && (!inSmalls || j === N - 1)) {
        floats++;
        train++;
        bigMass += jv;
        if (residueStart < 0) residueStart = j;
        residueEnd = j;
        trainPrev = jv;
      } else {
        stranded++;
      }
    }
    return { prefixPhi: prefixPhi, bigMass: bigMass, structPhi: structPhi,
             packedLen: packedLen, hasPair: pairUsed,
             pairAt: pairAt,
             pairIsTail: pairUsed && pairAt === packedLen - 1,
             tailValue: tailValue,
             residueStart: residueStart, residueEnd: residueEnd,
             floats: floats, leaked: leaked, stranded: stranded,
             train: train };
  }

  // The finished spiral: S[0..14] hold 65536 down to 4.
  function chainComplete(b, S) {
    for (var i = 0; i <= 14; i++) {
      if (b[S[i]] !== (1 << (16 - i))) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------
  // Build search: DFS to the next junk-free checkpoint
  // ------------------------------------------------------------------

  // From the current position, find a line of controlled outcomes that
  // reaches a strictly better rest state: packed chain advanced, nothing
  // stranded or leaked, at most a couple of small floats near the
  // frontier. Intermediates obey the same rules (a cascade may park one
  // extra float, never strand chain material). First-success ordering
  // (best-chain direction and frontier spawns first) makes this a
  // deterministic construction with backtracking; memoized failures keep
  // the worst case bounded.
  function buildSearch(b0, S, opts, certMemo) {
    var N = S.length;
    var loose = !opts.strictPairs;
    // The healing regime (a score run's second act) reads boards with
    // workshop rules; the sprint classifier must stay byte-identical,
    // so the flag is decided first and threaded through every analyze.
    var healing = opts.goal === "score" && b0[S[0]] >= 131072;
    var pair44 = !!opts.pair44;
    var start = analyze(b0, S, loose, healing, pair44);
    var maxDepth = opts.depth;
    var budget = { nodes: opts.nodes };
    var failed = {};
    var si = {};
    for (var i = 0; i < N; i++) si[S[i]] = i;

    // Certified checkpoints: a rest state only counts if a (cheaper,
    // memoized) follow-up search proves it can improve again. Traps are
    // exactly the rest states with no onward line, so they self-reject
    // no matter how plausible they look to the shape rules.
    // Rest states are so constrained (see isGoal) that onward viability
    // is simply the next plan's problem; the dead-end family blacklist
    // plus undo-backtracking referee everything else.
    function certify(nb) {
      return !(opts.deadEnds && opts.deadEnds[deadKey(nb, opts.exactDead)]);
    }

    // A rest state must stay playable: some legal move that doesn't
    // strand chain material. This is what forces the gap-spawn trick —
    // [.., 8, _, 4] is a fine rest state while the fully packed
    // [.., 8, 4] with nothing else on the board is a trap (only
    // chain-wrecking moves remain).
    function continuable(b, tol) {
      var lim = tol || 0;
      for (var dir = 0; dir < 4; dir++) {
        var sim = simMove(b, dir);
        if (!sim.moved) continue;
        if (opts.free) return true;
        if (analyze(sim.board, S, loose, healing, pair44).stranded <= lim) return true;
      }
      return false;
    }

    // The canon rest state — the shape a careful human keeps at all
    // times: a packed descending chain (one mergeable tail/carry pair
    // allowed inside it), then at most ONE extra tile, small, sitting
    // in the first or second slot past the frontier (the staged feed).
    // Nothing else. Everything wilder is intermediate-only: lines pass
    // through parks, flights and trains freely but must tidy up before
    // resting. Simple goals + deep lines beat clever goals + shallow
    // lines — every historic wall of this project fell to this shape.
    function countExtras(nb, packedLen) {
      var n = 0;
      for (var q = packedLen; q < N; q++) {
        if (nb[S[q]] !== 0) n++;
      }
      return n;
    }
    var startExtras = countExtras(b0, start.packedLen);

    // The one board a score run is allowed to die on: every cell holding
    // the full descending chain 131072..4 — the maximum-score death.
    function maxDeath(nb) {
      // Full snake: 131072 down to 4. Sub-snake (second act): 65536
      // down to 4 — and then the whole board IS the maximum-score
      // death, since 131072 fills the one cell the sub-snake skips.
      var top = N === 16 ? 131072 : 65536;
      for (var i = 0; i < N; i++) {
        if (nb[S[i]] !== (top >> i)) return false;
      }
      return true;
    }

    // The anchor rule: in the second act the 131072 either sits in its
    // corner, or the corner is transiently empty (a column pump in
    // flight) with the 131072 still in the corner's row or column so a
    // slide can bring it straight home. A corner cell holding anything
    // else means the 131072 got buried — no line out of that, ever.
    function anchorOK(nb) {
      var v = nb[S[0]];
      if (v === 131072) return true;
      if (v !== 0) return false;
      var cx = S[0] % 4;
      var cy = (S[0] / 4) | 0;
      for (var i = 0; i < CELLS; i++) {
        if (nb[i] === 131072) {
          return (i % 4) === cx || ((i / 4) | 0) === cy;
        }
      }
      return false;
    }

    // No resting on a board whose structure floats past holes: vacated
    // cells underneath real mass mean the only compacting moves slide
    // the corner row — a parked position with no way back. Feed 8s roam
    // free (the cycle mints them mid-board, often past a hole, since
    // half the rows pack away from the snake), and ONE tile >= 16 may
    // be in flight out there too — a catch-up builds each doubling in
    // the feed zone and docks it before minting the next. Two or more
    // is not a catch-up; it's structure resting on air.
    function snakeCompact(nb) {
      var hole = false;
      var out = 0;
      for (var i = 0; i < N; i++) {
        var v = nb[S[i]];
        if (v === 0) { hole = true; continue; }
        if (hole && v >= 16 && ++out > 1) return false;
      }
      return true;
    }

    var startLoose = startExtras - start.train;

    // Smalls parked in front of big tiles along the snake. The healthy
    // order is bigs descending, then smalls, then space; one small deep
    // in the big region is fine — it's the growable tail and ordinary
    // feeding turns it into the next big — but two stacked smalls under
    // a cliff wall each other off from their merge partners and the
    // position bricks. Rests keep this count at one (or falling, while
    // the post-collapse swamp still has many).
    function misplacedOf(nb) {
      // Only the ordered structure before the first hole sets the bar;
      // workshop bigs past it are order-free and wall nothing in. The
      // single exemption the cap grants is for a GROWABLE tail — and a
      // small can only grow to meet what follows it when that material
      // is within a few doublings (<= 32). A 4 parked beside the
      // corner with an 8192 behind it is not a tail, it is a wedge,
      // and it counts double so no cap ever blesses it.
      var lastBig = -1;
      for (var i = 0; i < N; i++) {
        var v = nb[S[i]];
        if (v === 0) break;
        if (v >= 8) lastBig = i;
      }
      var n = 0;
      for (var j = 0; j < lastBig; j++) {
        var w = nb[S[j]];
        if (w > 0 && w <= 4) {
          n++;
          for (var k = j + 1; k <= lastBig; k++) {
            if (nb[S[k]] >= 8) {
              if (nb[S[k]] > 32) n++;
              break;
            }
          }
        }
      }
      return n;
    }
    var startMisplaced = misplacedOf(b0);

    // The inversion guard: material waiting beyond the walk must fit
    // UNDER the walk's own big tiles. A rest like [131072, 16 | ...,
    // 16384, 8192] wedges a lightweight at S1 and builds the real
    // chain behind it — legal to every other rule, and ten hours of
    // undo cannot unbuild it. The bar is the last big below the
    // corner; while that big is mid-growth (less than half its
    // predecessor) the predecessor sets the bar instead — that is the
    // ordinary catch-up. With no bigs below the corner yet, 16 is the
    // consolidation scale the bootstrap swamp needs.
    function inversionOK(nb, ana) {
      var last = 0;
      for (var i = 1; i < ana.packedLen; i++) {
        if (nb[S[i]] >= 8) last = nb[S[i]];
      }
      // A genuine catch-up stays within a few doublings of what waits
      // for it; anything farther is a wedge the tail can never grow to
      // meet (v13 blessed an 8 at S2 "growing toward" a 16384 — ten
      // doublings of fantasy). Three doublings is the working span,
      // and 16 is the consolidation scale before any big exists.
      var bound = last * 8 > 16 ? last * 8 : 16;
      for (var j = ana.packedLen; j < N; j++) {
        var w = nb[S[j]];
        if (w >= 8 && w > bound) return false;
      }
      return true;
    }
    var startInversion = inversionOK(b0, start);

    function isGoal(ana, nb, gained) {
      var extras = 0;
      var canon = !ana.stranded;
      for (var q = ana.packedLen; q < N; q++) {
        var qv = nb[S[q]];
        if (qv === 0) continue;
        extras++;
        if (extras > 1 || qv > 4 || q > ana.packedLen + 1) canon = false;
      }
      if (canon && ana.prefixPhi > start.prefixPhi) {
        if (continuable(nb)) return true;
        // In a score run the very last rest is the glorious dead end;
        // any other death is premature and not a goal.
        return opts.goal === "score" && maxDeath(nb);
      }
      // Healing checkpoint: the game's own objective is the progress
      // metric — the line banked some score (a real merge happened) and
      // the structural guards all held: big mass never melts away,
      // damage never grows, big tiles rest packed from the corner, the
      // loose-small population stays bounded, and the board is alive.
      // Score is strictly increasing and bounded by the ceiling, so the
      // run always terminates; the guards herd every merge toward one
      // descending chain, which is exactly the maximum-score death.
      return healing && gained > 0 &&
             ana.stranded <= start.stranded &&
             ana.bigMass >= start.bigMass &&
             extras - ana.train <= (startLoose > 3 ? startLoose : 3) &&
             misplacedOf(nb) <= (startMisplaced > 1 ? startMisplaced : 1) &&
             (inversionOK(nb, ana) || !startInversion) &&
             snakeCompact(nb) &&
             continuable(nb, 1e9);
    }

    // Intermediates are freer than rests, but never allow stranded
    // chain material and keep the loose-tile population bounded so the
    // branching stays sane.
    // Intermediates may be as messy as the root already is (healing a
    // garbage-heavy board has to wade through it), just never messier
    // than that or the tier's own allowance.
    function usable(ana) {
      // Healing lines must pass through consolidation states (8+8 -> 16
      // out of chain order) that the classifier counts as fresh damage;
      // give them bounded slack instead of a hard wall. Likewise, when a
      // column pump lifts the whole chain off the corner row the lifted
      // structure reads as a giant train — cap only the loose smalls,
      // not the structure in flight.
      if (ana.stranded > start.stranded + (healing ? 2 : 0)) return false;
      if (ana.leaked > Math.max(opts.leaked, start.leaked)) return false;
      var fl = healing ? ana.floats - ana.train : ana.floats;
      var fl0 = healing ? start.floats - start.train : start.floats;
      return fl <= Math.max(opts.floats, fl0);
    }

    function spawnCells(post, packedLen) {
      var out = [];
      var lim = opts.allCells ? N - 1 : Math.min(N - 1, packedLen + 4);
      for (var k = 0; k <= lim; k++) {
        var c = S[k];
        if (post[c] === 0) out.push(c);
      }
      return out;
    }

    function dfs(b, depth, gained) {
      if (budget.nodes-- <= 0) return null;
      // Only whether the line has banked a merge matters to isGoal, so
      // that one bit joins the memo key.
      var key = depth + "|" + (gained > 0 ? 1 : 0) + "|" + b.join(",");
      if (failed[key]) return null;
      var sims = [];
      for (var dir = 0; dir < 4; dir++) {
        var sim = simMove(b, dir);
        if (!sim.moved) continue;
        var sa = analyze(sim.board, S, loose, healing, pair44);
        var msum = 0;
        for (var mg = 0; mg < sim.merges.length; mg++) msum += sim.merges[mg];
        sims.push({ dir: dir, board: sim.board, ana: sa, msum: msum });
      }
      sims.sort(function (a, b2) { return b2.ana.prefixPhi - a.ana.prefixPhi; });
      for (var m = 0; m < sims.length; m++) {
        var post = sims[m];
        var spawns = spawnCells(post.board, post.ana.packedLen);
        for (var e = 0; e < spawns.length; e++) {
          for (var vi = 0; vi < opts.valueOrder.length; vi++) {
            var val = opts.valueOrder[vi];
            var nb = post.board.slice();
            nb[spawns[e]] = val;
            if (healing && !anchorOK(nb)) continue;
            if (opts.anchorCell !== undefined &&
                nb[opts.anchorCell] !== opts.anchorValue) continue;
            var ana = analyze(nb, S, loose, healing, pair44);
            var step = { dir: post.dir, cell: spawns[e], value: val };
            if (isGoal(ana, nb, gained + post.msum) && certify(nb)) return [step];
            if (depth + 1 >= maxDepth) continue;
            if (!usable(ana)) continue;
            var sub = dfs(nb, depth + 1, gained + post.msum);
            if (sub) return [step].concat(sub);
          }
        }
      }
      failed[key] = true;
      return null;
    }

    return dfs(b0, 0, 0);
  }

  // ------------------------------------------------------------------
  // Scripted finale (collapse phase)
  // ------------------------------------------------------------------

  // Once the board is full and the spiral is primed, search the exact
  // move/spawn-value script that folds the chain into 131072. Each step
  // must merge exactly one pair (value >= 8, i.e. chain material) and the
  // spawn refills the single freed cell; only its value (2 vs 4) needs
  // choosing so garbage never lines up into an accidental merge.
  // The collapse: fold the primed spiral into 131072. Unlike the 2048
  // tile's collapse (whose primed board keeps five empty cells of
  // slack), the 131072 chain fills the board COMPLETELY, so every
  // spawn during the fold lands on the cascade's path. Junk sometimes
  // has to be consolidated (2+2) in moves of their own before the
  // cascade can continue, which is why the fold takes MORE than the 15
  // forced merges. The true minimum is a constant of the game, and
  // this search finds it: iterative deepening over total length, where
  // each move either advances the cascade by exactly the next doubling
  // (8, 16, ... 131072, at most one junk merge alongside) or is a pure
  // junk-consolidation move (2+2 merges only, cascade untouched).
  function collapseSearch(b, S, memo, mustContinue) {
    // Hard node cap: on the canonical primed board the fold is found
    // well inside it, and on anything messier the answer is "no" —
    // which must come back in seconds, not hours (a full board passes
    // through the fold guard transiently all through the 65536 era).
    var fuel = { nodes: 2e7 };
    for (var budget = 15; budget <= 26; budget++) {
      var r = collapseDFS(b, S, memo, mustContinue, 0, budget, fuel);
      if (r) return r;
      if (fuel.nodes <= 0) return null;
    }
    return null;
  }

  function collapseDFS(b, S, memo, mustContinue, prev, left, fuel) {
    if (b[S[0]] >= 131072) {
      if (!mustContinue) return [];
      return boardDead(b) ? null : [];
    }
    if (left <= 0 || maxTile(b) >= 131072) return null;
    if (fuel.nodes-- <= 0) return null;
    var key = prev + "|" + left + "|" + b.join(",");
    if (memo.hasOwnProperty(key)) return memo[key] || null;
    memo[key] = false; // cycle guard / proven failure
    var result = null;
    outer:
    for (var dir = 0; dir < 4; dir++) {
      var sim = simMove(b, dir);
      if (!sim.moved) continue;
      // Classify merges against the cascade's expectation: exactly the
      // next doubling advances the fold; anything below it is junk
      // consolidating behind the front (2s into 4s into 8s — the more
      // the junk crushes down, the more slack the fold gets); anything
      // above it would be an out-of-order merge and poisons the move.
      var expected = prev ? prev * 2 : 8;
      var casc = 0, junk = 0, badBig = false;
      for (var mi = 0; mi < sim.merges.length; mi++) {
        var mv = sim.merges[mi];
        if (mv === expected) casc++;
        else if (mv < expected) junk++;
        else badBig = true;
      }
      if (badBig) continue;
      var nextPrev;
      if (casc === 1 && junk <= 1) {
        nextPrev = expected; // cascade advances
      } else if (casc === 0 && junk >= 1 && junk <= 2) {
        nextPrev = prev;     // junk consolidation
      } else {
        continue;
      }
      var empt = emptyCells(sim.board);
      if (empt.length < 1 || empt.length > 3) continue;
      for (var ei = 0; ei < empt.length; ei++) {
        for (var vi = 0; vi < 2; vi++) {
          var val = vi === 0 ? 2 : 4; // 2 first: 9x cheaper to sample
          var nb = sim.board.slice();
          nb[empt[ei]] = val;
          var sub = collapseDFS(nb, S, memo, mustContinue, nextPrev, left - 1, fuel);
          if (sub) {
            result = [{ dir: dir, cell: empt[ei], value: val }].concat(sub);
            break outer;
          }
        }
      }
    }
    memo[key] = result || false;
    return result;
  }

  // ------------------------------------------------------------------
  // Policy
  // ------------------------------------------------------------------

  // Iterative deepening: most plans resolve in the shallow tier; the
  // deep tiers pay off only at carry cascades and row transitions,
  // where a single line can run 15+ moves before it can tidy up.
  var SEARCH_TIERS = [
    { depth: 12, floats: 4, leaked: 1, nodes: 3e5, allCells: true },
    { depth: 16, floats: 5, leaked: 2, nodes: 1e6, allCells: true },
    { depth: 20, floats: 6, leaked: 2, nodes: 3e6, allCells: true }
  ];

  // A 4-only spawn menu halves the branching but also halves the line
  // supply: strict-4 sub-builds routinely need the extra plies that
  // [4,2] play resolves with a well-placed 2. Perfect mode gets one
  // deeper tier before conceding a backtrack — a failed plan costs
  // hundreds of churned moves, so the extra search is cheap by
  // comparison.
  var PERFECT_TIERS = SEARCH_TIERS.concat([
    { depth: 26, floats: 6, leaked: 2, nodes: 1e7, allCells: true }
  ]);

  // goal "tile"  — sprint to 131072 (4-feeds, fastest finish; the game
  //                ends the moment the corner holds 131072).
  // goal "score" — the maximum-score run: 2-feeds only (every spawned 4
  //                costs 4 points), and after 131072 keep counting: stack
  //                the full descending chain 65536, 32768, ... beside it
  //                until the board dies full and mergeless. Theoretical
  //                ceiling: 3,932,156 points.
  function SuperAI(corner, opts) {
    this.corner = corner;
    this.goal = (opts && opts.goal) === "score" ? "score" : "tile";
    // Perfect: the move-minimal game. Mass is conserved by slides and
    // grows only by spawns, so with every build spawn a 4 the build to
    // the primed 131072-chain takes EXACTLY (131072-8)/4 = 32,766
    // moves, and the collapse cascade 8,16,...,131072 adds exactly 15:
    // 32,781 moves total, the provable minimum for this construction
    // (the same ledger gives the known 519 for the 2048 tile). A score
    // run ignores the flag: max score wants the opposite dial - all 2s.
    this.perfect = !!(opts && opts.perfect) && this.goal !== "score";
    this.S = snakeCells(corner);
    // The second act is a fresh sprint on the 15 cells the 131072
    // doesn't occupy: same machine, one cell shorter.
    this.subS = this.S.slice(1);
    this.collapseMemo = {};
    this.foldCache = {};
    this.certMemo = {};
    this.deadEnds = {};
    this.planFail = {};
  }

  // board: flat 16-array (y*4+x). Returns a plan:
  //   {type:"done"}
  //   {type:"stuck", reason}
  //   {type:"line", steps:[{dir,cell,value}...], phase:"build"|"finale"}
  // A line runs from the current position to the next verified
  // checkpoint; the driver replays it step by step with undo re-rolls.
  SuperAI.prototype.opts = function (base) {
    var o = {};
    for (var k in base) o[k] = base[k];
    o.deadEnds = this.deadEnds;
    o.exactDead = this.perfect;
    o.pair44 = this.perfect;
    o.goal = this.goal;
    // Sprint feeds 4s (twice the mass per move); a score run feeds 2s —
    // every spawned 4 forfeits the 4 points its skipped merge was worth.
    // Perfect feeds ONLY 4s: a single 2 in the build would break the
    // exact 32,781-move ledger (each pair of 2s costs one extra move).
    o.valueOrder = this.goal === "score" ? [2, 4]
                 : this.perfect ? [4]
                 : [4, 2];
    return o;
  };

  // Dead ends are keyed with feed smalls (<= 4) erased: trap families
  // differ only by where the in-flight small happens to sit, so one
  // mark condemns the whole family instead of playing whack-a-mole
  // with thousands of isomorphs. Conservative (a few viable variants
  // die too), but backtracking just diverts to a different line.
  //
  // NOT in perfect mode, though: with a 4-only spawn menu, consecutive
  // legitimate checkpoints differ exactly by 4-placements — the very
  // thing the family key erases — so one mark condemns the next
  // stretch of the build, the search sticks again, marks again, and
  // the poisoning cascades until nothing within undo reach can plan.
  // There, dead ends are exact boards.
  function deadKey(b, exact) {
    if (exact) return b.join(",");
    var out = new Array(CELLS);
    for (var i = 0; i < CELLS; i++) out[i] = b[i] <= 4 ? 0 : b[i];
    return out.join(",");
  }

  // A rest state that later proved unwinnable; searches refuse to rest
  // there again, so backtracking takes a different line. Stale cached
  // certifications that relied on it self-correct: the next visit hits
  // the (memoized, instant) failed plan and marks that state dead too,
  // propagating the dead zone backward one checkpoint at a time.
  // Family keys where smalls are transient noise (the sprint build,
  // a score run's first act): one mark diverts a whole family of
  // doomed rests, which is what makes backtracking converge there.
  // Exact keys where smalls are the substance (a 4-only perfect build,
  // the second act's dense small-differentiated rests): a family mark
  // there condemns the next stretch of legitimate checkpoints and the
  // poisoning cascades. Getting this split wrong livelocks either way.
  // (The second act runs on family keys too: its dead ends differ only
  // by where the feed 2s sit — an astronomical family that exact keys
  // can never converge on, as a budget-long two-board oscillation
  // proved. The healing rest rules were validated under family marks.)
  SuperAI.prototype.exactDeadFor = function (board) {
    return this.perfect;
  };

  SuperAI.prototype.markDeadEnd = function (board) {
    this.deadEnds[deadKey(board, this.exactDeadFor(board))] = true;
  };

  function boardDead(b) {
    for (var dir = 0; dir < 4; dir++) {
      if (simMove(b, dir).moved) return false;
    }
    return true;
  }

  SuperAI.prototype.plan = function (board) {
    var S = this.S;
    if (this.goal === "tile") {
      if (maxTile(board) >= 131072) return { type: "done" };
    } else {
      // Max score: 131072 is the halfway mark; done means the board
      // died full and mergeless with the descending chain stacked.
      if (boardDead(board)) {
        return maxTile(board) >= 131072
          ? { type: "done" }
          : { type: "stuck", reason: "board died early" };
      }
    }

    // Finale: the fold only ever starts from ONE board — the primed
    // spiral the build is defined to deliver (65536 ... 4 down the
    // snake, a spawned 4 in the last cell). The fold search is a
    // 17-million-node, gigabyte-memo affair, so it runs exactly once:
    // any other full board near the top is mid-feed churn and gets the
    // ordinary build search instead.
    var primed = board[S[15]] === 4;
    if (primed) {
      for (var pi = 0; pi <= 14; pi++) {
        if (board[S[pi]] !== (1 << (16 - pi))) { primed = false; break; }
      }
    }
    if (primed) {
      var fKey = board.join(",");
      var script = this.foldCache[fKey];
      if (!script) {
        script = collapseSearch(board, S, this.collapseMemo,
                                this.goal === "score");
        if (script && script.length) {
          this.foldCache[fKey] = script;
          this.collapseMemo = {}; // release the search's giant memo
        }
      }
      if (script && script.length) {
        return { type: "line", steps: script, phase: "finale" };
      }
      // A primed board that isn't collapsible would be a build
      // accident; fall through so the search can dig itself out.
    }

    // Failed full searches are final for a given board (dead ends only
    // ever grow), so repeat visits during backtracking are instant.
    var pfKey = board.join(",");
    if (this.planFail[pfKey]) {
      return { type: "stuck", reason: "no line to a checkpoint" };
    }

    // Second act: with 131072 home, the rest of the game is a fresh
    // sprint on the other fifteen cells — the same machine that builds
    // 65536 from nothing at a percent of churn. The healing regime only
    // bridges the post-fold swamp; once the sub-board reads as a build
    // position (nothing stranded, junk down to feed scale), the proven
    // canon machinery takes over on the sub-snake, with the corner
    // pinned as a hard anchor.
    var useS = S;
    var anchored = false;
    if (this.goal === "score" && board[S[0]] === 131072) {
      var subAna = analyze(board, this.subS, true);
      var subExtras = 0;
      for (var se = subAna.packedLen; se < this.subS.length; se++) {
        if (board[this.subS[se]] !== 0) subExtras++;
      }
      if (subAna.stranded === 0 && subExtras - subAna.train <= 2) {
        useS = this.subS;
        anchored = true;
      }
    }

    var line = null;
    var tiers = this.perfect ? PERFECT_TIERS : SEARCH_TIERS;
    for (var ti = 0; ti < tiers.length && !line; ti++) {
      var o = this.opts(tiers[ti]);
      if (anchored) { o.anchorCell = S[0]; o.anchorValue = 131072; }
      line = buildSearch(board, useS, o, this.certMemo);
    }
    if (!line && anchored) {
      // The sub-sprint found nothing from here; let the healing regime
      // (full snake) have a look before conceding a dead end.
      for (var t2 = 0; t2 < tiers.length && !line; t2++) {
        line = buildSearch(board, S, this.opts(tiers[t2]), this.certMemo);
      }
    }
    if (!line) {
      this.planFail[pfKey] = true;
      return { type: "stuck", reason: "no line to a checkpoint" };
    }

    return { type: "line", steps: line, phase: "build" };
  };

  // ------------------------------------------------------------------
  // Driver: runs plans against a real GameManager via undo re-rolls
  // ------------------------------------------------------------------

  function SuperDriver(gameManager, corner, TileCtor, options) {
    this.gm = gameManager;
    this.Tile = TileCtor;
    this.ai = new SuperAI(corner, options);
    this.options = options || {};
    this.stats = { moves: 0, undos: 0, attempts: 0, restarts: 0,
                   backtracks: 0, startedAt: 0 };
    this.backtrackStep = 4;
    this.bestPhi = -1;
    this.unwinding = false;
    this.planCache = null;
    this.consecFails = 0;
    this.lastSpawn = null;
    this.pendingSpawn = null;
    this.injectedPlan = null;
    this.attached = false;
    this.history = [];
  }

  // External planning support (browser: plans computed in a Web Worker
  // so searches never block the page). When options.externalPlanner is
  // set, step() never calls ai.plan itself: it returns
  // {type:"needplan", board} and waits for setPlan().
  SuperDriver.prototype.setPlan = function (board, plan) {
    this.injectedPlan = { key: board.join(","), plan: plan };
  };

  SuperDriver.prototype.readBoard = function () {
    var b = new Array(CELLS);
    var cells = this.gm.grid.cells;
    for (var x = 0; x < 4; x++) {
      for (var y = 0; y < 4; y++) {
        var t = cells[x][y];
        b[y * 4 + x] = t ? t.value : 0;
      }
    }
    return b;
  };

  // Replace addRandomTile with an O(1) version. The original reseeds and
  // burns score-many PRNG draws per spawn, which is unusably slow at the
  // multi-million scores Super Mode reaches. In super mode the
  // distribution is identical (uniform cell, 90/10 two/four) and the
  // undo button re-rolls the misses; in predictable mode the planner's
  // chosen tile is placed directly — no luck, no undos. The original
  // machinery is restored when the driver detaches.
  SuperDriver.prototype.attach = function () {
    if (this.attached) return;
    var self = this;
    var Tile = this.Tile;
    this.gm.addRandomTile = function () {
      var pending = self.pendingSpawn;
      self.pendingSpawn = null;
      if (pending && this.grid.cellAvailable(pending)) {
        this.grid.insertTile(new Tile(pending, pending.value));
        self.lastSpawn = { x: pending.x, y: pending.y, value: pending.value };
        return;
      }
      var cells = this.grid.availableCells();
      if (!cells.length) return;
      // A perfect game is all 4s from the very first two tiles: a
      // stray 2 could never merge again (no partner will ever spawn)
      // and would poison the board for good.
      var value = self.ai.perfect ? 4 : (Math.random() < 0.9 ? 2 : 4);
      var cell = cells[(Math.random() * cells.length) | 0];
      this.grid.insertTile(new Tile(cell, value));
      self.lastSpawn = { x: cell.x, y: cell.y, value: value };
    };
    this.attached = true;
  };

  SuperDriver.prototype.detach = function () {
    if (!this.attached) return;
    delete this.gm.addRandomTile;
    this.attached = false;
  };

  function boardsEqual(a, b) {
    for (var i = 0; i < CELLS; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // One attempt. Returns {type: "accepted"|"rejected"|"retry"|"done"|"stuck", ...}
  SuperDriver.prototype.step = function () {
    var gm = this.gm;
    var board = this.readBoard();
    if (this.ai.goal === "score"
        ? (boardDead(board) && maxTile(board) >= 131072)
        : maxTile(board) >= 131072) {
      return { type: "done" };
    }

    var cache = this.planCache;
    if (cache && !boardsEqual(board, cache.expected)) {
      // The world diverged from the line (shouldn't happen; replan).
      cache = this.planCache = null;
    }
    if (!cache && this.unwinding &&
        !(this.ai.goal === "score" && board[this.ai.S[0]] >= 131072)) {
      // Mid-unwind, don't waste full searches on obvious wrecks (they
      // are stranded-shaped mid-line intermediates); just step back.
      // Not in a score run's second act, though: healing rests carry
      // stranded tiles by nature and are perfectly plannable.
      var quick = analyze(board, this.ai.S, true);
      if (quick.stranded && gm.undoStack.length > 0) {
        gm.move(-1);
        this.stats.undos++;
        return { type: "backtrack", depth: 1 };
      }
    }
    if (!cache) {
      var plan;
      if (this.options.externalPlanner) {
        if (this.injectedPlan && this.injectedPlan.key === board.join(",")) {
          plan = this.injectedPlan.plan;
          this.injectedPlan = null;
        } else {
          return { type: "needplan", board: board };
        }
      } else {
        plan = this.ai.plan(board);
      }
      if (plan.type === "done") return { type: "done" };
      if (plan.type === "stuck") {
        this.lastStuck = { board: board, reason: plan.reason };
        if (gm.undoStack.length === 0) {
          // Nothing left to unwind: start over.
          this.unwinding = false;
          gm.restart();
          this.stats.restarts++;
          return { type: "restart" };
        }
        var back;
        if (this.unwinding) {
          // We landed on a mid-line intermediate that can't plan; that's
          // not a dead end worth recording, just keep stepping back
          // until some state plans.
          back = 1;
        } else {
          // A real wall: a rest state with no line out. Blacklist its
          // family and use the undo button for real — jump back and let
          // the search pick a different line around it.
          this.ai.markDeadEnd(board);
          if (this.options.onDeadEnd) this.options.onDeadEnd(board);
          back = Math.min(this.backtrackStep, gm.undoStack.length);
          this.backtrackStep = Math.min(this.backtrackStep * 2, 2048);
          this.stats.backtracks++;
          this.unwinding = true;
        }
        for (var u = 0; u < back; u++) {
          gm.move(-1);
          this.stats.undos++;
        }
        return { type: "backtrack", depth: back };
      }
      cache = this.planCache = { steps: plan.steps, phase: plan.phase,
                                 idx: 0, expected: board };
    }

    var step = cache.steps[cache.idx];

    // Never let the 2048 "You win!" gate block a move; undo resets the
    // flag so it has to be re-set on every attempt.
    if (gm.won && !gm.keepPlaying) gm.keepPlaying = true;

    this.lastSpawn = null;
    this.stats.attempts++;
    if (this.options.predictable) {
      // Predictable mode: the planner controls the spawn outright —
      // the exact tile it wants appears where it wants it. No luck to
      // re-roll, so no undos.
      this.pendingSpawn = { x: step.cell % 4, y: (step.cell / 4) | 0,
                           value: step.value };
    }
    gm.move(step.dir);

    if (!this.lastSpawn) {
      // The move didn't happen: plan/board desync. Replan once.
      this.planCache = null;
      if (++this.consecFails > 3) return { type: "stuck", reason: "planned move was illegal" };
      return { type: "retry" };
    }

    var sp = this.lastSpawn;
    var wantX = step.cell % 4;
    var wantY = (step.cell / 4) | 0;
    if (sp.x !== wantX || sp.y !== wantY || sp.value !== step.value) {
      gm.move(-1); // the undo button — re-rolls the spawn seed
      this.stats.undos++;
      return { type: "rejected" };
    }

    this.consecFails = 0;
    this.stats.moves++;
    this.unwinding = false;

    // Advance the line; verify the game agrees with the simulation.
    var predicted = simMove(cache.expected, step.dir).board;
    predicted[step.cell] = step.value;
    var got = this.readBoard();
    if (!boardsEqual(got, predicted)) {
      if (this.options.verify) {
        throw new Error("sim/game divergence" +
          "\nexpected " + predicted.join(",") + "\ngot      " + got.join(","));
      }
      this.planCache = null; // self-heal in production
    } else {
      cache.expected = predicted;
      cache.idx++;
      if (cache.idx >= cache.steps.length) this.planCache = null;
    }

    // Only genuinely new territory resets the backtrack ladder, and
    // "new" is judged on the big-tile backbone alone: replayed ground
    // jitters the full phi upward on every cycle (feed smalls land in
    // slightly different cells), and a ladder that resets on jitter
    // undo-replays the same wall forever without ever escalating.
    var phiNow = analyze(got, this.ai.S, true).structPhi;
    if (phiNow > this.bestPhi) {
      this.bestPhi = phiNow;
      this.backtrackStep = 4;
    }

    var primed = chainComplete(got, this.ai.S) && got[this.ai.S[15]] === 4;

    if (this.options.trace) {
      var ana = analyze(got, this.ai.S);
      this.history.push({ n: this.stats.moves, dir: step.dir, phase: cache.phase,
        board: got, junk: ana.floats + ana.leaked + ana.stranded,
        prefixPhi: ana.prefixPhi });
      if (this.history.length > 60) this.history.shift();
    }

    // Keep the fork's unbounded undo stack from hoarding memory over a
    // ~33k-move run; the AI only ever needs one level.
    if (gm.undoStack && gm.undoStack.length > 3000) gm.undoStack.splice(0, 500);

    return { type: "accepted",
             phase: primed ? "primed" : cache.phase };
  };

  // ------------------------------------------------------------------

  // Debug helper: rank all depth-1 controlled outcomes of a position.
  function debugChildren(b, S, limit) {
    var rows = [];
    for (var dir = 0; dir < 4; dir++) {
      var sim = simMove(b, dir);
      if (!sim.moved) continue;
      var empt = emptyCells(sim.board);
      for (var e = 0; e < empt.length; e++) {
        for (var vi = 0; vi < 2; vi++) {
          var val = vi ? 2 : 4;
          var nb = sim.board.slice();
          nb[empt[e]] = val;
          var ana = analyze(nb, S);
          rows.push({ dir: dir, cell: empt[e], value: val, phi: ana.prefixPhi,
                      frontier: ana.packedLen,
                      junk: ana.floats + ana.leaked + ana.stranded });
        }
      }
    }
    rows.sort(function (a, b2) { return b2.phi - a.phi; });
    return rows.slice(0, limit || 12);
  }

  // ------------------------------------------------------------------
  // Headless runner: no GUI, no GameManager — pure matrix data
  // ------------------------------------------------------------------

  // The whole game as flat 16-element arrays: the planner, the moves,
  // the 90/10 spawn odds and the undo re-rolls all happen in here. No
  // DOM, no tile objects, no frames to wait for — the only cost left
  // is the planner itself. run(ms) advances in bounded slices so the
  // host (the web worker, a Node script) can stay responsive and
  // report progress between slices.
  function HeadlessRunner(corner, options) {
    options = options || {};
    this.S = snakeCells(corner);
    this.ai = new SuperAI(corner, { goal: options.goal,
                                    perfect: options.perfect });
    this.goal = this.ai.goal;
    // Perfect play is forward-only by definition; it never pays the
    // undo trick because it never needs it.
    this.predictable = !!options.predictable || this.ai.perfect;
    // moves counts the SURVIVING line — the game as actually played.
    // Search backtracking rewinds it (simulation, not undos); explored
    // counts every applied step, kept or not, as the work meter.
    this.stats = { moves: 0, attempts: 0, undos: 0, backtracks: 0,
                   restarts: 0, score: 0, explored: 0 };
    this.board = this.freshBoard();
    this.hist = [];
    this.backStep = 4;
    this.unwinding = false;
    this.bestPhi = -1;
    this.done = false;
  }

  HeadlessRunner.prototype.freshBoard = function () {
    var b = [];
    for (var i = 0; i < CELLS; i++) b.push(0);
    this.spawnRandom(b);
    this.spawnRandom(b);
    return b;
  };

  HeadlessRunner.prototype.spawnRandom = function (b) {
    var empt = emptyCells(b);
    if (!empt.length) return;
    b[empt[(Math.random() * empt.length) | 0]] =
      this.ai.perfect ? 4 : (Math.random() < 0.9 ? 2 : 4);
  };

  HeadlessRunner.prototype.goalDone = function (b) {
    if (this.goal !== "score") return maxTile(b) >= 131072;
    return maxTile(b) >= 131072 && boardDead(b);
  };

  // Commit one planned spawn. Predictable mode places it; super mode
  // pays for it honestly — uniform cell over the empties, 90/10 value,
  // one simulated undo re-roll per miss. Identical distribution, same
  // expected number of undos as driving the real game.
  HeadlessRunner.prototype.place = function (step, post) {
    if (this.predictable) { this.stats.attempts++; return; }
    var empt = 0;
    for (var i = 0; i < CELLS; i++) if (post[i] === 0) empt++;
    var pWant = step.value === 2 ? 0.9 : 0.1;
    var attempts = 1;
    while (!(((Math.random() * empt) | 0) === 0 && Math.random() < pWant)) {
      attempts++;
    }
    this.stats.attempts += attempts;
    this.stats.undos += attempts - 1;
  };

  // Advance for about `ms` milliseconds. Returns true once the goal
  // board is reached; this.board / this.stats carry the live state.
  HeadlessRunner.prototype.run = function (ms) {
    var until = Date.now() + (ms || 100);
    while (!this.done && Date.now() < until) {
      var b = this.board;
      if (this.goalDone(b)) { this.done = true; break; }

      var plan = this.ai.plan(b);
      if (plan.type === "done") { this.done = true; break; }

      if (plan.type === "stuck") {
        // Mirror the driver's undo-backtracking on the plain history.
        if (!this.hist.length) {
          this.stats.restarts++;
          this.board = this.freshBoard();
          this.stats.moves = 0;
          this.stats.score = 0;
          this.unwinding = false;
          this.backStep = 4;
          continue;
        }
        var back;
        if (this.unwinding) {
          back = 1;
        } else {
          this.ai.markDeadEnd(b);
          back = Math.min(this.backStep, this.hist.length);
          this.backStep = Math.min(this.backStep * 2, 2048);
          this.stats.backtracks++;
          this.unwinding = true;
        }
        while (back-- > 0 && this.hist.length) {
          var h1 = this.hist.pop();
          this.board = h1.b;
          this.stats.moves--;
          this.stats.score -= h1.g;
          if (!this.predictable) this.stats.undos++;
        }
        // Skip planning on obviously wrecked mid-line intermediates —
        // except in a score run's second act, where stranded tiles are
        // the normal look of a perfectly plannable board.
        if (!(this.goal === "score" && this.board[this.S[0]] >= 131072)) {
          while (this.hist.length &&
                 analyze(this.board, this.S, true).stranded) {
            var h2 = this.hist.pop();
            this.board = h2.b;
            this.stats.moves--;
            this.stats.score -= h2.g;
            if (!this.predictable) this.stats.undos++;
          }
        }
        continue;
      }

      for (var i = 0; i < plan.steps.length; i++) {
        var step = plan.steps[i];
        var sim = simMove(this.board, step.dir);
        var msum = 0;
        for (var mg = 0; mg < sim.merges.length; mg++) msum += sim.merges[mg];
        this.hist.push({ b: this.board, g: msum });
        if (this.hist.length > 3000) this.hist.splice(0, 100);
        this.stats.score += msum;
        this.place(step, sim.board);
        sim.board[step.cell] = step.value;
        this.board = sim.board;
        this.stats.moves++;
        this.stats.explored++;
        this.unwinding = false;
        var phi = analyze(this.board, this.S, true).structPhi;
        if (phi > this.bestPhi) { this.bestPhi = phi; this.backStep = 4; }
      }
    }
    if (!this.done && this.goalDone(this.board)) this.done = true;
    return this.done;
  };

  var api = {
    SuperAI: SuperAI,
    SuperDriver: SuperDriver,
    HeadlessRunner: HeadlessRunner,
    snakeCells: snakeCells,
    simMove: simMove,
    analyze: analyze,
    chainComplete: chainComplete,
    maxTile: maxTile,
    debugChildren: debugChildren
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.Super2048 = api;
  }
})(this);
