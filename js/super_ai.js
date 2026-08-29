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
  function analyze(b, S, loose) {
    var prefixPhi = 0;
    var bigMass = 0;
    var prev = Infinity;
    var pairUsed = false;
    var pairAt = -1;
    var packedLen = 0;
    while (packedLen < CELLS) {
      var v = b[S[packedLen]];
      if (v === 0) break;
      if (v > prev) break;
      if (v === prev) {
        // A healthy counter carries at most one equal (mergeable) pair;
        // runs of three-plus can't be merged without side damage.
        if (pairUsed) break;
        pairUsed = true;
        pairAt = packedLen;
      }
      prefixPhi += v * W[packedLen];
      // The big-structure mass: feed smalls churn constantly, but the
      // >= 8 backbone (walk + docked train) only changes on structural
      // events, and merges within it preserve it exactly — the right
      // invariant to hold while a line rummages through the board.
      if (v >= 8) bigMass += v;
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
    for (var j = packedLen; j < CELLS; j++) {
      var jv = b[S[j]];
      if (jv === 0) { workshop = true; continue; }
      if (jv <= 4) { floats++; inSmalls = true; continue; }
      if (workshop) {
        floats++;
        train++;
        bigMass += jv;
        continue;
      }
      var limit = trainPrev >= 0 ? trainPrev : headOK;
      if (jv <= limit && (!inSmalls || j === CELLS - 1)) {
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
    return { prefixPhi: prefixPhi, bigMass: bigMass,
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
    var loose = !opts.strictPairs;
    var start = analyze(b0, S, loose);
    var maxDepth = opts.depth;
    var budget = { nodes: opts.nodes };
    var failed = {};
    var si = {};
    for (var i = 0; i < CELLS; i++) si[S[i]] = i;

    // Certified checkpoints: a rest state only counts if a (cheaper,
    // memoized) follow-up search proves it can improve again. Traps are
    // exactly the rest states with no onward line, so they self-reject
    // no matter how plausible they look to the shape rules.
    // Rest states are so constrained (see isGoal) that onward viability
    // is simply the next plan's problem; the dead-end family blacklist
    // plus undo-backtracking referee everything else.
    function certify(nb) {
      return !(opts.deadEnds && opts.deadEnds[deadKey(nb)]);
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
        if (analyze(sim.board, S, loose).stranded <= lim) return true;
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
      for (var q = packedLen; q < CELLS; q++) {
        if (nb[S[q]] !== 0) n++;
      }
      return n;
    }
    var startExtras = countExtras(b0, start.packedLen);

    // Score runs enter a second act once 131072 is home: the collapse
    // leaves the board swamped in spawned junk, and a whole new chain
    // (65536 downward) must be bootstrapped through it. That junk is
    // BIGGER than the baby chain hanging off the corner, so the strict
    // build-phase classification would call every consolidation step
    // damage, and the canon rest bar (a contiguous walk with one small
    // extra) sits 30+ moves past every pair merge that vacates a cell —
    // out of any search's reach. The healing regime stays on for the
    // whole second act and rests on structural progress instead.
    var healing = opts.goal === "score" && b0[S[0]] >= 131072;

    // The one board a score run is allowed to die on: every cell holding
    // the full descending chain 131072..4 — the maximum-score death.
    function maxDeath(nb) {
      for (var i = 0; i < CELLS; i++) {
        if (nb[S[i]] !== (1 << (17 - i))) return false;
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
      for (var i = 0; i < CELLS; i++) {
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
      var lastBig = -1;
      for (var i = CELLS - 1; i >= 0; i--) {
        if (nb[S[i]] >= 8) { lastBig = i; break; }
      }
      var n = 0;
      for (var j = 0; j < lastBig; j++) {
        var v = nb[S[j]];
        if (v > 0 && v <= 4) n++;
      }
      return n;
    }
    var startMisplaced = misplacedOf(b0);

    function isGoal(ana, nb, gained) {
      var extras = 0;
      var canon = !ana.stranded;
      for (var q = ana.packedLen; q < CELLS; q++) {
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
      var lim = opts.allCells ? CELLS - 1 : Math.min(CELLS - 1, packedLen + 4);
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
        var sa = analyze(sim.board, S, loose);
        var msum = 0;
        for (var mg = 0; mg < sim.merges.length; mg++) msum += sim.merges[mg];
        sims.push({ dir: dir, board: sim.board, ana: sa, msum: msum });
      }
      sims.sort(function (a, b2) { return b2.ana.prefixPhi - a.ana.prefixPhi; });
      for (var m = 0; m < sims.length; m++) {
        var post = sims[m];
        var spawns = spawnCells(post.board, post.ana.packedLen);
        for (var e = 0; e < spawns.length; e++) {
          for (var vi = 0; vi < 2; vi++) {
            var val = opts.valueOrder[vi];
            var nb = post.board.slice();
            nb[spawns[e]] = val;
            if (healing && !anchorOK(nb)) continue;
            var ana = analyze(nb, S, loose);
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
  function collapseSearch(b, S, memo, mustContinue) {
    // Success means 131072 ON THE CHOSEN CORNER, not merely somewhere:
    // the final 65536+65536 merge must land at S[0]. A sprint is happy
    // to die right there; a score run must keep playing, so its collapse
    // has to leave the garbage with at least one legal move in it.
    if (b[S[0]] >= 131072) {
      if (!mustContinue) return [];
      return boardDead(b) ? null : [];
    }
    if (maxTile(b) >= 131072) return null;
    var key = b.join(",");
    if (memo.hasOwnProperty(key)) return memo[key];
    memo[key] = null; // cycle guard
    var result = null;
    outer:
    for (var dir = 0; dir < 4; dir++) {
      var sim = simMove(b, dir);
      if (!sim.moved) continue;
      if (sim.merges.length !== 1 || sim.merges[0] < 8) continue;
      var empt = emptyCells(sim.board);
      if (empt.length !== 1) continue;
      for (var vi = 0; vi < 2; vi++) {
        var val = vi === 0 ? 2 : 4; // 2 first: 9x cheaper to sample
        var nb = sim.board.slice();
        nb[empt[0]] = val;
        var sub = collapseSearch(nb, S, memo, mustContinue);
        if (sub) {
          result = [{ dir: dir, cell: empt[0], value: val }].concat(sub);
          break outer;
        }
      }
    }
    memo[key] = result;
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
    this.S = snakeCells(corner);
    this.collapseMemo = {};
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
    o.goal = this.goal;
    // Sprint feeds 4s (twice the mass per move); a score run feeds 2s —
    // every spawned 4 forfeits the 4 points its skipped merge was worth.
    o.valueOrder = this.goal === "score" ? [2, 4] : [4, 2];
    return o;
  };

  // Dead ends are keyed with feed smalls (<= 4) erased: trap families
  // differ only by where the in-flight small happens to sit, so one
  // mark condemns the whole family instead of playing whack-a-mole
  // with thousands of isomorphs. Conservative (a few viable variants
  // die too), but backtracking just diverts to a different line.
  function deadKey(b) {
    var out = new Array(CELLS);
    for (var i = 0; i < CELLS; i++) out[i] = b[i] <= 4 ? 0 : b[i];
    return out.join(",");
  }

  // A rest state that later proved unwinnable; searches refuse to rest
  // there again, so backtracking takes a different line. Stale cached
  // certifications that relied on it self-correct: the next visit hits
  // the (memoized, instant) failed plan and marks that state dead too,
  // propagating the dead zone backward one checkpoint at a time.
  SuperAI.prototype.markDeadEnd = function (board) {
    this.deadEnds[deadKey(board)] = true;
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

    // Finale: full board at 65536+ (and no 131072 yet) means we're
    // folding the spiral.
    if (board[S[0]] < 131072 &&
        maxTile(board) >= 65536 && emptyCells(board).length === 0) {
      var script = collapseSearch(board, S, this.collapseMemo,
                                  this.goal === "score");
      if (script && script.length) {
        return { type: "line", steps: script, phase: "finale" };
      }
      // A full board that isn't collapsible would be a build accident;
      // fall through to the search so it can dig itself out.
    }

    // Failed full searches are final for a given board (dead ends only
    // ever grow), so repeat visits during backtracking are instant.
    var pfKey = board.join(",");
    if (this.planFail[pfKey]) {
      return { type: "stuck", reason: "no line to a checkpoint" };
    }

    var line = null;
    for (var ti = 0; ti < SEARCH_TIERS.length && !line; ti++) {
      line = buildSearch(board, S, this.opts(SEARCH_TIERS[ti]), this.certMemo);
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
      var value = Math.random() < 0.9 ? 2 : 4;
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
          this.backtrackStep = Math.min(this.backtrackStep * 2, 512);
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

    // Only genuinely new territory resets the backtrack ladder;
    // replaying old ground after an undo keeps it climbing.
    var phiNow = analyze(got, this.ai.S, true).prefixPhi;
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
    if (gm.undoStack && gm.undoStack.length > 600) gm.undoStack.splice(0, 500);

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

  var api = {
    SuperAI: SuperAI,
    SuperDriver: SuperDriver,
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
