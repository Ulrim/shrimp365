# ADR 0007 — Postgres RLS 운영 정합성 교정 (인증 조회 · 트랜잭션 컨텍스트 · 배치 순회 · DB 역할)

- 상태(Status): **제안(Proposed)** — architect 설계 확정, 구현은 `backend-engineer` 위임 대기.
  마이그레이션 0013 + 코드 4파일 + Postgres 전용 테스트 모듈이 머지되고 `qa-reviewer` 승인을
  받으면 Accepted 로 전이한다.
- 결정권자: architect (CLAUDE.md Hard Rule 4 = 멀티테넌시 격리 소관). 스택 변경 아님(Postgres RLS
  유지) — **RLS 정책 모델과 세션 컨텍스트 수명 계약을 변경**하므로 ADR 필수.
- 산식 무관: KPI/MRV 산식(`packages/kpi`)에 어떤 영향도 없다 → `data-kpi-engineer` 합의 게이트
  대상 아님(Rule 1 범위 밖).
- 날짜: 2026-08-29
- 작성: architect
- 관련: ADR 0005(Supabase Auth — **2절/5절의 사실 오류를 본 ADR 이 정정한다**),
  ADR 0006(shrimp365 계정 연계 — 실행 전제에 본 ADR 완료가 추가된다),
  ADR 0002(불변성의 "관례가 아닌 물리적 강제" 철학 — 본 ADR 이 그대로 계승),
  `infra/migrations/versions/0001~0012`, `CLAUDE.md`(Hard Rule 4/6/10),
  MASTER 5장(인증/RLS)
- **MASTER 11장 기여**: 본 ADR 은 평가 산출물을 직접 생산하지 않는다. 기여 경로는 정확히 하나 —
  *현재 상태로는 Postgres 운영 배포 시 로그인·수집·알림·모든 쓰기 API 가 동작하지 않으므로,
  11장의 모든 산출물(MRV 리포트·전후비교·운영 로그)의 원재료인 실운영 데이터가 단 한 건도
  쌓이지 않는다.* 즉 본 ADR 은 산출물의 **전제조건**을 복구한다.

---

## 맥락 (Context)

오케스트레이터가 "Supabase 로그인이 운영 Postgres 에서 403 으로 실패한다"는 결함 1건을 실증
보고했다. architect 가 동일 환경(Postgres 16, 비수퍼유저·비 BYPASSRLS `appuser` 소유,
`alembic upgrade head`(0012))에서 재현·확장 조사한 결과, **보고된 것은 한 결함이 아니라 결함
군(群)의 한 사례**였다. 진짜 명제는 이것이다:

> **RLS 계층은 이 프로젝트에서 단 한 번도 실행 검증된 적이 없다.**
> 전체 테스트(263건)는 SQLite 에서 돌고 SQLite 에는 RLS 가 없어 `set_org_context` 가 no-op 이다.
> `make dev`(docker-compose)조차 `POSTGRES_USER` 를 그대로 앱 역할로 쓰는데, 공식 postgres/
> timescaledb 이미지에서 그 역할은 **부트스트랩 superuser** 이고 **superuser 는 RLS 를 전면
> 우회**한다. 따라서 "RLS 가 켜진 상태에서 앱이 실제로 동작하는가"를 검증할 수 있는 환경이
> 개발·테스트·CI 어디에도 존재하지 않았다.

### 실측 결과 (전부 재현 완료, 추측 없음)

검증 환경: Postgres 16 / DB `rlscheck` / 역할 `appuser`(`rolsuper=f, rolbypassrls=f`, DB 소유자)
/ `alembic upgrade head` (0001→0012) 적용.

`pg_class` 확인 — RLS 가 켜진 테이블 19개(전부 `relrowsecurity=t, relforcerowsecurity=t`):
`alerts, api_keys, audit_logs, baselines, batches, control_actions, feed_logs, harvest_logs,
kpi_snapshots, meters, mortality_logs, mrv_reports, readings, recipe_versions, recipes, sites,
sop_checklist_runs, tanks, users`.
RLS 비대상 3개: `organizations, kpi_config, emission_factors`(전부 org 전역 설정 성격 — 의도된 것).

