#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 research/spliced_certificates.py | tee research/spliced-checks.log
python3 research/score_equality_test.py | tee research/score-equality-check.log
python3 - <<'PY' | tee research/score-equality-independent.log
import importlib.util
s=importlib.util.spec_from_file_location('v','verify/verify2048.py')
v=importlib.util.module_from_spec(s);s.loader.exec_module(v)
v.N=2
v.main('research/2x2-score-equality-counterexample.txt')
PY
python3 research/mass_barriers.py > research/mass-barrier-check.log
python3 research/mass_interval.py > research/mass-interval-check.log
(
  cd lean-kernel
  export LEAN_PATH="$PWD"
  lean --version | tee ../research/deadline-toolchain.log
  grep -q 'version 4.19.0,' ../research/deadline-toolchain.log
  for mod in Basic LowerBound SemanticsChecks; do
    lean -o "Game2048/$mod.olean" "Game2048/$mod.lean" > "../research/deadline-$mod.log" 2>&1
  done
  lean -o Game2048/DeadlineSlack.olean Game2048/DeadlineSlack.lean | tee ../research/deadline-lean-audit.log
)
python3 - <<'PY'
import sys
sys.path.insert(0,'lean-kernel')
from build_certificate import audit_output
from pathlib import Path
import json
names=['Game2048.deadline_slack_131072','Game2048.optimal_opening_and_prefix','Game2048.target_prefix_budget']
audit=audit_output(Path('research/deadline-lean-audit.log').read_text(), names)
Path('research/deadline-axioms.json').write_text(json.dumps(audit,indent=2)+'\n')
assert 'sorryAx' not in str(audit)
print('RESEARCH CHECKS PASSED. New stochastic results remain conventional, not Lean-formalised.')
PY
