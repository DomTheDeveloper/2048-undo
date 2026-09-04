// Generates js/perfect_line.js — the perfect game as data.
//
//   node test/gen_perfect.js
//
// The perfect game is a computed constant, not a runtime search. Mass
// fixes its length: slides conserve mass, every legal move spawns one
// tile, so an all-4 build from the two starting 4s (mass 8) to the
// primed spiral (mass 131,072) takes EXACTLY (131072-8)/4 = 32,766
// moves whatever the route, and the proven-minimal fold adds 15 more:
// 32,781 moves, zero undos, by construction.
//
// The build walks a binary counter along the snake. Restricted action
// space IS the motif algebra: carries slide toward the tail row's head,
// drop-feeds slide rowward, the top-row dance slides away from the
// head; spawns go to the counter-extension cell or to hover cells one
// physical row deeper. A structural score over the snake (only the
// non-increasing prefix counts, one pending carry allowed, everything
// else a value-scaled liability) drives a 1-ply greedy; an
// iterative-deepening rescue threads the turns and seats. Mass grows
// every move, so no board can repeat and the walk cannot cycle.
//
// The result is verified by full replay — every slide must move, every
// spawn cell must be empty — for all four corners (the other three are
// exact mirror images), then written as two hex chars per step:
// bits 0-1 dir, 2-5 spawn cell, 6 spawn value (0 = 4, 1 = 2; 2s appear
// only as the fold's junk spawns).

"use strict";

var fs = require("fs");
var path = require("path");
var Super = require(path.join(__dirname, "..", "js", "super_ai.js"));

var CORNER = "br"; // canonical; other corners are transforms
var S = Super.snakeCells(CORNER);
var VERBOSE = process.env.V === "1";

// Two perfect lines share this generator:
//   TARGET=tile — the 32,781-move game to the 131072 tile (build the
//                 primed spiral in exactly 32,766 moves, then the
//                 proven 15-move fold).
//   TARGET=full — the 65,533-move game to the COMPLETE spiral: fold
//                 the tile mid-line, then keep building until every
//                 power of two from 131072 down to 4 sits on the board
//                 at once. The ledger is target-agnostic: mass 8 to
//                 mass 262,140 at +4 a move is 65,533 moves whatever
//                 the route, so only reachability needs constructing.
//   TARGET=score — the maximum-score game: the same complete spiral,
//                 fed with 2s. Two 4-spawns are structurally forced,
//                 one per act boundary: the fold-entry and the final
//                 death are both full-board squeezes where the tail 4
//                 cannot be staged from 2+2 (no room for the pair). So
//                 the line is exactly (262140 - 4 - 8)/2 + 2 = 131,066
//                 moves from two starting 2s, scoring exactly 3,932,156.
var TARGET = process.env.TARGET === "tile" ? "tile"
           : process.env.TARGET === "score" ? "score" : "full";
var PLANT = TARGET === "score" ? 2 : 4;
var START_MASS = TARGET === "score" ? 4 : 8;
// 4-plants unlock at exactly the two forced moments — the fold-entry
// and the final death, both with pre-plant mass 4 short of an act's
// full board. Any wider window lets stray 4s in, and every stray 4
// costs one move of length and 4 points off the exact maximum.
function squeeze(bm) {
  return bm === 131068 || bm === 262136;
}

function chainDone(b) {
  for (var i = 0; i < 16; i++) {
    if (b[S[i]] !== (1 << (17 - i))) return false;
  }
  return true;
}
function targetDone(b) {
  return TARGET === "tile" ? spiralReached(b) : chainDone(b);
}
var TARGET_MOVES = TARGET === "full" ? 65533
                 : TARGET === "score" ? 131066 : 32766;

function xy(i) { return { x: i % 4, y: (i / 4) | 0 }; }
function dirFromTo(a, b) {
  var A = xy(a), B = xy(b);
  if (B.x > A.x) return 1;
  if (B.x < A.x) return 3;
  if (B.y > A.y) return 2;
  return 0;
}
var OPP = { 0: 2, 1: 3, 2: 0, 3: 1 };

