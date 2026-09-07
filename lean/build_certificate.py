#!/usr/bin/env python3
"""Generate and KERNEL-CHECK the committed 131072 witness.

Python only proposes concrete intermediate boards and Lean source. Every
proposed transition is subsequently checked by Lean's ordinary equality reflexivity (`rfl`),
and the final theorem also uses the independently proved universal lower
bound. Python, its replay function, and this generator are not proof axioms.
Run from any directory after compiling Basic.lean and LowerBound.lean:
    python3 lean/build_certificate.py
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import subprocess
import time

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
OUT = ROOT / "Game2048" / "Generated"
WITNESS = REPO / "witness" / "131072.txt"
WORKERS = max(1, min(4, int(os.environ.get("LEAN_JOBS", "2"))))
DIRECTIONS = {"U": "up", "R": "right", "D": "down", "L": "left"}
ALLOWED_AXIOMS = {"propext", "Classical.choice", "Quot.sound"}


def parse_witness() -> tuple[list[tuple[int, int, int]], list[tuple[str, int, int, int]]]:
    starts: list[tuple[int, int, int]] = []
    moves: list[tuple[str, int, int, int]] = []
    for lineno, raw in enumerate(WITNESS.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        fields = line.split()
        if len(fields) != 4:
            raise ValueError(f"line {lineno}: expected four fields")
        op = fields[0]
        r, c, v = map(int, fields[1:])
        if not (0 <= r < 4 and 0 <= c < 4 and v in (2, 4)):
            raise ValueError(f"line {lineno}: illegal coordinate or spawn value")
        if op == "start":
            if moves or len(starts) >= 2:
                raise ValueError(f"line {lineno}: misplaced starting tile")
            starts.append((r, c, v))
        elif op in DIRECTIONS:
            if len(starts) != 2:
                raise ValueError(f"line {lineno}: two initial tiles are required")
            moves.append((op, r, c, v))
        else:
            raise ValueError(f"line {lineno}: unknown direction {op!r}")
    if len(starts) != 2 or len(moves) != 32781:
        raise ValueError("This development expects two starting tiles and exactly 32781 rounds")
    return starts, moves


def slide(board: list[int], direction: str) -> tuple[list[int], int]:
    """Untrusted, independent state generator; no imports from the game or AI."""
    result = board.copy()
    score = 0
    for line in range(4):
        cells = ([4 * line + x for x in range(4)] if direction in "LR"
                 else [4 * y + line for y in range(4)])
        if direction in "RD":
            cells.reverse()
        values = [board[i] for i in cells if board[i] != 0]
        merged: list[int] = []
        j = 0
        while j < len(values):
            if j + 1 < len(values) and values[j] == values[j + 1]:
                value = 2 * values[j]
                merged.append(value)
                score += value
                j += 2
            else:
                merged.append(values[j])
                j += 1
        merged.extend([0] * (4 - len(merged)))
        for i, value in zip(cells, merged):
            result[i] = value
    return result, score


def board_literal(board: list[int]) -> str:
    rows = ["⟨" + ",".join(map(str, board[4*r:4*r+4])) + "⟩" for r in range(4)]
    return "⟨" + ",".join(rows) + "⟩"


def step_literal(s: tuple[str, int, int, int]) -> str:
    d, r, c, v = s
    return f"⟨.{DIRECTIONS[d]}, .i{r}, .i{c}, {v}⟩"


def write_source(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")


def compile_lean(relative: str) -> str:
    source = ROOT / relative
    log = ROOT / ("kernel-" + source.stem + ".log")
    env = os.environ.copy()
    env["LEAN_PATH"] = str(ROOT)
    started = time.monotonic()
    command = ["lean", "-o", str(source.with_suffix(".olean")), str(source)]
    completed = subprocess.run(command, cwd=ROOT, env=env, text=True,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               timeout=900, check=False)
    log.write_text(completed.stdout, encoding="utf-8")
    elapsed = time.monotonic() - started
    print(f"{relative}: exit {completed.returncode}, {elapsed:.2f}s", flush=True)
    if completed.stdout.strip():
        print(completed.stdout, flush=True)
    if completed.returncode != 0:
        raise RuntimeError(f"Lean rejected {relative}; see {log.name}")
    if "declaration uses 'sorry'" in completed.stdout:
        raise RuntimeError(f"Unfinished declaration in {relative}")
    return completed.stdout


def audit_output(text: str, expected: list[str]) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {}
    for name in expected:
        match = re.search(re.escape("'" + name + "'") +
                          r" depends on axioms:\s*\[(.*?)\]", text, re.S)
        if match:
            axioms = [a.strip() for a in match.group(1).split(",") if a.strip()]
        elif "'" + name + "' does not depend on any axioms" in text:
            axioms = []
        else:
            raise RuntimeError(f"Missing axiom audit for {name}")
        forbidden = set(axioms) - ALLOWED_AXIOMS
        if forbidden:
            raise RuntimeError(f"Nonstandard proof assumptions in {name}: {sorted(forbidden)}")
        result[name] = axioms
    return result


def main() -> None:
    (ROOT / "verification.json").unlink(missing_ok=True)
    # Every step is an independent closed reduction. Large replay terms
    # duplicate intermediate board computations; named states avoid that.
    group_size = int(os.environ.get("LEAN2048_GROUP", "128"))
    if not 1 <= group_size <= 512:
        raise ValueError("LEAN2048_GROUP must be between 1 and 512")
    starts, moves = parse_witness()
    board = [0] * 16
    n2 = n4 = score = 0
    for r, c, v in starts:
        if board[4*r+c]:
            raise ValueError("overlapping initial tiles")
        board[4*r+c] = v
        n2 += v == 2
        n4 += v == 4
    states = [board.copy()]
    first_hit = None
    for t, (d, r, c, v) in enumerate(moves, 1):
        after, gain = slide(board, d)
        if after == board or after[4*r+c] != 0:
            raise ValueError(f"illegal proposed transition {t}")
        after[4*r+c] = v
        board = after
        score += gain
        n2 += v == 2
        n4 += v == 4
        states.append(board.copy())
        if 131072 in board and first_hit is None:
            first_hit = t
    if first_hit != 32781 or score != 1966092:
        raise ValueError("unexpected endpoint or score")
    stats = {"witness": "witness/131072.txt",
             "sha256": sha256(WITNESS.read_bytes()).hexdigest(),
             "moves": len(moves), "first_131072": first_hit,
             "score": score, "spawned_2s": n2, "spawned_4s": n4,
             "initial_board": states[0], "final_board": states[-1],
             "group_size": group_size}
    print(json.dumps(stats, indent=2), flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    for pattern in ("Segment*.lean", "Segment*.olean", "Certificate.lean", "Certificate.olean"):
        for old in OUT.glob(pattern):
            old.unlink()
    cuts = sorted(set(range(0, len(moves)+1, group_size)) | {32766, len(moves)})
    modules = []
    for i, (lo, hi) in enumerate(zip(cuts, cuts[1:])):
        name = f"Segment{i:03d}"
        modules.append(name)
        lines = ["import Game2048.Basic", "", "set_option maxRecDepth 100000",
                 "set_option maxHeartbeats 0", "",
                 f"namespace Game2048.Cert131072.{name}", "",
                 f"-- Source rounds {lo+1} through {hi}."]
        for j, st in enumerate(states[lo:hi+1]):
            lines.append(f"def b{j} : Board := {board_literal(st)}")
        lines += ["", f"theorem segment : Plays b0 {hi-lo} b{hi-lo} := by",
                  "  have p0 : Plays b0 0 b0 := Plays.refl"]
        for j, st in enumerate(moves[lo:hi]):
            lines.append(f"  have p{j+1} : Plays b0 {j+1} b{j+1} :=")
            lines.append(f"    Plays.snoc p{j} {step_literal(st)} (by rfl)")
        lines += [f"  exact p{hi-lo}", "", f"end Game2048.Cert131072.{name}", ""]
        write_source(OUT / (name + ".lean"), "\n".join(lines))
    lines = [f"import Game2048.Generated.{m}" for m in modules]
    lines += ["", "set_option maxRecDepth 100000", "set_option maxHeartbeats 0",
              "namespace Game2048.Cert131072", "",
              f"def initial : Board := {board_literal(states[0])}",
              f"def terminal : Board := {board_literal(states[-1])}",
              f"def primed : Board := {board_literal(states[32766])}", "",
              "theorem start_valid : IsInitial initial := by"]
    r1,c1,v1=starts[0]; r2,c2,v2=starts[1]
    lines += [f"  refine ⟨.i{r1}, .i{c1}, .i{r2}, .i{c2}, {v1}, {v2}, ?_, ?_, ?_, ?_⟩",
              "  all_goals decide", "",
              "theorem prefix000 : Plays initial 0 initial := Plays.refl"]
    for i, name in enumerate(modules):
        lo, hi = cuts[i], cuts[i+1]
        lines += [f"theorem prefix{i+1:03d} : Plays initial {hi} {name}.b{hi-lo} :=",
                  f"  Plays.append prefix{i:03d} {name}.segment"]
    lines += ["", "theorem certified_play : Plays initial 32781 terminal :=",
              f"  prefix{len(modules):03d}", "",
              "theorem certified_primed_prefix : Plays initial 32766 primed :=",
              f"  prefix{cuts.index(32766):03d}", "",
              "theorem contains_terminal : terminal.Contains 131072 := by"]
    cell = states[-1].index(131072)
    lines += [f"  exact ⟨.i{cell//4}, .i{cell%4}, rfl⟩", "",
              "#print axioms certified_play", "end Game2048.Cert131072", ""]
    write_source(OUT / "Certificate.lean", "\n".join(lines))
    print(f"Generated {len(moves)} single-transition proofs in {len(modules)} modules", flush=True)
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = [pool.submit(compile_lean, "Game2048/Generated/" + m + ".lean")
                   for m in modules]
        for future in as_completed(futures):
            future.result()
    cert_output = compile_lean("Game2048/Generated/Certificate.lean")
    main_output = compile_lean("Game2048/Main.lean")
    audits = audit_output(cert_output, ["Game2048.Cert131072.certified_play"])
    audits.update(audit_output(main_output, ["Game2048.reachable_131072",
                                          "Game2048.standard2048_exact_131072"]))
    stats["axioms"] = audits
    stats["kernel_checked"] = True
    stats["lean_version"] = subprocess.check_output(["lean", "--version"], cwd=ROOT, text=True).strip()
    (ROOT / "verification.json").write_text(json.dumps(stats, indent=2)+"\n")
    print("KERNEL VERIFIED: 131072 is reachable in 32781 rounds, and no legal play is shorter.", flush=True)
    print(json.dumps(audits, indent=2), flush=True)

if __name__ == "__main__":
    main()
