// Headless proof that Super Mode plays a perfect game.
//
//   node test/run.js [corner ...]        (default: br bl tr tl)
//
// Loads the real grid/tile/game_manager engine, drives it with SuperDriver
// (real moves, real undo re-rolls, real 90/10 spawn odds) and asserts the
// board ends with the 131072 tile in the chosen corner.

"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");

var root = path.join(__dirname, "..");

function load(ctx, file) {
  var src = fs.readFileSync(path.join(root, "js", file), "utf8");
  vm.runInContext(src, ctx, { filename: file });
}

function makeGame() {
  var sandbox = {
    Math: Math,
    console: console,
    window: {}
  };
  var ctx = vm.createContext(sandbox);
  load(ctx, "tile.js");
  load(ctx, "grid.js");
  load(ctx, "game_manager.js");

  vm.runInContext(
    "function FakeInput(){} FakeInput.prototype.on = function(){};\n" +
    "function FakeActuator(){} FakeActuator.prototype.actuate = function(){};\n" +
    "FakeActuator.prototype.continue = function(){};\n" +
    "function FakeScore(){} FakeScore.prototype.get = function(){return 0};\n" +
    "FakeScore.prototype.set = function(){};\n", ctx);

  // The original addRandomTile needs Math.seedrandom; the driver replaces
  // it anyway, so stub the two constructor-time spawns through the driver
  // patch by attaching before setup: construct lazily instead.
  vm.runInContext("Math.seedrandom = function(){};", ctx);
  var gm = vm.runInContext(
    "new GameManager(4, FakeInput, FakeActuator, FakeScore)", ctx);
  return { gm: gm, Tile: sandbox.Tile };
}

var Super = require(process.env.SUPER_AI || path.join(root, "js", "super_ai.js"));

function fmt(b) {
  var rows = [];
  for (var y = 0; y < 4; y++) {
    var r = [];
    for (var x = 0; x < 4; x++) r.push(String(b[y * 4 + x]).padStart(6));
    rows.push(r.join(" "));
  }
  return rows.join("\n");
}