var HEADDIR = [];
for (var r = 0; r < 4; r++) HEADDIR.push(dirFromTo(S[4 * r + 1], S[4 * r]));
var ROWWARD = dirFromTo(S[4], S[3]);

function hoverCell(c) {
  var v = { 0: { x: 0, y: 1 }, 1: { x: -1, y: 0 },
            2: { x: 0, y: -1 }, 3: { x: 1, y: 0 } }[ROWWARD];
  var p = xy(c);
  var hx = p.x + v.x, hy = p.y + v.y;
  if (hx < 0 || hx > 3 || hy < 0 || hy > 3) return -1;
  return hy * 4 + hx;
}

function spiralReached(b) {
  if (b[S[15]] !== 4) return false;
  for (var i = 0; i <= 14; i++) if (b[S[i]] !== (1 << (16 - i))) return false;
  return true;
}

function H(b) {
  var mx = 0;
  for (var m = 0; m < 16; m++) if (b[m] > mx) mx = b[m];
  var L = 0;
  var prev = Infinity;
  var pairUsed = false;
  if (b[S[0]] === mx) {
    while (L < 16) {
      var v0 = b[S[L]];
      if (!v0 || v0 > prev) break;
      if (v0 === prev) {
        if (pairUsed) break;
        pairUsed = true;
      }
      prev = v0;
      L++;
    }
  }
  var acc = 0;
  for (var i = 0; i < L; i++) acc += b[S[i]] * Math.pow(0.5, i);
  for (var j = L; j < 16; j++) {
    var v = b[S[j]];
    if (v) acc += -v * 1e3 + j * 1e-4;
  }
  return acc;
}

// How far ahead committed states are checked for full-board traps.
// 2-feed terrain funnels into dead gapless rows up to four plies out
// ([16,4,2,2] -> [2,16,4,4] -> [2,2,16,8] -> all children immobile),
// and branching at <=2 empties is tiny (1-4), so depth five is cheap.
var TRAP_DEPTH = 5;

// Stall families are banned with the in-flight smalls erased: a stall
// board differs from its thousand siblings only by where the 2s and 4s
// happen to sit, so an exact ban just reroutes into the next sibling.
// The key is the big structure plus how full the board is; the ledger
// keeps any surviving route exact, so over-banning can only reroute.
var BANFAM = {};
function familyKey(b) {
  var out = new Array(16);
  var empties = 0;
  for (var i = 0; i < 16; i++) {
    out[i] = b[i] >= 8 ? b[i] : 0;
    if (!b[i]) empties++;
  }
  return out.join(",") + "|" + empties;
}

