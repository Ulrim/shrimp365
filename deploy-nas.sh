#!/bin/bash
# =====================================================
#  Shrimp365 NAS 배포 스크립트
# =====================================================
#  사용법:
#    ./deploy-nas.sh load <파일>   # 이미지 파일 로드 + 재배포 (권장)
#    ./deploy-nas.sh restart       # 재빌드 없이 컨테이너만 재시작
#    ./deploy-nas.sh logs          # 로그 보기
#    ./deploy-nas.sh status        # 컨테이너 상태 / BUILD_ID
#
#  일반 배포 흐름 (개발 머신):
#    1) 개발 머신: ./ship-to-nas.sh   → 자동으로 이 스크립트 호출됨
#
#  NAS에서 직접 실행할 경우:
#    ./deploy-nas.sh load /volume1/docker/shrimp365/shrimp365-image.tar.gz
# =====================================================
set -e

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'

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

ACTION="${1:-help}"

# ── logs ───────────────────────────────────────────
if [ "$ACTION" = "logs" ]; then
  $COMPOSE -f "$WORK_DIR/shrimp365/docker-compose.yml" logs -f --tail=200 shrimp365 2>/dev/null \
    || $COMPOSE logs -f --tail=200 shrimp365
  exit 0
fi

# ── status ─────────────────────────────────────────
if [ "$ACTION" = "status" ]; then
  $COMPOSE -f "$WORK_DIR/shrimp365/docker-compose.yml" ps 2>/dev/null \
    || $COMPOSE ps
  echo ""
  echo -e "${CYAN}── 환경변수 (값은 마스킹) ──${NC}"
  $DOCKER exec shrimp365 env 2>/dev/null \
    | grep -E "SUPABASE|DODO|ANTHROPIC|SITE_URL" \
    | sed 's/=.*/=***/' \
    || echo "컨테이너가 실행 중이지 않습니다."
  echo ""
  echo -e "${CYAN}── 번들 내 Supabase URL ──${NC}"
  $DOCKER exec shrimp365 sh -c \
    'grep -ho "https://[a-z0-9]*\.supabase\.co" /app/.next/static/chunks/*.js 2>/dev/null | sort -u' || true
  echo ""
  echo -e "${CYAN}── 현재 BUILD_ID ──${NC}"
  $DOCKER exec shrimp365 sh -c 'cat /app/.next/BUILD_ID 2>/dev/null' || true
  exit 0
fi

# ── restart ────────────────────────────────────────
if [ "$ACTION" = "restart" ]; then
  echo -e "${YELLOW}🔄  컨테이너 재시작 중... (이미지 재빌드 없음)${NC}"
  $COMPOSE -f "$WORK_DIR/shrimp365/docker-compose.yml" restart shrimp365 2>/dev/null \
    || $COMPOSE restart shrimp365
  echo -e "${GREEN}✔  재시작 완료${NC}"
  exit 0
fi

# ── load (이미지 파일 → 로드 → 재배포) ─────────────
if [ "$ACTION" = "load" ]; then
  IMAGE_FILE="${2:-}"
  if [ -z "$IMAGE_FILE" ] || [ ! -f "$IMAGE_FILE" ]; then
    echo -e "${RED}❌  이미지 파일이 필요합니다.${NC}"
    echo -e "    사용법: ./deploy-nas.sh load /경로/shrimp365-image.tar.gz"
    exit 1
  fi

  echo ""
  echo -e "${CYAN}${BOLD}🦐  Shrimp365 이미지 로드 + 재배포${NC}"
  echo -e "${CYAN}=================================================${NC}"

  echo -e "${YELLOW}📦  Docker 이미지 로드 중... (30초~2분 소요)${NC}"
  $DOCKER load < "$IMAGE_FILE"
  echo -e "${GREEN}✔  이미지 로드 완료${NC}"

  # .env.local 위치 탐색
  ENV_FILE=""
  if   [ -f "$WORK_DIR/.env.local" ];           then ENV_FILE="$WORK_DIR/.env.local"
  elif [ -f "$WORK_DIR/shrimp365/.env.local" ]; then ENV_FILE="$WORK_DIR/shrimp365/.env.local"
  fi

  if [ -z "$ENV_FILE" ]; then
    echo -e "${RED}❌  .env.local 파일이 없습니다.${NC}"
    echo -e "    ${BOLD}$WORK_DIR/.env.local${NC} 에 만들어주세요."
    exit 1
  fi
  echo -e "${GREEN}✔  .env.local: $ENV_FILE${NC}"

  # docker-compose.yml 위치 탐색
  COMPOSE_FILE=""
  if   [ -f "$WORK_DIR/shrimp365/docker-compose.yml" ]; then COMPOSE_FILE="$WORK_DIR/shrimp365/docker-compose.yml"
  elif [ -f "$WORK_DIR/docker-compose.yml" ];            then COMPOSE_FILE="$WORK_DIR/docker-compose.yml"
  fi

  # docker-compose.yml이 없으면 최소 버전 자동 생성
  if [ -z "$COMPOSE_FILE" ]; then
    COMPOSE_FILE="$WORK_DIR/docker-compose.yml"
    echo -e "${YELLOW}⚠️   docker-compose.yml 없음 → 자동 생성${NC}"
    cat > "$COMPOSE_FILE" << 'COMPEOF'
