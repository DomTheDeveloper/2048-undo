// Exact analysis of small 2048 boards.
//
//   node test/solve.js 3x3            (also 2x2, 2x3, 2x4, 3x3, 2x5, 3x4 ...)
//   SYM=0 node test/solve.js 2x3      count without symmetry reduction
//
// Enumerates every reachable position of the W x H game layer by layer
// (a position's mass -- the sum of its tiles -- grows by exactly the
// spawned value each move, so the state graph is a DAG graded by mass)
// and computes, exactly:
//
//   * the number of reachable positions and afterstates, raw and up to
//     the board's symmetries;
//   * under CONTROLLED spawns (the "possible in principle" model, where
//     any spawn sequence may be chosen): the fewest moves to every tile
//     value, the fewest spawned 4s needed to reach every position, and
//     hence the maximum attainable score, which by the score identity
//     score = sum over tiles of (k-1)*2^k  -  4 * (spawned 4s)
//     is max over positions of Phi(position) - 4 * minFours(position);
//   * under the HONEST game (uniform empty cell, 90% twos): the optimal
//     expected score from the standard two-tile start, and the maximum
//     probability of ever building each tile value.
//
// Positions are packed 4 bits a cell into a double (exact to 2^53), so
// boards up to 13 cells fit. 3x3 takes a few minutes; 4x3 is Kaneko &
// Yamashita territory (1.15 trillion positions) and out of reach here.

"use strict";

// Boards are boxes of any dimension: "3x3", "2x4", "2x2x2" (Das and
// Paul's higher-dimensional 2048, arXiv:1804.07393), "2x2x2x2", ...
// A slide moves every line parallel to one axis toward one of its two
// walls, so a d-dimensional box has 2d directions. Cell index =
// sum of coordinate_i * stride_i with stride_0 = 1 (for W x H that is
// the game's y * W + x).
var arg = (process.argv[2] || "3x3").toLowerCase().split("x");
var DIMS = arg.map(Number);
if (DIMS.length === 1) DIMS.push(DIMS[0]);
var W = DIMS[0], H = DIMS[1];
var C = DIMS.reduce(function (a, b) { return a * b; }, 1);
var NDIR = 2 * DIMS.length;
var STRIDE = [];
(function () { var st = 1; for (var i = 0; i < DIMS.length; i++) { STRIDE.push(st); st *= DIMS[i]; } })();
function coordsOf(i) { var c = []; for (var a = 0; a < DIMS.length; a++) { c.push(i % DIMS[a]); i = (i - c[a]) / DIMS[a]; } return c; }
function indexOf(c) { var i = 0; for (var a = 0; a < DIMS.length; a++) i += c[a] * STRIDE[a]; return i; }
var USE_SYM = process.env.SYM !== "0";
var VERBOSE = process.env.VERBOSE === "1";
// FORWARD_ONLY=1 skips the honest-game backward pass and frees each
// layer as soon as it is closed, so memory stays at the open layers:
// how 2x5 (about 1.5 billion positions) fits in a few hundred MB.
var FORWARD_ONLY = process.env.FORWARD_ONLY === "1";
if (!(C >= 2 && C <= 13)) throw new Error("board must have 2..13 cells");
if (DIMS.some(function (n) { return !(n >= 1 && n === Math.floor(n)); })) throw new Error("bad board " + arg.join("x"));

function fmtInt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

// ---------------------------------------------------------------- lines
// For each direction, the cells as lines ordered from the wall the tiles
// move toward. Direction 2a slides axis a toward coordinate 0, 2a+1
// toward the far wall; for W x H that is up, down, left, right (the
// solver never needs the game's own direction codes).
var LINES = [];
(function () {
  for (var a = 0; a < DIMS.length; a++) {
    var toward0 = [], towardFar = [];
    for (var i = 0; i < C; i++) {
      var c = coordsOf(i);
      if (c[a] !== 0) continue;
      var line = [];
      for (var k = 0; k < DIMS[a]; k++) { c[a] = k; line.push(indexOf(c)); }
      toward0.push(line);
      towardFar.push(line.slice().reverse());
    }
    LINES.push(toward0); LINES.push(towardFar);
  }
})();

