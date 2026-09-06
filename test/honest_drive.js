// Honest play against the REAL game engine: loads grid/tile/game_manager
// like test/run.js does and drives them with HonestDriver — real moves,
// the real undo button for the death ladder, the Evil or 90/10 spawner
// patched in exactly as the page does it.
//
//   node test/honest_drive.js            every algo x tiles x undo, short games
//   ALGO=genius TILES=evil UNDO=regular MAXMOVES=2000 node test/honest_drive.js

"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");

var root = path.join(__dirname, "..");
var Super = require(path.join(root, "js", "super_ai.js"));
var Honest = require(path.join(root, "js", "honest_ai.js"));

function load(ctx, file) {
  var src = fs.readFileSync(path.join(root, "js", file), "utf8");
  vm.runInContext(src, ctx, { filename: file });
}

function makeGame() {
  var sandbox = { Math: Math, console: console, window: {} };
  var ctx = vm.createContext(sandbox);
  load(ctx, "tile.js");
  load(ctx, "grid.js");
  load(ctx, "game_manager.js");
  vm.runInContext(
    "function FakeInput(){} FakeInput.prototype.on = function(){};\n" +
    "function FakeActuator(){} FakeActuator.prototype.actuate = function(){};\n" +
    "FakeActuator.prototype.continue = function(){};\n" +
    "function FakeScore(){} FakeScore.prototype.get = function(){return 0};\n" +
    "FakeScore.prototype.set = function(){};\n" +
    "Math.seedrandom = function(){};\n", ctx);
  var gm = vm.runInContext(
    "new GameManager(4, FakeInput, FakeActuator, FakeScore)", ctx);
  return { gm: gm, Tile: sandbox.Tile };
}

function fmtInt(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function readBoard(gm) {
  var b = [];
  for (var y = 0; y < 4; y++) {
    for (var x = 0; x < 4; x++) {
      var t = gm.grid.cells[x][y];
      b.push(t ? t.value : 0);
    }
  }
  return b;
}

function drive(algo, tiles, undo, maxMoves) {
  var game = makeGame();
  var gm = game.gm;
  var driver = new Honest.HonestDriver(gm, "br", game.Tile,
    { algo: algo, tiles: tiles, undo: undo, goal: "tile" });
  driver.attach();
  gm.undoStack.length = 0;
  gm.restart();
  var t0 = Date.now();
  var ev, steps = 0, backtracks = 0;
  for (;;) {
    ev = driver.step();
    steps++;
    if (ev.type === "done") break;
    if (ev.type === "backtrack") backtracks++;
    if (driver.stats.moves >= maxMoves) { ev = { type: "cap" }; break; }
    if (steps > maxMoves * 50) throw new Error("runaway step loop");
  }
  // The real board must agree with what the driver counted.
  var b = readBoard(gm);
  if (Super.maxTile(b) !== driver.stats.maxTile && ev.type !== "cap") {
    // maxTile tracks the best ever seen; after undos the board can be
    // smaller, so only the "never larger than best" direction holds.
    if (Super.maxTile(b) > driver.stats.maxTile) throw new Error("maxTile bookkeeping");
  }
  if (gm.score !== driver.stats.score) throw new Error("score bookkeeping");
  console.log("[" + algo + "/" + tiles + "/undo " + undo + "] " + ev.type +
    (ev.reason ? " (" + ev.reason + ")" : "") +
    "  moves=" + fmtInt(driver.stats.moves) + " undos=" + fmtInt(driver.stats.undos) +
    " deaths=" + driver.stats.deaths + " max=" + fmtInt(driver.stats.maxTile) +
    " score=" + fmtInt(gm.score) + " in " + ((Date.now() - t0) / 1000).toFixed(1) + "s");
  driver.detach();
  if (typeof gm.addRandomTile !== "function" || gm.hasOwnProperty("addRandomTile")) {
    throw new Error("spawner not restored");
  }
  return ev;
}

var ALGO = process.env.ALGO, TILES = process.env.TILES, UNDO = process.env.UNDO;
var MAXMOVES = Number(process.env.MAXMOVES) || 0;
if (ALGO || TILES || UNDO) {
  drive(ALGO || "genius", TILES || "regular", UNDO || "disabled", MAXMOVES || 1e9);
} else {
  var cap = MAXMOVES || 600;
  Honest.ALGOS.forEach(function (algo) {
    drive(algo, "regular", "disabled", cap);
    drive(algo, "regular", "regular", cap);
    drive(algo, "evil", "disabled", cap);
  });
  // The ladder has to actually escape deaths through the real undo button.
  var ev = drive("random", "regular", "regular", 100000);
  if (ev.type !== "done" || ev.reason !== "out of luck") {
    throw new Error("random + undo regular should end out of luck, got " + JSON.stringify(ev));
  }
  console.log("HONEST DRIVE OK");
}