function candidates(b, seen, depth, existsOnly) {
  if (depth === undefined) depth = TRAP_DEPTH;
  var z = -1;
  for (var zi = 0; zi < 16; zi++) if (b[S[zi]] === 0) { z = zi; break; }
  var tailRow = z < 0 ? 3 : (z / 4) | 0;
  var dirs = [HEADDIR[tailRow], ROWWARD, OPP[HEADDIR[tailRow]]];
  var out = [];
  for (var di = 0; di < dirs.length; di++) {
    var dir = dirs[di];
    var sim = Super.simMove(b, dir);
    if (!sim.moved) continue;
    var plants = [];
    var seenP = {};
    var cnt = 0;
    for (var i = 0; i < 16 && cnt < 2; i++) {
      if (sim.board[S[i]] === 0) { plants.push(S[i]); seenP[S[i]] = 1; cnt++; }
    }
    for (var k = 0; k < 4; k++) {
      var hc = hoverCell(S[4 * tailRow + k]);
      if (hc >= 0 && sim.board[hc] === 0 && !seenP[hc]) {
        plants.push(hc); seenP[hc] = 1;
      }
    }
    // 2-feeding gets the 4-spawn menu only inside the death squeeze:
    // the final 8 and the tail 4 cannot be staged from 2s in the space
    // left, and keeping 4s out everywhere else is what makes the
    // score exact.
    var pvals = [PLANT];
    if (PLANT === 2) {
      var bm = 0;
      for (var bmi = 0; bmi < 16; bmi++) bm += sim.board[bmi];
      if (squeeze(bm)) pvals = [2, 4];
    }
    for (var pi = 0; pi < plants.length; pi++) {
     for (var pvi = 0; pvi < pvals.length; pvi++) {
      var nb = sim.board.slice();
      nb[plants[pi]] = pvals[pvi];
      var key = nb.join(",");
      if (seen[key]) continue;
      // Banned stall families are dead ends — but the target itself
      // can share a family with a death-squeeze trap, so it is exempt.
      if (BANFAM[familyKey(nb)] && !targetDone(nb)) continue;
      // Once the 131072 exists, nothing may ever sit head-ward of it:
      // no smaller tile can merge its way past, so such boards are
      // unwinnable however long they stay mobile.
      var hi = -1;
      for (var hj = 0; hj < 16; hj++) {
        if (nb[S[hj]] === 131072) { hi = hj; break; }
      }
      if (hi > 0) {
        var blocked = false;
        for (var hk = 0; hk < hi; hk++) {
          if (nb[S[hk]]) { blocked = true; break; }
        }
        if (blocked) continue;
      }
      if (!targetDone(nb)) {
        var mobile = false;
        var mz = -1;
        for (var mzi = 0; mzi < 16; mzi++) if (!nb[S[mzi]]) { mz = mzi; break; }
        var mrow = mz < 0 ? 3 : (mz / 4) | 0;
        var mdirs = [HEADDIR[mrow], ROWWARD, OPP[HEADDIR[mrow]]];
        for (var mdi = 0; mdi < 3 && !mobile; mdi++) {
          if (Super.simMove(nb, mdirs[mdi]).moved) mobile = true;
        }
        if (!mobile) continue;
        // Near-full boards get a second ply: a state can be mobile yet
        // have every onward move die at once. The classic trap is the
        // very last plant — seating the second-to-last 4 shallow
        // ([16,8,4,_] row) reads as a longer walk but forces game over
        // one move short of the target; only [16,8,_,4] can finish.
        // Active whenever the board is nearly full: the trap exists at
        // BOTH era boundaries (the primed spiral before the fold, and
        // the complete chain at the very end), and the fold-era boards
        // that live at 1-2 empties simply pay the one extra ply.
        if (depth > 1) {
          var empties = 0;
          for (var ei = 0; ei < 16; ei++) if (!nb[ei]) empties++;
          if (empties <= 2 &&
              candidates(nb, {}, depth - 1, true).length === 0) continue;
        }
      }
      out.push({ dir: dir, cell: plants[pi], value: pvals[pvi],
                 nb: nb, key: key, h: H(nb) });
      if (existsOnly) return out; // caller only needs viability
     }
    }
  }
  out.sort(function (p, q) { return q.h - p.h; });
  return out;
}

function rescueDFS(b, seen, depth, floor, fuel) {
  if (fuel.n-- <= 0) return null;
  // Cheap filters only inside the tree: the deep near-full lookahead
  // on every explored node is a multiplicative bomb in 1-2-empty
  // terrain (measured at 94% of all work). Committed states still get
  // the full check — the greedy's own picks and, below, the ending of
  // any rescue line before it is accepted.
  var cands = candidates(b, seen, 1);
  for (var i = 0; i < Math.min(cands.length, 10); i++) {
    var c = cands[i];
    if (c.h > floor) return [c];
    if (depth > 1) {
      seen[c.key] = true;
      var sub = rescueDFS(c.nb, seen, depth - 1, floor, fuel);
      delete seen[c.key];
      if (sub) return [c].concat(sub);
    }
  }
  return null;
}
function rescue(b, maxDepth, floor, banned) {
  var bad = banned ? Object.create(banned) : {};
  for (var d = 2; d <= maxDepth; d++) {
    for (var tries = 0; tries < 6; tries++) {
      var fuel = { n: 60000 };
      var r = rescueDFS(b, bad, d, floor, fuel);
      if (!r) {
        if (fuel.n <= 0) return null;
        break; // depth exhausted, go deeper
      }
      // Validate the line's ending with the full trap check; a doomed
      // ending gets banned and the search retried. Intermediate states
      // need no check — a found line moves through them by definition.
      var fin = r[r.length - 1];
      var empt = 0;
      for (var i = 0; i < 16; i++) if (!fin.nb[i]) empt++;
      if (empt <= 2 && !targetDone(fin.nb) &&
          candidates(fin.nb, {}, TRAP_DEPTH, true).length === 0) {
        bad[fin.key] = true;
        continue;
      }
      return r;
    }
  }
  return null;
}

