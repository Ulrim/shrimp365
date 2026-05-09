#!/bin/bash
# =====================================================
#  개발 머신에서 실행: 빌드 → 이미지 저장 → NAS 전송
# =====================================================
#  사전 설정 (한 번만):
#    export NAS_HOST=192.168.x.x        # NAS IP 또는 호스트명
#    export NAS_USER=culiver_admin       # NAS SSH 사용자
#    export NAS_PATH=/volume1/docker/shrimp365  # NAS 작업 폴더
#
#  사용법:
#    ./ship-to-nas.sh          # 빌드 + 전송 + NAS 재배포
#    ./ship-to-nas.sh build    # 빌드만 (이미지 파일 생성)
#    ./ship-to-nas.sh send     # 이미지 파일만 전송 (재빌드 없음)
# =====================================================
set -e

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'

cd "$(dirname "$0")"

NAS_HOST="${NAS_HOST:-}"
NAS_USER="${NAS_USER:-culiver_admin}"
NAS_PATH="${NAS_PATH:-/volume1/docker/shrimp365}"
IMAGE_NAME="shrimp365:latest"
IMAGE_FILE="shrimp365-image.tar.gz"

ACTION="${1:-ship}"

# ── .env.local 확인 ────────────────────────────────
if [ ! -f ".env.local" ]; then
  echo -e "${RED}❌  .env.local 파일이 없습니다.${NC}"; exit 1
fi

REQUIRED="NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY NEXT_PUBLIC_SITE_URL"
for v in $REQUIRED; do
  if ! grep -qE "^$v=.+" .env.local; then
    echo -e "${RED}❌  .env.local에 $v 가 비어있습니다.${NC}"; exit 1
  fi
done

# ── 빌드 ────────────────────────────────────────────
do_build() {
  echo -e "${YELLOW}🔨  Docker 이미지 빌드 중...${NC}"
  set -a; . ./.env.local; set +a
  docker build --no-cache \
    --build-arg NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
    --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
    --build-arg NEXT_PUBLIC_SITE_URL="$NEXT_PUBLIC_SITE_URL" \
    -t "$IMAGE_NAME" .
  echo -e "${GREEN}✔  빌드 완료${NC}"

  echo -e "${YELLOW}📦  이미지 파일로 저장 중... ($IMAGE_FILE)${NC}"
  docker save "$IMAGE_NAME" | gzip > "$IMAGE_FILE"
  echo -e "${GREEN}✔  이미지 파일 생성: $IMAGE_FILE ($(du -sh "$IMAGE_FILE" | cut -f1))${NC}"
}

if [ "$ACTION" = "build" ]; then
  do_build; exit 0
fi

# ── NAS 전송 ────────────────────────────────────────
do_send() {
  if [ ! -f "$IMAGE_FILE" ]; then
    echo -e "${RED}❌  $IMAGE_FILE 가 없습니다. 먼저 ./ship-to-nas.sh build 를 실행하세요.${NC}"; exit 1
  fi
  if [ -z "$NAS_HOST" ]; then
    echo -e "${RED}❌  NAS_HOST 가 설정되지 않았습니다.${NC}"
    echo -e "    export NAS_HOST=192.168.0.x"
    exit 1
  fi

  echo -e "${YELLOW}📤  NAS로 이미지 전송 중...${NC}"
  echo -e "    → ${NAS_USER}@${NAS_HOST}:${NAS_PATH}/"
  scp "$IMAGE_FILE" "${NAS_USER}@${NAS_HOST}:${NAS_PATH}/"

  # deploy-nas.sh도 함께 전송 (업데이트된 경우)
  if [ -f "deploy-nas.sh" ]; then
    scp deploy-nas.sh "${NAS_USER}@${NAS_HOST}:${NAS_PATH}/"
    echo -e "${GREEN}✔  deploy-nas.sh 전송됨${NC}"
  fi

  echo -e "${GREEN}✔  전송 완료${NC}"

  # NAS에서 로드 + 재배포
  echo -e "${YELLOW}🚀  NAS에서 이미지 로드 + 컨테이너 재시작 중...${NC}"
  ssh "${NAS_USER}@${NAS_HOST}" "chmod +x ${NAS_PATH}/deploy-nas.sh && ${NAS_PATH}/deploy-nas.sh load ${NAS_PATH}/${IMAGE_FILE}"
}

if [ "$ACTION" = "send" ]; then
  do_send; exit 0
fi

# ── ship (전체: 빌드 + 전송 + 재배포) ──────────────
echo ""
echo -e "${CYAN}${BOLD}🦐  Shrimp365 → NAS 배포${NC}"
echo -e "${CYAN}=================================================${NC}"
do_build
do_send

echo ""
echo -e "${CYAN}=================================================${NC}"
echo -e "${BOLD}배포 완료${NC}"
echo -e "  NAS: ssh ${NAS_USER}@${NAS_HOST}"
echo -e "  로그: ${NAS_PATH}/deploy-nas.sh logs"
echo -e "${CYAN}=================================================${NC}"
