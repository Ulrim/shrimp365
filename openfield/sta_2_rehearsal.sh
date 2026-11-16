#!/usr/bin/env bash
# STA 2. rehearsal (run all steps, seal test set)
set -u
cd "$(dirname "$0")"
export PYTHONUTF8=1
echo "=== STA 2. rehearsal (run all steps, seal test set) ==="
[ -f .venv/bin/activate ] && . .venv/bin/activate
python scripts/sta_run_all.py --mode rehearsal "$@"
code=$?
echo; echo "[exit code $code]"
exit $code
