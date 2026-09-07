#!/usr/bin/env python3
"""Generate and kernel-check the committed 131072 witness.

Python only proposes intermediate boards and Lean source. Lean checks each
individual move using `decide +kernel` and composes the results as legal
plays. The final theorem also imports the universal mathematical lower
bound. The Python replay and generator are not proof assumptions.
Run after compiling Basic.lean and LowerBound.lean:
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
CHUNK = int(os.environ.get("LEAN2048_CHUNK", "128"))
CHUNKS_PER_MODULE = 16
WORKERS = min(2, os.cpu_count() or 1)
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
        raise ValueError("Expected two starting tiles and exactly 32781 rounds")
    return starts, moves


def slide(board: list[int], direction: str) -> tuple[list[int], int]:
    """Untrusted independent state generator; imports no game or AI implementation."""
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


def negative_kernel_test() -> None:
    """Lean must reject a deliberately false transition, not merely a bad text parser."""
    text = '''import Game2048.Basic
open Game2048
-- Moving an empty board cannot be a legal round, even with a permitted spawn.
example : step Board.empty ⟨.left, .i0, .i0, 4⟩ =
    some (Board.empty.set .i0 .i0 4) := by decide +kernel
'''
    source = ROOT / "NegativeKernelTest.lean"
    source.write_text(text, encoding="utf-8")
    env = os.environ.copy()
    env["LEAN_PATH"] = str(ROOT)
    result = subprocess.run(["lean", str(source)], cwd=ROOT, env=env, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            timeout=60, check=False)
    (ROOT / "negative-kernel.log").write_text(result.stdout, encoding="utf-8")
    source.unlink()
    if result.returncode == 0 or "error:" not in result.stdout:
        raise RuntimeError("Negative test failed: Lean did not reject the fabricated transition")
    print("Negative kernel test: fabricated transition REJECTED", flush=True)


def main() -> None:
    if not 1 <= CHUNK <= 512:
        raise ValueError("LEAN2048_CHUNK must be between 1 and 512")
    starts, moves = parse_witness()
    cuts = sorted(set(range(0, len(moves) + 1, CHUNK)) | {32766, len(moves)})
    board = [0] * 16
    n2 = n4 = 0
    for r, c, v in starts:
        if board[4*r+c] != 0:
            raise ValueError("The starting tiles overlap")
        board[4*r+c] = v
        n2 += v == 2
        n4 += v == 4
    states = [board.copy()]
    score = 0
    first_hit = None
    for t, (d, r, c, v) in enumerate(moves, 1):
        after, gain = slide(board, d)
        if after == board:
            raise ValueError(f"round {t}: a nonmoving slide")
        if after[4*r+c] != 0:
            raise ValueError(f"round {t}: spawn in an occupied cell")
        after[4*r+c] = v
        score += gain
        n2 += v == 2
        n4 += v == 4
        board = after
        if 131072 in board and first_hit is None:
            first_hit = t
        states.append(board.copy())
    if first_hit != 32781 or score != 1966092:
        raise ValueError("Unexpected certificate endpoint or accounting")
    stats = {
        "witness": "witness/131072.txt",
        "sha256": sha256(WITNESS.read_bytes()).hexdigest(),
        "moves": len(moves), "first_131072": first_hit,
        "score": score, "spawned_2s": n2, "spawned_4s": n4,
        "final_board": board, "chunks": len(cuts)-1, "chunk_size": CHUNK,
        "kernel_transition_checks": len(moves),
    }
    print(json.dumps(stats, indent=2), flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    for pattern in ("Block*.lean", "Block*.olean", "Checkpoints.lean", "Checkpoints.olean",
                    "Certificate.lean", "Certificate.olean"):
        for old in OUT.glob(pattern):
            old.unlink()
    header = ("import Game2048.Basic\n\nset_option maxRecDepth 100000\n"
              "set_option maxHeartbeats 0\n\nnamespace Game2048.Cert131072\n\n")
    checkpoints = header
    for i, t in enumerate(cuts):
        checkpoints += f"def c{i:04d} : Board := {board_literal(states[t])}\n"
    checkpoints += "\nend Game2048.Cert131072\n"
    write_source(OUT / "Checkpoints.lean", checkpoints)
    modules: list[str] = []
    chunks = len(cuts)-1
    for first in range(0, chunks, CHUNKS_PER_MODULE):
        module = f"Block{len(modules):03d}"
        modules.append(module)
        text = header.replace("import Game2048.Basic", "import Game2048.Generated.Checkpoints")
        for i in range(first, min(first + CHUNKS_PER_MODULE, chunks)):
            lo, hi = cuts[i], cuts[i+1]
            size = hi-lo
            text += f"namespace Segment{i:04d}\n"
            text += f"def b0 : Board := c{i:04d}\n"
            for j in range(1, size):
                text += f"def b{j} : Board := {board_literal(states[lo+j])}\n"
            text += f"def b{size} : Board := c{i+1:04d}\n"
            text += "theorem p0 : Plays b0 0 b0 := Plays.refl\n"
            for j in range(1, size+1):
                st = step_literal(moves[lo+j-1])
                text += (f"theorem p{j} : Plays b0 {j} b{j} :=\n"
                         f"  Plays.snoc p{j-1} {st} (by decide +kernel)\n")
            text += f"end Segment{i:04d}\n"
            text += (f"theorem chunk{i:04d} : Plays c{i:04d} {size} c{i+1:04d} :=\n"
                     f"  Segment{i:04d}.p{size}\n\n")
        text += "end Game2048.Cert131072\n"
        write_source(OUT / (module + ".lean"), text)
    aggregate = "\n".join("import Game2048.Generated." + m for m in modules)
    aggregate += "\n\nset_option maxRecDepth 100000\nset_option maxHeartbeats 0\n"
    aggregate += "\nnamespace Game2048.Cert131072\n\n"
    aggregate += "theorem prefix0000 : Plays c0000 0 c0000 := Plays.refl\n"
    for i in range(chunks):
        aggregate += (f"theorem prefix{i+1:04d} : Plays c0000 {cuts[i+1]} c{i+1:04d} :=\n"
                      f"  Plays.append prefix{i:04d} chunk{i:04d}\n")
    aggregate += f"\ndef initial : Board := c0000\ndef terminal : Board := c{chunks:04d}\n"
    primed_index = cuts.index(32766)
    aggregate += f"def primed : Board := c{primed_index:04d}\n"
    r1, c1, v1 = starts[0]
    r2, c2, v2 = starts[1]
    aggregate += ("\ntheorem start_valid : IsInitial initial := by\n"
                  f"  refine ⟨.i{r1}, .i{c1}, .i{r2}, .i{c2}, {v1}, {v2}, ?_, ?_, ?_, ?_⟩\n"
                  "  all_goals decide +kernel\n")
    aggregate += ("\ntheorem certified_play : Plays initial 32781 terminal :=\n"
                  f"  prefix{chunks:04d}\n")
    aggregate += ("\ntheorem certified_primed_prefix : Plays initial 32766 primed :=\n"
                  f"  prefix{primed_index:04d}\n")
    hit_cell = board.index(131072)
    aggregate += ("\ntheorem contains_terminal : terminal.Contains 131072 := by\n"
                  f"  exact ⟨.i{hit_cell//4}, .i{hit_cell%4}, by decide +kernel⟩\n")
    aggregate += "\n#print axioms certified_play\nend Game2048.Cert131072\n"
    write_source(OUT / "Certificate.lean", aggregate)
    print(f"Generated {len(moves)} transitions in {chunks} chunks and {len(modules)} modules", flush=True)
    for source in (ROOT / "Game2048").rglob("*.lean"):
        text = source.read_text(encoding="utf-8")
        if re.search(r"\b(sorry|admit|native_decide)\b", text):
            raise RuntimeError(f"Disallowed proof shortcut in {source}")
        if re.search(r"(?m)^\s*axiom\s", text):
            raise RuntimeError(f"Custom axiom declaration in {source}")
    negative_kernel_test()
    compile_lean("Game2048/Generated/Checkpoints.lean")
    compile_lean("Game2048/Generated/" + modules[0] + ".lean")
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = [pool.submit(compile_lean, "Game2048/Generated/" + m + ".lean")
                   for m in modules[1:]]
        for future in as_completed(futures):
            future.result()
    cert_output = compile_lean("Game2048/Generated/Certificate.lean")
    main_output = compile_lean("Game2048/Main.lean")
    audits = audit_output(cert_output, ["Game2048.Cert131072.certified_play"])
    audits.update(audit_output(main_output, ["Game2048.reachable_131072",
                                          "Game2048.standard2048_exact_131072"]))
    stats["axioms"] = audits
    stats["kernel_checked"] = True
    stats["negative_kernel_test"] = "rejected fabricated transition"
    stats["lean_version"] = subprocess.check_output(["lean", "--version"], cwd=ROOT, text=True).strip()
    (ROOT / "verification.json").write_text(json.dumps(stats, indent=2) + "\n", encoding="utf-8")
    print("KERNEL VERIFIED: 131072 is reachable in 32781 rounds, and no legal play is shorter.", flush=True)
    print(json.dumps(audits, indent=2), flush=True)


if __name__ == "__main__":
    main()