| ID | 결함 | 실측 증거 | 영향 |
|---|---|---|---|
| **D1** | `users` 가 `_RLS_TABLES`(0002)에 포함되어 있는데 `deps.py::get_auth_context` 는 org 컨텍스트 없는 세션으로 조회한다 | 컨텍스트 없는 새 연결에서 `SELECT ... FROM users WHERE supabase_user_id=<uid>` → **0행**, `WHERE email=... AND supabase_user_id IS NULL` → **0행** | `AUTH_MODE=supabase` 전 로그인 403. ADR 0005·0006 동시 무력화 |
| **D2** | `api_keys` 도 동일 구조. `services/api_key_auth.py::get_ingest_context` 는 `set_org_context` 를 **조회 이후에** 호출한다 | org 컨텍스트로 시드한 키를, 컨텍스트 없는 새 연결에서 `WHERE key_hash='deadbeefhash'` → **0행** | `POST /ingest/readings` 전건 401. **`AUTH_MODE` 와 무관** — 현재 계약된 수집 경로가 그대로 죽는다 |
| **D3** | `set_org_context` 는 `set_config(..., is_local => true)` = **트랜잭션 스코프**. `session.commit()` 순간 GUC 가 소실된다 | 커밋 전 `SELECT count(*) FROM users` → 1, **커밋 후 동일 쿼리 → 0**, `current_setting(...)` → `''`. 커밋 후 2번째 INSERT → `InsufficientPrivilege: new row violates row-level security policy for table "tanks"`. ORM 레벨: `expire_on_commit=True` 기본값 탓에 커밋 후 속성 접근만으로 `ObjectDeletedError` | **가장 넓은 폭발 반경.** 커밋 사이트 20곳(라우터 11개). `session.refresh()` 후속 6곳(`recommendations/control_actions×4/alerts`), 커밋 후 ORM 속성 읽기(`logs.py` 2곳), 2회 커밋 엔드포인트 전부. **인증 모드와 무관하게 거의 모든 쓰기 API 가 500** |
| **D4** | `job_evaluate_alerts` 가 org 컨텍스트 없이 `select(Site)` 전 순회 | 워커 패턴 재현: `sites visible: 0`, `organizations visible: 2`, `job_evaluate_alerts created: 0` | 알림 서브시스템(phase-2 슬라이스 H) **조용한 영구 무동작**. 예외도 로그도 없다 — 가장 발견하기 어려운 유형 |
| **D5** | `infra/docker-compose.yml` 이 `POSTGRES_USER`(=부트스트랩 superuser)를 그대로 앱 DB 역할로 사용 | 공식 postgres 이미지 entrypoint 가 `initdb --username="$POSTGRES_USER"` 로 해당 역할을 superuser 로 생성 → superuser 는 RLS 전면 우회 | 두 갈래 모두 파국: superuser 로 운영하면 **RLS 가 0의 보호**(Rule 4 무력), 비superuser 로 운영하면 D1~D4 로 **앱이 안 뜬다** |
| **D6**(비결함, 계약 명시 필요) | `organizations.py::invite_user` 의 UID 선연계 중복 조회는 org 스코프 세션에서 돌아 **같은 org 만** 본다 | 코드 주석이 이미 정확히 인지하고 있다(deps.py 주석과 모순) | D1 수정으로 동작이 바뀌므로 기대값을 명시 고정해야 한다 |

### 이 결함이 왜 여태 안 잡혔는가 (근본 원인)

1. **테스트 환경이 SQLite** → `set_org_context` no-op → D1~D4 전부 통과.
2. **개발 스택이 superuser** → Postgres 로 띄워도 RLS 우회 → D1~D4 전부 통과.
3. **문서가 서로 모순** → `deps.py::_get_unscoped_db` docstring 은 "`users` 는 `_RLS_TABLES`
   대상이 아니다"라고 주장하고, ADR 0005 2절은 그 근거로 **`0001_initial_schema.py`** 를 인용한다.
   그러나 `users` 는 0001 이 아니라 **0002 에서 생성되고 거기서 RLS 가 걸린다**. 인용한 파일에
   `users` 가 없는 것은 사실이지만 그것은 테이블이 아직 존재하지 않기 때문이다 — **"부재"를
   "비대상"으로 오독**한 전형적 사례다. 같은 저장소의 `organizations.py:68` 주석과
   `infra/seed/seed_demo_site.py:19` 주석은 정반대로 정확히 서술하고 있다.

교훈은 "0002 를 놓쳤다"가 아니라 **"RLS 동작을 관찰할 수 있는 환경이 없으면 RLS 에 관한 어떤
서술도 검증되지 않는다"** 이다. 본 ADR 의 4절(회귀 방지)이 실제 핵심이다.

---

## 결정 (Decision)

### 1. `users` / `api_keys` — RLS 유지, **명령 분할 정책(command-split policy)** 채택

인증 조회는 본질적으로 "org 를 알기 전에 읽어야" 하고 RLS 는 "org 를 알아야 읽을 수 있다"고
요구한다. 이 충돌은 **읽기와 쓰기를 분리**하면 해소된다. 두 테이블에 대해 기존
`org_isolation_{table}`(암묵적 `FOR ALL`) 정책을 **네 개의 명령별 정책으로 교체**한다.
`ENABLE/FORCE ROW LEVEL SECURITY` 는 **유지**한다(끄지 않는다 — 쓰기 정책이 강제되어야 한다).

