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
    finale: false,
    done: false,
    startedAt: 0,
    lastTick: 0,
    moveDebt: 0,
    rafId: null,
    pumpId: null,
    savedProtoMove: null,
    savedProtoRestart: null
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

  function startRun() {
    if (controller.running) return;
    var g = gm();
    if (!g) return;

    controller.running = true;
    controller.finale = false;
    controller.done = false;
    controller.startedAt = Date.now();
    controller.lastTick = 0;
    controller.moveDebt = 0;

    installHooks();
    hideWinOverlay();

    controller.aiActing = true;
    g.undoStack.length = 0;        // a fresh run keeps its own history
    g.restart();
    controller.driver = new Super.SuperDriver(g, controller.corner, Tile, {});
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
    controller.rafId = controller.pumpId = null;
    if (controller.driver) controller.driver.detach();
    removeHooks();
    document.body.classList.remove("super-running");
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
    if (!d) return;
    $(".super-stat-moves").textContent = fmtInt(d.stats.moves);
    var undoEl = $(".super-stat-undos");
    var prev = undoEl.textContent;
    var next = fmtInt(d.stats.undos);
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
      setStatus("131072 — perfect spiral complete!");
    } else if (controller.finale) {
      setStatus("FINALE — folding the spiral into 131072…");
    } else if (controller.running) {
      var max = Super.maxTile(d.readBoard());
      setStatus("building the spiral — largest tile " + fmtInt(max));
    }
  }

  function updateControls() {
    $(".super-toggle").classList.toggle("super-on", controller.running);
    $(".super-toggle .super-toggle-label").textContent =
      controller.running ? "STOP" : "SUPER MODE";
    $all(".super-speed").forEach(function (el) {
      el.classList.toggle("selected", el.getAttribute("data-speed") === controller.speed);
    });
    $all(".super-corner-cell").forEach(function (el) {
      el.classList.toggle("selected", el.getAttribute("data-corner") === controller.corner);
      el.classList.toggle("disabled", controller.running);
    });
    if (!controller.running && !controller.done) {
      setStatus("plays a perfect game to the 131072 tile, undoing every unlucky spawn");
    }
  }

  // NodeList.forEach polyfill for older browsers, matching the repo's era.
  if (window.NodeList && !NodeList.prototype.forEach) {
    NodeList.prototype.forEach = Array.prototype.forEach;
  }

  function showWinOverlay() {
    var d = controller.driver;
    var el = $(".super-win");
    $(".super-win-moves").textContent = fmtInt(d.stats.moves);
    $(".super-win-undos").textContent = fmtInt(d.stats.undos);
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
        controller.speed = el.getAttribute("data-speed");
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
