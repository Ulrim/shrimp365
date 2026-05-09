#!/bin/bash
# =====================================================
#  Shrimp365 NAS 배포 스크립트  (git 불필요 — curl + tarball)
# =====================================================
#  사용법:
#    ./deploy-nas.sh           # 최신 코드 받아서 빌드 + 재배포
#    ./deploy-nas.sh build     # 코드 받지 않고 빌드만
#    ./deploy-nas.sh restart   # 재빌드 없이 컨테이너만 재시작
#    ./deploy-nas.sh logs      # 로그 보기
#    ./deploy-nas.sh status    # 컨테이너 상태
#
#  최초 설치:
#    1) 이 파일을 NAS의 작업 폴더에 둡니다 (예: /volume1/docker/shrimp365)
#    2) 같은 폴더에 .env.local 파일을 만들어 변수 채우기
#    3) chmod +x deploy-nas.sh
#    4) ./deploy-nas.sh
# =====================================================
set -e

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'

# ── 설정 ───────────────────────────────────────────
GH_REPO="${GH_REPO:-ulrim/shrimp365}"
GH_BRANCH="${GH_BRANCH:-claude/shrimp-water-quality-monitoring-aZ4EY}"
SRC_DIR="${SRC_DIR:-shrimp365}"   # 코드가 풀리는 하위 폴더 이름

cd "$(dirname "$0")"
WORK_DIR="$(pwd)"

# sudo 자동 판단
if [ "$EUID" -ne 0 ] && ! docker info >/dev/null 2>&1; then
  DOCKER="sudo docker"
  COMPOSE="sudo docker compose"
else
  DOCKER="docker"
  COMPOSE="docker compose"
fi

ACTION="${1:-deploy}"

# ── logs ───────────────────────────────────────────
if [ "$ACTION" = "logs" ]; then
  cd "$WORK_DIR/$SRC_DIR" 2>/dev/null || cd "$WORK_DIR"
  $COMPOSE logs -f --tail=200 shrimp365
  exit 0
fi

# ── status ─────────────────────────────────────────
if [ "$ACTION" = "status" ]; then
  cd "$WORK_DIR/$SRC_DIR" 2>/dev/null || cd "$WORK_DIR"
  $COMPOSE ps
  echo ""
  echo -e "${CYAN}── 환경변수 (값은 마스킹) ──${NC}"
  $DOCKER exec shrimp365 env 2>/dev/null | grep -E "SUPABASE|DODO|ANTHROPIC|SITE_URL" | sed 's/=.*/=***/' || echo "컨테이너가 실행 중이지 않습니다."
  echo ""
  echo -e "${CYAN}── 번들 내 Supabase URL ──${NC}"
  $DOCKER exec shrimp365 sh -c 'grep -ho "https://[a-z0-9]*\.supabase\.co" /app/.next/static/chunks/*.js 2>/dev/null | sort -u' || true
  echo ""
  echo -e "${CYAN}── 현재 BUILD_ID ──${NC}"
  $DOCKER exec shrimp365 sh -c 'cat /app/.next/BUILD_ID 2>/dev/null' || true
  exit 0
fi

# ── restart ────────────────────────────────────────
if [ "$ACTION" = "restart" ]; then
  cd "$WORK_DIR/$SRC_DIR" 2>/dev/null || cd "$WORK_DIR"
  echo -e "${YELLOW}🔄  컨테이너 재시작 중... (이미지 재빌드 없음)${NC}"
  $COMPOSE restart shrimp365
  echo -e "${GREEN}✔  재시작 완료${NC}"
  exit 0
fi

# ── 헬퍼: 빌드 + 기동 ──────────────────────────────
do_build_and_up() {
  cd "$WORK_DIR/$SRC_DIR"

  if [ ! -f "../.env.local" ] && [ ! -f ".env.local" ]; then
    echo -e "${RED}❌  .env.local 파일이 없습니다.${NC}"
    echo -e "    ${BOLD}$WORK_DIR/.env.local${NC} 또는 ${BOLD}$WORK_DIR/$SRC_DIR/.env.local${NC} 에 만들어주세요."
    exit 1
  fi

  # .env.local 위치: 작업폴더 우선, 없으면 소스 폴더
  if [ -f "../.env.local" ]; then
    cp ../.env.local ./.env.local
  fi

  REQUIRED="NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY NEXT_PUBLIC_SITE_URL"
  MISSING=""
  for v in $REQUIRED; do
    if ! grep -qE "^$v=.+" .env.local; then
      MISSING="$MISSING $v"
    fi
  done
  if [ -n "$MISSING" ]; then
    echo -e "${RED}❌  .env.local에 다음 변수가 비어있습니다:${NC}$MISSING"
    exit 1
  fi
  echo -e "${GREEN}✔  필수 환경변수 OK${NC}"

  echo -e "${YELLOW}🔨  Docker 이미지 빌드 중... (1~3분 소요)${NC}"
  set -a
  # shellcheck disable=SC1091
  . ./.env.local
  set +a
  $COMPOSE build --no-cache
  echo -e "${GREEN}✔  빌드 완료${NC}"

  echo -e "${YELLOW}🚀  컨테이너 재시작 중...${NC}"
  $COMPOSE down || true
  $COMPOSE up -d
  echo -e "${GREEN}✔  배포 완료${NC}"
}