```sql
DROP POLICY org_isolation_users ON users;

-- 읽기: DB 계층 개방. org 를 알기 전 인증 조회를 허용한다(1-1 근거).
CREATE POLICY users_select_open ON users FOR SELECT USING (true);

-- 쓰기: org 스코프 물리 강제 유지(권한 상승 방어선).
CREATE POLICY users_insert_org ON users FOR INSERT
  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY users_update_org ON users FOR UPDATE
  USING      (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY users_delete_org ON users FOR DELETE
  USING      (org_id = current_setting('app.current_org_id', true));
```
`api_keys` 도 동일 형태(`api_keys_select_open` / `_insert_org` / `_update_org` / `_delete_org`).

**실측 검증 완료**(프로토타입을 실 Postgres 에 적용 후 원복):

| 시나리오 | 기대 | 실측 |
|---|---|---|
| 컨텍스트 없이 `SELECT ... WHERE supabase_user_id=<uid>` | 1행 | **1행** ✅ |
| 컨텍스트 없이 `INSERT`(타 org) | 거부 | **`ERROR: new row violates row-level security policy`** ✅ |
| 컨텍스트 없이 `UPDATE` | 0행 갱신 | **`UPDATE 0`** ✅ |
| org 컨텍스트 하 `UPDATE`(lazy-link 경로) | 1행 갱신 | **`UPDATE 1`** ✅ |
| org-t 컨텍스트에서 org-START 로 `INSERT` | 거부 | **`ERROR: ... violates row-level security policy`** ✅ |

**1-1. 읽기 개방이 안전한 근거 — `users` 읽기 경로 전수 조사**

`grep -rn "select(User)" apps/api/app` 결과 **정확히 3곳**이 전부다. `users` 를 목록으로 노출하는
엔드포인트는 **존재하지 않는다**(`GET /organizations/{org_id}/users` 같은 조회 API 자체가 없다).

| # | 위치 | 조회 형태 | 안전 근거 |
|---|---|---|---|
| 1 | `deps.py:183` | `WHERE supabase_user_id == <JWT sub>` | Supabase 서명 검증을 통과한 토큰의 `sub`(UUID v4, 전역 유니크 부분 인덱스). 추측 불가·열거 불가 |
| 2 | `deps.py:115` (`_lazy_link`) | `WHERE email == <JWT email> AND supabase_user_id IS NULL` | `email` 은 **Supabase 가 서명한 토큰**에서만 온다(사용자 입력 아님). 반환은 1건일 때만 사용하고 2건 이상이면 409 로 안전 실패(ADR 0005 4절 기존 계약) |
| 3 | `organizations.py:72` | `WHERE supabase_user_id == <요청 본문 값>` | `require_owner` + 경로 org_id==auth.org_id 3중 방어 통과 후. 결과는 **행 내용을 반환하지 않고 "존재 여부"만 409 로 변환**한다(D6, 아래 1-3) |

즉 개방되는 읽기 표면은 "정확 매칭 1건 조회" 셋뿐이며, 어느 것도 행을 다른 테넌트에게 반환하지
않는다. `api_keys` 도 동일 — 읽기 경로는 `api_key_auth.py:64`(전역 유니크 sha256 해시 정확 매칭)와
`onboarding.py:49`(org 스코프 `get_db` 세션에서 `site_id` 조회) 둘뿐이다.

**1-2. 왜 (a) 단순 RLS 해제가 아니라 명령 분할인가**

오케스트레이터 제시안 (a)(정책·RLS 를 통째로 DROP)는 위 근거로 "읽기는 안전"까지는 맞지만
**쓰기 방어선까지 함께 버린다**. 이 시스템에서 가장 값비싼 공격은 *피해 org 에 `role='owner'`
users 행을 삽입해 테넌트를 탈취하는 것*이며, RLS 는 정확히 그 한 가지를 물리적으로 막는다.
명령 분할의 추가 비용은 **같은 마이그레이션 안에서 `CREATE POLICY` 3줄이 늘어나는 것뿐**이다.
비용 대비 이득이 명백하므로 (a) 를 채택하지 않는다. **(a) 는 폴백으로도 두지 않는다** — 애매한
선택지를 남기면 구현자가 더 쉬운 쪽으로 흐른다.

**1-3. D6 확정 계약**: `organizations.py::invite_user` 의 UID 선연계 중복 조회는 본 결정 이후
**전 org 를 보게 된다**(SELECT 개방). 이는 **개선**이다 — 기존 코드 주석이 "타 org 에 이미 연계된
UID 는 부분 유니크 인덱스가 IntegrityError 로 막는다"며 감수하던 열화(잘못된 409 문구)가 사라지고,
의도대로 `"this supabase account is already linked to a user"` 409 가 나간다. 코드 변경 불요,
**주석만 갱신**하고 회귀 테스트로 고정한다.

### 2. org 컨텍스트를 **세션 수명 전체**에 재적용 (D3)

`SET LOCAL`/`set_config(..., true)` 는 트랜잭션 스코프다. 커밋마다 사라진다. 세션 스코프
(`is_local=false`)로 바꾸는 것은 **더 나쁘다** — 커넥션 풀에 GUC 가 남아 다음 요청이 이전 테넌트의
컨텍스트를 물려받는다(Rule 4 정면 위반). 따라서:

**결정: `Session` 에 org_id 를 바인딩하고, SQLAlchemy `after_begin` 이벤트로 매 트랜잭션 시작 시
GUC 를 재적용한다.** 커밋/롤백 경계가 호출부에 투명해지고, 개별 라우터가 "커밋 후 다시 걸기"를
기억할 필요가 없다(ADR 0002 의 "관례가 아니라 물리적 강제" 철학 동형 적용).

```python
# apps/api/app/db/session.py (계약)
_ORG_CONTEXT_KEY = "culiver_org_id"

@event.listens_for(Session, "after_begin")
def _reapply_org_context(session, transaction, connection) -> None:
    """모든 트랜잭션 시작 시 org GUC 재적용 — SET LOCAL 은 커밋 시 소실된다(ADR 0007 2절)."""
    if not _is_postgres():
        return
    org_id = session.info.get(_ORG_CONTEXT_KEY)
    if org_id is None:
        return
    connection.execute(
        text("SELECT set_config('app.current_org_id', :org_id, true)"), {"org_id": org_id}
    )

def set_org_context(session: Session, org_id: str) -> None:
    session.info[_ORG_CONTEXT_KEY] = org_id      # sqlite 에서도 기록(테스트가 관찰 가능하도록)
    if not _is_postgres():
        return
    # 이미 열려 있는 트랜잭션에도 즉시 적용(세션 중간 바인딩 = _lazy_link 경로). 멱등.
    session.execute(
        text("SELECT set_config('app.current_org_id', :org_id, true)"), {"org_id": org_id}
    )
```

**실측 검증 완료**(프로토타입):

| 시나리오 | 수정 전 | 수정 후 |
|---|---|---|
| ctx → read → commit → read | 1 → **0** ❌ | 1 → **1** ✅ |
| ctx → INSERT+commit → INSERT+commit | 2번째 **InsufficientPrivilege** ❌ | **둘 다 성공** ✅ |
| ctx → 타 org INSERT(차단) → rollback → read | — | **차단 후 정상 read** ✅ |
| ORM `refresh()` after commit | **ObjectDeletedError** ❌ | **성공** ✅ |
| 컨텍스트 없는 새 세션(풀 재사용 3회) | — | **tanks 0행 = 누수 없음** ✅ |

`expire_on_commit` 은 **기본값(True) 그대로 둔다** — 2절 수정으로 커밋 후 재조회가 정상 동작하므로
바꿀 이유가 없고, 바꾸면 저장소 전역 ORM 시맨틱이 변해 예상 못한 stale 값 버그를 부른다.

### 3. 배치 순회는 `organizations`(RLS 비대상) → **org 별 스코프 순회** (D4)

`job_evaluate_alerts` 의 `select(Site)` 전 순회는 RLS 하에서 0행이다. **BYPASSRLS 역할이나
escape hatch 를 만들지 않는다.** RLS 비대상인 `organizations` 를 열거하고, org 마다 컨텍스트를 건 뒤
그 org 의 site 만 읽는다.

```python
# apps/api/app/services/alert_jobs.py::job_evaluate_alerts (계약)
org_ids = session.execute(select(Organization.id)).scalars().all()
for org_id in org_ids:
    set_org_context(session, org_id)                      # sqlite no-op
    sites = session.execute(
        select(Site).where(Site.org_id == org_id)
    ).scalars().all()
    for site in sites:
        ...  # 기존 3종 평가 로직 그대로(내부 set_org_context(site.org_id) 는 중복이므로 제거)
```
부수 효과로 org 경계가 코드에 **명시**되어 Rule 4 가독성이 올라간다. SQLite 에서도 순회 결과가
동일하므로 기존 알림 테스트는 무회귀여야 한다(수용 기준).

### 4. ★회귀 방지 — Postgres 전용 RLS 테스트 (본 ADR 의 핵심)

전체 263건을 Postgres 로 옮기지 않는다(느려지고, 이득은 RLS 한 축뿐 — 과설계). 대신
**RLS 동작만 검증하는 10건 내외의 별도 스위트**를 둔다.

- 위치: `apps/api/tests_rls/`(기존 `tests/` 형제 디렉터리). `pyproject.toml` 의
  `testpaths = ["tests"]` 덕분에 `make test-api` 는 **건드리지 않는다**(회귀 0). `tests/conftest.py`
  의 SQLite 환경변수 세팅이 상속되지 않도록 반드시 형제 디렉터리여야 한다.
- 게이트: `RLS_TEST_DATABASE_URL` 환경변수가 없으면 모듈 수집 시 `pytest.skip(allow_module_level=True)`.
  → 로컬/CI 에서 무설정 시 조용한 no-op, 설정 시 전량 실행.
