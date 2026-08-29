# 컬리버 MRV 플랫폼 표준 명령(CLAUDE.md '표준 명령').
# 프론트(web) 명령은 frontend-engineer 가 채운다(현재는 자리만).

COMPOSE := docker compose -f infra/docker-compose.yml
API_DIR := apps/api
KPI_DIR := packages/kpi
WEB_DIR := apps/web
DATABASE_URL ?= sqlite+pysqlite:///./culiver_dev.db
# RLS 전용 검증 DB(ADR 0007 4절). 반드시 **비 superuser · 비 BYPASSRLS** 역할이어야 한다
# (superuser 는 RLS 를 전면 우회하므로 전부 초록불이 된다 — 스위트가 스스로 fail 시킨다).
# 역할 생성은 ADR 0007 5절(C7) = infra/db/init/10_app_role.sh 가 담당한다(compose 최초 기동 시
# 자동). 도커 밖 로컬 Postgres 에 직접 만들려면 같은 스크립트를 실행하면 된다:
#   POSTGRES_USER=postgres POSTGRES_DB=<db> APP_DB_USER=culiver_app APP_DB_PASSWORD=<pw> \
#     infra/db/init/10_app_role.sh
# 다른 접속 정보를 쓰려면:
#   make test-rls RLS_TEST_DATABASE_URL="postgresql+psycopg://<role>:<pw>@localhost:5432/<db>"
# 이 검증 DB 는 culiver_app 이 **소유자**인 단순 구성이다(compose 운영 구성은 소유자=POSTGRES_USER,
# 런타임=culiver_app 로 분리). 두 구성 모두 RLS 가 걸린다 — 마이그레이션이 모든 org 스코프
# 테이블에 ENABLE + FORCE ROW LEVEL SECURITY 를 적용하므로 소유자에게도 정책이 강제된다.
RLS_TEST_DATABASE_URL ?= postgresql+psycopg://culiver_app:culiver@localhost:5432/culiver_rls_test

.PHONY: dev test test-api test-kpi test-web test-rls lint migrate seed e2e down

## dev: 전체 스택 기동(web/api/db/mqtt/worker)
dev:
	$(COMPOSE) up --build

## down: 스택 종료
down:
	$(COMPOSE) down

## migrate: Alembic 마이그레이션 최신화
## ★Postgres 대상일 때 이 DATABASE_URL 은 **소유자/마이그레이션 역할**(compose 의
## MIGRATION_DATABASE_URL = POSTGRES_USER)이어야 한다. 런타임 역할(culiver_app)은
## NOSUPERUSER 이고 스키마 CREATE 권한이 없어 DDL 이 실패한다(ADR 0007 5절).
migrate:
	cd infra && DATABASE_URL="$(DATABASE_URL)" python -m alembic upgrade head

## seed: 데모 양식장 시드(결정론·멱등)
seed:
	DATABASE_URL="$(DATABASE_URL)" python infra/seed/seed_demo_site.py

## test: KPI + 백엔드(pytest) + 프론트(vitest)
test: test-kpi test-api test-web

## test-web: 프론트엔드 단위테스트(vitest)
test-web:
	cd $(WEB_DIR) && npm run test

## test-api: FastAPI 백엔드 테스트
test-api:
	cd $(API_DIR) && python -m pytest -q

## test-rls: Postgres 전용 RLS 동작 검증(비 superuser 역할 필수, ADR 0007 4절)
## make test 에는 포함하지 않는다 — Postgres 없는 환경의 초록불을 유지하기 위함.
test-rls:
	cd infra && DATABASE_URL="$(RLS_TEST_DATABASE_URL)" python -m alembic upgrade head
	cd $(API_DIR) && RLS_TEST_DATABASE_URL="$(RLS_TEST_DATABASE_URL)" python -m pytest tests_rls -q

## test-kpi: KPI 엔진 단위테스트
test-kpi:
	cd $(KPI_DIR) && python -m pytest -q

## lint: ruff(백엔드) + eslint·tsc(프론트) — 게이트, 실패 시 중단
lint:
	cd $(API_DIR) && ruff check .
	cd $(WEB_DIR) && npm run lint && npm run typecheck

## e2e: Playwright(프론트엔드 담당, 자리)
e2e:
	@echo "TODO(frontend): playwright e2e"
