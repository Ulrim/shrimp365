#!/bin/bash
# =====================================================
#  Shrimp365 NAS 배포 스크립트
# =====================================================
#  사용법:
#    ./deploy-nas.sh           # 전체 배포 (빌드 + 재시작)
#    ./deploy-nas.sh restart   # 재빌드 없이 재시작만 (서버 변수만 바뀐 경우)
#    ./deploy-nas.sh logs      # 로그 보기
#    ./deploy-nas.sh status    # 컨테이너 상태
# =====================================================
set -e

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'

# 스크립트가 위치한 폴더를 기준으로 동작
cd "$(dirname "$0")"

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
  $COMPOSE logs -f --tail=200 shrimp365
  exit 0
fi

# ── status ─────────────────────────────────────────
if [ "$ACTION" = "status" ]; then
  $COMPOSE ps
  echo ""
  echo -e "${CYAN}── 환경변수 (값은 마스킹) ──${NC}"
  $DOCKER exec shrimp365 env 2>/dev/null | grep -E "SUPABASE|DODO|ANTHROPIC|SITE_URL" | sed 's/=.*/=***/' || echo "컨테이너가 실행 중이지 않습니다."
  echo ""
  echo -e "${CYAN}── 번들 내 Supabase URL ──${NC}"
  $DOCKER exec shrimp365 sh -c 'grep -ho "https://[a-z0-9]*\.supabase\.co" /app/.next/static/chunks/*.js 2>/dev/null | sort -u' || true
  exit 0
fi

# ── restart (빌드 없이 재시작) ─────────────────────
if [ "$ACTION" = "restart" ]; then
  echo -e "${YELLOW}🔄  컨테이너 재시작 중... (이미지 재빌드 없음)${NC}"
  $COMPOSE restart shrimp365
  echo -e "${GREEN}✔  재시작 완료${NC}"
  echo -e "    NEXT_PUBLIC_* 변수를 변경하셨다면 ${BOLD}./deploy-nas.sh${NC} (인자 없이) 실행하세요."
  exit 0
fi

# ── deploy (전체 배포) ─────────────────────────────
echo ""
echo -e "${CYAN}${BOLD}🦐  Shrimp365 NAS 배포${NC}"
echo -e "${CYAN}=================================================${NC}"

# 1) .env.local 확인
if [ ! -f ".env.local" ]; then
  echo -e "${RED}❌  .env.local 파일이 없습니다.${NC}"
  echo -e "    이 폴더에 .env.local 파일을 만들고 값을 채워주세요."
  exit 1
fi
echo -e "${GREEN}✔  .env.local 확인${NC}"

# 2) 필수 변수 체크
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
echo -e "${GREEN}✔  필수 환경변수 모두 설정됨${NC}"

# 3) git pull (선택)
if [ -d ".git" ]; then
  echo -e "${YELLOW}📥  git pull 중...${NC}"
  git pull --ff-only || echo -e "${YELLOW}⚠️   git pull 건너뜀 (수동 처리 필요)${NC}"
fi

# 4) 빌드 + 기동 (.env.local의 값을 build-arg로 전달)
echo -e "${YELLOW}🔨  Docker 이미지 빌드 중... (1~3분 소요)${NC}"
set -a
# shellcheck disable=SC1091
. ./.env.local
set +a
$COMPOSE build --no-cache
echo -e "${GREEN}✔  빌드 완료${NC}"

echo -e "${YELLOW}🚀  컨테이너 재시작 중...${NC}"
$COMPOSE down
$COMPOSE up -d
echo -e "${GREEN}✔  배포 완료${NC}"

# 5) 검증
sleep 3
echo ""
echo -e "${CYAN}── 배포 검증 ──${NC}"
URL_IN_BUNDLE=$($DOCKER exec shrimp365 sh -c 'grep -ho "https://[a-z0-9]*\.supabase\.co" /app/.next/static/chunks/*.js 2>/dev/null | sort -u' || echo "")
if [ -n "$URL_IN_BUNDLE" ]; then
  echo -e "${GREEN}✔  번들에 박힌 Supabase URL: $URL_IN_BUNDLE${NC}"
else
  echo -e "${RED}❌  번들에 Supabase URL이 박히지 않았습니다. .env.local의 NEXT_PUBLIC_SUPABASE_URL을 확인하세요.${NC}"
fi

echo ""
echo -e "${CYAN}=================================================${NC}"
echo -e "${BOLD}배포가 완료되었습니다.${NC}"
echo -e "  접속: $(grep '^NEXT_PUBLIC_SITE_URL=' .env.local | cut -d= -f2-)"
echo -e "  로그: ${BOLD}./deploy-nas.sh logs${NC}"
echo -e "  상태: ${BOLD}./deploy-nas.sh status${NC}"
echo -e "${CYAN}=================================================${NC}"
