#!/usr/bin/env bash
# 성적서용 수치를 **명령 하나로** 낸다 — test 445장, 배포본, 재현 가능.
#
# 왜 스크립트인가
# ---------------
# 수치가 공인 시험성적서에 올라간다. 사람이 단계를 손으로 밟으면 어느 분할을
# 썼는지, 어떤 임계값이었는지가 실행할 때마다 달라진다. 한 번에 끝내고, 쓴
# 조건을 결과 파일에 함께 적는다.
#
# 하는 일
#   1. 원본 두 데이터셋을 합치고 **학습 때와 같은 방식으로 다시 나눈다**
#      (--on-leakage regroup, 씨앗 20260101 → train 3,927 / valid 873 / test 445)
#   2. 그 test 445장으로 배포본(416 ONNX)의 mAP·P·R·F1·계수 오차율을 잰다
#   3. 출력 JSON·CSV 를 docs/result-03-bluestartup/evidence/ 에 떨어뜨린다
#
# 쓰는 법 (저장소의 vision/ 에서)
#
#   # (가) 원본을 이미 풀어 둔 경우 — 가장 확실하다
#   ./ai/trainer/run_test_eval.sh <shrimp_cf 폴더> <Counting PL 폴더>
#
#   # (나) shrimp_cf 를 Roboflow 에서 바로 받는 경우
#   export ROBOFLOW_API_KEY='...'
#   ./ai/trainer/run_test_eval.sh --from-roboflow <Counting PL 폴더>
#
# 폴더는 Roboflow 'YOLOv8' 내보내기를 푼 것이어야 한다(안에 data.yaml 과
# train/valid/test 가 있다).
#
# 필요한 것: python 3.11+, numpy, onnxruntime, pillow, pydantic, pydantic-settings
#   pip install -e ".[edge]"
set -euo pipefail

VISION="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ROOT="$(cd "$VISION/.." && pwd)"
PY="${PYTHON:-python3}"
[ -x "$VISION/.venv/bin/python" ] && PY="$VISION/.venv/bin/python"

WEIGHTS="${WEIGHTS:-$VISION/ai/models/shrimp_yolov8n_416.onnx}"
WORK="${WORK:-$VISION/datasets/shrimp}"
EVID="${EVID:-$ROOT/docs/result-03-bluestartup/evidence}"
CONF="${CONF:-0.25}"

usage() { sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 1; }
[ $# -ge 1 ] || usage

if [ "$1" = "--from-roboflow" ]; then
  shift
  [ $# -eq 1 ] || usage
  CF="$VISION/data/shrimp_cf"
  "$PY" -I "$VISION/ai/trainer/fetch_roboflow.py" --out "$CF"
  PL="$1"
else
  [ $# -eq 2 ] || usage
  CF="$1"; PL="$2"
fi

for d in "$CF" "$PL"; do
  [ -f "$d/data.yaml" ] || { echo "[오류] $d 안에 data.yaml 이 없습니다 (Roboflow YOLOv8 내보내기 폴더를 주세요)." >&2; exit 1; }
done
[ -f "$WEIGHTS" ] || { echo "[오류] 모델이 없습니다: $WEIGHTS" >&2; exit 1; }

echo "== 1/3  분할 재현 =================================================="
echo "  shrimp_cf    $CF"
echo "  counting_pl  $PL"
cd "$VISION"
"$PY" ai/trainer/prepare_dataset.py \
  --source "shrimp_cf=$CF" \
  --source "counting_pl=$PL" \
  --out "$WORK" --on-leakage regroup \
  --report "$WORK/준비보고.json"

COUNT_TEST="$(find "$WORK/test/images" -type f | wc -l | tr -d ' ')"
echo
echo "  test 분할 $COUNT_TEST 장"
if [ "$COUNT_TEST" != "445" ]; then
  echo "  ⚠ 학습 기록의 445장과 다릅니다. 원본 데이터셋이 그때와 같은지 확인하세요."
  echo "    (다르면 성적서의 '학습에 쓰지 않은 이미지'라는 설명이 어긋납니다.)"
fi

echo
echo "== 2/3  배포본 성능 측정 ==========================================="
mkdir -p "$EVID"
"$PY" ai/trainer/eval_detect.py \
  --weights "$WEIGHTS" \
  --images "$WORK/test/images" --labels "$WORK/test/labels" \
  --conf "$CONF" --bootstrap 2000 \
  --json "$EVID/08_탐지성능_test분할.json" \
  --csv  "$EVID/08_탐지성능_test분할_이미지별.csv"

echo
echo "== 3/3  끝났습니다 ================================================="
echo "  증빙  $EVID/08_탐지성능_test분할.json"
echo "        $EVID/08_탐지성능_test분할_이미지별.csv"
echo
echo "  다음에 할 일"
echo "   1) 위 두 파일을 커밋하세요 — 그래야 수치가 '문서 기재값'이 아니라 자료가 됩니다."
echo "   2) 엣지 처리시간(③)은 라즈베리파이에서 따로 잽니다:"
echo "        python ai/trainer/export_edge.py --bench --runs 30 \\"
echo "          --weights ai/models/shrimp_yolov8n_416.onnx --image <실제 수조 사진>.jpg"
echo "   3) 시험기관에 보낼 것은 docs/result-03-bluestartup/시험의뢰_패키지.md 에 정리되어 있습니다."
