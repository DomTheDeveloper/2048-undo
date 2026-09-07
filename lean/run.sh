#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export LEAN_PATH="$PWD"
lean --version | tee toolchain.log
if ! grep -q 'version 4.19.0,' toolchain.log; then
  echo 'This proof is pinned to Lean 4.19.0.' >&2
  exit 1
fi
lean -o Game2048/Basic.olean Game2048/Basic.lean 2>&1 | tee basic.log
lean -o Game2048/LowerBound.olean Game2048/LowerBound.lean 2>&1 | tee lower-bound.log
lean -o Game2048/Semantics.olean Game2048/Semantics.lean 2>&1 | tee semantics.log
lean -o Game2048/RulesTests.olean Game2048/RulesTests.lean 2>&1 | tee rules-tests.log
python3 build_certificate.py 2>&1 | tee certificate-build.log
python3 tamper_test.py 2>&1 | tee tamper-rejection.log
