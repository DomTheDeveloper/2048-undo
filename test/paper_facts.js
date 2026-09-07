// Checks the structural claims of paper/main.tex against the shipped
// lines and, exhaustively, against the tiny boards:
//
//   node test/paper_facts.js
//
//   * the primed board: after move 32,766 of the 32,781-move line the
//     board is full and holds exactly 65536, 32768, ..., 8, 4, 4;
//   * the last move: the full-chain lines end with two spawned 4s and a
//     last slide that merges exactly 4+4 -> 8 from a full board, so the
//     final 4 sits on the boundary in the line of the 8;
//   * the eight spirals: the corner snakes are one orbit of the eight
//     symmetries of the square, and each transformed line replays;
//   * the longest game and the max score on 2x2 and 2x3 by brute force,
//     including every move that produces the full chain.

"use strict";

var path = require("path");
var Super = require(path.join(__dirname, "..", "js", "super_ai.js"));

var failures = 0;
function check(cond, what) {
  if (cond) { console.log("  ok   " + what); return; }
  failures++;
  console.log("  FAIL " + what);
}
function multiset(b) {
  return b.filter(function (v) { return v > 0; }).sort(function (a, c) { return c - a; });
}
function replay(corner, which, orient) {
  var book = Super.perfectBook(corner, which, orient);
  var b = book.start.slice();
  var hist = [];
  for (var i = 0; i < book.steps.length; i++) {
    var st = book.steps[i];
    var sim = Super.simMove(b, st.dir);
    if (!sim.moved || sim.board[st.cell] !== 0) throw new Error(which + " replay broke at step " + i);
    sim.board[st.cell] = st.value;
    b = sim.board;
    hist.push({ before: hist.length ? hist[hist.length - 1].board : book.start, board: b, step: st, merges: sim.merges });
  }
  return hist;
}

console.log("the primed board (32,781-move line)");
var tile = replay("br", "tile", "row");
var primed = multiset(tile[32766 - 1].board);
var want = [];
for (var k = 16; k >= 2; k--) want.push(1 << k);
want.push(4);
check(primed.join(",") === want.join(","), "after move 32,766 the board holds exactly 65536,...,8,4,4 (full)");
check(tile.length === 32781 && Super.maxTile(tile[tile.length - 1].board) === 131072, "131072 after move 32,781");
// The k-th fold move must create the next doubling 2^(k+2); the junk
// spawned during the fold may consolidate alongside (2+2, 4+4), which
// is why the merge lists are checked for the cascade value and every
// other merge is required to be junk-sized (mass of the junk so far).
var chainMerges = 0;
for (var f = 32766; f < 32781; f++) {
  var want2 = 1 << (f - 32766 + 3);
  var ms = tile[f].merges.slice().sort(function (a, c) { return c - a; });
  var junkMass = 4 * (f - 32766);
  if (ms[0] === want2 && ms.slice(1).every(function (v) { return v <= junkMass; })) chainMerges++;
}
check(chainMerges === 15, "the fifteen fold moves create 8, 16, ..., 131072 in order (junk merges ride along)");

["full", "score"].forEach(function (which) {
  console.log("the last move (" + which + " line)");
  var h = replay("br", which, "row");
  var L = h.length;
  var last = h[L - 1], prev = h[L - 2];
  var chainFrom16 = [];
  for (var k2 = 17; k2 >= 4; k2--) chainFrom16.push(1 << k2);
  check(last.step.value === 4 && prev.step.value === 4, "the last two spawns are 4s");
  check(multiset(last.before).join(",") === chainFrom16.concat([4, 4]).join(","), "before the last slide: full board, 131072..16 and two 4s");
  check(last.merges.length === 1 && last.merges[0] === 8, "the last slide merges exactly 4+4 -> 8");
  var cx = last.step.cell % 4, cy = (last.step.cell / 4) | 0;
  var onEdge = cx === 0 || cx === 3 || cy === 0 || cy === 3;
  var eightAt = last.board.indexOf(8);
  var sameLine = (eightAt % 4) === cx || ((eightAt / 4) | 0) === cy;
  check(onEdge && sameLine, "the final 4 is on the boundary, in the line of the 8");
  check(multiset(last.board).join(",") === chainFrom16.concat([8, 4]).join(","), "the final position is the full chain");
});

