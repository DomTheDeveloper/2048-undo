// Writes the shipped perfect lines as plain-text witnesses that anyone
// can check without this repository's code (see verify/verify2048.py):
//
//   node test/gen_witness.js
//
// Format, one item per line:
//   start ROW COL VALUE      the two starting tiles (row 0 = top,
//                            column 0 = left)
//   DIR ROW COL VALUE        one move: slide DIR (U, R, D, L), then the
//                            random tile that appeared, with its cell
//                            and value (2 or 4)
// Lines starting with # are comments.

"use strict";

var fs = require("fs");
var path = require("path");
var Super = require(path.join(__dirname, "..", "js", "super_ai.js"));

var DIR = ["U", "R", "D", "L"]; // game_manager.js codes 0 up, 1 right, 2 down, 3 left

var LINES = [
  { which: "tile", file: "131072.txt",
    head: ["The 32,781-move line to the 131072 tile: the fewest moves in",
           "which the largest tile of 4x4 2048 can be built (paper/main.pdf,",
           "Theorem 4). Every spawn is a 4 until the final fifteen moves."] },
  { which: "full", file: "full-chain.txt",
    head: ["The 65,533-move line to the full chain 131072, 65536, ..., 4",
           "(one power of two per cell, a dead board, score 3,670,024):",
           "the fewest moves possible, every spawn a 4."] },
  { which: "score", file: "max-score.txt",
    head: ["The 129,333-move line from two 2s to the full chain with",
           "1,735 spawned 4s: score 3,925,224, the highest known for 4x4",
           "2048 (the proved ceiling is 3,932,100), and the longest known",
           "game (the proved ceiling is 131,052 moves)."] }
];

LINES.forEach(function (L) {
  var book = Super.perfectBook("br", L.which, "row");
  var out = [];
  out.push("# 2048 witness: a legal play of the standard 4x4 game.");
  L.head.forEach(function (h) { out.push("# " + h); });
  out.push("# Check it with:  python3 verify/verify2048.py witness/" + L.file);
  out.push("# Lines: 'start ROW COL VALUE' for the two starting tiles, then one");
  out.push("# move per line: 'DIR ROW COL VALUE' = slide DIR (U/R/D/L), then the");
  out.push("# new tile that appeared at (ROW, COL) with VALUE. Row 0 is the top row,");
  out.push("# column 0 the left column.");
  for (var c = 0; c < 16; c++) {
    if (book.start[c]) out.push("start " + ((c / 4) | 0) + " " + (c % 4) + " " + book.start[c]);
  }
  for (var i = 0; i < book.steps.length; i++) {
    var st = book.steps[i];
    out.push(DIR[st.dir] + " " + ((st.cell / 4) | 0) + " " + (st.cell % 4) + " " + st.value);
  }
  var target = path.join(__dirname, "..", "witness", L.file);
  fs.writeFileSync(target, out.join("\n") + "\n");
  console.log("wrote " + target + " (" + book.steps.length + " moves)");
});
