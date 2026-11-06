# CLAUDE.md — 프로젝트 운영 규칙

이 파일은 Claude Code가 매 세션 자동 로드하는 프로젝트 헌법이다.
상세 사양은 `00_개발의뢰서_MASTER.md`를 따른다(단일 진실 공급원).

## 프로젝트
컬리버 통합관리 + 탄소 MRV 플랫폼. 실내 흰다리새우(RAS) 양식장용 B2B 구독 웹앱.
핵심 가치: 단순 모니터링이 아니라 **기준선→추천/제어→로그→전후비교→MRV 증빙**의 일관 시스템.

## 기술 스택 (변경 시 ADR 필수)
- FE: React 18 + TypeScript + Vite, Zustand, TanStack Query, Tailwind + shadcn/ui, ECharts
- BE: FastAPI(Python 3.12), PostgreSQL + TimescaleDB, SQLAlchemy 2.0 + Alembic
- 인증: JWT/Supabase Auth + Postgres RLS (멀티테넌시 격리)
- 수집: MQTT → ingestion worker, 작업: Celery/APScheduler
- 리포트: HTML→PDF(WeasyPrint/Playwright, 한글 폰트 임베드)
- 인프라: Docker Compose, GitHub Actions

## 디렉터리(권장)
```
/apps/web        React 프론트엔드
/apps/api        FastAPI 백엔드
/packages/kpi    KPI/MRV 도메인 엔진(순수 함수 + 테스트)  ← 가장 보호받는 코드
/infra           docker-compose, 마이그레이션
/.claude/agents  전담 팀(서브에이전트)
/docs/adr        아키텍처 결정 기록
```

## 절대 규칙 (Hard Rules)
1. **KPI/MRV 산식은 `/packages/kpi`에서만** 정의·수정한다. 다른 곳에 산식 중복 금지.
2. 산식 변경은 반드시 **단위테스트 추가 + `kpi_config` 버전 증가**와 함께.
3. **기준선(baseline)은 잠금 후 불변**. 수정 코드 경로를 만들지 말 것.
4. **멀티테넌시 누수 금지**: 모든 쿼리 org_id 스코프. 누수 테스트 통과 전 머지 금지.
5. **전력 배출계수 하드코딩 금지**: `emission_factors` 테이블 + 출처/연도 저장.
6. **결정론적**: KPI/MRV는 같은 입력→같은 출력. `now()`/난수를 산출 로직에 넣지 말 것.
7. 비밀값은 `.env`(커밋 금지). 예시는 `.env.example`로.
8. 한글 도메인어를 식별자로 쓰지 말 것. 영문 + 주석 한글 병기.
9. 모든 제어/설정 변경은 `audit_logs`에 diff 기록.
10. **모든 머지 전 `qa-reviewer` 검증** 통과.

## 표준 명령(설정 후 채울 것)
- `make dev` : docker compose up (web/api/db/mqtt/worker)
- `make test` : pytest + vitest
- `make e2e` : playwright
- `make lint` : ruff + eslint + tsc --noEmit
- `make migrate` : alembic upgrade head

## 커밋/PR
- Conventional Commits(feat/fix/refactor/test/docs/chore).
- PR 본문에 "어떤 산출물(섹션 11) 기여인지" 한 줄 명시.
- 머지 전 체크: lint·typecheck·test green + qa-reviewer 승인.

## 팀 위임 (서브에이전트)
- `architect` 설계·ADR·작업분해 / `frontend-engineer` UI / `backend-engineer` API·DB·수집
- `data-kpi-engineer` KPI·MRV·추천(★산식 단독 책임) / `qa-reviewer` 검증 / `ui-ux-designer` 디자인 시스템
- 메인 세션은 **오케스트레이터**: 계획→위임→통합→검증.

## 불명확하면
추측하지 말 것. `00_개발의뢰서_MASTER.md` 재확인 → 그래도 불명확하면 사용자에게 질문.