// Slide `b` (ranks, 0 = empty) in direction d into `out`. Returns the
// score gained, or -1 if nothing moved. Same rules as game_manager.js:
// one merge per tile per move, merges resolved from the wall outward.
var vals = new Uint8Array(Math.max.apply(null, DIMS));
function slide(b, d, out) {
  var moved = false, gain = 0;
  var lines = LINES[d];
  for (var li = 0; li < lines.length; li++) {
    var line = lines[li], n = 0;
    for (var j = 0; j < line.length; j++) { var v = b[line[j]]; if (v) vals[n++] = v; }
    var k = 0, i = 0;
    while (i < n) {
      if (i + 1 < n && vals[i] === vals[i + 1]) {
        var r = vals[i] + 1;
        gain += 1 << r;
        vals[k++] = r;
        i += 2;
      } else {
        vals[k++] = vals[i++];
      }
    }
    for (j = 0; j < line.length; j++) {
      var nv = j < k ? vals[j] : 0;
      if (out[line[j]] !== nv || b[line[j]] !== nv) { if (b[line[j]] !== nv) moved = true; }
      out[line[j]] = nv;
    }
  }
  return moved ? gain : -1;
}

// ------------------------------------------------------------ symmetries
// The symmetry group of the box: every permutation of axes that maps
// the box onto itself (axes of equal length may be swapped) combined
// with a reflection of any subset of axes. 8 for a square, 4 for a
// rectangle, 48 for a cube. Index permutations: image[i] = source cell
// of cell i.
var SYMS = (function () {
  var out = [];
  var d = DIMS.length;
  var perms = [];
  (function permute(cur, used) {
    if (cur.length === d) { perms.push(cur.slice()); return; }
    for (var a = 0; a < d; a++) {
      if (used[a] || DIMS[a] !== DIMS[cur.length]) continue;
      used[a] = true; cur.push(a); permute(cur, used); cur.pop(); used[a] = false;
    }
  })([], []);
  perms.forEach(function (perm) {
    for (var mask = 0; mask < (1 << d); mask++) {
      var p = new Uint8Array(C);
      for (var i = 0; i < C; i++) {
        var c = coordsOf(i), img = new Array(d);
        for (var a = 0; a < d; a++) {
          var v = c[a];
          if (mask & (1 << a)) v = DIMS[a] - 1 - v;
          img[perm[a]] = v; // axis a of the source becomes axis perm[a]
        }
        p[indexOf(img)] = i;
      }
      out.push(p);
    }
  });
  // the identity first, so SYM=0 keeps exactly it
  out.sort(function (x, y) { var ix = 0, iy = 0; for (var i = 0; i < C; i++) { if (x[i] !== i) ix = 1; if (y[i] !== i) iy = 1; } return ix - iy; });
  return USE_SYM ? out : [out[0]];
})();

var POW16 = [];
for (var pi = 0; pi < C; pi++) POW16.push(Math.pow(16, pi));

function keyOf(b) {
  var k = 0;
  for (var i = 0; i < C; i++) k += b[i] * POW16[i];
  return k;
}
function decode(key, b) {
  for (var i = 0; i < C; i++) { var d = key % 16; b[i] = d; key = (key - d) / 16; }
}
var tmpB = new Uint8Array(C);
function canonKey(b) {
  var best = Infinity;
  for (var s = 0; s < SYMS.length; s++) {
    var p = SYMS[s], k = 0;
    for (var i = 0; i < C; i++) k += b[p[i]] * POW16[i];
    if (k < best) best = k;
  }
  return best;
}
// Orbit size of a position under the symmetry group.
function orbitSize(b) {
  var seen = [];
  for (var s = 0; s < SYMS.length; s++) {
    var p = SYMS[s], k = 0;
    for (var i = 0; i < C; i++) k += b[p[i]] * POW16[i];
    if (seen.indexOf(k) < 0) seen.push(k);
  }
  return seen.length;
}

function massOf(b) { var m = 0; for (var i = 0; i < C; i++) if (b[i]) m += 1 << b[i]; return m; }
function phiOf(b) { var p = 0; for (var i = 0; i < C; i++) if (b[i]) p += (b[i] - 1) * (1 << b[i]); return p; }
function maxRank(b) { var m = 0; for (var i = 0; i < C; i++) if (b[i] > m) m = b[i]; return m; }

// ----------------------------------------------------------- forward pass
// Layers keyed by mass. A closed layer: sorted keys + per-state data.
var layers = new Map();   // mass -> { keys: Float64Array, n4: Uint16Array, mv: Uint32Array, orbit: Uint8Array }
var open = new Map();     // mass -> Map(key -> [n4, moves])

