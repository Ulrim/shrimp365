#!/bin/bash

# =====================================================
#  Shrimp365 로컬 실행 스크립트
# =====================================================

# 색상 정의
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${CYAN}${BOLD}🦐  Shrimp365 — 흰다리새우 스마트 양식 플랫폼${NC}"
echo -e "${CYAN}=================================================${NC}"
echo ""

# ── 1. Node.js 버전 체크 ──────────────────────
NODE_VERSION=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)
if [ -z "$NODE_VERSION" ]; then
  echo -e "${RED}❌  Node.js가 설치되어 있지 않습니다.${NC}"
  echo -e "    https://nodejs.org 에서 Node.js 18 이상을 설치해주세요."
  exit 1
fi

if [ "$NODE_VERSION" -lt 18 ]; then
  echo -e "${RED}❌  Node.js 18 이상이 필요합니다. (현재: v${NODE_VERSION})${NC}"
  echo -e "    https://nodejs.org 에서 최신 버전으로 업그레이드해주세요."
  exit 1
fi
echo -e "${GREEN}✔  Node.js v$(node -v | sed 's/v//')${NC}"

# ── 2. 의존성 설치 ────────────────────────────
if [ ! -d "node_modules" ]; then
  echo -e "${YELLOW}📦  패키지를 설치합니다 (최초 1회)...${NC}"
  npm install
  if [ $? -ne 0 ]; then
    echo -e "${RED}❌  패키지 설치 실패${NC}"
    exit 1
  fi
  echo -e "${GREEN}✔  패키지 설치 완료${NC}"
else
  echo -e "${GREEN}✔  패키지 이미 설치됨${NC}"
fi

# ── 3. .env.local 확인 ───────────────────────
if [ ! -f ".env.local" ]; then
  echo -e "${YELLOW}⚠️   .env.local 파일이 없습니다. 기본값으로 생성합니다...${NC}"
  cat > .env.local << 'ENVEOF'
NEXT_PUBLIC_SUPABASE_URL=https://okecfkqpoigxvlsomqjc.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_Apo03iZBcxLWn-XsCCCHMw_H0iQW8_x
ENVEOF
  echo -e "${GREEN}✔  .env.local 생성됨${NC}"
else
  echo -e "${GREEN}✔  .env.local 확인됨${NC}"
fi

# ── 4. 포트 확인 ─────────────────────────────
PORT=3000
if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
  PORT=3001
  echo -e "${YELLOW}⚠️   3000번 포트 사용 중 → 3001번 포트로 실행합니다${NC}"
fi

# ── 5. 실행 안내 ─────────────────────────────
echo ""
echo -e "${CYAN}=================================================${NC}"
echo -e "${BOLD}🚀  개발 서버를 시작합니다...${NC}"
echo ""
echo -e "  접속 주소 : ${GREEN}${BOLD}http://localhost:${PORT}${NC}"
echo ""
echo -e "  ${BOLD}테스트 계정${NC}"
echo -e "  ├ 관리자  : admin@shrimp365.com / test1234"
echo -e "  └ 운영자  : operator@shrimp365.com / test1234"
echo ""
echo -e "  종료하려면 ${BOLD}Ctrl + C${NC} 를 누르세요."
echo -e "${CYAN}=================================================${NC}"
echo ""

# ── 6. 서버 실행 ─────────────────────────────
npm run dev -- --port $PORT
