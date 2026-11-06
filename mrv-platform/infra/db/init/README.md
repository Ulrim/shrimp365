# infra/db/init

컨테이너 **최초 기동 시 1회**만 `docker-entrypoint-initdb.d` 로 실행되는 부트스트랩.
파일명 **사전순**으로 실행된다.

| 순서 | 파일 | 역할 |
|---|---|---|
| 1 | `00_extensions.sql` | TimescaleDB 확장 활성화 |
| 2 | `10_app_role.sh` | 런타임 앱 역할 `culiver_app` 생성 + 권한/기본권한 부여 (ADR 0007 5절) |

> 이미 데이터가 있는 볼륨(`db_data`)에는 다시 실행되지 않는다. 기존 스택에 적용하려면
> `10_app_role.sh` 를 수동으로 실행하라 — 멱등하게 작성되어 있다:
> ```sh
> POSTGRES_USER=culiver POSTGRES_DB=culiver APP_DB_USER=culiver_app \
>   APP_DB_PASSWORD='...' infra/db/init/10_app_role.sh
> ```

## DB 역할 분리 (ADR 0007 5절 = D5)

Postgres 는 **superuser 에게 RLS 를 적용하지 않는다**. `FORCE ROW LEVEL SECURITY` 는 테이블
*소유자* 에게 정책을 강제할 뿐이고 superuser 는 그마저 우회한다. 그런데 공식
postgres/timescaledb 이미지는 `POSTGRES_USER` 를 `initdb --username=` 으로 만들므로 그 역할은
**부트스트랩 superuser** 다. 그 역할로 앱이 접속하면 마이그레이션이 심은 RLS 정책 전부가
무효가 된다(실측: superuser 는 org 컨텍스트 없이 `tanks` 전체 행이 보이고, 비 superuser 는 0행).

따라서 역할을 둘로 나눈다.

| 역할 | 값 | 용도 | 왜 |
|---|---|---|---|
| 소유자/마이그레이션 | `POSTGRES_USER`(=superuser) | `alembic upgrade head`, `make migrate` | CREATE TABLE/POLICY, `create_hypertable` 등 DDL 필요 |
| 런타임 | `APP_DB_USER`(기본 `culiver_app`, NOSUPERUSER NOBYPASSRLS) | api / worker / ingestion | DML 만 필요. RLS 가 실제로 적용되는 유일한 경로 |

compose 는 `MIGRATION_DATABASE_URL`(소유자)과 `APP_DATABASE_URL`(런타임)을 분리해 주입하며,
`api` 컨테이너는 alembic 단계에만 소유자 URL 을 쓰고 uvicorn 은 런타임 URL 로 돈다.
`app/config.py::assert_non_superuser_db_role` 가 `ENVIRONMENT=production` 에서 이 규약을
기동 시 물리적으로 강제한다(위반 시 기동 실패).

### ★ ALTER DEFAULT PRIVILEGES 가 필수인 이유

init 스크립트는 **테이블이 하나도 없는 시점**에 돈다(alembic 은 그 뒤에 api 컨테이너가 실행).
그래서 `GRANT ... ON ALL TABLES IN SCHEMA public` 만 걸면 대상이 0개라 아무 효과가 없고,
마이그레이션이 만드는 테이블에 앱이 접근하지 못해 운영이 즉시 깨진다.
`ALTER DEFAULT PRIVILEGES FOR ROLE <소유자> IN SCHEMA public GRANT ... TO culiver_app` 으로
**앞으로 소유자가 만들 테이블/시퀀스**에 권한을 예약해 둔다.

실증(로컬 Postgres 16): 기본권한 설정 → 그 **이후** 소유자가 `CREATE TABLE post_init_tbl(...)`
→ `information_schema.role_table_grants` 에 `culiver_app | SELECT,INSERT,UPDATE,DELETE` 자동 부여
확인, 앱 역할로 SELECT/INSERT 성공(bigserial 시퀀스 USAGE 포함), 타 org INSERT 는 RLS 로 거부.

### 최소권한

- 스키마 `public` 의 `CREATE` 는 앱 역할에서 회수한다(런타임은 DDL 금지).
- `TRUNCATE` / `REFERENCES` / `TRIGGER` 는 부여하지 않는다.
- `APP_DB_PASSWORD` 는 하드코딩 폴백을 두지 않는다 — 비어 있으면 init 이 실패한다(CLAUDE Rule 7).

## RLS 정책 자체는 어디에?

RLS 정책은 **Alembic 마이그레이션**에서 테이블 생성과 함께 적용한다(스키마와 정책의 원자적
버전 관리). 여기서는 확장과 역할만 준비한다.

- org 스코프 테이블 19개: `ENABLE` + `FORCE ROW LEVEL SECURITY`.
- 정책: `org_id = current_setting('app.current_org_id', true)`.
  단 `users` / `api_keys` 는 ADR 0007 1절의 **명령 분할 정책**(SELECT 개방 + 쓰기 org 스코프).
- 애플리케이션은 매 트랜잭션 시작 시 `SELECT set_config('app.current_org_id', <org>, true)` 로
  컨텍스트를 재주입한다(ADR 0007 2절, `app/db/session.py`).