- **DB 역할 요구**: 접속 역할이 `rolsuper` 또는 `rolbypassrls` 이면 **skip 이 아니라 fail** 한다
  (superuser 로 돌리면 전부 초록불이 되는 D5 함정을 테스트가 스스로 막는다).
- 실행: `make test-rls`(수동) + CI 가 생기는 시점에 필수 잡. **현재 저장소에 `.github/workflows`
  가 존재하지 않으므로** CI 배선은 "CI 도입 시 함께"로 계약만 남긴다(지금 CI 를 새로 만드는 것은
  본 슬라이스 범위 밖).

### 5. DB 역할 — 앱은 **비 superuser · 비 BYPASSRLS** 로만 접속 (D5)

RLS 는 superuser 에게 아무 의미가 없다. "RLS 를 켰다"는 서술이 참이려면 앱 역할이 superuser 가
아니어야 한다. 이를 관례가 아니라 **기동 시 물리적 강제**로 만든다(ADR 0005 5절
`_guard_production_auth_mode` 선례 동형).

- `infra/db/init/` 에 앱 전용 역할(`culiver_app`, `NOSUPERUSER NOBYPASSRLS`) 생성 스크립트를
  추가하고, compose 의 `api`/`worker` `DATABASE_URL` 을 그 역할로 바꾼다.
- `app/config.py` 또는 기동 훅에서 `environment == "production"` 일 때
  `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user` 를 확인하고 참이면
  **기동 실패**시킨다.

> **구현 시 확정된 변경(2026-08-29, 오케스트레이터 판단 — 위 초안과 다름)**
>
> 초안은 "스키마 소유권 이전 + 마이그레이션도 앱 역할로 실행"을 적었으나, 실제 구현은
> **소유자/마이그레이션 역할(`POSTGRES_USER`)과 런타임 역할(`culiver_app`)을 분리**했다.
>
> - **채택 이유**: 런타임 최소권한. `culiver_app` 에서 `REVOKE CREATE ON SCHEMA public` 하면
>   앱이 `DROP POLICY`·`ALTER TABLE` 을 물리적으로 할 수 없다 — 애플리케이션 취약점이
>   RLS 정책 자체를 무력화하는 경로를 닫는다. 소유권을 앱 역할로 넘기면 앱이 자기 테이블의
>   정책을 지울 수 있어 이 방어가 성립하지 않는다.
> - **RLS 보호에 손실 없음**: `culiver_app` 은 **비소유자**이므로 `FORCE ROW LEVEL SECURITY`
>   없이도 정책이 항상 강제된다(FORCE 는 소유자에게도 적용시키기 위한 옵션일 뿐이다).
> - **트레이드오프(기록)**: 마이그레이션 실행 역할이 런타임 역할과 달라, "운영과 동일 조건에서
>   마이그레이션을 검증한다"는 초안의 이점은 포기했다. 대신 `10_app_role.sh` 의
>   `ALTER DEFAULT PRIVILEGES` 가 소유자가 이후 만드는 모든 객체에 런타임 권한을 자동
>   부여하며, 이것이 실제로 동작함을 신규 DB에서 실증했다(init → 테이블 생성 → 앱 역할
>   DML 가능 확인). 전체 마이그레이션(0001~0013) 적용 후 SELECT/INSERT 권한 누락 테이블 0개.

---

## 대안 (Alternatives considered)

- **(a) `users` RLS 를 통째로 해제** — 1-2절에서 기각. 읽기 안전성은 성립하나 권한 상승(타 org 에
  owner 행 삽입) 방어선까지 버린다. 명령 분할이 같은 마이그레이션 안에서 3줄 더 쓰는 비용으로
  그 방어선을 유지하므로 열위.
- **(b) `SECURITY DEFINER` 함수로 인증 조회만 우회** — **실측으로 기각**. `FORCE ROW LEVEL
  SECURITY` 는 **테이블 소유자에게도 RLS 를 적용**하므로, 소유자(`appuser`)가 정의한 `SECURITY
  DEFINER` 함수를 컨텍스트 없이 호출해도 **0행**이 나온다(재현: `auth_lookup_user(<uid>)` →
  `rows_returned = 0`, 컨텍스트를 걸면 1). 성립시키려면 `BYPASSRLS` 역할이 필요한데,
  마이그레이션을 실행하는 앱 역할은 그 역할을 만들 수 없다(재현: `CREATE ROLE ... BYPASSRLS` →
  `ERROR: permission denied to create role`). 즉 **모든 배포 환경마다 superuser 수동 개입이
  선행**되어야 하고, 관리형 Postgres 에서는 보장되지 않는다. 마이그레이션 자족성을 깨는 대가로
  얻는 것이 (d) 대비 없으므로 기각.
