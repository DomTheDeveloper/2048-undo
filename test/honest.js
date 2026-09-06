// Honest-play benchmark: how far each AI gets when the tiles are what
// they are.
//
//   node test/honest.js [algo|all] [games]
//
//   algo    genius | smart | algorithm | priority | random | all
//   env     TILES=regular|evil   UNDO=disabled|regular   GOAL=tile|score
//           CORNER=br|bl|tr|tl   MAXMOVES=n (cap per game)  DEPTH=n (genius)
//
// Plays the games headless (js/honest_ai.js, pure arrays), prints the
// max-tile histogram, average score and moves, and the speed.

"use strict";

var path = require("path");
var Honest = require(path.join(__dirname, "..", "js", "honest_ai.js"));

var what = process.argv[2] || "all";
var games = Number(process.argv[3]) || 10;
var TILES = process.env.TILES === "evil" ? "evil" : "regular";
var UNDO = process.env.UNDO === "regular" ? "regular" : "disabled";
var GOAL = process.env.GOAL === "score" ? "score" : "tile";
var CORNER = process.env.CORNER || "br";
var MAXMOVES = Number(process.env.MAXMOVES) || 0;
var DEPTH = Number(process.env.DEPTH) || 0;

function fmtInt(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function bench(algo) {
  var t0 = Date.now();
  var results = [];
  var totalMoves = 0, totalUndos = 0, totalScore = 0;
  for (var g = 0; g < games; g++) {
    var runner = new Honest.HonestRunner(CORNER, {
      algo: algo, tiles: TILES, undo: UNDO, goal: GOAL,
      maxDepth: DEPTH || undefined
    });
    while (!runner.run(500)) {
      if (MAXMOVES && runner.stats.moves >= MAXMOVES) {
        runner.reason = "move cap";
        break;
      }
    }
    results.push({ max: runner.stats.maxTile, score: runner.stats.score,
                   moves: runner.stats.moves, undos: runner.stats.undos,
                   deaths: runner.stats.deaths, reason: runner.reason });
    totalMoves += runner.stats.moves;
    totalUndos += runner.stats.undos;
    totalScore += runner.stats.score;
  }
  var secs = (Date.now() - t0) / 1000;
  var histo = {};
  results.forEach(function (r) { histo[r.max] = (histo[r.max] || 0) + 1; });
  console.log("[" + algo + "] " + games + " games, " + TILES + " tiles, undo " + UNDO +
    ", goal " + GOAL + ", corner " + CORNER + " — " + secs.toFixed(1) + "s" +
    "  (" + fmtInt(Math.round(totalMoves / secs)) + " moves/s, " +
    (totalMoves ? (secs * 1000 / totalMoves).toFixed(2) : "-") + " ms/move)");
  Object.keys(histo).map(Number).sort(function (a, b) { return b - a; })
    .forEach(function (m) {
      console.log("  reached " + fmtInt(m) + ": " + histo[m] + "/" + games);
    });
  var endings = results.reduce(function (acc, r) {
    acc[r.reason] = (acc[r.reason] || 0) + 1; return acc;
  }, {});
  console.log("  avg score " + fmtInt(Math.round(totalScore / games)) +
    ", avg moves " + fmtInt(Math.round(totalMoves / games)) +
    (UNDO === "regular" ? ", avg undos " + fmtInt(Math.round(totalUndos / games)) : "") +
    ", endings " + JSON.stringify(endings));
  return { algo: algo, avgScore: totalScore / games, histo: histo };
}

var list = what === "all" ? Honest.ALGOS : [what];
var out = [];
list.forEach(function (algo) { out.push(bench(algo)); });
if (out.length > 1) {
  console.log("--- ranking by average score ---");
  out.sort(function (a, b) { return b.avgScore - a.avgScore; })
    .forEach(function (r, i) {
      console.log("  " + (i + 1) + ". " + r.algo + "  " + fmtInt(Math.round(r.avgScore)));
    });
}