function runCorner(corner) {
  var t0 = Date.now();
  var game = makeGame();
  var gm = game.gm;

  var goal = process.env.GOAL === "score" ? "score" : "tile";
  var perfect = process.env.PERFECT === "1";
  var driver = new Super.SuperDriver(gm, corner, game.Tile,
    { verify: true, trace: process.env.TRACE === "1",
      predictable: process.env.PREDICTABLE === "1" || perfect,
      perfect: perfect,
      goal: goal });
  driver.attach();
  gm.restart(); // fresh board through the patched spawner

  var MAX_ATTEMPTS = 30e6;
  var MAX_MS = (Number(process.env.MAX_MIN) || 70) * 60 * 1000;
  var finaleSpawnedFour = false;
  var lastPhase = "build";
  var lastLog = 0;
  var lastBeat = Date.now();

  while (true) {
    var ev = driver.step();
    if (ev.type === "done") break;
    if (ev.type === "stuck") {
      console.error("[" + corner + "] STUCK: " + ev.reason +
        " (moves=" + driver.stats.moves + ")");
      var sb = driver.readBoard();
      console.error(fmt(sb));
      var S = Super.snakeCells(corner);
      var ra = Super.analyze(sb, S);
      console.error("root phi=" + ra.prefixPhi.toExponential(3) +
        " packed=" + ra.packedLen + " floats=" + ra.floats + " leaked=" + ra.leaked + " stranded=" + ra.stranded);
      Super.debugChildren(sb, S, 10).forEach(function (r) {
        console.error("  dir=" + r.dir + " cell=" + r.cell + " v=" + r.value +
          " phi=" + r.phi.toExponential(3) +
          " frontier=" + r.frontier + " junk=" + r.junk);
      });
      if (driver.history.length) {
        console.error("--- last accepted moves (dir 0=up 1=right 2=down 3=left) ---");
        driver.history.forEach(function (h) {
          console.error("#" + h.n + " dir=" + h.dir + " junk=" + h.junk +
            " prefixPhi=" + h.prefixPhi.toExponential(3) +
            "  [" + h.board.join(",") + "]");
        });
      }
      return false;
    }
    if (ev.type === "backtrack") {
      if (driver.stats.backtracks <= 24 || driver.stats.backtracks % 25 === 0) {
        console.log("[" + corner + "] backtrack #" + driver.stats.backtracks +
          " depth=" + ev.depth + " deadend=[" + driver.lastStuck.board.join(",") + "]");
      }
    }
    if (ev.type === "restart" && driver.lastStuck && driver.stats.restarts <= 8) {
      console.error("[" + corner + "] restart #" + driver.stats.restarts +
        " after: " + driver.lastStuck.reason);
      console.error(fmt(driver.lastStuck.board));
    }
    if (ev.type === "accepted") {
      lastPhase = ev.phase;
      if (ev.phase === "primed") finaleSpawnedFour = true;
      var m = driver.stats.moves;
      if (m - lastLog >= 500) {
        lastLog = m;
        console.log("[" + corner + "] moves=" + m +
          " undos=" + driver.stats.undos +
          " max=" + Super.maxTile(driver.readBoard()) +
          " " + ((Date.now() - t0) / 1000).toFixed(1) + "s");
      }
    }
    if (Date.now() - lastBeat > 15000) {
      lastBeat = Date.now();
      console.log("[" + corner + "] beat moves=" + driver.stats.moves +
        " attempts=" + driver.stats.attempts +
        " max=" + Super.maxTile(driver.readBoard()) +
        " restarts=" + driver.stats.restarts +
        " board=[" + driver.readBoard().join(",") + "]");
    }
    if (driver.stats.attempts > MAX_ATTEMPTS) {
      console.error("[" + corner + "] attempt budget exceeded");
      console.error(fmt(driver.readBoard()));
      return false;
    }
    if (Date.now() - t0 > MAX_MS) {
      console.error("[" + corner + "] time budget exceeded");
      console.error(fmt(driver.readBoard()));
      return false;
    }
  }

  var b = driver.readBoard();
  var S = Super.snakeCells(corner);
  var ok;
  if (goal === "score") {
    var dead = true;
    for (var dd = 0; dd < 4; dd++) {
      if (Super.simMove(b, dd).moved) dead = false;
    }
    ok = b[S[0]] === 131072 && dead && gm.score >= 3930000;
    console.log("[" + corner + "] score-goal: score=" + gm.score +
      " (ceiling 3,932,156)  dead=" + dead);
  } else {
    ok = b[S[0]] === 131072;
    if (perfect) {
      // The mass ledger makes this a theorem, not a hope: with every
      // build spawn a 4, the surviving line is exactly 32,766 build
      // moves + 15 collapse moves. (Undone moves don't count; in
      // predictable play every undo removed one accepted move.)
      var net = driver.stats.moves - driver.stats.undos;
      console.log("[" + corner + "] perfect-goal: net moves=" + net +
        " (theoretical minimum 32,781)");
      ok = ok && net === 32781;
    }
  }
  console.log("[" + corner + "] DONE in " + ((Date.now() - t0) / 1000).toFixed(1) + "s" +
    "  moves=" + driver.stats.moves +
    "  undos=" + driver.stats.undos +
    "  attempts=" + driver.stats.attempts +
    "  score=" + gm.score +
    "  primed4=" + finaleSpawnedFour);
  console.log(fmt(b));
  if (!ok) {
    console.error("[" + corner + "] FAIL: " + (goal === "score"
      ? "score run fell short (need dead board, 131072 in corner, score >= 3,930,000)"
      : "131072 not in the " + corner + " corner"));
  }
  if (!finaleSpawnedFour) console.error("[" + corner + "] WARN: finale prime phase never reported");
  return ok;
}

var corners = process.argv.slice(2);
if (!corners.length) corners = ["br", "bl", "tr", "tl"];

var allOk = true;
corners.forEach(function (c) {
  if (!runCorner(c)) allOk = false;
});
process.exit(allOk ? 0 : 1);