function openLayer(m) { var L = open.get(m); if (!L) { L = new Map(); open.set(m, L); } return L; }
function relax(m, key, n4, mv) {
  var L = openLayer(m);
  var e = L.get(key);
  if (!e) { L.set(key, [n4, mv]); return; }
  if (n4 < e[0]) e[0] = n4;
  if (mv < e[1]) e[1] = mv;
}

// Starts: two spawned tiles, any cells, values 2 or 4 (controlled model
// sees all of them at 0 moves; the honest start distribution weights
// them below).
var startWeights = new Map(); // canonical key -> probability under the honest start
var b0 = new Uint8Array(C);
for (var c1 = 0; c1 < C; c1++) for (var c2 = 0; c2 < C; c2++) {
  if (c1 === c2) continue;
  for (var v1 = 1; v1 <= 2; v1++) for (var v2 = 1; v2 <= 2; v2++) {
    b0.fill(0); b0[c1] = v1; b0[c2] = v2;
    var k0 = canonKey(b0);
    var n40 = (v1 === 2 ? 1 : 0) + (v2 === 2 ? 1 : 0);
    relax(massOf(b0), k0, n40, 0);
    // honest: first tile uniform over C cells, second over C-1, values 0.9/0.1
    var pr = (1 / C) * (1 / (C - 1)) * (v1 === 1 ? 0.9 : 0.1) * (v2 === 1 ? 0.9 : 0.1);
    startWeights.set(k0, (startWeights.get(k0) || 0) + pr);
  }
}

var afterSeen = new Map(); // mass -> Set of canonical afterstate keys (closed once mass processed)
var totalStates = 0, totalRaw = 0, totalAfter = 0, totalAfterRaw = 0, deadStates = 0, deadRaw = 0;
var bestScore = -1, bestScoreKey = 0, bestScoreMass = 0, bestScoreN4 = 0;
var minMovesToRank = [];   // rank -> fewest moves to a position containing it
var minFoursToRank = [];   // rank -> fewest spawned 4s to a position containing it
var maxRankSeen = 0;
var chainKey = null, chainMass = 0, chainN4 = -1, chainMv = -1;
// The longest play: a play's length is mass/2 - n4 - 2 (each move spawns
// once, mass = 2*n2 + 4*n4), so the longest play to a position uses the
// fewest 4s, and the longest game is the maximum over positions.
var longestMoves = -1, longestKey = 0, longestMass = 0;
// Every move that produces the full chain, by signature: the parent's
// multiset, whether the parent is full, the number of merges and their
// total, and the spawned value. The paper's last-move proposition says
// there is exactly one signature: the chain from 16 up plus two 4s,
// full, one merge worth 8, spawn 4.
var chainEndings = new Map();
function tilesOf(x) { var t = 0; for (var i = 0; i < C; i++) if (x[i]) t++; return t; }
var t0 = Date.now();

// The full chain 2^(C+1) ... 2^2 (one tile per cell) is the maximum-Phi
// board if reachable; remember its canonical key for the report.
(function () {
  var chain = new Uint8Array(C);
  // arrangement doesn't matter for the multiset; we match by sorted ranks
  for (var i = 0; i < C; i++) chain[i] = C + 1 - i;
  chainMass = massOf(chain);
})();
function isFullChain(b) {
  var seen = 0;
  for (var i = 0; i < C; i++) {
    if (!b[i] || b[i] < 2 || b[i] > C + 1) return false;
    if (seen & (1 << b[i])) return false;
    seen |= 1 << b[i];
  }
  return true;
}