- **(c) 정책에 "org 컨텍스트 미설정 시 허용" 예외**
  (`current_setting(...) IS NULL OR org_id = current_setting(...)`) — **강력 기각**. 이 예외는
  *특정 테이블의 특정 조회*가 아니라 **`set_org_context` 를 호출하지 않은 모든 코드 경로**에
  적용된다. 즉 컨텍스트 세팅을 한 번 잊는 순간(오늘 D2·D4 가 정확히 그 상태다) 해당 경로는 에러
  없이 **조용히 전 테넌트 데이터를 반환**한다. 실패가 시끄러운(0행/예외) 현재 모델을 조용한
  전면 누수 모델로 바꾸는 것이며, RLS 를 도입한 목적 자체를 무효화한다. 덧붙여 D3 실측에서
  확인했듯 커밋 후 GUC 는 `NULL` 이 아니라 `''` 로 남아 이 조건식은 **의도대로 동작하지도 않는다**
  (`IS NULL` 이 거짓). 보안적으로도 기술적으로도 틀렸다.
- **(d2) 인증 전용 신규 테이블 분리**(`auth_identities(supabase_user_id → user_id, org_id)`, `users`
  는 RLS 유지) — 기각. `_lazy_link` 는 **아직 연계되지 않은** 초대 행을 email 로 찾아야 하는데 그
  행에는 identity 레코드가 없다. 결국 초대 이메일까지 새 테이블에 넣어야 하고, 그러면 노출 표면이
  `users` 와 동일해지면서 **테이블만 하나 늘고 동기화 버그 표면이 생긴다**. 순 이득 0, 순 비용 +.
- **`is_local=false`(세션 스코프 GUC)로 D3 해결** — 기각. 커넥션 풀 반납 후 GUC 가 남아 다음 요청이
  이전 테넌트 컨텍스트를 상속한다. `checkin` 이벤트로 RESET 을 걸어도 예외 경로에 누수 창이 남는다.
  Rule 4 상 허용 불가.
- **전체 테스트 스위트를 Postgres 로 이전** — 기각(과설계). 협약 7개월 안에 START·PRO 를 끝내는
  것이 최우선이며, RLS 라는 한 축을 위해 263건 전체의 실행 시간·픽스처를 재작성할 이유가 없다.
  4절의 10건 전용 스위트가 동일한 회귀를 잡는다.

---

## 결과 (Consequences)

- (+) `AUTH_MODE=supabase` 운영 배포가 **가능해진다**(ADR 0005/0006 의 차단 해제).
- (+) `POST /ingest/readings`(D2), 쓰기 API 전반(D3), 알림 배치(D4)가 Postgres 에서 처음으로 동작한다.
- (+) `users`/`api_keys` 의 **쓰기** 측 물리 격리는 유지된다 — 방어 계층을 잃지 않는다.
- (+) org 컨텍스트가 세션 수명 계약이 되어, 앞으로 추가되는 라우터가 커밋 경계를 신경 쓸 필요가 없다.
- (−) `users`/`api_keys` 의 **읽기** 격리는 이제 애플리케이션 계층(3중 방어 1·3번째)에만 의존한다.
  완화: 두 테이블 모두 목록 노출 엔드포인트가 없고 읽기 경로가 총 5곳(전수 조사 완료)이며,
  4절 테스트가 "새 목록 조회 경로가 생기면 깨지도록" 고정한다. **`users`/`api_keys` 에 목록/검색
  조회를 추가하려는 향후 변경은 본 ADR 의 전제를 무너뜨리므로 후속 ADR 트리거다.**
- (−) `after_begin` 이벤트 리스너는 `Session` 클래스 전역에 걸린다 — 향후 별도 엔진/세션을 만들면
  동일 규약을 따라야 한다(`_is_postgres()` 가드로 SQLite 는 자동 무해).
- (−) `make test-rls` 는 Postgres 기동을 요구한다(로컬에서 항상 돌지는 않는다). 완화: 무설정 시 skip,
  CI 도입 시 필수 잡.
- 후속 ADR 트리거: (i) `users`/`api_keys` 에 목록 조회 API 추가, (ii) PgBouncer 트랜잭션 풀링 도입
  (세션 GUC 전제가 바뀐다), (iii) 다중 org 소속 사용자 요구 발생.

---

## 구현 계약 (backend-engineer 위임)

### C1. 마이그레이션 `infra/migrations/versions/0013_rls_auth_lookup_policies.py`

- `revision = "0013_rls_auth_lookup_policies"`, `down_revision = "0012_control_actions"`.
- 기존 `_is_postgres()` 가드 패턴 재사용(SQLite 는 전부 no-op).
- `upgrade()`: `for table in ("users", "api_keys")` —
  `DROP POLICY IF EXISTS org_isolation_{table} ON {table}` 후 1절의 4개 정책 생성.
  **`ENABLE/FORCE ROW LEVEL SECURITY` 는 건드리지 않는다**(유지).
- `downgrade()`: 4개 정책 DROP 후 `org_isolation_{table}`(FOR ALL, USING+WITH CHECK) 재생성.
- 정책 SQL 의 비교식은 기존 마이그레이션과 **문자열까지 동일**하게
  `org_id = current_setting('app.current_org_id', true)` 로 쓴다(일관성).