console.log("the eight spirals");
function T(c, g) {
  var x = c % 4, y = (c / 4) | 0, t;
  if (g & 1) x = 3 - x;
  if (g & 2) y = 3 - y;
  if (g & 4) { t = x; x = y; y = t; }
  return y * 4 + x;
}
var snakes = {};
["tl", "tr", "bl", "br"].forEach(function (c) { ["row", "col"].forEach(function (o) { snakes[Super.snakeCells(c, o).join(",")] = 1; }); });
var base = Super.snakeCells("br", "row");
var orbit = {};
for (var g = 0; g < 8; g++) orbit[base.map(function (c) { return T(c, g); }).join(",")] = 1;
check(Object.keys(snakes).length === 8, "the four corners and two orientations give eight distinct snakes");
check(Object.keys(orbit).length === 8 && Object.keys(orbit).every(function (s) { return snakes[s]; }),
  "the eight snakes are the orbit of one under the symmetries of the square");
var finals = {};
["tl", "tr", "bl", "br"].forEach(function (c) { ["row", "col"].forEach(function (o) {
  var h = replay(c, "full", o);
  var S = Super.snakeCells(c, o);
  var b = h[h.length - 1].board;
  if (h.length === 65533 && Super.fullChain(b, S)) finals[b.join(",")] = 1;
}); });
check(Object.keys(finals).length === 8, "the transformed full-chain line replays to eight distinct final spirals in 65,533 moves each");

// Hamiltonian paths from a corner
(function () {
  var seen = new Array(16).fill(false), count = 0, endCorner = 0, endOpposite = 0;
  function nb(c) { var x = c % 4, y = (c / 4) | 0, o = [];
    if (x > 0) o.push(c - 1); if (x < 3) o.push(c + 1); if (y > 0) o.push(c - 4); if (y < 3) o.push(c + 4); return o; }
  function dfs(c, n) {
    seen[c] = true;
    if (n === 16) { count++; if (c === 3 || c === 12) endCorner++; if (c === 0) endOpposite++; }
    else nb(c).forEach(function (d) { if (!seen[d]) dfs(d, n + 1); });
    seen[c] = false;
  }
  dfs(15, 1);
  check(count === 52 && endCorner === 16 && endOpposite === 0, "52 Hamiltonian paths leave a corner; 16 end at an adjacent corner, none at the opposite one");
})();