function startBoard() {
  var b = [];
  for (var i = 0; i < 16; i++) b.push(0);
  b[S[0]] = PLANT;
  b[S[1]] = PLANT;
  return b;
}

function replayBoard(steps) {
  var b = startBoard();
  for (var k = 0; k < steps.length; k++) {
    var st = steps[k];
    var sim = Super.simMove(b, st.dir);
    if (!sim.moved || sim.board[st.cell] !== 0) {
      throw new Error("replay broke at step " + k);
    }
    sim.board[st.cell] = st.value;
    b = sim.board;
  }
  return b;
}

function generateBuild() {
  var b = startBoard();

  var steps = [];
  var t0 = Date.now();
  var lastReport = 0;

  // The walk state is just (board, steps), so a long generation run can
  // survive its host dying: GEN_CKPT=<file> persists both every few
  // seconds and a relaunch picks up mid-line. The mass ledger guards
  // the resume: 8 + 4*steps must equal the board's mass exactly.
  var CKPT = process.env.GEN_CKPT || null;
  var lastCkpt = 0;
  if (CKPT && fs.existsSync(CKPT)) {
    var ck = JSON.parse(fs.readFileSync(CKPT, "utf8"));
    var cm = 0;
    for (var ci = 0; ci < 16; ci++) cm += ck.board[ci];
    var spawned = 0;
    for (var si2 = 0; si2 < ck.steps.length; si2++) spawned += ck.steps[si2].value;
    if (ck.target && ck.target !== TARGET) {
      console.log("  checkpoint is for TARGET=" + ck.target + ", starting fresh");
    } else if (cm !== START_MASS + spawned) {
      throw new Error("checkpoint fails the mass ledger");
    } else {
      b = ck.board;
      steps = ck.steps;
      console.log("  resumed at move " + steps.length);
    }
  }

  var milestone = 0;
  // The greedy is forward-only, so a region condemned by the trap
  // check needs a way OUT, not just a refusal: on a stall, ban the
  // exact board, retreat a doubling number of moves (the same ladder
  // dynamics that make the game runner converge — mass growth means
  // no cycles), and let the replay steer around the family.
  var banned = {};
  var backStep = 8;
  var maxLen = steps.length;
  var stalls = 0;
  while (!targetDone(b)) {
    if (CKPT && Date.now() - lastCkpt >= 15000) {
      lastCkpt = Date.now();
      fs.writeFileSync(CKPT + ".tmp",
        JSON.stringify({ target: TARGET, board: b, steps: steps }));
      fs.renameSync(CKPT + ".tmp", CKPT);
    }
    if (steps.length > TARGET_MOVES) {
      throw new Error("overran the ledger at " + steps.length + " moves");
    }
    var cur = H(b);
    var cands = candidates(b, banned);
    var pick = null;
    if (cands.length && cands[0].h > cur) {
      pick = [cands[0]];
    } else {
      pick = rescue(b, 10, cur, banned);
      if (!pick && cands.length) pick = [cands[0]];
      if (!pick) {
        stalls++;
        if (stalls > 2000) {
          throw new Error("gave up after " + stalls + " stalls at move " +
            steps.length + " board=[" + b.join(",") + "]");
        }
        BANFAM[familyKey(b)] = true;
        var pop = Math.min(backStep, steps.length);
        backStep = Math.min(backStep * 2, 2048);
        steps.length = steps.length - pop;
        b = replayBoard(steps);
        if (VERBOSE) {
          console.log("  stall #" + stalls + ": banned a dead family, " +
            "backtracked " + pop + " to move " + steps.length);
        }
        continue;
      }
    }
    for (var k = 0; k < pick.length; k++) {
      steps.push({ dir: pick[k].dir, cell: pick[k].cell, value: pick[k].value });
      b = pick[k].nb;
      if (!milestone && Super.maxTile(b) >= 131072) {
        milestone = steps.length;
        console.log("  131072 forms at move " + milestone);
      }
    }
    if (steps.length > maxLen) {
      maxLen = steps.length;
      backStep = 8; // new ground: the ladder resets
    }
    if (VERBOSE && Date.now() - lastReport >= 5000) {
      lastReport = Date.now();
      console.log("  build move " + steps.length + " max=" + Super.maxTile(b) +
        " " + ((Date.now() - t0) / 1000).toFixed(1) + "s");
    }
  }
  if (steps.length !== TARGET_MOVES) {
    throw new Error("target in " + steps.length + " moves; ledger says " +
      TARGET_MOVES);
  }
  if (CKPT) { try { fs.unlinkSync(CKPT); } catch (e) {} }
  return { steps: steps, board: b, milestone: milestone };
}