function noteEnding(parent, tiles, merges, gain, spawn, orbit) {
  var vals = [];
  for (var i = 0; i < C; i++) if (parent[i]) vals.push(1 << parent[i]);
  vals.sort(function (a, c) { return c - a; });
  var sig = "parent [" + vals.join(",") + "] " + (tiles === C ? "full" : "not full") +
    ", " + merges + " merge(s) worth " + gain + ", spawn " + spawn;
  chainEndings.set(sig, (chainEndings.get(sig) || 0) + orbit);
}
var b = new Uint8Array(C), after = new Uint8Array(C), nb = new Uint8Array(C);
var masses = Array.from(open.keys()).sort(function (a, c) { return a - c; });
var mIdx = 0;
var maxMass = 0;
while (true) {
  // next mass to process: the smallest open layer
  var ks = Array.from(open.keys());
  if (!ks.length) break;
  var m = Math.min.apply(null, ks);
  var L = open.get(m);
  open.delete(m);
  // freeze
  var n = L.size;
  var keys = new Float64Array(n), n4s = new Uint16Array(n), mvs = new Uint32Array(n);
  var idx = 0;
  L.forEach(function (v, k) { keys[idx] = k; n4s[idx] = v[0]; mvs[idx] = v[1]; idx++; });
  // sort by key (keep data aligned)
  var order = new Uint32Array(n);
  for (var i = 0; i < n; i++) order[i] = i;
  var ord = Array.from(order).sort(function (a, c) { return keys[a] - keys[c]; });
  var sk = new Float64Array(n), sn4 = new Uint16Array(n), smv = new Uint32Array(n), sorb = new Uint8Array(n);
  for (i = 0; i < n; i++) { sk[i] = keys[ord[i]]; sn4[i] = n4s[ord[i]]; smv[i] = mvs[ord[i]]; }
  L = null;
  var afterSet = new Set();
  var layerDead = 0, layerDeadRaw = 0, layerRaw = 0;
  for (i = 0; i < n; i++) {
    decode(sk[i], b);
    var orb = orbitSize(b);
    sorb[i] = orb;
    layerRaw += orb;
    var phi = phiOf(b);
    var sc = phi - 4 * sn4[i];
    if (sc > bestScore) { bestScore = sc; bestScoreKey = sk[i]; bestScoreMass = m; bestScoreN4 = sn4[i]; }
    var mr = maxRank(b);
    if (mr > maxRankSeen) maxRankSeen = mr;
    if (minMovesToRank[mr] === undefined || smv[i] < minMovesToRank[mr]) minMovesToRank[mr] = smv[i];
    if (minFoursToRank[mr] === undefined || sn4[i] < minFoursToRank[mr]) minFoursToRank[mr] = sn4[i];
    if (isFullChain(b)) {
      if (chainN4 < 0 || sn4[i] < chainN4) { chainN4 = sn4[i]; chainKey = sk[i]; }
      if (chainMv < 0 || smv[i] < chainMv) chainMv = smv[i];
    }
    var lp = m / 2 - sn4[i] - 2;
    if (lp > longestMoves) { longestMoves = lp; longestKey = sk[i]; longestMass = m; }
    var any = false;
    var nearChain = m + 4 >= chainMass; // only the last layers can produce the chain
    var tilesB = nearChain ? tilesOf(b) : 0;
    for (var d = 0; d < NDIR; d++) {
      var gain = slide(b, d, after);
      if (gain < 0) continue;
      any = true;
      afterSet.add(canonKey(after));
      var mergesHere = nearChain ? tilesB - tilesOf(after) : 0;
      for (var c = 0; c < C; c++) {
        if (after[c]) continue;
        after[c] = 1;
        relax(m + 2, canonKey(after), sn4[i], smv[i] + 1);
        if (nearChain && isFullChain(after)) noteEnding(b, tilesB, mergesHere, gain, 2, sorb[i]);
        after[c] = 2;
        relax(m + 4, canonKey(after), sn4[i] + 1, smv[i] + 1);
        if (nearChain && isFullChain(after)) noteEnding(b, tilesB, mergesHere, gain, 4, sorb[i]);
        after[c] = 0;
      }
    }
    if (!any) { layerDead++; layerDeadRaw += orb; }
  }
  if (!FORWARD_ONLY) layers.set(m, { keys: sk, n4: sn4, mv: smv, orbit: sorb });
  totalStates += n; totalRaw += layerRaw; deadStates += layerDead; deadRaw += layerDeadRaw;
  totalAfter += afterSet.size;
  if (afterSet.size) {
    var ar = 0; afterSet.forEach(function (k) { decode(k, nb); ar += orbitSize(nb); });
    totalAfterRaw += ar;
  }
  if (m > maxMass) maxMass = m;
  if (VERBOSE || m % 64 === 0) {
    console.log("mass " + m + ": " + fmtInt(n) + " positions (" + fmtInt(totalStates) + " so far), " +
      ((Date.now() - t0) / 1000).toFixed(1) + "s");
  }
}

