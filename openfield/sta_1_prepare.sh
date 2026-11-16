#!/usr/bin/env bash
# STA 1. prepare (check data, build cache, check model hashes)
set -u
cd "$(dirname "$0")"
export PYTHONUTF8=1
echo "=== STA 1. prepare (check data, build cache, check model hashes) ==="
[ -f .venv/bin/activate ] && . .venv/bin/activate
python scripts/sta_prepare.py "$@"
code=$?
echo; echo "[exit code $code]"
exit $code
