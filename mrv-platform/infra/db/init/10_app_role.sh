#!/bin/sh
# 앱 런타임 전용 DB 역할 생성(ADR 0007 5절 = D5, C7).
#
# 왜 필요한가 — 실측 사실:
#   Postgres 는 **superuser 에 대해 RLS 를 아예 적용하지 않는다**. `FORCE ROW LEVEL SECURITY`
#   는 테이블 *소유자* 에게 RLS 를 강제할 뿐 superuser 는 그마저 우회한다.
#   그런데 공식 postgres/timescaledb 이미지 entrypoint 는 `initdb --username="$POSTGRES_USER"`
#   로 `POSTGRES_USER` 를 **부트스트랩 superuser** 로 만든다. 그 역할로 앱이 접속하면
#   마이그레이션 0001~0013 이 심어 놓은 RLS 정책 전부가 **0의 보호**가 된다.
#   실측(로컬 Postgres 16, 동일 스키마):
#     superuser(postgres)    : SELECT count(*) FROM tanks (org 컨텍스트 없음) → 2행  ← 우회
#     비수퍼유저(culiver_app): SELECT count(*) FROM tanks (org 컨텍스트 없음) → 0행  ← 작동
#
# 역할 분리 설계(★):
#   - 소유자 / 마이그레이션 역할 = 기존 `POSTGRES_USER`(superuser).
#     CREATE TABLE / CREATE POLICY / TimescaleDB hypertable 생성 등 DDL 권한이 필요하고,
#     ADR 0007 이 대안 (b) 를 기각한 근거와 같은 이유로 "마이그레이션 자족성"을 유지해야 한다.
#   - 런타임 앱(api / worker / ingestion) 역할 = `culiver_app`(NOSUPERUSER NOBYPASSRLS).
#     필요한 것은 DML(SELECT/INSERT/UPDATE/DELETE)뿐이다.
#
#   ★ ALTER DEFAULT PRIVILEGES 가 이 스크립트의 핵심이다.
#     init 스크립트는 `docker-entrypoint-initdb.d` 에서 **테이블이 하나도 없는 시점**에 돈다
#     (alembic 은 그 뒤에 api 컨테이너 기동 명령으로 실행된다). 따라서
#     `GRANT ... ON ALL TABLES IN SCHEMA public` 만 걸면 대상이 0개라 아무 효과가 없고,
#     마이그레이션이 만드는 22개 테이블에 앱이 접근하지 못해 운영이 즉시 깨진다.
#     `ALTER DEFAULT PRIVILEGES FOR ROLE <owner>` 로 "앞으로 owner 가 만들 객체"에 미리
#     권한을 예약해 두어야 한다. 시퀀스(BIGSERIAL PK 등)도 동일하게 처리한다.
#
# 실행 순서: 파일명 사전순 — `00_extensions.sql`(TimescaleDB) → `10_app_role.sh`.
#   `.sql` 은 환경변수 치환이 불가능하므로(비밀번호 하드코딩 금지, CLAUDE Rule 7)
#   `.sh` + psql 변수(`-v`)로 작성한다. `:'var'`(리터럴)/`:"var"`(식별자) 인용은 psql 이
#   처리하므로 특수문자 비밀번호도 안전하다.
#
# 멱등: CREATE 는 존재 검사 후 실행하고, 이후 ALTER/GRANT 는 무조건 재적용한다.
#   (init 은 최초 1회만 돌지만, 기존 볼륨에 수동 적용할 때를 위해 재실행 가능하게 둔다.)
set -e

APP_DB_USER="${APP_DB_USER:-culiver_app}"

if [ -z "${APP_DB_PASSWORD:-}" ]; then
    echo "[10_app_role] FATAL: APP_DB_PASSWORD 가 비어 있다. infra/.env 에 설정하라(ADR 0007 5절)." >&2
    echo "[10_app_role]        비밀번호 하드코딩은 CLAUDE Rule 7 위반이므로 폴백 기본값을 두지 않는다." >&2
    exit 1
fi

echo "[10_app_role] creating runtime role '${APP_DB_USER}' (NOSUPERUSER NOBYPASSRLS) in db '${POSTGRES_DB}'"

psql -v ON_ERROR_STOP=1 \
     --username "$POSTGRES_USER" \
     --dbname "$POSTGRES_DB" \
     -v app_user="$APP_DB_USER" \
     -v app_password="$APP_DB_PASSWORD" \
     -v owner="$POSTGRES_USER" \
     -v db_name="$POSTGRES_DB" <<'EOSQL'

-- 1) 역할 생성(없을 때만). \gexec 로 식별자/리터럴 인용을 format() 에 위임한다.
SELECT format(
    'CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT PASSWORD %L',
    :'app_user', :'app_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')
\gexec

-- 2) 속성 재확정(멱등). 기존 역할이 어떤 이유로든 superuser/BYPASSRLS 였다면 여기서 되돌린다.
--    RLS 가 실제로 작동하려면 이 두 속성이 반드시 거짓이어야 한다.
SELECT format(
    'ALTER ROLE %I WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT PASSWORD %L',
    :'app_user', :'app_password'
)
\gexec

-- 3) 접속/스키마 사용 권한.
GRANT CONNECT ON DATABASE :"db_name" TO :"app_user";
GRANT USAGE ON SCHEMA public TO :"app_user";

-- 스키마에 객체를 만들 권한은 주지 않는다(DDL 은 마이그레이션 = 소유자 역할 전용).
-- Postgres 15+ 는 public 스키마의 CREATE 를 PUBLIC 에서 이미 회수하지만, 하위 버전/복원된
-- 볼륨에서도 동일 보장을 하도록 명시적으로 회수한다.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM :"app_user";

-- 4) 이미 존재하는 객체(수동 재적용 시나리오용 — init 시점에는 0개라 no-op).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app_user";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"app_user";

-- 5) ★앞으로 소유자(=마이그레이션 역할)가 만들 객체에 대한 기본 권한.
--    이것이 없으면 alembic 이 만드는 모든 테이블에 앱이 접근하지 못한다(운영 즉시 파손).
--    TRUNCATE/REFERENCES/TRIGGER 는 주지 않는다(런타임 앱에 불필요 — 최소권한).
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO :"app_user";

-- 6) 검증 로그: 이 두 값이 f/f 여야 RLS 가 의미를 갖는다(ADR 0007 5절).
SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
FROM pg_roles WHERE rolname = :'app_user';

EOSQL

echo "[10_app_role] done. api/worker 는 이 역할로 접속해야 RLS 가 실제로 작동한다."
