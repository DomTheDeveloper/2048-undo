#!/usr/bin/env python3
"""Require Lean to reject a claimed transition with an occupied spawn cell."""
from pathlib import Path
import os
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent
SOURCE = """import Game2048.Basic
open Game2048
example : step
  ⟨⟨0,0,0,0⟩,⟨0,0,0,0⟩,⟨0,0,0,0⟩,⟨0,0,4,4⟩⟩
  ⟨.right,.i3,.i3,4⟩ =
  some ⟨⟨0,0,0,0⟩,⟨0,0,0,0⟩,⟨0,0,0,0⟩,⟨0,0,4,8⟩⟩ := by rfl
"""
with tempfile.TemporaryDirectory(prefix="lean2048-negative-") as tmp:
    source = Path(tmp) / "Tampered.lean"
    source.write_text(SOURCE, encoding="utf-8")
    env = dict(os.environ, LEAN_PATH=str(ROOT))
    result = subprocess.run(["lean", str(source)], cwd=ROOT, env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, timeout=60, check=False)
    print(result.stdout)
    if result.returncode == 0 or "rfl" not in result.stdout or "error:" not in result.stdout:
        raise SystemExit("FAIL: Lean did not reject the corrupted transition as expected")
    print("PASS: the kernel proof attempt rejects the occupied-cell spawn.")
