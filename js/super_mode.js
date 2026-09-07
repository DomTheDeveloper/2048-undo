// 2048-ai UI controller.
//
// Drives the AIs against the live game: js/super_ai.js for perfect
// play (the computed lines, with placed spawns or with the undo trick)
// and js/honest_ai.js for honest play (aj-r's AIs and GENIUS against
// regular or Evil tiles, with or without the undo button as a human
// would use it). Owns the option rows, the speed control (1x-100x,
// AFAP, HEADLESS), the corner picker, the HUD, the slow-motion or
// instant finale, and the end-of-run overlay.

(function () {
  "use strict";

  var Super = window.Super2048;
  var BASE_MPS = 8; // moves per second at 1x
  var BUILD = "6";  // bump with index.html's ?v= so browsers refetch the scripts

  var TILES = ["evil", "regular", "perfect"];
  var UNDOS = ["disabled", "regular", "perfect"];
  var ALGOS = ["genius", "smart", "algorithm", "priority", "random"];
  var GOALS = ["tile", "score", "spiral"];
  var SPEEDS = ["1", "2", "3", "4", "5", "10", "20", "50", "100", "afap", "headless"];
  var FINALES = ["slow", "hyper"];
  var CORNERS = ["tl", "tr", "bl", "br"];
  var ORIENTS = ["row", "col"];
  var ALGO_NAMES = { genius: "GENIUS", smart: "SMART", algorithm: "ALGORITHM",
                     priority: "PRIORITY", random: "RANDOM" };
  var STALL_DEATHS = 40; // mirrors honest_ai.js

  var controller = {
    running: false,
    aiActing: false,
    dirty: false,
    driver: null,
    corner: null,
    orient: null,
    speed: null,
    tiles: null,
    undo: null,
    algo: null,
    goal: null,
    finaleMode: null,
    finale: false,
    done: false,
    endReason: null,
    startedAt: 0,
    lastTick: 0,
    moveDebt: 0,
    rafId: null,
    pumpId: null,
    worker: null,
    replayId: null,
    plannerBusySince: 0,
    requestedKey: null,
    savedProtoMove: null,
    savedProtoRestart: null,
    headless: null
  };

  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return document.querySelectorAll(sel); }

  function loadPref(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
  }
  function savePref(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* private mode */ }
  }
  function pick(value, allowed, fallback) {
    return allowed.indexOf(value) >= 0 ? value : fallback;
  }

  // Saved choices (the old single "mode" pref maps onto the new rows:
  // SUPER was regular tiles + perfect undo, the others perfect tiles).
  var legacyMode = loadPref("super2048.mode", null);
  controller.corner = pick(loadPref("super2048.corner", "br"), CORNERS, "br");
  controller.orient = pick(loadPref("super2048.orient", "row"), ORIENTS, "row");
  controller.speed = pick(loadPref("super2048.speed", "afap"), SPEEDS, "afap");
  controller.tiles = pick(loadPref("super2048.tiles",
    legacyMode && legacyMode !== "super" ? "perfect" : "regular"), TILES, "regular");
  controller.undo = pick(loadPref("super2048.undo", "perfect"), UNDOS, "perfect");
  controller.algo = pick(loadPref("super2048.algo", "genius"), ALGOS, "genius");
  controller.goal = pick(loadPref("super2048.goal", "spiral"), GOALS, "spiral");
  controller.finaleMode = pick(loadPref("super2048.finale", "slow"), FINALES, "slow");

  // What kind of run the selection describes. Perfect play is the
  // computed line — spawns placed (PERFECT tiles) or re-rolled onto it
  // (REGULAR tiles + PERFECT undo); everything else is honest play.
  function perfectPlay() {
    return controller.tiles === "perfect" ||
           (controller.tiles === "regular" && controller.undo === "perfect");
  }
  function honestPlay() { return !perfectPlay(); }
  function runGoal() {
    if (perfectPlay()) return controller.goal;
    return controller.goal === "score" ? "score" : "tile";
  }
  function honestConfig() {
    return { algo: controller.algo, tiles: controller.tiles,
             undo: controller.tiles === "regular" ? controller.undo : "disabled" };
  }
  function slowFinale() { return perfectPlay() && controller.finaleMode === "slow"; }

  // ----------------------------------------------------------------
  // Game hooks
  // ----------------------------------------------------------------

  function gm() { return window.game_manager; }

  function installHooks() {
    var g = gm();

    controller.savedProtoMove = GameManager.prototype.move;
    GameManager.prototype.move = function (dir) {
      // While the AI runs, only the AI may move (keys/swipes are bound
      // directly to this prototype method, so gate it here).
      if (controller.running && !controller.aiActing) return;
      return controller.savedProtoMove.call(this, dir);
    };

    controller.savedProtoRestart = GameManager.prototype.restart;
    GameManager.prototype.restart = function () {
      if (controller.running && !controller.aiActing) stopRun("restarted");
      return controller.savedProtoRestart.call(this);
    };

    // Suppress rendering during bursts; one real actuate per frame.
    g.actuate = function () { controller.dirty = true; };
    g.actuator.continue = function () {};
  }

  function removeHooks() {
    var g = gm();
    if (controller.savedProtoMove) GameManager.prototype.move = controller.savedProtoMove;
    if (controller.savedProtoRestart) GameManager.prototype.restart = controller.savedProtoRestart;
    controller.savedProtoMove = controller.savedProtoRestart = null;
    delete g.actuate;
    delete g.actuator.continue;
  }

  function render() {
    var g = gm();
    if (g.won && !g.keepPlaying) g.keepPlaying = true; // never show "You win!" mid-run
    // A death the undo button already took back must not leave the
    // stock "Game over!" screen behind.
    if (!g.isGameTerminated()) g.actuator.clearMessage();
    GameManager.prototype.actuate.call(g);
    controller.dirty = false;
  }

  // ----------------------------------------------------------------
  // Run loop
  // ----------------------------------------------------------------

  function speedMps() {
    if (controller.speed === "afap") return Infinity;
    return BASE_MPS * parseInt(controller.speed, 10);
  }

  // ----------------------------------------------------------------
  // Headless: the whole game runs in the worker as matrix data — no
  // rendering per move, no round trips, no frame budget. The page just
  // shows the live counters and installs the final position into the
  // real game at the end. Full speed even in a background tab (rAF
  // throttling can't touch a worker).
  // ----------------------------------------------------------------

  function buildGrid(board, still) {
    var grid = new Grid(4);
    for (var i = 0; i < 16; i++) {
      if (!board[i]) continue;
      var t = new Tile({ x: i % 4, y: (i / 4) | 0 }, board[i]);
      if (still) t.previousPosition = { x: t.x, y: t.y }; // no pop-in
      grid.insertTile(t);
    }
    return grid;
  }

  function installBoard(board, score) {
    var g = gm();
    controller.aiActing = true;
    g.grid = buildGrid(board, false);
    g.score = score;
    g.won = Super.maxTile(board) >= 2048;
    g.keepPlaying = true;
    g.over = false;
    g.undoStack.length = 0; // the history lived in the worker, not here
    controller.aiActing = false;
    render();
  }

  function startHeadless() {
    var g = gm();
    if (!g) return;
    var worker = null;
    try { worker = new Worker("js/super_worker.js?v=" + BUILD); } catch (e) { worker = null; }
    if (!worker) return; // no Web Worker (file://): headless is unavailable

    controller.running = true;
    controller.finale = false;
    controller.done = false;
    controller.endReason = null;
    controller.startedAt = Date.now();
    controller.driver = null;
    controller.headless = { stats: { moves: 0, attempts: 0, undos: 0, score: 0 },
                            board: null, elapsed: 0 };
    controller.worker = worker;

    installHooks();
    hideWinOverlay();

    worker.onmessage = function (e) {
      var msg = e.data;
      if (!controller.running) return;
      if (msg.type !== "headlessProgress" && msg.type !== "headlessDone") return;
      controller.headless = { stats: msg.stats, board: msg.board,
                              elapsed: msg.elapsed };
      if (msg.type === "headlessDone") {
        controller.endReason = msg.reason || "won";
        if (controller.worker) { controller.worker.terminate(); controller.worker = null; }
        if (slowFinale() && perfectFinaleReplay(msg.board, msg.stats.score)) {
          return; // the cinema ends with the overlay and stopRun
        }
        installBoard(msg.board, msg.stats.score);
        controller.done = true;
        showWinOverlay();
        stopRun("won");
        return;
      }
      // Headless means headless: no rendering at all mid-run — the
      // board stays dimmed and frozen, only the counters live. The
      // final position installs when the run ends (or is stopped).
      updateHud();
    };
    worker.onerror = function () { stopRun("error"); };
    worker.postMessage({ type: "headless", corner: controller.corner,
                         orient: controller.orient,
                         goal: runGoal(),
                         predictable: controller.tiles === "perfect",
                         perfect: controller.tiles === "perfect",
                         honest: honestPlay() ? honestConfig() : null });

    document.body.classList.add("super-running");
    // Every headless run turns the renderer off: dim and freeze the
    // grid until the finished position lands.
    document.body.classList.add("super-computing");
    updateControls();
    // Just keep the clock ticking; progress messages drive everything else.
    controller.pumpId = setInterval(function () {
      if (controller.running) updateHud();
    }, 500);
  }

  // The compute is instant, but the ending deserves eyes on it. Once
  // the worker finishes a perfect run, rewind to just before the
  // finale, watch the tail of the build complete the primed spiral —
  // 65536 down to 4, snaked around the board — hold on it, then fold
  // it into 131072 in slow motion, every move played through the real
  // game. Returns false if the book isn't available to the page (then
  // the final board is simply installed, as before).
  var REPLAY_TAIL = 40;      // last build moves + the 15-move fold
  var SPIRAL_HOLD_MS = 2200; // the pose on the completed spiral

  function perfectFinaleReplay(finalBoard, finalScore) {
    var book = null;
    try {
      book = Super.perfectBook(controller.corner,
        controller.goal === "spiral" ? "full"
      : controller.goal === "score" ? "score" : "tile", controller.orient);
    } catch (e) {}
    if (!book || book.steps.length < REPLAY_TAIL) return false;
    var g = gm();

    // Fast-forward the line (pure simulation) to the cinema point,
    // carrying the score so the counter stays honest.
    var from = book.steps.length - REPLAY_TAIL;
    var b = book.start.slice();
    var score = 0;
    for (var i = 0; i < from; i++) {
      var st = book.steps[i];
      var sim = Super.simMove(b, st.dir);
      for (var m = 0; m < sim.merges.length; m++) score += sim.merges[m];
      sim.board[st.cell] = st.value;
      b = sim.board;
    }

    var S = Super.snakeCells(controller.corner, controller.orient);
    function primed(bb) {
      if (bb[S[15]] !== 4) return false;
      for (var p = 0; p <= 14; p++) {
        if (bb[S[p]] !== (1 << (16 - p))) return false;
      }
      return true;
    }

    installBoard(b, score);
    document.body.classList.remove("super-computing");
    controller.finale = true;
    updateHud();

    var idx = from;
    var endHeld = false;
    var stepMs = 1000 / FINALE_MPS;
    function playNext() {
      if (!controller.running) return;
      if (idx >= book.steps.length) {
        if (Super.maxTile(b) < 131072) {
          // The real grid should mirror the book exactly; if anything
          // ever drifted, land on the verified final position.
          installBoard(finalBoard, finalScore);
        }
        g.undoStack.length = 0; // the history lived in the book
        if (controller.goal !== "tile" && !endHeld) {
          // The last frame IS the money shot: the complete chain,
          // 131072 down to 4. Hold the pose before the overlay.
          endHeld = true;
          render();
          controller.replayId = setTimeout(playNext, SPIRAL_HOLD_MS);
          return;
        }
        controller.replayId = null;
        controller.done = true;
        render();
        showWinOverlay();
        stopRun("won");
        return;
      }
      var st = book.steps[idx++];
      var sim = Super.simMove(b, st.dir);
      sim.board[st.cell] = st.value;
      b = sim.board;

      var origSpawn = g.addRandomTile;
      g.addRandomTile = function () {
        var t = new Tile({ x: st.cell % 4, y: (st.cell / 4) | 0 }, st.value);
        g.grid.insertTile(t);
      };
      controller.aiActing = true;
      try {
        g.move(st.dir);
      } finally {
        g.addRandomTile = origSpawn;
        controller.aiActing = false;
      }
      render();
      updateHud();
      var wait = stepMs;
      if (primed(b)) wait = SPIRAL_HOLD_MS; // the pose on the primed spiral
      controller.replayId = setTimeout(playNext, wait);
    }
    controller.replayId = setTimeout(playNext, 700);
    return true;
  }

  function startRun() {
    if (controller.running) return;
    // 🧮 HEADLESS runs in the worker with the renderer off. Everything
    // else plays on the visible grid at the chosen speed.
    if (controller.speed === "headless") {
      startHeadless();
      return;
    }
    var g = gm();
    if (!g) return;

    controller.running = true;
    controller.finale = false;
    controller.done = false;
    controller.endReason = null;
    controller.startedAt = Date.now();
    controller.lastTick = 0;
    controller.moveDebt = 0;
    controller.frameBudget = 0;
    controller.headless = null;

    installHooks();
    hideWinOverlay();

    // All thinking happens in a worker so the page never freezes; if
    // workers are unavailable (e.g. file://), fall back to thinking on
    // the main thread.
    controller.worker = null;
    controller.requestedKey = null;
    controller.plannerBusySince = 0;
    var honest = honestPlay();
    try {
      controller.worker = new Worker("js/super_worker.js?v=" + BUILD);
      controller.worker.postMessage({ type: "init", corner: controller.corner,
                                      orient: controller.orient,
                                      goal: runGoal(),
                                      perfect: controller.tiles === "perfect",
                                      honest: honest ? honestConfig() : null });
      controller.planStore = {};
      controller.worker.onmessage = function (e) {
        var msg = e.data;
        if (!controller.running) return;
        var key = msg.board ? msg.board.join(",") : null;
        if (msg.type === "plan") {
          controller.planStore[key] = { board: msg.board, plan: msg.plan };
          var keys = Object.keys(controller.planStore);
          if (keys.length > 8) delete controller.planStore[keys[0]];
        } else if (msg.type === "move") {
          if (controller.driver && controller.driver.setMove) {
            controller.driver.setMove(msg.board, msg.dir);
          }
        } else {
          return;
        }
        if (controller.requestedKey === key) {
          controller.requestedKey = null;
          controller.plannerBusySince = 0;
          tick(null, "reply"); // resume the burst right away, no frame wait
        }
      };
      controller.worker.onerror = function () {
        // Lose the worker, keep the run: fall back to sync thinking.
        if (controller.worker) controller.worker.terminate();
        controller.worker = null;
        if (controller.driver) controller.driver.options.externalPlanner = false;
      };
    } catch (e) { controller.worker = null; }

    controller.aiActing = true;
    if (honest) {
      var hc = honestConfig();
      controller.driver = new Super.HonestDriver(g, controller.corner, Tile, {
        algo: hc.algo,
        tiles: hc.tiles,
        undo: hc.undo,
        goal: runGoal(),
        externalPlanner: !!controller.worker
      });
    } else {
      controller.driver = new Super.SuperDriver(g, controller.corner, Tile, {
        predictable: controller.tiles === "perfect",
        perfect: controller.tiles === "perfect",
        orient: controller.orient,
        goal: runGoal(),
        externalPlanner: !!controller.worker,
        onDeadEnd: function (board) {
          if (controller.worker) {
            controller.worker.postMessage({ type: "markDead", board: board });
          }
        }
      });
    }
    // Attach before the restart: the opening pair then comes through
    // the driver's spawner too — seated on the line for perfect play,
    // honest random (or Evil) otherwise.
    controller.driver.attach();
    g.undoStack.length = 0;        // a fresh run keeps its own history
    g.restart();
    controller.aiActing = false;

    document.body.classList.add("super-running");
    updateControls();
    controller.rafId = requestAnimationFrame(tick);
    // Keep making progress when the tab is hidden and rAF is throttled.
    controller.pumpId = setInterval(function () {
      if (document.hidden && controller.running) tick(null, "clock");
    }, 250);
  }

  function stopRun(why) {
    if (!controller.running) return;
    controller.running = false;
    if (controller.rafId) cancelAnimationFrame(controller.rafId);
    if (controller.pumpId) clearInterval(controller.pumpId);
    if (controller.replayId) clearTimeout(controller.replayId);
    controller.rafId = controller.pumpId = controller.replayId = null;
    controller.requestedKey = null;
    if (controller.worker) { controller.worker.terminate(); controller.worker = null; }
    if (controller.driver) controller.driver.detach();
    if (controller.headless && controller.headless.board && why !== "won") {
      // Stopped mid-headless-run: keep what it reached — install the
      // last snapshot as the real game state (no undo history; the
      // moves lived in the worker).
      installBoard(controller.headless.board, controller.headless.stats.score);
    }
    removeHooks();
    document.body.classList.remove("super-running");
    document.body.classList.remove("super-computing");
    render();
    updateControls();
    updateHud();
  }

  // The finale (folding the finished spiral into 131072) plays at a
  // readable pace whatever speed built it — unless HYPERCOMPLETE says
  // otherwise.
  var FINALE_MPS = 2.5;

  // kind: undefined = an animation frame (schedules the next one and
  // advances the clock); "clock" = the hidden-tab pump (advances the
  // clock only); "reply" = a worker answer arrived (spend what the
  // current frame still allows, right away).
  function tick(ts, kind) {
    if (!controller.running) return;
    if (!kind) controller.rafId = requestAnimationFrame(tick);

    var now = Date.now();
    var mps = controller.finale ? FINALE_MPS : speedMps();
    if (kind !== "reply") {
      if (!controller.lastTick) controller.lastTick = now;
      var dt = Math.min(500, now - controller.lastTick);
      controller.lastTick = now;
      if (mps !== Infinity) {
        // Whatever the last frame didn't spend flows back into the debt.
        controller.moveDebt += dt * mps / 1000 + (controller.frameBudget || 0);
        controller.frameBudget = Math.floor(controller.moveDebt);
        controller.moveDebt -= controller.frameBudget;
      }
    }

    var deadline = now + (mps === Infinity ? 11 : 6);
    for (;;) {
      if (mps !== Infinity && controller.frameBudget <= 0) break;
      var ev = stepOnce();
      if (ev === "halt") return;
      if (ev === "planwait") break; // the worker is thinking; stay smooth
      if (ev === "accepted") {
        if (mps !== Infinity) controller.frameBudget--;
        if (controller.finale) { controller.frameBudget = 0; break; } // one finale move per frame
      }
      if (Date.now() >= deadline) break;
    }

    if (controller.dirty) render();
    updateHud();
  }

  function stepOnce() {
    var d = controller.driver;
    controller.aiActing = true;
    var ev;
    try {
      ev = d.step();
    } finally {
      controller.aiActing = false;
    }
    if (ev.type === "accepted" && slowFinale() &&
        (ev.phase === "finale" || ev.phase === "primed") && !controller.finale) {
      controller.finale = true;
      controller.dirty = true;
      render(); // show the primed board before the slow-motion collapse
    }
    if (ev.type === "accepted" && ev.phase === "build" && controller.finale) {
      // A score run keeps playing after the 131072 collapse; resume the
      // chosen speed once the cinematic is over.
      controller.finale = false;
    }
    if (ev.type === "done") {
      controller.endReason = ev.reason || "won";
      controller.done = true;
      render();
      showWinOverlay();
      stopRun("won");
      return "halt";
    }
    if (ev.type === "stuck") {
      stopRun("stuck");
      return "halt";
    }
    if (ev.type === "needplan") {
      var key = ev.board.join(",");
      var stored = controller.planStore && controller.planStore[key];
      if (stored) {
        delete controller.planStore[key];
        controller.driver.setPlan(stored.board, stored.plan);
        return "working"; // prefetched: keep the burst rolling
      }
      if (controller.worker && controller.requestedKey !== key) {
        controller.requestedKey = key;
        controller.plannerBusySince = Date.now();
        controller.worker.postMessage({ type: "plan", board: ev.board });
      }
      return "planwait";
    }
    if (ev.type === "needmove") {
      var mkey = ev.board.join(",");
      if (controller.worker && controller.requestedKey !== mkey) {
        controller.requestedKey = mkey;
        controller.plannerBusySince = Date.now();
        controller.worker.postMessage({ type: "move", board: ev.board,
                                        lastDir: ev.lastDir });
      }
      return "planwait";
    }
    if (ev.type === "backtrack") controller.dirty = true;
    return ev.type === "accepted" ? "accepted" : "working";
  }

  // ----------------------------------------------------------------
  // UI
  // ----------------------------------------------------------------

  function fmtInt(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  // Every perfect run plays the shipped line for its goal when the
  // page has it; the lengths are exact by the mass ledger.
  function lineMoves() {
    return controller.goal === "spiral" ? "65,533"
         : controller.goal === "score" ? "129,333" : "32,781";
  }

  function onBook() {
    try {
      return !!Super.hasBook(Super.bookFor(controller.goal));
    } catch (e) { return false; }
  }

  // Words for the honest selection (the end-of-run overlay).
  function algoWho() {
    return controller.algo === "genius"
      ? "GENIUS" : "aj-r's " + ALGO_NAMES[controller.algo];
  }
  function tilesWords() {
    return controller.tiles === "evil" ? "Evil tiles" : "regular tiles";
  }

  // The HUD: three counters, nothing that changes width.
  function updateHud() {
    var d = controller.driver;
    var hs = controller.headless;
    var st = d ? d.stats : (hs && hs.stats);
    if (!st) return;
    $(".super-stat-moves").textContent = fmtInt(st.moves);
    var undoEl = $(".super-stat-undos");
    var prev = undoEl.textContent;
    var next = fmtInt(st.undos);
    if (prev !== next) {
      undoEl.textContent = next;
      undoEl.classList.remove("super-pulse");
      void undoEl.offsetWidth; // restart the animation
      undoEl.classList.add("super-pulse");
    }
    var secs = Math.floor((Date.now() - controller.startedAt) / 1000);
    $(".super-stat-time").textContent =
      Math.floor(secs / 60) + ":" + ("0" + (secs % 60)).slice(-2);
  }

  function setRow(name, shown) {
    var row = $('.super-row[data-row="' + name + '"]');
    if (row) row.classList.toggle("super-hidden", !shown);
  }

  function selectChips(attr, value) {
    $all(".super-chip[" + attr + "]").forEach(function (el) {
      el.classList.toggle("selected", el.getAttribute(attr) === value);
      el.classList.toggle("disabled", controller.running);
    });
  }

  function updateControls() {
    $(".super-toggle").classList.toggle("super-on", controller.running);
    $(".super-toggle .super-toggle-label").textContent =
      controller.running ? "STOP" : "RUN AI";
    var honest = honestPlay();
    setRow("undo", controller.tiles === "regular");
    setRow("algo", honest);
    setRow("algo2", honest);
    setRow("finale", !honest);
    selectChips("data-tiles", controller.tiles);
    selectChips("data-undo", controller.undo);
    selectChips("data-algo", controller.algo);
    selectChips("data-goal", runGoal());
    selectChips("data-finale", controller.finaleMode);
    $all('.super-chip[data-goal="spiral"]').forEach(function (el) {
      el.classList.toggle("super-hidden", honest);
    });
    $all(".super-speed").forEach(function (el) {
      el.classList.toggle("selected",
        el.getAttribute("data-speed") === controller.speed);
      el.classList.toggle("disabled", false);
    });
    drawPickers();
  }

  // Two fixed-size pickers: the corner grid says where the 131072
  // lives; the spiral grids draw both snakes out of that corner (along
  // its row, along its column) and you click the one you want.
  function drawPickers() {
    $all(".super-corner-cell").forEach(function (el) {
      el.classList.toggle("selected", el.getAttribute("data-corner") === controller.corner);
      el.classList.toggle("disabled", controller.running);
    });
    $all(".super-spiral").forEach(function (box) {
      var orient = box.getAttribute("data-orient");
      var S = Super.snakeCells(controller.corner, orient);
      var order = {};
      var pts = [];
      for (var i = 0; i < 16; i++) {
        order[S[i]] = i;
        pts.push((5 + 12 * (S[i] % 4)) + "," + (5 + 12 * ((S[i] / 4) | 0)));
      }
      var line = box.querySelector("polyline");
      if (line) line.setAttribute("points", pts.join(" "));
      var head = box.querySelector("circle");
      if (head) {
        head.setAttribute("cx", 5 + 12 * (S[0] % 4));
        head.setAttribute("cy", 5 + 12 * ((S[0] / 4) | 0));
      }
      box.querySelectorAll(".super-mini-cell").forEach(function (el) {
        var c = Number(el.getAttribute("data-cell"));
        el.classList.toggle("selected", c === S[0]);
        // The cells fade along the snake: brightest at the corner.
        el.style.background = c === S[0] ? ""
          : "rgba(246, 94, 59, " + (0.55 - 0.032 * order[c]).toFixed(3) + ")";
      });
      box.classList.toggle("selected", orient === controller.orient);
      box.classList.toggle("disabled", controller.running);
    });
  }

  // NodeList.forEach polyfill for older browsers, matching the repo's era.
  if (window.NodeList && !NodeList.prototype.forEach) {
    NodeList.prototype.forEach = Array.prototype.forEach;
  }

  function showWinOverlay() {
    var st = controller.driver ? controller.driver.stats
                               : controller.headless.stats;
    var el = $(".super-win");
    var score = controller.driver ? gm().score : st.score;
    // One short line under the number; the counters below carry the rest.
    if (honestPlay()) {
      var mt = st.maxTile || Super.maxTile(controller.driver
        ? controller.driver.readBoard() : controller.headless.board);
      $(".super-win h2").textContent = fmtInt(mt);
      var why = controller.endReason === "won" ? "131072"
              : controller.endReason === "out of luck" ? "Out of luck"
              : "Game over";
      $(".super-win-sub").textContent = why + " · " + algoWho() + " · " +
        tilesWords() + " · " + fmtInt(score) + " points";
    } else if (controller.goal === "score") {
      $(".super-win h2").textContent = fmtInt(score);
      $(".super-win-sub").textContent = "The full chain. The board is dead.";
    } else if (controller.goal === "spiral") {
      $(".super-win h2").textContent = "131072";
      $(".super-win-sub").textContent = "Every power of two on the board at once.";
    } else {
      $(".super-win h2").textContent = "131072";
      $(".super-win-sub").textContent = "The highest tile in 2048.";
    }
    $(".super-win-moves").textContent = fmtInt(st.moves);
    $(".super-win-undos").textContent = fmtInt(st.undos);
    var secs = Math.floor((Date.now() - controller.startedAt) / 1000);
    $(".super-win-time").textContent =
      Math.floor(secs / 60) + "m " + (secs % 60) + "s";
    el.classList.add("super-win-active");
  }

  function hideWinOverlay() {
    $(".super-win").classList.remove("super-win-active");
  }

  function setOption(name, value) {
    if (name === "finale") controller.finaleMode = value;
    else controller[name] = value;
    savePref("super2048." + name, value);
    if (name === "tiles" && value === "perfect") {
      // The instant computed run is PERFECT's default experience;
      // picking a rendered speed afterwards plays the whole book on
      // the visible grid instead.
      controller.speed = "headless";
      savePref("super2048.speed", controller.speed);
    }
    updateControls();
  }

  function wireUp() {
    $(".super-toggle").addEventListener("click", function (e) {
      e.preventDefault();
      if (controller.running) stopRun("user"); else startRun();
    });

    var OPTION_ATTRS = ["tiles", "undo", "algo", "goal", "finale"];
    $all(".super-chip").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.preventDefault();
        if (controller.running) return; // pick before you launch
        for (var i = 0; i < OPTION_ATTRS.length; i++) {
          var v = el.getAttribute("data-" + OPTION_ATTRS[i]);
          if (v) { setOption(OPTION_ATTRS[i], v); break; }
        }
      });
    });

    $all(".super-speed").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.preventDefault();
        var next = el.getAttribute("data-speed");
        // Rendered speeds swap freely mid-run; headless is a different
        // execution mode, so crossing that line needs a fresh start.
        if (controller.running &&
            (next === "headless") !== (controller.speed === "headless")) return;
        controller.speed = next;
        savePref("super2048.speed", controller.speed);
        updateControls();
      });
    });

    $all(".super-corner-cell").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.preventDefault();
        if (controller.running) return; // pick before you launch
        controller.corner = el.getAttribute("data-corner");
        savePref("super2048.corner", controller.corner);
        updateControls();
      });
    });

    $all(".super-spiral").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.preventDefault();
        if (controller.running) return;
        setOption("orient", el.getAttribute("data-orient"));
      });
    });

    $(".super-win-again").addEventListener("click", function (e) {
      e.preventDefault();
      hideWinOverlay();
      startRun();
    });
    $(".super-win-close").addEventListener("click", function (e) {
      e.preventDefault();
      hideWinOverlay();
    });

    updateControls();
  }

  // application.js creates game_manager inside requestAnimationFrame;
  // wait for both it and the DOM.
  function boot() {
    if (window.game_manager && document.readyState !== "loading") {
      wireUp();
    } else {
      setTimeout(boot, 50);
    }
  }
  boot();
})();
