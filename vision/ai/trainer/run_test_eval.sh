#!/usr/bin/env bash
# 성적서용 수치와 시험기관 제출 묶음을 명령 하나로 낸다 — test 445장, 배포본, 재현 가능.
#
# 실제 일은 sta_run.py 가 한다(윈도우에서도 같은 순서로 돌도록 파이썬으로 옮겼다).
# 이 파일은 예전 명령을 그대로 받아 넘기는 껍데기다.
#
#   ./ai/trainer/run_test_eval.sh <shrimp_cf 폴더> <Counting PL 폴더>   전날: 묶음 + 사전 측정
#   ./ai/trainer/run_test_eval.sh --from-roboflow <Counting PL 폴더>    (ROBOFLOW_API_KEY 환경변수)
#   ./ai/trainer/run_test_eval.sh --rerun                               시험 당일
#   ./ai/trainer/run_test_eval.sh --rehearsal                           데이터셋 없이 흐름 확인
#
# 설정(환경변수): STA  WEIGHTS  CONF  EVAL_ARGS  — 설명은 sta_run.py 머리말.
set -euo pipefail

VISION="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PY="${PYTHON:-python3}"
[ -x "$VISION/.venv/bin/python" ] && PY="$VISION/.venv/bin/python"
RUN=("$PY" "$VISION/ai/trainer/sta_run.py")

case "${1:-}" in
  --rerun)         [ $# -eq 1 ] && exec "${RUN[@]}" rerun ;;
  --rehearsal)     [ $# -eq 1 ] && exec "${RUN[@]}" rehearsal ;;
  --from-roboflow) [ $# -eq 2 ] && exec "${RUN[@]}" prepare --from-roboflow "$2" ;;
  *)               [ $# -eq 2 ] && exec "${RUN[@]}" prepare "$1" "$2" ;;
esac
sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
exit 1
