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

function candidates(b, seen) {
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
    for (var pi = 0; pi < plants.length; pi++) {
      var nb = sim.board.slice();
      nb[plants[pi]] = 4;
      var key = nb.join(",");
      if (seen[key]) continue;
      if (!spiralReached(nb)) {
        var mobile = false;
        var mz = -1;
        for (var mzi = 0; mzi < 16; mzi++) if (!nb[S[mzi]]) { mz = mzi; break; }
        var mrow = mz < 0 ? 3 : (mz / 4) | 0;
        var mdirs = [HEADDIR[mrow], ROWWARD, OPP[HEADDIR[mrow]]];
        for (var mdi = 0; mdi < 3 && !mobile; mdi++) {
          if (Super.simMove(nb, mdirs[mdi]).moved) mobile = true;
        }
        if (!mobile) continue;
      }
      out.push({ dir: dir, cell: plants[pi], nb: nb, key: key, h: H(nb) });
    }
  }
  out.sort(function (p, q) { return q.h - p.h; });
  return out;
}

function rescueDFS(b, seen, depth, floor, fuel) {
  if (fuel.n-- <= 0) return null;
  var cands = candidates(b, seen);
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
function rescue(b, maxDepth, floor) {
  for (var d = 2; d <= maxDepth; d++) {
    var fuel = { n: 60000 };
    var r = rescueDFS(b, {}, d, floor, fuel);
    if (r) return r;
    if (fuel.n <= 0) return null;
  }
  return null;
}

function generateBuild() {
  var b = [];
  for (var i = 0; i < 16; i++) b.push(0);
  b[S[0]] = 4;
  b[S[1]] = 4;

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
    if (cm !== 8 + 4 * ck.steps.length) {
      throw new Error("checkpoint fails the mass ledger");
    }
    b = ck.board;
    steps = ck.steps;
    console.log("  resumed at move " + steps.length);
  }

  while (!spiralReached(b)) {
    if (CKPT && Date.now() - lastCkpt >= 15000) {
      lastCkpt = Date.now();
      fs.writeFileSync(CKPT + ".tmp", JSON.stringify({ board: b, steps: steps }));
      fs.renameSync(CKPT + ".tmp", CKPT);
    }
    if (steps.length > 32766) {
      throw new Error("overran the ledger at " + steps.length + " moves");
    }
    var cur = H(b);
    var cands = candidates(b, {});
    var pick = null;
    if (cands.length && cands[0].h > cur) {
      pick = [cands[0]];
    } else {
      pick = rescue(b, 10, cur);
      if (!pick && cands.length) pick = [cands[0]];
      if (!pick) {
        throw new Error("stalled at move " + steps.length +
          " board=[" + b.join(",") + "]");
      }
    }
    for (var k = 0; k < pick.length; k++) {
      steps.push({ dir: pick[k].dir, cell: pick[k].cell, value: 4 });
      b = pick[k].nb;
    }
    if (VERBOSE && Date.now() - lastReport >= 5000) {
      lastReport = Date.now();
      console.log("  build move " + steps.length + " max=" + Super.maxTile(b) +
        " " + ((Date.now() - t0) / 1000).toFixed(1) + "s");
    }
  }
  if (steps.length !== 32766) {
    throw new Error("spiral in " + steps.length + " moves; ledger says 32766");
  }
  if (CKPT) { try { fs.unlinkSync(CKPT); } catch (e) {} }
  return { steps: steps, board: b };
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

function verifyCorner(corner) {
  var book = Super.perfectBook(corner);
  if (!book) throw new Error("perfectBook(" + corner + ") failed to load");
  var Sc = Super.snakeCells(corner);
  var b = book.start.slice();
  for (var i = 0; i < book.steps.length; i++) {
    var st = book.steps[i];
    var sim = Super.simMove(b, st.dir);
    if (!sim.moved) {
      throw new Error(corner + ": step " + i + " does not move");
    }
    if (sim.board[st.cell] !== 0) {
      throw new Error(corner + ": step " + i + " spawns on occupied cell");
    }
    sim.board[st.cell] = st.value;
    b = sim.board;
  }
  if (b[Sc[0]] !== 131072) {
    throw new Error(corner + ": final board lacks 131072 in the corner");
  }
  if (book.steps.length !== 32781) {
    throw new Error(corner + ": " + book.steps.length + " steps, want 32781");
  }
  console.log("  " + corner + ": 32,781 steps replay clean, 131072 seated");
}

console.log("building the 32,766-move counter line (" + CORNER + ")...");
var build = generateBuild();
console.log("  spiral reached, ledger exact");

console.log("folding (engine's proven 15-move collapse)...");
var ai = new Super.SuperAI(CORNER, { goal: "tile" });
var fold = ai.plan(build.board);
if (fold.type !== "line" || fold.phase !== "finale") {
  throw new Error("fold plan came back " + fold.type + "/" + fold.phase);
}
if (fold.steps.length !== 15) {
  throw new Error("fold took " + fold.steps.length + " moves, want 15");
}
var line = build.steps.concat(fold.steps);
console.log("  fold is 15 moves; total " + line.length);

var hex = encode(line);
var out = "// Generated by test/gen_perfect.js — do not edit.\n" +
  "//\n" +
  "// The perfect 2048 game to the 131072 tile as data: 32,781 moves,\n" +
  "// zero undos. Two hex chars per step: bits 0-1 direction (0 up,\n" +
  "// 1 right, 2 down, 3 left), bits 2-5 spawn cell (y*4+x), bit 6\n" +
  "// spawn value (0 = 4, 1 = 2; 2s only in the fold's junk spawns).\n" +
  "// Canonical corner: bottom-right; the engine mirrors it for the\n" +
  "// others. The length is forced by the mass ledger — slides conserve\n" +
  "// mass, each move spawns once — so (131072-8)/4 = 32,766 build\n" +
  "// moves plus the proven-minimal 15-move fold.\n" +
  "(function (root) {\n" +
  "  var api = { hex:\n" +
  "\"" + hex + "\"\n" +
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
["br", "bl", "tr", "tl"].forEach(verifyCorner);
console.log("PERFECT LINE VERIFIED");
