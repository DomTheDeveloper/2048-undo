// Super Mode UI controller for 2048-undo.
//
// Drives the SuperAI (js/super_ai.js) against the live game: speed
// control (1x-5x and AFAP), target-corner picker, HUD with move/undo
// counters, a cinematic finale, and a 131072 celebration overlay.

(function () {
  "use strict";

  var Super = window.Super2048;
  var BASE_MPS = 8; // moves per second at 1x

  var controller = {
    running: false,
    aiActing: false,
    dirty: false,
    driver: null,
    corner: null,
    speed: null,
    mode: null,
    finale: false,
    done: false,
    startedAt: 0,
    lastTick: 0,
    moveDebt: 0,
    rafId: null,
    pumpId: null,
    worker: null,
    replayId: null,
    holdStatus: null,
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

  controller.corner = loadPref("super2048.corner", "br");
  controller.speed = loadPref("super2048.speed", "afap");
  controller.mode = loadPref("super2048.mode", "super");
  controller.goal = loadPref("super2048.goal", "tile");

  // ----------------------------------------------------------------
  // Game hooks
  // ----------------------------------------------------------------

  function gm() { return window.game_manager; }

  function installHooks() {
    var g = gm();

    controller.savedProtoMove = GameManager.prototype.move;
    GameManager.prototype.move = function (dir) {
      // While Super Mode runs, only the AI may move (keys/swipes are
      // bound directly to this prototype method, so gate it here).
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
  // shows a live counter and an occasional board snapshot, and installs
  // the final position into the real game at the end. Full speed even
  // in a background tab (rAF throttling can't touch a worker).
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
    try { worker = new Worker("js/super_worker.js"); } catch (e) { worker = null; }
    if (!worker) {
      // No workers here (e.g. file://): headless can't run in the
      // background, so fall back to the fastest rendered mode.
      controller.speed = "afap";
      savePref("super2048.speed", controller.speed);
      updateControls();
      startRun();
      return;
    }

    controller.running = true;
    controller.finale = false;
    controller.done = false;
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
        if (controller.worker) { controller.worker.terminate(); controller.worker = null; }
        if (controller.mode === "perfect" &&
            perfectFinaleReplay(msg.board, msg.stats.score)) {
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
      updateHud(false);
    };
    worker.onerror = function () {
      setStatus("worker error — headless run stopped");
      stopRun("error");
    };
    worker.postMessage({ type: "headless", corner: controller.corner,
                         goal: controller.goal,
                         predictable: controller.mode !== "super",
                         perfect: controller.mode === "perfect" });

    document.body.classList.add("super-running");
    // Every headless run turns the renderer off: dim and freeze the
    // grid until the finished position lands.
    document.body.classList.add("super-computing");
    updateControls();
    // Just keep the clock ticking; progress messages drive everything else.
    controller.pumpId = setInterval(function () {
      if (controller.running) updateHud(false);
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
      : controller.goal === "score" ? "score" : "tile");
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

    var S = Super.snakeCells(controller.corner);
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
    updateHud(false);

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
          controller.holdStatus = controller.goal === "score"
            ? "move 129,333 — MAXIMUM SCORE: 3,925,224 points, the board dead on the full spiral"
            : "move 65,533 — THE 131072 SPIRAL: every power of two at once";
          setStatus(controller.holdStatus);
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
      controller.holdStatus = null; // any lingering pose is over
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
      updateHud(false);
      var wait = stepMs;
      if (primed(b)) {
        wait = SPIRAL_HOLD_MS;
        controller.holdStatus =
          "move 32,766 — THE PERFECT SPIRAL: 65536 … 4, one fold from 131072";
        setStatus(controller.holdStatus);
      }
      controller.replayId = setTimeout(playNext, wait);
    }
    controller.replayId = setTimeout(playNext, 700);
    return true;
  }

  function startRun() {
    if (controller.running) return;
    // 🧮 HEADLESS runs in the worker with the renderer off. Everything
    // else — PERFECT included — plays on the visible grid: a rendered
    // PERFECT run replays the whole book move by move at the chosen
    // speed, finale in slow motion, zero undos.
    if (controller.speed === "headless") {
      startHeadless();
      return;
    }
    var g = gm();
    if (!g) return;

    controller.running = true;
    controller.finale = false;
    controller.done = false;
    controller.startedAt = Date.now();
    controller.lastTick = 0;
    controller.moveDebt = 0;
    controller.headless = null;

    installHooks();
    hideWinOverlay();

    // All searching happens in a worker so the page never freezes; if
    // workers are unavailable (e.g. file://), fall back to planning on
    // the main thread.
    controller.worker = null;
    controller.requestedKey = null;
    controller.plannerBusySince = 0;
    try {
      controller.worker = new Worker("js/super_worker.js");
      controller.worker.postMessage({ type: "init", corner: controller.corner,
                                      goal: controller.goal,
                                      perfect: controller.mode === "perfect" });
      controller.planStore = {};
      controller.worker.onmessage = function (e) {
        var msg = e.data;
        if (msg.type === "plan" && controller.running) {
          var key = msg.board.join(",");
          controller.planStore[key] = { board: msg.board, plan: msg.plan };
          var keys = Object.keys(controller.planStore);
          if (keys.length > 8) delete controller.planStore[keys[0]];
          if (controller.requestedKey === key) {
            controller.requestedKey = null;
            controller.plannerBusySince = 0;
            tick(null, true); // resume the burst right away, no frame wait
          }
        }
      };
      controller.worker.onerror = function () {
        // Lose the worker, keep the run: fall back to sync planning.
        if (controller.worker) controller.worker.terminate();
        controller.worker = null;
        if (controller.driver) controller.driver.options.externalPlanner = false;
      };
    } catch (e) { controller.worker = null; }

    controller.aiActing = true;
    g.undoStack.length = 0;        // a fresh run keeps its own history
    g.restart();
    controller.driver = new Super.SuperDriver(g, controller.corner, Tile, {
      predictable: controller.mode !== "super",
      perfect: controller.mode === "perfect",
      goal: controller.goal,
      externalPlanner: !!controller.worker,
      onDeadEnd: function (board) {
        if (controller.worker) {
          controller.worker.postMessage({ type: "markDead", board: board });
        }
      }
    });
    controller.driver.attach();
    controller.aiActing = false;

    document.body.classList.add("super-running");
    updateControls();
    controller.rafId = requestAnimationFrame(tick);
    // Keep making progress when the tab is hidden and rAF is throttled.
    controller.pumpId = setInterval(function () {
      if (document.hidden && controller.running) tick(null, true);
    }, 250);
  }

  function stopRun(why) {
    if (!controller.running) return;
    controller.running = false;
    if (controller.rafId) cancelAnimationFrame(controller.rafId);
    if (controller.pumpId) clearInterval(controller.pumpId);
    if (controller.replayId) clearTimeout(controller.replayId);
    controller.rafId = controller.pumpId = controller.replayId = null;
    controller.holdStatus = null;
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
    updateHud(why === "won");
  }

  // The finale (folding the finished spiral into 131072) always plays at
  // a readable pace, whatever speed built it — it's the money shot.
  var FINALE_MPS = 2.5;

  function tick(ts, fromPump) {
    if (!controller.running) return;
    if (!fromPump) controller.rafId = requestAnimationFrame(tick);

    var now = Date.now();
    if (!controller.lastTick) controller.lastTick = now;
    var dt = Math.min(500, now - controller.lastTick);
    controller.lastTick = now;

    var mps = controller.finale ? FINALE_MPS : speedMps();
    var budgetMoves;
    if (mps === Infinity) {
      budgetMoves = Infinity;
    } else {
      controller.moveDebt += dt * mps / 1000;
      budgetMoves = Math.floor(controller.moveDebt);
      controller.moveDebt -= budgetMoves;
    }

    var deadline = now + (mps === Infinity ? 11 : 6);
    var movesDone = 0;
    while (movesDone < budgetMoves || (mps === Infinity && Date.now() < deadline)) {
      if (mps !== Infinity && movesDone >= budgetMoves) break;
      var ev = stepOnce();
      if (ev === "halt") return;
      if (ev === "planwait") break; // the worker is thinking; stay smooth
      if (ev === "accepted") {
        movesDone++;
        if (controller.finale) break; // one finale move per frame batch
      }
      if (Date.now() >= deadline) break;
    }

    if (controller.dirty) render();
    updateHud(false);
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
    if (ev.type === "accepted" && (ev.phase === "finale" || ev.phase === "primed") &&
        !controller.finale) {
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
      controller.done = true;
      render();
      showWinOverlay();
      stopRun("won");
      return "halt";
    }
    if (ev.type === "stuck") {
      setStatus("stuck — " + (ev.reason || "unknown") + " (stopped)");
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
    return ev.type === "accepted" ? "accepted" : "working";
  }

  // ----------------------------------------------------------------
  // UI
  // ----------------------------------------------------------------

  function setStatus(text) {
    $(".super-status").textContent = text;
  }

  function fmtInt(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function updateHud(justWon) {
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

    if (controller.done || justWon) {
      setStatus(controller.goal === "score"
        ? "maximum score reached — the board died gloriously!"
        : controller.goal === "spiral"
        ? "THE 131072 SPIRAL — every power of two on the board at once!"
        : "131072 — perfect spiral complete!");
    } else if (controller.finale) {
      // A held pose (the primed spiral, the finished chain) owns the
      // status for as long as the camera lingers on it.
      setStatus(controller.holdStatus ||
        (controller.goal === "spiral"
          ? "FINALE — the last tiles of the full spiral…"
          : "FINALE — folding the spiral into 131072…"));
    } else if (controller.running && !d && hs) {
      var hmax = hs.board ? Super.maxTile(hs.board) : 0;
      if (controller.mode === "perfect") {
        setStatus("computing the perfect " +
          (controller.goal === "spiral" ? "spiral — move "
         : controller.goal === "score" ? "score run — move " : "game — move ") +
          fmtInt(st.moves) +
          (controller.goal === "spiral" ? " of 65,533"
         : controller.goal === "score" ? " of 129,333" : " of 32,781") +
          " — zero undos, by construction — " +
          fmtInt(st.explored || 0) + " states searched — largest tile " +
          fmtInt(hmax));
      } else {
        var mps = hs.elapsed > 500
          ? " at " + fmtInt(Math.round(st.moves / (hs.elapsed / 1000))) + " moves/s"
          : "";
        setStatus("headless — pure data, no rendering" + mps +
          " — largest tile " + fmtInt(hmax) +
          (controller.goal === "score"
            ? " — score " + fmtInt(st.score) + " / 3,932,156"
            : controller.goal === "spiral" ? " — building the full spiral" : ""));
      }
    } else if (controller.running) {
      var thinking = controller.plannerBusySince &&
        Date.now() - controller.plannerBusySince > 400;
      var max = Super.maxTile(d.readBoard());
      var bookOf = controller.mode === "perfect"
        ? "move " + fmtInt(d.stats.moves) + " of " +
          (controller.goal === "spiral" ? "65,533"
         : controller.goal === "score" ? "129,333" : "32,781") + " — "
        : null;
      var progress = controller.goal === "score"
        ? (bookOf || "") + "score " + fmtInt(gm().score) +
          " / 3,932,156 — largest tile " + fmtInt(max)
        : controller.goal === "spiral"
        ? (bookOf || "building the FULL spiral — ") + "largest tile " + fmtInt(max)
        : (bookOf || "building the spiral — ") + "largest tile " + fmtInt(max);
      setStatus((thinking ? "thinking… — " : "") + progress +
        (controller.mode === "predictable" ? " (spawns by design)" : ""));
    }
  }

  function updateControls() {
    $(".super-toggle").classList.toggle("super-on", controller.running);
    $(".super-toggle .super-toggle-label").textContent =
      controller.running ? "STOP" : "SUPER MODE";
    $all(".super-speed").forEach(function (el) {
      el.classList.toggle("selected",
        el.getAttribute("data-speed") === controller.speed);
      el.classList.toggle("disabled", false);
    });
    $all(".super-corner-cell").forEach(function (el) {
      el.classList.toggle("selected", el.getAttribute("data-corner") === controller.corner);
      el.classList.toggle("disabled", controller.running);
    });
    $all(".super-mode-btn").forEach(function (el) {
      el.classList.toggle("selected", el.getAttribute("data-mode") === controller.mode);
      el.classList.toggle("disabled", controller.running);
    });
    $all(".super-goal-btn").forEach(function (el) {
      el.classList.toggle("selected", el.getAttribute("data-goal") === controller.goal);
      el.classList.toggle("disabled", controller.running);
    });
    if (!controller.running && !controller.done) {
      var how = controller.mode === "perfect"
        ? "all-4 feeding: the mathematical minimum of " +
          (controller.goal === "spiral" ? "65,533" : "32,781") + " moves"
        : controller.mode === "predictable"
        ? "it decides every next tile and where it lands"
        : "undoing every unlucky spawn along the way";
      setStatus(controller.goal === "score"
        ? "maximum-score run to 3,932,156 — " +
          (controller.mode === "perfect"
            ? "the computed 129,333-move line: 2s except the 1,735 geometrically forced 4s"
            : how)
        : controller.goal === "spiral"
        ? "the FULL spiral — every power of two, 131072 down to 4, at once — " + how
        : (controller.mode === "perfect"
            ? "move-minimal game to 131072 — " : "perfect game to 131072 — ") + how);
    }
  }

  // NodeList.forEach polyfill for older browsers, matching the repo's era.
  if (window.NodeList && !NodeList.prototype.forEach) {
    NodeList.prototype.forEach = Array.prototype.forEach;
  }

  function showWinOverlay() {
    var st = controller.driver ? controller.driver.stats
                               : controller.headless.stats;
    var el = $(".super-win");
    var how = controller.mode === "perfect"
      ? "computed as pure data: exactly " +
        (controller.goal === "spiral" ? "65,533"
       : controller.goal === "score" ? "129,333" : "32,781") +
        " moves, zero undos"
      : controller.mode === "predictable"
      ? "every tile chosen and placed by design"
      : "capped off by a spawned&nbsp;4";
    if (controller.mode !== "perfect" && controller.speed === "headless") {
      how += ", all as pure matrix data";
    }
    if (controller.goal === "score") {
      $(".super-win h2").textContent = fmtInt(gm().score);
      $(".super-win-sub").innerHTML =
        "Maximum-score run complete — 131072 plus the full descending " +
        "chain, " + how + ".<br>The board is dead. Gloriously.";
    } else if (controller.goal === "spiral") {
      $(".super-win h2").textContent = "131072";
      $(".super-win-sub").innerHTML =
        "THE FULL SPIRAL — every power of two from 131072 down to 4, " +
        "one per cell, " + how + ".<br>The board is dead. Perfectly.";
    } else {
      $(".super-win h2").textContent = "131072";
      $(".super-win-sub").innerHTML = "Perfect spiral complete — " + how +
        ".<br>The highest tile 2048 allows.";
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

  function wireUp() {
    $(".super-toggle").addEventListener("click", function (e) {
      e.preventDefault();
      if (controller.running) stopRun("user"); else startRun();
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

    $all(".super-mode-btn").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.preventDefault();
        if (controller.running) return; // pick before you launch
        controller.mode = el.getAttribute("data-mode");
        savePref("super2048.mode", controller.mode);
        if (controller.mode === "perfect") {
          // The instant computed run is PERFECT's default experience;
          // picking a rendered speed afterwards plays the whole book
          // on the visible grid instead.
          controller.speed = "headless";
          savePref("super2048.speed", controller.speed);
        }
        updateControls();
      });
    });

    $all(".super-goal-btn").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.preventDefault();
        if (controller.running) return; // pick before you launch
        controller.goal = el.getAttribute("data-goal");
        savePref("super2048.goal", controller.goal);
        updateControls();
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