function encode(steps) {
  var out = new Array(steps.length);
  for (var i = 0; i < steps.length; i++) {
    var s = steps[i];
    var byte = (s.dir & 3) | ((s.cell & 15) << 2) | (s.value === 2 ? 64 : 0);
    out[i] = (byte < 16 ? "0" : "") + byte.toString(16);
  }
  return out.join("");
}

function verifyCorner(corner, which) {
  var book = Super.perfectBook(corner, which);
  if (!book) throw new Error("perfectBook(" + corner + "," + which + ") failed to load");
  var Sc = Super.snakeCells(corner);
  var b = book.start.slice();
  var score = 0;
  for (var i = 0; i < book.steps.length; i++) {
    var st = book.steps[i];
    var sim = Super.simMove(b, st.dir);
    if (!sim.moved) {
      throw new Error(corner + ": step " + i + " does not move");
    }
    if (sim.board[st.cell] !== 0) {
      throw new Error(corner + ": step " + i + " spawns on occupied cell");
    }
    for (var m = 0; m < sim.merges.length; m++) score += sim.merges[m];
    sim.board[st.cell] = st.value;
    b = sim.board;
  }
  if (which === "full" || which === "score") {
    var wantSteps = which === "full" ? 65533 : 131066;
    var wantScore = which === "full" ? 3670024 : 3932156;
    if (book.steps.length !== wantSteps) {
      throw new Error(corner + ": " + book.steps.length + " steps, want " + wantSteps);
    }
    if (!Super.fullChain(b, Sc)) {
      throw new Error(corner + ": final board is not the full spiral");
    }
    for (var d = 0; d < 4; d++) {
      if (Super.simMove(b, d).moved) {
        throw new Error(corner + ": full-spiral board is not dead");
      }
    }
    // Path-independent: every tile 2^k built from 4s banks (k-2)*2^k
    // (full chain: 3,670,024); built from 2s it banks (k-1)*2^k, minus
    // 4 per forced 4-spawn (full chain: 3,932,164 - 8 = 3,932,156).
    if (score !== wantScore) {
      throw new Error(corner + ": score " + score + ", want " + wantScore);
    }
    if (which === "score") {
      var fours = [];
      for (var f = 0; f < book.steps.length; f++) {
        if (book.steps[f].value === 4) fours.push(f + 1);
      }
      if (fours.length !== 2) {
        throw new Error(corner + ": " + fours.length +
          " four-spawns (at " + fours.join(",") + "), want exactly 2");
      }
    }
    console.log("  " + corner + ": " + wantSteps + " steps replay clean — " +
      "full spiral, dead board, score " + wantScore);
  } else {
    if (book.steps.length !== 32781) {
      throw new Error(corner + ": " + book.steps.length + " steps, want 32781");
    }
    if (b[Sc[0]] !== 131072) {
      throw new Error(corner + ": final board lacks 131072 in the corner");
    }
    console.log("  " + corner + ": 32,781 steps replay clean, 131072 seated");
  }
}

