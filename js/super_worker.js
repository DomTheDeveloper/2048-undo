// Web Worker host for the Super Mode planner.
//
// All searching happens here so the page never freezes: the controller
// sends a board, this worker answers with the planned line. The memoized
// search state (dead-end families, failed plans, collapse scripts) lives
// for the length of one run.

importScripts("super_ai.js");

var ai = null;
var headless = null;

// Headless mode: the ENTIRE game runs in here as matrix data — no
// per-move round trips, no rendering. Bounded slices keep the worker
// responsive to stop messages; progress posts a few times a second.
function headlessTick() {
  if (!headless) return;
  var done = headless.run(150);
  postMessage({
    type: done ? "headlessDone" : "headlessProgress",
    board: headless.board,
    stats: headless.stats,
    elapsed: Date.now() - headless.t0
  });
  if (done) { headless = null; return; }
  setTimeout(headlessTick, 0);
}

// Answer the requested board, then prefetch one line ahead: while the
// page replays line N, the plan for line N+1 is already computed. In
// steady state the planner never sits on the critical path.
function planAndSend(board) {
  var plan = ai.plan(board);
  postMessage({ type: "plan", board: board, plan: plan });
  return plan;
}

function endpointOf(board, steps) {
  var b = board;
  for (var i = 0; i < steps.length; i++) {
    b = Super2048.simMove(b, steps[i].dir).board;
    b[steps[i].cell] = steps[i].value;
  }
  return b;
}

onmessage = function (e) {
  var msg = e.data;
  if (msg.type === "init") {
    ai = new Super2048.SuperAI(msg.corner, { goal: msg.goal,
                                             perfect: msg.perfect });
  } else if (msg.type === "plan" && ai) {
    var plan = planAndSend(msg.board);
    if (plan.type === "line" && plan.steps.length) {
      planAndSend(endpointOf(msg.board, plan.steps));
    }
  } else if (msg.type === "markDead" && ai) {
    ai.markDeadEnd(msg.board);
  } else if (msg.type === "headless") {
    headless = new Super2048.HeadlessRunner(msg.corner, {
      goal: msg.goal,
      predictable: msg.predictable,
      perfect: msg.perfect
    });
    headless.t0 = Date.now();
    headlessTick();
  } else if (msg.type === "headlessStop") {
    headless = null;
  }
};
