#!/usr/bin/env bash
# 성적서용 수치와 **시험기관 제출 묶음**을 명령 하나로 낸다 — test 445장, 배포본, 재현 가능.
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
#      test 가 445장·정답 3,699개가 아니면 **멈춘다**(다른 장수로 재지 않는다).
#   2. test 분할을 제출 묶음에 복사하고 sha256 목록으로 고정한다
#   3. 배포본(416 ONNX)의 mAP·P·R·F1·계수 오차율을 재고 데이터별 로그를 남긴다
#   4. 로그만으로 최종값을 다시 계산해 일치하는지 본다(recompute_detect.py)
#
# 만들어지는 묶음 (기본 vision/sta_블루스타트업/ — 저장소에 커밋하지 않는다)
#   00_시험대상_해시.txt            모델 sha256, git 커밋, 코드 sha256
#   01_시험데이터/test/images, labels   시험 이미지·라벨
#   01_시험데이터/sha256sums.txt, 통계.txt
#   02_예측별_결과.csv  02_정답별_결과.csv  02_이미지별_결과.csv
#   03_최종결과.json   04_재계산_결과.txt   05_실행로그.txt
#
# 쓰는 법 (저장소의 vision/ 에서)
#
#   # (가) 전날 — 원본을 풀어 둔 폴더로 묶음을 만들고 사전 측정한다
#   ./ai/trainer/run_test_eval.sh <shrimp_cf 폴더> <Counting PL 폴더>
#
#   # (나) shrimp_cf 를 Roboflow 에서 바로 받는 경우 (키는 환경변수로만)
#   export ROBOFLOW_API_KEY='...'
#   ./ai/trainer/run_test_eval.sh --from-roboflow <Counting PL 폴더>
#
#   # (다) 시험 당일 — 고정해 둔 시험 데이터로 다시 재고 다시 계산한다
#   ./ai/trainer/run_test_eval.sh --rerun
#
#   # (라) 리허설 — 원본 데이터셋 없이 시험 PC 설치와 흐름만 확인한다
#   #      저장소의 수조 사진 12장을 쓴다. **수치는 성적이 아니다.** (묶음: sta_리허설/)
#   ./ai/trainer/run_test_eval.sh --rehearsal
#
# 폴더는 Roboflow 'YOLOv8' 내보내기를 푼 것이어야 한다(안에 data.yaml 과
# train/valid/test 가 있다).
#
# 설정(환경변수): STA=<묶음 폴더>  WEIGHTS=<모델>  CONF=0.25
#   판정 기준은 EVAL_ARGS 로 넘긴다. 예) EVAL_ARGS="--count-judge both --pass-count-within 0.8"
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
STA="${STA:-$VISION/sta_블루스타트업}"
case "$STA" in /*) ;; *) STA="$PWD/$STA" ;; esac     # 아래에서 cd 하므로 절대경로로 굳힌다
CONF="${CONF:-0.25}"
EVAL_ARGS="${EVAL_ARGS:-}"
# 학습 기록의 test 분할 크기. 연습(다른 자료로 흐름만 확인)할 때만 바꾼다.
EXPECT_IMAGES="${EXPECT_IMAGES:-445}"
EXPECT_BOXES="${EXPECT_BOXES:-3699}"

usage() { sed -n '2,49p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 1; }
[ $# -ge 1 ] || usage

RERUN=0
REHEARSAL=0
if [ "$1" = "--rerun" ]; then
  [ $# -eq 1 ] || usage
  RERUN=1
elif [ "$1" = "--rehearsal" ]; then
  [ $# -eq 1 ] || usage
  REHEARSAL=1
  STA="$VISION/sta_리허설"            # 진짜 묶음을 건드리지 않는다
elif [ "$1" = "--from-roboflow" ]; then
  shift
  [ $# -eq 1 ] || usage
  CF="$VISION/data/shrimp_cf"
  "$PY" -I "$VISION/ai/trainer/fetch_roboflow.py" --out "$CF"
  PL="$1"
else
  [ $# -eq 2 ] || usage
  CF="$1"; PL="$2"
fi
[ -f "$WEIGHTS" ] || { echo "[오류] 모델이 없습니다: $WEIGHTS" >&2; exit 1; }

TEST="$STA/01_시험데이터/test"
SUMS="$STA/01_시험데이터/sha256sums.txt"
LOG="$STA/05_실행로그.txt"

# 이미지 장수와 정답 박스 수를 센다(측정 프로그램과 같은 규칙: 값이 5개 이상인 줄).
count_split() {  # $1 = images, labels 를 담은 폴더 → "장수 박스수"
  "$PY" -I - "$1" <<'PYEOF'
import sys
from pathlib import Path
base = Path(sys.argv[1])
ext = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
images = [p for p in (base / "images").rglob("*") if p.suffix.lower() in ext]
labels = [(base / "labels" / p.relative_to(base / "images")).with_suffix(".txt") for p in images]
boxes = sum(1 for p in labels if p.exists()          # 이미지와 짝이 맞는 라벨만 센다
            for line in p.read_text().splitlines() if len(line.split()) >= 5)
print(len(images), boxes)
PYEOF
}

require_expected() {  # $1 = 폴더. 445장·3,699개가 아니면 멈춘다.
  read -r n_img n_box <<<"$(count_split "$1")"
  echo "  test 분할  이미지 $n_img 장 · 정답 박스 $n_box 개"
  [ "$REHEARSAL" = "0" ] || return 0     # 리허설 자료는 445장이 아니다
  if [ "$n_img" != "$EXPECT_IMAGES" ] || [ "$n_box" != "$EXPECT_BOXES" ]; then
    echo "[중단] 학습 기록의 test 분할(이미지 $EXPECT_IMAGES 장 · 정답 $EXPECT_BOXES 개)과 다릅니다." >&2
    echo "       받은 원본 데이터셋의 판(version)이 그때와 같은지 확인하세요. 측정하지 않습니다." >&2
    exit 1
  fi
}

cd "$VISION"
if [ "$REHEARSAL" = "1" ]; then
  echo "== 리허설 — 설치와 흐름 확인용. 여기서 나온 수치는 성적이 아닙니다 =="
  SRC="$VISION/data/tank/labeled"
  [ -d "$SRC/images" ] || { echo "[오류] 리허설 자료가 없습니다: $SRC" >&2; exit 1; }
  rm -rf "$STA"
  mkdir -p "$TEST"
  cp -R "$SRC/images" "$SRC/labels" "$TEST/"
elif [ "$RERUN" = "0" ]; then
  for d in "$CF" "$PL"; do
    [ -f "$d/data.yaml" ] || { echo "[오류] $d 안에 data.yaml 이 없습니다 (Roboflow YOLOv8 내보내기 폴더를 주세요)." >&2; exit 1; }
  done
  echo "== 1/4  분할 재현 =================================================="
  echo "  shrimp_cf    $CF"
  echo "  counting_pl  $PL"
  "$PY" ai/trainer/prepare_dataset.py \
    --source "shrimp_cf=$CF" \
    --source "counting_pl=$PL" \
    --out "$WORK" --on-leakage regroup \
    --report "$WORK/준비보고.json"
  echo
  require_expected "$WORK/test"

  echo
  echo "== 2/4  시험 데이터 고정 ==========================================="
  # 새로 나눴으므로 이전 묶음의 시험 데이터·목록·결과는 지우고 다시 만든다.
  rm -rf "$STA/01_시험데이터"
  rm -f "$STA"/0[02345]_*
  mkdir -p "$TEST"
  cp -R "$WORK/test/images" "$WORK/test/labels" "$TEST/"
  echo "  복사  $TEST"
else
  [ -d "$TEST/images" ] && [ -f "$SUMS" ] || {
    echo "[오류] 고정해 둔 시험 데이터가 없습니다: $TEST" >&2
    echo "       먼저 원본 데이터셋으로 묶음을 만드세요(쓰는 법 (가))." >&2; exit 1; }
  # 전날 결과가 오늘 결과와 섞이지 않게 지운다(시험 데이터와 고정 목록은 그대로 둔다).
  rm -f "$STA"/00_* "$STA"/02_* "$STA"/03_* "$STA"/04_* "$LOG"
fi

mkdir -p "$STA"
{
  [ "$REHEARSAL" = "0" ] || echo "※ 리허설 — 수조 사진 12장. 이 로그의 수치와 판정은 성적이 아닙니다."
  echo "== 시험 대상 확인 ================================================="
  echo "  실행 시각   $(date '+%Y-%m-%d %H:%M:%S %Z')"
  echo "  git 커밋    $(git -C "$VISION" rev-parse HEAD 2>/dev/null || echo '확인 불가')"
  echo "  모델 sha256 $("$PY" -I -c 'import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$WEIGHTS")"
  require_expected "$TEST"
  if [ "$RERUN" = "1" ] && command -v sha256sum >/dev/null; then
    echo "  시험 데이터 sha256 대조 (sha256sum -c)"
    if ! (cd "$TEST" && sha256sum -c --quiet "$SUMS"); then
      echo "[중단] 시험 데이터가 고정된 목록과 다릅니다. 측정하지 않습니다." >&2
      exit 1
    fi
    echo "  → 모두 일치"
  fi

  echo
  echo "== 3/4  배포본 성능 측정 ==========================================="
  EXTRA=()
  if [ "$RERUN" = "0" ] && [ "$REHEARSAL" = "0" ]; then   # 사전 측정은 증빙 폴더에도 남긴다
    mkdir -p "$EVID"
    EXTRA=(--json "$EVID/08_탐지성능_test분할.json" --csv "$EVID/08_탐지성능_test분할_이미지별.csv")
  fi
  # shellcheck disable=SC2086  # EVAL_ARGS 는 일부러 낱말로 쪼갠다
  "$PY" ai/trainer/eval_detect.py \
    --weights "$WEIGHTS" \
    --images "$TEST/images" --labels "$TEST/labels" \
    --conf "$CONF" --bootstrap 2000 \
    --log-dir "$STA" ${EXTRA[@]+"${EXTRA[@]}"} $EVAL_ARGS

  echo
  echo "== 4/4  로그만으로 다시 계산 ======================================="
  "$PY" ai/trainer/recompute_detect.py --dir "$STA"
} 2>&1 | tee -a "$LOG"

echo
echo "== 끝났습니다 ======================================================"
echo "  제출 묶음  $STA"
echo "  실행 로그  $LOG"
echo
echo "  다음에 할 일"
if [ "$REHEARSAL" = "1" ]; then
  echo "   리허설이 끝까지 돌았습니다 — 이 PC 에서 측정·재계산이 됩니다."
  echo "   위 수치와 판정은 수조 사진 12장의 것이라 성적이 아닙니다. 이 묶음은 보내지 마세요."
elif [ "$RERUN" = "0" ]; then
  echo "   1) 03_최종결과.json 의 판정과 04_재계산_결과.txt 의 '모두 일치'를 확인하세요."
  echo "   2) 시험 당일에는 같은 묶음으로:  ./ai/trainer/run_test_eval.sh --rerun"
  echo "      (순서는 docs/STA-시험당일-실행순서.md)"
else
  echo "   1) 묶음 폴더를 압축해 당일 오후 시험기관에 보냅니다."
fi