console.log("");
console.log("=== " + DIMS.join("x") + " (" + C + " cells, " + NDIR + " directions) " + (USE_SYM ? "up to " + SYMS.length + " symmetries" : "no symmetry reduction") + " ===");
console.log("reachable positions: " + fmtInt(totalStates) + " canonical, " + fmtInt(totalRaw) + " raw");
console.log("afterstates:         " + fmtInt(totalAfter) + " canonical, " + fmtInt(totalAfterRaw) + " raw");
console.log("dead positions:      " + fmtInt(deadStates) + " canonical, " + fmtInt(deadRaw) + " raw");
console.log("largest tile ever:   " + (1 << maxRankSeen) + "   (2^(cells+1) = " + (1 << (C + 1)) + ")");
console.log("max mass:            " + fmtInt(maxMass));
console.log("");
console.log("--- controlled spawns (anything possible) ---");
for (var r = 2; r <= maxRankSeen; r++) {
  var formula = ((1 << r) - 8) / 4 + (r - 2);
  console.log("  tile " + String(1 << r).padStart(6) + ": fewest moves " + String(minMovesToRank[r]).padStart(6) +
    "   ledger formula (2^k-8)/4+(k-2) = " + String(formula).padStart(6) +
    (minMovesToRank[r] === formula ? "  =" : "  !=") +
    "   fewest spawned 4s " + minFoursToRank[r]);
}
decode(bestScoreKey, b);
var bb = Array.from(b).map(function (r2) { return r2 ? 1 << r2 : 0; });
console.log("  MAXIMUM SCORE: " + fmtInt(bestScore) + "  at mass " + bestScoreMass +
  "  board " + JSON.stringify(bb) + "  (Phi " + fmtInt(phiOf(b)) + ", spawned 4s " + bestScoreN4 + ")");
var phiChain = 0;
for (var kk = 2; kk <= C + 1; kk++) phiChain += (kk - 1) * (1 << kk);
console.log("  full chain 2^" + (C + 1) + "..4: Phi = " + fmtInt(phiChain) +
  (chainN4 >= 0 ? "  reachable, fewest spawned 4s " + chainN4 + "  -> score " + fmtInt(phiChain - 4 * chainN4)
                : "  NOT reachable"));
if (chainN4 >= 0) {
  console.log("  full chain: fewest moves " + fmtInt(chainMv) + " (all-4 ledger 2^cells-3 = " + fmtInt(Math.pow(2, C) - 3) +
    "), longest play to it " + fmtInt(chainMass / 2 - chainN4 - 2));
}
if (chainEndings.size) {
  console.log("  every move that produces the full chain (raw count):");
  chainEndings.forEach(function (n, sig) { console.log("    " + sig + "  x" + fmtInt(n)); });
}
decode(longestKey, b);
var lb = Array.from(b).map(function (r3) { return r3 ? 1 << r3 : 0; });
console.log("  LONGEST GAME: " + fmtInt(longestMoves) + " moves  (theorem bound 2^(cells+1)-4-cells = " +
  fmtInt(Math.pow(2, C + 1) - 4 - C) + ")  ending on " + JSON.stringify(lb) + " at mass " + longestMass);
console.log("  folklore ceilings: Phi-8 (two forced 4s) = " + fmtInt(phiChain - 8) +
  ",  Phi-4*cells (one 4 per chain tile) = " + fmtInt(phiChain - 4 * C));