console.log("building the " + TARGET_MOVES.toLocaleString("en-US") +
  "-move counter line (TARGET=" + TARGET + ", " + CORNER + ")...");
var build = generateBuild();
console.log("  target reached, ledger exact" +
  (build.milestone ? " — 131072 formed at move " + build.milestone : ""));

var line;
if (TARGET === "tile") {
  console.log("folding (engine's proven 15-move collapse)...");
  var ai = new Super.SuperAI(CORNER, { goal: "tile" });
  var fold = ai.plan(build.board);
  if (fold.type !== "line" || fold.phase !== "finale") {
    throw new Error("fold plan came back " + fold.type + "/" + fold.phase);
  }
  if (fold.steps.length !== 15) {
    throw new Error("fold took " + fold.steps.length + " moves, want 15");
  }
  line = build.steps.concat(fold.steps);
  console.log("  fold is 15 moves; total " + line.length);
} else {
  line = build.steps; // the fold happened mid-line, inside the greedy
}

// Preserve whichever other line is already shipped.
var existing = {};
try { existing = require(path.join(__dirname, "..", "js", "perfect_line.js")); }
catch (e) {}
var hexTile = TARGET === "tile" ? encode(line) : existing.hex;
var hexFull = TARGET === "full" ? encode(line) : existing.full;
var hexScore = TARGET === "score" ? encode(line) : existing.score;

var out = "// Generated by test/gen_perfect.js — do not edit.\n" +
  "//\n" +
  "// The perfect 2048 games as data. Two hex chars per step: bits 0-1\n" +
  "// direction (0 up, 1 right, 2 down, 3 left), bits 2-5 spawn cell\n" +
  "// (y*4+x), bit 6 spawn value (0 = 4, 1 = 2). Canonical corner:\n" +
  "// bottom-right; the engine mirrors it for the others. Lengths are\n" +
  "// forced by the mass ledger (slides conserve mass, each move spawns\n" +
  "// once):\n" +
  "//   hex  — to the 131072 tile: (131072-8)/4 = 32,766 build moves\n" +
  "//          plus the proven-minimal 15-move fold = 32,781.\n" +
  "//   full — to the COMPLETE spiral, 131072 down to 4 filling the\n" +
  "//          board: (262140-8)/4 = 65,533 moves, score 3,670,024.\n" +
  "//   score — the same spiral fed with 2s (two forced 4-spawns at\n" +
  "//          the death squeeze): 131,066 moves, score 3,932,156 —\n" +
  "//          the maximum 2048 allows.\n" +
  "(function (root) {\n" +
  "  var api = {\n" +
  (hexTile ? "    hex:\n\"" + hexTile + "\",\n" : "") +
  (hexFull ? "    full:\n\"" + hexFull + "\",\n" : "") +
  (hexScore ? "    score:\n\"" + hexScore + "\"\n" : "") +
  "  };\n" +
  "  if (typeof module !== \"undefined\" && module.exports) {\n" +
  "    module.exports = api;\n" +
  "  } else {\n" +
  "    root.PERFECT_LINE = api;\n" +
  "  }\n" +
  "})(this);\n";

var target = path.join(__dirname, "..", "js", "perfect_line.js");
fs.writeFileSync(target, out);
console.log("wrote " + target + " (" + (out.length / 1024).toFixed(1) + " KB)");

console.log("verifying by full replay, all corners...");
delete require.cache[require.resolve(target)];
["br", "bl", "tr", "tl"].forEach(function (c) {
  if (hexTile) verifyCorner(c, "tile");
  if (hexFull) verifyCorner(c, "full");
  if (hexScore) verifyCorner(c, "score");
});
console.log("PERFECT LINE VERIFIED");
