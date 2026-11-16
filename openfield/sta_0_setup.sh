#!/usr/bin/env bash
# STA 0. setup (venv + packages)
set -u
cd "$(dirname "$0")"
export PYTHONUTF8=1
echo "=== STA 0. setup (venv + packages) ==="
python3 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
code=$?
echo; echo "[exit code $code]"
exit $code