// ---------------------------------------------------------- backward pass
// Optimal expected score (honest 90/10 spawns) and the maximum probability
// of ever building each tile, by value iteration over the mass-graded DAG:
// every successor lives in a heavier layer, so one sweep from the top is
// exact.
function findIdx(keys, key) {
  var lo = 0, hi = keys.length - 1;
  while (lo <= hi) {
    var mid = (lo + hi) >> 1;
    if (keys[mid] < key) lo = mid + 1; else if (keys[mid] > key) hi = mid - 1; else return mid;
  }
  return -1;
}
if (FORWARD_ONLY) {
  console.log("");
  console.log("(FORWARD_ONLY=1: honest-game pass skipped)  forward " + ((Date.now() - t0) / 1000).toFixed(1) + "s");
  process.exit(0);
}
var massList = Array.from(layers.keys()).sort(function (a, c) { return c - a; });
var V = new Map();      // mass -> Float64Array expected score-to-go
var P = new Map();      // mass -> Float64Array per rank target: prob of ever reaching tile >= 2^r
var TARGETS = [];
for (var tr = Math.max(2, maxRankSeen - 3); tr <= maxRankSeen; tr++) TARGETS.push(tr);
var totalBack = 0;
var tb = Date.now();
massList.forEach(function (m) {
  var Lr = layers.get(m);
  var n = Lr.keys.length;
  var v = new Float64Array(n);
  var pr = new Float64Array(n * TARGETS.length);
  var up2 = layers.get(m + 2), up4 = layers.get(m + 4);
  var V2 = V.get(m + 2), V4 = V.get(m + 4), P2 = P.get(m + 2), P4 = P.get(m + 4);
  for (var i = 0; i < n; i++) {
    decode(Lr.keys[i], b);
    var mr = maxRank(b);
    var bestV = -1;
    var bestP = new Float64Array(TARGETS.length);
    for (var t = 0; t < TARGETS.length; t++) bestP[t] = mr >= TARGETS[t] ? 1 : 0;
    var alreadyAll = mr >= TARGETS[TARGETS.length - 1];
    for (var d = 0; d < NDIR; d++) {
      var gain = slide(b, d, after);
      if (gain < 0) continue;
      var empt = 0;
      for (var c = 0; c < C; c++) if (!after[c]) empt++;
      var ev = 0;
      var ep = new Float64Array(TARGETS.length);
      for (c = 0; c < C; c++) {
        if (after[c]) continue;
        after[c] = 1;
        var k2 = canonKey(after);
        var j2 = findIdx(up2.keys, k2);
        after[c] = 2;
        var k4 = canonKey(after);
        var j4 = findIdx(up4.keys, k4);
        after[c] = 0;
        if (j2 < 0 || j4 < 0) throw new Error("successor missing at mass " + m);
        ev += 0.9 * V2[j2] + 0.1 * V4[j4];
        for (t = 0; t < TARGETS.length; t++) {
          ep[t] += 0.9 * P2[j2 * TARGETS.length + t] + 0.1 * P4[j4 * TARGETS.length + t];
        }
      }
      ev = gain + ev / empt;
      if (ev > bestV) bestV = ev;
      for (t = 0; t < TARGETS.length; t++) { var pt = ep[t] / empt; if (pt > bestP[t]) bestP[t] = pt; }
    }
    v[i] = bestV < 0 ? 0 : bestV;
    for (t = 0; t < TARGETS.length; t++) pr[i * TARGETS.length + t] = bestP[t];
  }
  V.set(m, v); P.set(m, pr);
  totalBack += n;
  // free what no lower layer will need
  V.delete(m + 6); P.delete(m + 6);
});

// Expected score and tile odds from the honest two-tile start.
var expScore = 0, tileOdds = new Float64Array(TARGETS.length);
startWeights.forEach(function (w, k) {
  decode(k, b);
  var m = massOf(b);
  var j = findIdx(layers.get(m).keys, k);
  expScore += w * V.get(m)[j];
  for (var t = 0; t < TARGETS.length; t++) tileOdds[t] += w * P.get(m)[j * TARGETS.length + t];
});
// Kaneko & Yamashita report the value for the most common start: two 2s.
var exp22 = 0, w22 = 0;
startWeights.forEach(function (w, k) {
  decode(k, b);
  var twos = 0; for (var i = 0; i < C; i++) if (b[i] === 1) twos++;
  if (twos !== 2) return;
  var m = massOf(b);
  var j = findIdx(layers.get(m).keys, k);
  exp22 += w * V.get(m)[j]; w22 += w;
});
console.log("");
console.log("--- honest game (uniform cell, 90% twos), optimal play ---");
console.log("  optimal expected score from the standard start: " + expScore.toFixed(4));
console.log("  optimal expected score given a two-2s start:   " + (exp22 / w22).toFixed(4) +
  "   (that start has probability " + w22.toFixed(4) + ")");
for (var t2 = 0; t2 < TARGETS.length; t2++) {
  console.log("  best probability of ever building " + String(1 << TARGETS[t2]).padStart(6) + ": " +
    (100 * tileOdds[t2]).toFixed(6) + "%");
}
console.log("");
console.log("forward " + ((tb - t0) / 1000).toFixed(1) + "s, backward " + ((Date.now() - tb) / 1000).toFixed(1) + "s");
