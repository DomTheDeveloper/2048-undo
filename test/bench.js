// Non-visual, pure-array speed benchmark for the three rulesets:
//
//   node test/bench.js standard   honest 2048: random spawns, no undo.
//                                 Perfection is impossible here, so it
//                                 plays N expectimax games and reports
//                                 how far honest play gets, and how fast.
//   node test/bench.js undo      super-mode semantics: honest 90/10
//                                 spawn odds, every miss re-rolled (the
//                                 undo trick), all the way to 131072.
//   node test/bench.js perfect   predictable semantics: the planner
//                                 places each spawn itself. 131072 with
//                                 zero luck.
//   node test/bench.js all       everything (undo and perfect take a
//                                 while: the planner, not the engine,
//                                 is the cost).
//
// No DOM, no GameManager, no tile objects: just flat 16-element arrays
// and the same exact move simulation the game verifies against.

"use strict";

var path = require("path");
var Super = require(process.env.SUPER_AI ||
  path.join(__dirname, "..", "js", "super_ai.js"));

var CORNER = process.env.CORNER || "br";
var GOAL = process.env.GOAL === "score" ? "score" : "tile";

function fmtInt(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function freshBoard() {
  var b = new Array(16);
  for (var i = 0; i < 16; i++) b[i] = 0;
  spawnRandom(b);
  spawnRandom(b);
  return b;
}

function spawnRandom(b) {
  var empt = [];
  for (var i = 0; i < 16; i++) if (b[i] === 0) empt.push(i);
  if (!empt.length) return -1;
  var cell = empt[(Math.random() * empt.length) | 0];
  b[cell] = Math.random() < 0.9 ? 2 : 4;
  return cell;
}

function maxTile(b) {
  var m = 0;
  for (var i = 0; i < 16; i++) if (b[i] > m) m = b[i];
  return m;
}

// ------------------------------------------------------------------
// Shared runner for the two perfect-play variants. `place(step, post)`
// commits the planned spawn and returns how many attempts it cost.
// ------------------------------------------------------------------

function runControlled(name, place) {
  var ai = new Super.SuperAI(CORNER, { goal: GOAL });
  var S = Super.snakeCells(CORNER);
  var b = freshBoard();
  var hist = [];
  var stats = { moves: 0, attempts: 0, undos: 0, backtracks: 0, score: 0 };
  var planMs = 0, engineMs = 0;
  var backStep = 4;
  var unwinding = false;
  var bestPhi = -1;
  var t0 = Date.now();

  function goalDone(bb) {
    if (GOAL === "tile") return maxTile(bb) >= 131072;
    if (maxTile(bb) < 131072) return false;
    for (var d = 0; d < 4; d++) if (Super.simMove(bb, d).moved) return false;
    return true;
  }

  while (!goalDone(b)) {
    if (Date.now() - t0 > 90 * 60 * 1000) throw new Error(name + ": time out");

    var tp = Date.now();
    var plan = ai.plan(b);
    planMs += Date.now() - tp;

    if (plan.type === "stuck") {
      // Mirror the driver's undo-backtracking on the plain history.
      if (!hist.length) { b = freshBoard(); continue; }
      var back;
      if (unwinding) {
        back = 1;
      } else {
        ai.markDeadEnd(b);
        back = Math.min(backStep, hist.length);
        backStep = Math.min(backStep * 2, 2048);
        stats.backtracks++;
        unwinding = true;
      }
      while (back-- > 0 && hist.length) {
        b = hist.pop();
        stats.undos++;
      }
      // Skip plan attempts on obviously wrecked mid-line boards.
      while (hist.length &&
             Super.analyze(b, S, true).stranded) {
        b = hist.pop();
        stats.undos++;
      }
      continue;
    }
    if (plan.type === "done") break;

    var te = Date.now();
    for (var i = 0; i < plan.steps.length; i++) {
      var step = plan.steps[i];
      hist.push(b);
      if (hist.length > 3000) hist.splice(0, 100);
      var sim = Super.simMove(b, step.dir);
      var post = sim.board;
      for (var mg = 0; mg < sim.merges.length; mg++) stats.score += sim.merges[mg];
      stats.attempts += place(step, post);
      post[step.cell] = step.value;
      b = post;
      stats.moves++;
      unwinding = false;
      var phi = Super.analyze(b, S, true).structPhi;
      if (phi > bestPhi) { bestPhi = phi; backStep = 4; }
    }
    engineMs += Date.now() - te;
  }

  var secs = (Date.now() - t0) / 1000;
  console.log("[" + name + "] " + (GOAL === "score" ? "max-score" : "131072") +
    " in " + secs.toFixed(1) + "s" +
    "  score=" + fmtInt(stats.score) +
    "  moves=" + fmtInt(stats.moves) +
    "  attempts=" + fmtInt(stats.attempts) +
    "  undos(re-rolls)=" + fmtInt(stats.attempts - stats.moves) +
    "  backtracks=" + stats.backtracks +
    "  planning=" + (planMs / 1000).toFixed(1) + "s" +
    "  engine=" + (engineMs / 1000).toFixed(1) + "s" +
    "  (" + fmtInt(Math.round(stats.attempts / secs)) + " engine steps/s)");
  return { secs: secs, stats: stats };
}

function benchPerfect() {
  return runControlled("perfect", function () { return 1; });
}

function benchUndo() {
  // Honest odds: the spawn must land on the planned cell (uniform over
  // the empties of the post-move board) with the planned value (90/10).
  // Each miss is an undo re-roll; sampling until success is exactly the
  // same distribution the real game gives the undo trick.
  return runControlled("undo", function (step, post) {
    var empt = 0;
    for (var i = 0; i < 16; i++) if (post[i] === 0) empt++;
    var pWant = step.value === 2 ? 0.9 : 0.1;
    var attempts = 1;
    while (!((Math.random() * empt | 0) === 0 && Math.random() < pWant)) {
      attempts++;
    }
    return attempts;
  });
}

// ------------------------------------------------------------------
// Standard 2048: no undo, no control. Expectimax-lite (depth 2 over
// moves, spawns averaged by sampling) with the snake heuristic.
// ------------------------------------------------------------------

function evalBoard(b, S) {
  var a = Super.analyze(b, S, true);
  var empt = 0;
  for (var i = 0; i < 16; i++) if (b[i] === 0) empt++;
  return a.prefixPhi - (a.stranded * 1e12) - (a.leaked * 1e10) + empt * 1e6;
}

function benchStandard(games) {
  var S = Super.snakeCells(CORNER);

  // True expectimax: max over moves, exact expectation over every spawn
  // cell and value (90/10). Depth deepens as the board fills, which is
  // when precision matters and when the tree is smallest.
  function expectSpawn(b, depth) {
    var empt = [];
    for (var i = 0; i < 16; i++) if (b[i] === 0) empt.push(i);
    if (!empt.length) return evalBoard(b, S);
    var acc = 0;
    for (var e = 0; e < empt.length; e++) {
      b[empt[e]] = 2;
      acc += 0.9 * bestMove(b, depth);
      b[empt[e]] = 4;
      acc += 0.1 * bestMove(b, depth);
      b[empt[e]] = 0;
    }
    return acc / empt.length;
  }

  function bestMove(b, depth) {
    var best = -Infinity;
    for (var dir = 0; dir < 4; dir++) {
      var sim = Super.simMove(b, dir);
      if (!sim.moved) continue;
      var val = depth <= 1 ? evalBoard(sim.board, S)
                          : expectSpawn(sim.board, depth - 1);
      if (val > best) best = val;
    }
    return best === -Infinity ? -1e18 : best;
  }

  var t0 = Date.now();
  var totalMoves = 0;
  var results = [];

  for (var g = 0; g < games; g++) {
    var b = freshBoard();
    var moves = 0;
    for (;;) {
      var empties = 0;
      for (var i = 0; i < 16; i++) if (b[i] === 0) empties++;
      var depth = empties <= 7 ? 3 : 2;
      var bestDir = -1, bestScore = -Infinity;
      for (var dir = 0; dir < 4; dir++) {
        var sim = Super.simMove(b, dir);
        if (!sim.moved) continue;
        var val = expectSpawn(sim.board, depth - 1);
        if (val > bestScore) { bestScore = val; bestDir = dir; }
      }
      if (bestDir < 0) break; // game over
      b = Super.simMove(b, bestDir).board;
      spawnRandom(b);
      moves++;
    }
    totalMoves += moves;
    results.push({ max: maxTile(b), moves: moves });
  }

  var secs = (Date.now() - t0) / 1000;
  var histo = {};
  results.forEach(function (r) { histo[r.max] = (histo[r.max] || 0) + 1; });
  console.log("[standard] " + games + " honest games in " + secs.toFixed(1) + "s" +
    "  (" + fmtInt(Math.round(totalMoves / secs)) + " moves/s incl. search)");
  Object.keys(histo).map(Number).sort(function (a, b2) { return b2 - a; })
    .forEach(function (m) {
      console.log("  reached " + fmtInt(m) + ": " + histo[m] + "/" + games + " games");
    });
  console.log("  (no undo, no control: 131072 needs both — this is the honest ceiling)");
  return { secs: secs, results: results };
}

// ------------------------------------------------------------------

var what = process.argv[2] || "all";
if (what === "standard" || what === "all") benchStandard(Number(process.env.GAMES || 10));
if (what === "undo" || what === "all") benchUndo();
if (what === "perfect" || what === "all") benchPerfect();
