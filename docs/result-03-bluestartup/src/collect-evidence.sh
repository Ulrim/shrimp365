#!/usr/bin/env bash
# 결과보고서에 붙일 **시험 결과**를 실제로 돌려서 모은다.
#
# 왜 이 스크립트가 있나
# ---------------------
# "통과했습니다"라고 사람이 옮겨 적은 숫자는 증빙이 되지 않는다. 개발진척점검
# ②에서 지적된 것이 정확히 그것이다 — 결과서의 수치가 실행 기록이 아니라
# 서술이었던 문제. 그래서 각 파일 머리에 **언제·어느 커밋에서·무슨 명령으로**
# 돌렸는지를 적고, 그 아래에 출력을 그대로 담는다. 누구든 같은 명령으로 다시
# 만들 수 있어야 한다.
#
# 실행 (저장소 뿌리에서, 10~15분):
#
#     ./docs/result-03-bluestartup/src/collect-evidence.sh
#
# 필요한 것: vision/.venv, node, Chromium, PostgreSQL 16
# 순서가 중요하다 — 화면 점검이 .next 를 흉내 서버 주소로 다시 빌드하므로
# 사진 API 점검(평소 빌드가 필요)을 **먼저** 돌린다.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
OUT="$ROOT/docs/result-03-bluestartup/evidence"
PY="$ROOT/vision/.venv/bin/python"
cd "$ROOT"
mkdir -p "$OUT"

COMMIT="$(git rev-parse HEAD)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
DIRTY="$(git status --porcelain | wc -l)"

header() {  # header <파일> <시험명> <실행명령>
  {
    echo "시험명   : $2"
    echo "실행일시 : $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
    echo "저장소   : ulrim/shrimp365  $BRANCH @ $COMMIT"
    [ "$DIRTY" -gt 0 ] && echo "           ⚠ 커밋되지 않은 변경 $DIRTY 건이 있는 상태에서 돌렸다"
    echo "실행환경 : $($PY -V 2>&1), node $(node -v), $(uname -sr)"
    echo "실행명령 : $3"
    echo "────────────────────────────────────────────────────────────────"
    echo
  } > "$1"
}

run() {  # run <파일> <시험명> <명령…>
  local file="$1" name="$2"; shift 2
  echo "▶ $name"
  header "$file" "$name" "$*"
  ( "$@" ) >> "$file" 2>&1
  local code=$?
  { echo; echo "────────────────────────────────────────────────────────────────"
    echo "종료 코드: $code"; } >> "$file"
  [ $code -eq 0 ] && echo "  통과" || echo "  ⚠ 실패 (종료 코드 $code) — $file 를 보라"
  return $code
}

fails=0

run "$OUT/01_pytest.txt" "비전 서비스 단위·통합 시험 (pytest)" \
    "$PY" -m pytest vision -q || fails=$((fails+1))

run "$OUT/02_수조사진_API점검.txt" "수조 사진 장비→서버→웹 경로 점검 (실서버 HTTP)" \
    node scripts/check-vision-snapshot.mjs || fails=$((fails+1))

run "$OUT/03_가동률SQL_점검.txt" "가동률 집계 SQL 점검 (PostgreSQL 16 실행)" \
    ./scripts/check-vision-uptime-sql.sh || fails=$((fails+1))

run "$OUT/04_원격배포_왕복점검.txt" "원격 업데이트 꾸러미 왕복 점검" \
    "$PY" vision/tests/check_release_roundtrip.py || fails=$((fails+1))

run "$OUT/05_모델사양.txt" "배포 중인 계수 모델 사양·해시" \
    "$PY" docs/result-03-bluestartup/src/model-spec.py || fails=$((fails+1))

# 이것이 .next 를 흉내 서버 주소로 다시 빌드한다 — 반드시 마지막.
run "$OUT/06_웹화면_점검.txt" "영상 두절 시 수조 사진 대체 화면 점검 (브라우저)" \
    node scripts/check-vision-frame-ui.mjs || fails=$((fails+1))

echo
if [ "$fails" -eq 0 ]; then
  echo "여섯 건 전부 통과했습니다. 결과는 $OUT 에 있습니다."
else
  echo "$fails 건 실패했습니다. 결과보고서에 붙이기 전에 원인을 적으십시오."
fi
echo
echo "※ 화면 점검이 .next 를 흉내 서버 주소로 빌드해 두었습니다."
echo "   평소 빌드로 되돌리려면:  VERCEL=1 npx next build"
exit $fails
