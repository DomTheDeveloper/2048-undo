#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/lean"
export LEAN_PATH="$PWD"
lean --version | tee toolchain.log
if ! grep -q 'version 4.19.0,' toolchain.log; then
  echo 'Expected the pinned Lean 4.19.0 toolchain; see ../lean-toolchain.' >&2
  exit 1
fi
lean -o Game2048/Basic.olean Game2048/Basic.lean 2>&1 | tee basic.log
lean -o Game2048/LowerBound.olean Game2048/LowerBound.lean 2>&1 | tee lower-bound.log
python3 build_certificate.py 2>&1 | tee certificate-build.log