- 다른 17개 RLS 테이블은 **손대지 않는다**.

### C2. `apps/api/app/db/session.py`

- 2절 계약대로 `_ORG_CONTEXT_KEY`, `after_begin` 리스너, `set_org_context` 갱신.
- `from sqlalchemy import event` 추가. 모듈 docstring 에 ADR 0007 2절 참조 추가.

### C3. `apps/api/app/deps.py`

- **`_get_unscoped_db` docstring 전면 교체** — 현재 문장 "`users` 는 `_RLS_TABLES` 대상이 아니므로
  org 컨텍스트 없이 조회해도 안전하다"는 **사실과 다르다**. 새 문구는 반드시 다음을 담을 것:
  `users` 는 RLS 대상이며(0002), ADR 0007 1절의 명령 분할 정책 덕분에 **SELECT 만** org 컨텍스트
  없이 가능하다. 이 세션으로 **쓰기를 하려면 반드시 `set_org_context` 를 먼저 호출**해야 한다.
- 모듈 docstring 의 동일 취지 문장(상단 "`users` 는 RLS 비대상 테이블이므로 unscoped 조회가
  안전하다는 근거는 ADR 0005 2절")도 함께 교체하고 ADR 0007 을 인용.
- **`_lazy_link` 로직 수정(필수)**: 후보 1건 확정 직후, `user_row.supabase_user_id` 대입 **이전에**
  `set_org_context(session, user_row.org_id)` 를 호출한다.
  근거: `record_audit` 이 쓰는 `audit_logs` 는 **여전히 `FOR ALL` org 스코프 정책**이라 컨텍스트
  없이는 INSERT 가 거부되고, `users` UPDATE 도 `users_update_org` 에 막혀 **조용히 0행**이 된다
  (실측: `UPDATE 0`). 이 한 줄이 없으면 D1 을 고쳐도 첫 로그인이 여전히 실패한다.

### C4. `apps/api/app/services/api_key_auth.py`

- 로직 변경 없음(조회→`set_org_context` 순서가 이미 옳다). `get_ingest_context` docstring 에
  "이 순서가 성립하는 근거는 ADR 0007 1절의 `api_keys_select_open` 정책" 을 명시.

### C5. `apps/api/app/services/alert_jobs.py`

- 3절 계약대로 `job_evaluate_alerts` 순회를 org 기준으로 교체. `Organization` 임포트 추가,
  루프 내부의 중복 `set_org_context(session, site.org_id)` 제거.

### C6. `apps/api/app/routers/organizations.py`

- `invite_user` 의 `# (주의: Postgres 에서 users 는 org 스코프 RLS 대상이므로 이 선조회는 같은 org
  범위만 본다 ...)` 주석을 ADR 0007 1-3절 반영으로 갱신(**전 org 를 본다**, 따라서 UID 중복이
  의도한 409 문구로 나간다). 코드 변경 없음.

### C7. `infra/docker-compose.yml` + `infra/db/init/` + `app/config.py` (D5)

- `infra/db/init/` 에 `CREATE ROLE culiver_app LOGIN NOSUPERUSER NOBYPASSRLS ...` + 스키마/테이블
  소유권 및 권한 부여 스크립트 추가(기존 TimescaleDB 부트스트랩 스크립트와 같은 디렉터리).
- compose `api`/`worker` 의 `DATABASE_URL` 기본값을 `culiver_app` 로 변경. `.env.example` 갱신.
- `environment == "production"` 일 때 `current_user` 의 `rolsuper`/`rolbypassrls` 를 확인해 참이면
  기동 실패시키는 가드 추가.
- **선행 확인 1건**(architect 가 이 환경에서 확인 불가 — docker 데몬 없음): 실제 compose 기동 후
  `psql -c "select rolname, rolsuper from pg_roles where rolname=current_user"` 로
  기존 `POSTGRES_USER` 가 superuser 인지 확인하고 결과를 PR 본문에 기록할 것.

### C8. 테스트 계약 `apps/api/tests_rls/`

`conftest.py`:
- `RLS_TEST_DATABASE_URL` 부재 → `pytest.skip(..., allow_module_level=True)`.
- 접속 역할이 `rolsuper` 또는 `rolbypassrls` → **`pytest.fail`**(skip 아님).
- `app` 임포트 **이전에** `os.environ["DATABASE_URL"]` 세팅(기존 `tests/conftest.py` 패턴 차용).
- 2개 org(`org-A`, `org-B`) + 각 site/tank/user/api_key 시드 픽스처(결정론, 멱등).

테스트(각 항목이 위 결함 1개와 1:1 대응 — **수정 전에 반드시 실패함을 먼저 확인**할 것):

| # | 테스트 | 대응 | 기대 |
|---|---|---|---|
| 1 | `test_users_lookup_by_supabase_uid_without_org_context` | D1 | 1행 반환 |
| 2 | `test_users_lookup_by_email_unlinked_without_org_context` | D1 | 1행 반환 |
| 3 | `test_users_insert_into_foreign_org_denied` | 1절 | `ProgrammingError`(InsufficientPrivilege) |
| 4 | `test_users_update_without_org_context_affects_zero_rows` | 1절 | `rowcount == 0`, 컨텍스트 하에서는 1 |
| 5 | `test_api_key_lookup_by_hash_without_org_context` | D2 | 1행 반환 |
| 6 | `test_org_context_survives_commit` | D3 | 커밋 후 SELECT/INSERT/`refresh()` 모두 성공 |
| 7 | `test_org_context_does_not_leak_to_new_session` | D3 | 컨텍스트 없는 새 세션이 `tanks` 0행 |
| 8 | `test_cross_org_read_blocked` | Rule 4 | org-A 컨텍스트에서 org-B 의 `tanks`/`readings` 0행 |
| 9 | `test_alert_job_sees_all_orgs_under_rls` | D4 | `job_evaluate_alerts` 가 두 org 의 site 를 모두 평가 |
| 10 | `test_supabase_login_end_to_end_on_postgres` | **보고된 결함의 수용 테스트** | `AUTH_MODE=supabase` + 합성 JWT 로 `TestClient` → lazy-link 성공 200, `audit_logs` 에 `action='link'` 1행 |
| 11 | `test_ingest_with_api_key_end_to_end_on_postgres` | D2 수용 테스트 | `X-API-Key` 로 `POST /ingest/readings` → 200 + `readings` 실제 적재 |

`Makefile`:
```make
RLS_TEST_DATABASE_URL ?= postgresql+psycopg://culiver_app:culiver@localhost:5432/culiver_rls_test

## test-rls: Postgres 전용 RLS 동작 검증(비 superuser 역할 필수, ADR 0007 4절)
test-rls:
	cd infra && DATABASE_URL="$(RLS_TEST_DATABASE_URL)" python -m alembic upgrade head
	cd $(API_DIR) && RLS_TEST_DATABASE_URL="$(RLS_TEST_DATABASE_URL)" python -m pytest tests_rls -q
```
`.PHONY` 에 `test-rls` 추가. `make test` 의 정의는 **바꾸지 않는다**(Postgres 없는 환경에서 초록불
유지). CI 워크플로가 생기는 시점에 `postgres:16` 서비스 컨테이너 + `make test-rls` 를 필수 잡으로
추가한다(별도 작업, 본 슬라이스 범위 밖).

### C9. 문서 정정

- `docs/adr/0005-supabase-auth-integration.md`: **원문 삭제 금지**(ADR 은 이력). 상단 상태 줄 아래에
  "정정(2026-08-29)" 배너 + 문서 말미에 정정 섹션을 추가해 2절/5절의 "`users` 는 RLS 비대상" 서술이
  사실과 다름을 명시하고 ADR 0007 로 연결한다. → **본 ADR 과 함께 architect 가 이미 수행**.
- `docs/adr/0006-shrimp365-account-federation.md`: 실행 전제 체크리스트 최상단에 "ADR 0007 구현
  완료" 항목 추가. → **architect 가 이미 수행**.
- `docs/design/phase-3-auth.md`: 동일 취지의 서술이 있으면 backend-engineer 가 함께 정정한다.

### 수용 기준 (qa-reviewer 게이트, 전부 충족 시에만 머지)

1. `make test`(263건, SQLite) **전건 통과 — 회귀 0건**.
2. `make test-rls` 11건 전건 통과. 단, **수정 전 커밋에서 최소 5건(1·2·5·6·9)이 실패함을 먼저
   증명**한 스크린샷/로그를 PR 에 첨부(테스트가 실제로 결함을 잡는지 검증).
3. `make lint`(ruff + eslint + tsc) 통과.
4. `alembic upgrade head` → `downgrade -1` → `upgrade head` 왕복이 Postgres 에서 성공하고,
   왕복 후 `pg_policies` 상태가 왕복 전과 동일.
5. `deps.py` 어디에도 "`users` 는 RLS 대상이 아니다" 취지의 서술이 남아 있지 않다(grep 확인).
6. PR 본문 1줄: "MASTER 11장 기여 — 운영 Postgres 에서 로그인/수집/쓰기/알림을 복구해 전 산출물의
   원재료(실운영 데이터) 축적을 가능하게 한다."

### 범위 밖 (명시적 제외)

- `apps/web`, `/workspace/shrimp365` 변경 없음.
- 나머지 17개 RLS 테이블의 정책 변경 없음(전부 `FOR ALL` org 스코프 유지가 옳다 — 전부 org 를 안
  뒤에 접근한다).
- CI 워크플로 신규 작성(현재 `.github/` 부재 — 별도 작업).
- `mqtt_consumer.py` 의 게이트웨이 인증 배선(현재 골격만 존재, phase 범위 밖).