# ── build (코드 받지 않고 빌드만) ──────────────────
if [ "$ACTION" = "build" ]; then
  do_build_and_up
  exit 0
fi

# ── deploy (전체: 다운로드 + 빌드 + 재배포) ─────────
echo ""
echo -e "${CYAN}${BOLD}🦐  Shrimp365 NAS 배포 — $GH_REPO@$GH_BRANCH${NC}"
echo -e "${CYAN}=================================================${NC}"

if ! command -v curl >/dev/null 2>&1; then
  echo -e "${RED}❌  curl이 설치되어 있어야 합니다.${NC}"
  exit 1
fi

TARBALL_URL="https://codeload.github.com/$GH_REPO/tar.gz/refs/heads/$GH_BRANCH"
TMP_TAR="$WORK_DIR/.shrimp365.tar.gz"
TMP_EXTRACT="$WORK_DIR/.shrimp365_extract"

echo -e "${YELLOW}📥  최신 코드 다운로드 중...${NC}"
echo -e "    ${TARBALL_URL}"
if ! curl -fSL --retry 3 --retry-delay 2 -o "$TMP_TAR" "$TARBALL_URL"; then
  echo -e "${RED}❌  다운로드 실패. private repo이거나 브랜치명이 틀렸을 수 있습니다.${NC}"
  echo -e "    private repo면 GH_TOKEN을 export해서 인증 다운로드를 해야 합니다."
  exit 1
fi

rm -rf "$TMP_EXTRACT"
mkdir -p "$TMP_EXTRACT"
tar -xzf "$TMP_TAR" -C "$TMP_EXTRACT"
EXTRACTED_DIR=$(find "$TMP_EXTRACT" -mindepth 1 -maxdepth 1 -type d | head -1)
if [ -z "$EXTRACTED_DIR" ]; then
  echo -e "${RED}❌  압축 해제 실패${NC}"
  exit 1
fi

# 기존 .env.local 보존
if [ -f "$WORK_DIR/$SRC_DIR/.env.local" ]; then
  cp "$WORK_DIR/$SRC_DIR/.env.local" "$WORK_DIR/.env.local.backup"
fi

rm -rf "$WORK_DIR/$SRC_DIR"
mv "$EXTRACTED_DIR" "$WORK_DIR/$SRC_DIR"
rm -rf "$TMP_EXTRACT" "$TMP_TAR"

# .env.local 복원 (작업 폴더에 있던 것 우선)
if [ -f "$WORK_DIR/.env.local" ]; then
  cp "$WORK_DIR/.env.local" "$WORK_DIR/$SRC_DIR/.env.local"
elif [ -f "$WORK_DIR/.env.local.backup" ]; then
  mv "$WORK_DIR/.env.local.backup" "$WORK_DIR/$SRC_DIR/.env.local"
fi

echo -e "${GREEN}✔  코드 업데이트 완료${NC}"

do_build_and_up

# 검증
sleep 3
echo ""
echo -e "${CYAN}── 배포 검증 ──${NC}"
URL_IN_BUNDLE=$($DOCKER exec shrimp365 sh -c 'grep -ho "https://[a-z0-9]*\.supabase\.co" /app/.next/static/chunks/*.js 2>/dev/null | sort -u' || echo "")
if [ -n "$URL_IN_BUNDLE" ]; then
  echo -e "${GREEN}✔  번들에 박힌 Supabase URL: $URL_IN_BUNDLE${NC}"
else
  echo -e "${RED}❌  번들에 Supabase URL이 박히지 않았습니다.${NC}"
fi

BUILD_ID=$($DOCKER exec shrimp365 sh -c 'cat /app/.next/BUILD_ID 2>/dev/null' || echo "")
if [ -n "$BUILD_ID" ]; then
  echo -e "${GREEN}✔  BUILD_ID: $BUILD_ID${NC}"
fi

echo ""
echo -e "${CYAN}=================================================${NC}"
echo -e "${BOLD}배포가 완료되었습니다.${NC}"
echo -e "  접속: $(grep '^NEXT_PUBLIC_SITE_URL=' "$WORK_DIR/$SRC_DIR/.env.local" | cut -d= -f2-)"
echo -e "  로그: ${BOLD}./deploy-nas.sh logs${NC}"
echo -e "  상태: ${BOLD}./deploy-nas.sh status${NC}"
echo -e "${CYAN}=================================================${NC}"
