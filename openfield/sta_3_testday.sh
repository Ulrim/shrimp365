#!/usr/bin/env bash
# STA 3. test day (run all steps against sealed test set)
set -u
cd "$(dirname "$0")"
export PYTHONUTF8=1
echo "=== STA 3. test day (run all steps against sealed test set) ==="
[ -f .venv/bin/activate ] && . .venv/bin/activate
python scripts/sta_run_all.py --mode testday "$@"
code=$?
echo; echo "[exit code $code]"
exit $code