// tiny boards by brute force
function tiny(W, H) {
  var C = W * H;
  var LINES = [0, 1, 2, 3].map(function (dir) {
    var out = [];
    if (dir === 0 || dir === 2) {
      for (var x = 0; x < W; x++) { var l = []; for (var y = 0; y < H; y++) l.push(y * W + x); if (dir === 2) l.reverse(); out.push(l); }
    } else {
      for (var y2 = 0; y2 < H; y2++) { var r = []; for (var x2 = 0; x2 < W; x2++) r.push(y2 * W + x2); if (dir === 1) r.reverse(); out.push(r); }
    }
    return out;
  });
  function slide(b, dir) {
    var nb2 = b.slice(), moved = false, merges = [];
    LINES[dir].forEach(function (l) {
      var vals = [];
      for (var i = 0; i < l.length; i++) if (b[l[i]]) vals.push(b[l[i]]);
      var res = [];
      for (var j = 0; j < vals.length; j++) {
        if (j + 1 < vals.length && vals[j] === vals[j + 1]) { res.push(vals[j] * 2); merges.push(vals[j] * 2); j++; }
        else res.push(vals[j]);
      }
      for (var q = 0; q < l.length; q++) {
        var v = q < res.length ? res[q] : 0;
        if (nb2[l[q]] !== v) moved = true;
        nb2[l[q]] = v;
      }
    });
    return { board: nb2, moved: moved, merges: merges };
  }
  var info = {}, byMass = {};
  function add(b, moves, fours) {
    var key = b.join(","), e = info[key];
    if (!e) {
      var mass = b.reduce(function (s, v) { return s + v; }, 0);
      info[key] = { b: b, mass: mass, maxMoves: moves, minFours: fours };
      (byMass[mass] = byMass[mass] || []).push(key);
      return;
    }
    if (moves > e.maxMoves) e.maxMoves = moves;
    if (fours < e.minFours) e.minFours = fours;
  }
  for (var a = 0; a < C; a++) for (var c = 0; c < C; c++) if (a !== c) [2, 4].forEach(function (va) { [2, 4].forEach(function (vc) {
    var b = new Array(C).fill(0); b[a] = va; b[c] = vc; add(b, 0, (va === 4 ? 1 : 0) + (vc === 4 ? 1 : 0));
  }); });
  var chain = [];
  for (var r2 = C + 1; r2 >= 2; r2--) chain.push(1 << r2);
  var chainKey = chain.join(",");
  function isChain(b) { return multiset(b).join(",") === chainKey; }
  var longest = 0, maxScore = -1, chainFours = Infinity, endings = {}, raw = 0;
  var mass = 4;
  while (true) {
    var ks = byMass[mass];
    if (ks) {
      for (var qi = 0; qi < ks.length; qi++) {
        var e = info[ks[qi]]; raw++;
        var phi = 0;
        e.b.forEach(function (v) { if (v) phi += (Math.round(Math.log2(v)) - 1) * v; });
        maxScore = Math.max(maxScore, phi - 4 * e.minFours);
        longest = Math.max(longest, e.maxMoves);
        if (isChain(e.b)) chainFours = Math.min(chainFours, e.minFours);
        for (var d = 0; d < 4; d++) {
          var s = slide(e.b, d);
          if (!s.moved) continue;
          for (var cell = 0; cell < C; cell++) {
            if (s.board[cell]) continue;
            [2, 4].forEach(function (v) {
              var nb3 = s.board.slice(); nb3[cell] = v;
              add(nb3, e.maxMoves + 1, e.minFours + (v === 4 ? 1 : 0));
              if (isChain(nb3)) {
                var full = e.b.every(function (t) { return t > 0; });
                endings[multiset(e.b).join(",") + "|" + full + "|" + s.merges.join(",") + "|" + v] = 1;
              }
            });
          }
        }
      }
    }
    mass += 2;
    if (mass > (1 << (C + 2))) break;
  }
  var chainFrom16 = chain.slice(0, C - 2).concat([4, 4]).join(",");
  var endKeys = Object.keys(endings);
  console.log("  " + W + "x" + H + ": " + raw + " positions, longest game " + longest + ", max score " + maxScore);
  check(longest === Math.pow(2, C + 1) - 4 - C, W + "x" + H + " longest game = 2^(c+1)-4-c = " + (Math.pow(2, C + 1) - 4 - C));
  check(maxScore === (C - 1) * Math.pow(2, C + 2) + 4 - 4 * C, W + "x" + H + " max score = Phi_c-4c");
  check(chainFours === C, W + "x" + H + " full chain needs exactly c = " + C + " spawned 4s");
  check(endKeys.length === 1 && endKeys[0] === chainFrom16 + "|true|8|4",
    W + "x" + H + " every move producing the full chain: full board 2^(c+1)..16,4,4, merge 4+4 -> 8, spawn 4");
}
console.log("tiny boards, exhaustively");
tiny(2, 2);
tiny(2, 3);

console.log(failures ? "PAPER FACTS: " + failures + " FAILURE(S)" : "PAPER FACTS OK");
process.exit(failures ? 1 : 0);
