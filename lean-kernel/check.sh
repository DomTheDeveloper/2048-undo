#!/usr/bin/env bash
# Rebuild all proofs from source. Never reuse a previous success report.
set -euo pipefail
cd "$(dirname "$0")"
export LEAN_PATH="$PWD"
rm -f verification.json Game2048/Main.olean Game2048/Corollaries.olean
lean --version | tee toolchain.log
grep -q 'version 4.19.0,' toolchain.log || { echo 'Use the pinned Lean 4.19.0 toolchain.' >&2; exit 1; }
for module in Basic LowerBound PowerBounds SemanticsChecks TwoTwos; do
  test -f "Game2048/$module.lean"
  lean -o "Game2048/$module.olean" "Game2048/$module.lean" 2>&1 | tee "kernel-$module.log"
done
test -f Game2048/Main.lean
test -f Game2048/Corollaries.lean
python3 -u build_certificate.py 2>&1 | tee certificate-build.log
lean -o Game2048/Corollaries.olean Game2048/Corollaries.lean 2>&1 | tee kernel-Corollaries.log
python3 - <<'PY'
import json
from pathlib import Path
from build_certificate import audit_output
p = Path('verification.json')
v = json.loads(p.read_text())
assert v['kernel_checked'] is True
v['axioms'].update(audit_output(Path('kernel-Corollaries.log').read_text(), [
    'Game2048.standard2048_two_twos_exact',
    'Game2048.standard2048_exact_131072',
]))
v['two_twos_minimum_moves'] = 32782
p.write_text(json.dumps(v, indent=2) + '\n')
print('ALL CHECKS PASSED: standard start 32781; two-2s start 32782.')
PY