version: "3.9"
services:
  shrimp365:
    image: shrimp365:latest
    container_name: shrimp365
    restart: unless-stopped
    env_file:
      - .env.local
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
COMPEOF
    # env_file 경로를 절대경로로 패치
    sed -i "s|\.env\.local|${ENV_FILE}|g" "$COMPOSE_FILE"
    echo -e "${GREEN}✔  docker-compose.yml 생성됨${NC}"
  fi

  echo -e "${YELLOW}🚀  컨테이너 재시작 중...${NC}"
  COMPOSE_DIR="$(dirname "$COMPOSE_FILE")"
  (cd "$COMPOSE_DIR" && $COMPOSE down || true)
  (cd "$COMPOSE_DIR" && $COMPOSE up -d)
  echo -e "${GREEN}✔  재배포 완료${NC}"

  sleep 3
  echo ""
  echo -e "${CYAN}── 검증 ──${NC}"
  BUILD_ID=$($DOCKER exec shrimp365 sh -c 'cat /app/.next/BUILD_ID 2>/dev/null' || echo "")
  if [ -n "$BUILD_ID" ]; then
    echo -e "${GREEN}✔  BUILD_ID: $BUILD_ID${NC}"
  fi
  URL_IN_BUNDLE=$($DOCKER exec shrimp365 sh -c \
    'grep -ho "https://[a-z0-9]*\.supabase\.co" /app/.next/static/chunks/*.js 2>/dev/null | sort -u' || echo "")
  if [ -n "$URL_IN_BUNDLE" ]; then
    echo -e "${GREEN}✔  Supabase URL 번들 포함됨${NC}"
  else
    echo -e "${RED}❌  번들에 Supabase URL 없음 — .env.local의 NEXT_PUBLIC_SUPABASE_URL 확인${NC}"
  fi

  SITE_URL=$(grep '^NEXT_PUBLIC_SITE_URL=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || echo "")
  echo ""
  echo -e "${CYAN}=================================================${NC}"
  echo -e "${BOLD}배포 완료${NC}${SITE_URL:+  →  $SITE_URL}"
  echo -e "  로그: ${BOLD}./deploy-nas.sh logs${NC}"
  echo -e "  상태: ${BOLD}./deploy-nas.sh status${NC}"
  echo -e "${CYAN}=================================================${NC}"
  exit 0
fi

# ── help ────────────────────────────────────────────
echo -e "${CYAN}${BOLD}Shrimp365 NAS 배포 스크립트${NC}"
echo ""
echo -e "  ${BOLD}./deploy-nas.sh load <파일>${NC}  이미지 로드 + 재배포"
echo -e "  ${BOLD}./deploy-nas.sh restart${NC}      컨테이너만 재시작"
echo -e "  ${BOLD}./deploy-nas.sh logs${NC}         로그 보기"
echo -e "  ${BOLD}./deploy-nas.sh status${NC}       상태 / BUILD_ID 확인"
echo ""
echo -e "  개발 머신에서 ${BOLD}./ship-to-nas.sh${NC} 를 실행하면 자동으로 여기까지 처리됩니다."
