# ADR 0005 — Supabase Auth 통합 (로그인 발급, 슬라이스 O)

> ## ⚠ 정정 고지 (2026-08-29, ADR 0007)
> **본 ADR 2절·5절의 "`users` 테이블은 RLS 대상이 아니다"라는 서술은 사실과 다르다.**
> `users` 는 `infra/migrations/versions/0002_phase1_schema.py` 의 `_RLS_TABLES` **첫 번째
> 항목**이며 `ENABLE/FORCE ROW LEVEL SECURITY` + `org_isolation_users` 정책이 적용된다.
> 실 Postgres 16(비 superuser 역할)에서 재현 확인: org 컨텍스트 없는 연결의 `users` 조회는
> **0행**이다. 즉 본 ADR 이 설계한 `AUTH_MODE=supabase` 경로는 그대로 배포하면 **모든 로그인이
> 403 으로 실패**한다.
>
> 오류의 원인: 2절이 근거로 인용한 파일은 `0001_initial_schema.py` 인데, `users` 는 0001 이
> 아니라 **0002 에서 처음 생성**된다. "인용한 목록에 없음"을 "RLS 비대상"으로 오독했다.
>
> 해소: **ADR 0007**(`docs/adr/0007-rls-operational-correctness.md`)이 `users`/`api_keys` 에
> 명령 분할 RLS 정책(SELECT 개방 + 쓰기 org 스코프 유지)을 도입해 본 ADR 의 인증 조회 계약을
> 성립시킨다. **ADR 0007 구현 완료가 `AUTH_MODE=supabase` 운영 배포의 선행 조건이다.**
> 아래 본문은 이력 보존을 위해 원문 그대로 둔다 — 2절/5절의 해당 근거 문장만 무효로 읽을 것.
> 상세는 문서 말미 "정정 이력" 절 참조.

- 상태(Status): **제안(Proposed)** — 스택 선택은 사용자가 최종 확정했으나(아래 "결정 배경"),
  실제 Supabase 프로젝트 생성·키 발급은 사용자/컬리버 운영진 몫이며 아직 완료되지 않았다.
  코드 구현은 본 ADR의 계약대로 즉시 착수 가능하나, `SUPABASE_URL`/`SUPABASE_JWT_SECRET` 등
  운영 키가 `.env`에 채워지기 전까지는 `AUTH_MODE=supabase` 경로를 실제 운영 환경에 배포할 수
  없다(테스트/개발은 `AUTH_MODE=test-local`로 계속 진행 가능 — 5절). 실 키 발급 후 이 ADR을
  Accepted로 전이한다.
- 결정권자: 사용자(최종 확정) — `docs/design/phase-3.md` 8.0절에서 architect는 자체 JWT
  로그인을 권고했으나, 스택 선택은 협약 최종 결정권자인 사용자 소관이며 사용자가 Supabase
  Auth를 명시적으로 선택했다. 본 ADR은 그 결정을 전제로 **설계를 확정**한다.
- 산식 무관: 인증 인프라 결정이므로 `data-kpi-engineer` 합의 게이트 대상 아님(CLAUDE Rule 1
  범위 밖). SOP 콘텐츠 검수처럼 선택적 자문 대상도 아니다.
- 날짜: 2026-07-07
- 작성: architect
- 관련: MASTER 5장("인증/RLS: Supabase Auth 또는 자체 JWT + Postgres RLS"), `CLAUDE.md`
  (스택 변경 시 ADR 필수, Hard Rule 4 멀티테넌시 격리, Rule 9 감사 로그),
  `docs/design/phase-3.md` 8.0절(갭 발견)/9절 슬라이스 O(대체됨 — 본 ADR + `phase-3-auth.md`가
  최신 계약), ADR 0002(불변성 강제 패턴 — 물리적 방어 철학 재사용)

## 맥락 (Context)

코드 감사 결과(phase-3.md 8.0절) 실 로그인(자격증명 검증 → 세션 발급) 경로가 시스템에 전혀
없다. 현재 `apps/api/app/deps.py::get_auth_context`는 HS256 대칭키로 서명된 JWT를 검증해
`org_id`/`role`/`user_id` 클레임을 그대로 신뢰하며, 이 토큰은 오직
`apps/api/tests/conftest.py::_make_token`(테스트 헬퍼)로만 발급된다. `users` 테이블은
`id, org_id, email, role`만 가지고 비밀번호 관련 컬럼이 없다.

architect는 8.0절에서 "이미 존재하는 JWT 검증 인프라를 재사용할 수 있다"는 근거로 자체 로그인
(bcrypt + `POST /auth/login`)을 권고했다. 그러나 **사용자가 최종 결정권자로서 Supabase Auth
통합을 선택**했다. MASTER 5장이 애초에 "Supabase Auth 또는 자체 JWT" 둘 다 후보로 열어
두었으므로 이는 MASTER 범위 내의 선택이며, ADR로 확정하는 것으로 충분하다(MASTER 개정 불요).

## 결정 (Decision)

### 1. JWT 검증 방식 — **HS256 공유 비밀(레거시 방식) 채택**, JWKS는 이번 범위에서 채택하지 않음

Supabase는 프로젝트별로 (a) 레거시 HS256 공유 비밀 또는 (b) JWKS 기반 비대칭키(ES256 등,
"JWT Signing Keys" 기능)를 선택할 수 있다. 본 ADR은 **(a) HS256 공유 비밀**을 계약으로
못박는다.

근거(과설계 금지 원칙, CLAUDE.md):
- 현재 `deps.py`의 `jwt.decode(token, secret, algorithms=[...])` 코드 경로를 **거의 그대로
  재사용**할 수 있다 — 검증 로직 자체는 "어떤 대칭 비밀을 쓰는가"만 바뀐다. 신규 의존성
  (`PyJWKClient`, JWKS 캐싱/재조회 로직, 콜드스타트 시 네트워크 호출)이 필요 없다.
- 검증이 완전히 오프라인·결정론적이다(외부 네트워크 호출 없음) — CLAUDE Rule 6(결정론)
  정신과도 정합적이고, 5절 테스트 전략(진짜 Supabase 없이 동일 메커니즘으로 합성 토큰 검증
  가능)을 크게 단순화한다.
- 파일럿 규모(사이트 소수, 조직 소수)에서 비대칭키 회전의 이점(비밀 유출 시 영향 범위 축소,
  키 회전 시 앱 재배포 불요)은 이번 Phase의 리스크 대비 낮다.

트레이드오프(결과 절에서 재확인): 공유 비밀 회전 시 앱의 `.env` 재배포가 필요하고, 비밀이
유출되면 임의 토큰 위조가 가능하다(비대칭키는 공개키만 배포하면 되므로 유출 표면이 다르다).
**Supabase가 향후 신규 프로젝트에 비대칭키를 기본값으로 전환하거나 레거시 공유 비밀 발급을
제한하면, 그 시점에 별도 ADR로 JWKS 검증으로 전환한다**(마이그레이션 트리거 조건으로 이 ADR에
명시).

검증 상세 계약(`deps.py` supabase 분기, backend-engineer 구현):
```python
payload = jwt.decode(
    token,
    settings.supabase_jwt_secret,
    algorithms=["HS256"],
    audience="authenticated",          # Supabase 발급 토큰의 표준 aud 클레임 — 다른 용도
                                        # 토큰(예: service_role) 오수용 방지(OWASP A07)
    options={"require": ["exp", "sub"]},
)
supabase_uid = str(payload["sub"])     # Supabase auth.users.id (UUID)
email = payload.get("email")
```
`org_id`/`role` 클레임은 Supabase JWT에 **없다**(2절 참고 — 의도적으로 굽지 않는다).

### 2. org_id/role 클레임 연계 — **Auth Hooks 커스텀 클레임 미채택, 매 요청 DB 조회 채택**

Supabase Auth Hooks("Custom Access Token" hook)로 JWT 발급 시 `org_id`/`role`을 주입하는
방법이 존재하지만 **채택하지 않는다**. 근거:

- Auth Hook은 Supabase 프로젝트 대시보드에 Postgres 함수를 등록하고 Supabase 인프라가 그
  함수를 호출하는 별도 운영 표면을 새로 여는 것이다 — 파일럿 규모에서 이 추가 인프라의
  가치보다 운영 복잡도 증가가 크다(과설계 금지).
- **더 중요한 이유**: `role`을 토큰에 구우면 토큰 만료(기본 1시간) 전까지 role 변경이
  반영되지 않는 stale-permission 문제가 생긴다. 이 프로젝트는 이미 정확히 같은 이유로
  `plan`을 토큰에 굽지 않고 `GET /auth/me`가 매 조회 시 DB에서 읽도록 설계되어 있다
  (`apps/api/app/routers/auth.py` 기존 docstring 참고 — "plan 이 토큰 만료 전에 바뀌어도
  즉시 반영되어야 한다"). `role`도 동일한 성격의 값(구독 다운그레이드/직원 권한 회수처럼
  즉시 반영되어야 하는 보안 민감 값)이므로 **같은 원칙을 적용**하는 것이 기존 설계와
  일관적이다.

**결정**: `get_auth_context`가 Supabase JWT 검증 후 **`users` 테이블을 조회**해 우리 도메인의
`org_id`/`role`/내부 `user_id`를 얻는다. `users` 테이블은 `_RLS_TABLES`
(`infra/migrations/versions/0001_initial_schema.py`)에 포함되어 있지 않다 — 즉 `users`에는
Postgres RLS 정책이 없으므로, org 컨텍스트(`app.current_org_id`)가 아직 세팅되지 않은
시점(로그인 직후, org_id를 아직 모름)에 이 조회를 실행해도 안전하게 동작한다(RLS에 막히지
않는다). 조회는 `supabase_user_id`(신규 컬럼, 3절) 단일 인덱스 조회 1회 — 파일럿 규모 NFR상
문제없다(`require_plan`이 매 요청 `organizations` 테이블을 조회하는 기존 패턴과 동급 비용).

`AuthContext.user_id`는 **Supabase `sub`(UUID)가 아니라 우리 `users.id`**를 담는다(기존
`audit_logs.actor_id`, `baselines.locked_by` 등 전 도메인이 이미 `users.id` 형식 문자열을
참조하므로 일관성 유지 — Supabase UUID를 도메인 전역에 흘리지 않는다, 경계를 `deps.py`에서
끊는다).

### 3. `users` 테이블 변경 — `password_hash` 대신 `supabase_user_id` 컬럼

8.0절이 제안했던 `password_hash` 컬럼은 폐기한다(비밀번호는 이제 Supabase `auth.users`가
전담). 대신 아래 컬럼을 추가한다(스키마 계약, 구현은 backend-engineer):

```sql
ALTER TABLE users ADD COLUMN supabase_user_id VARCHAR(64) NULL;
-- Supabase auth.users.id(UUID) 매핑. nullable = "초대되었으나 아직 첫 로그인 전"(4절) 상태 표현.
CREATE UNIQUE INDEX ux_users_supabase_user_id
  ON users (supabase_user_id) WHERE supabase_user_id IS NOT NULL;
-- 4절 "이메일로 미연계 행 탐색" 조회 성능(email 은 (org_id,email) 복합 유니크뿐,
-- 전역 email 조회 인덱스가 없었다 — 신규 추가).
CREATE INDEX ix_users_email ON users (email);
```
`email`/`org_id`/`role` 컬럼과 `ux_users_org_email` 유니크 제약은 변경 없음. 마이그레이션
파일 번호는 backend-engineer가 슬라이스 M(emission_factors/mrv_reports)과 조율해 다음 가용
번호(`infra/migrations/versions/` 현재 최신 `0007`)로 부여한다 — 두 슬라이스가 병행되면 번호
충돌 가능성이 있으므로 착수 시점에 상호 확인 필수.

### 4. 로그인/회원가입 흐름 — **초대 기반, 자동 프로비저닝 없음**

백엔드는 로그인 엔드포인트를 구현하지 않는다(`POST /auth/login`은 만들지 않는다 — 8.0절
초안은 폐기). FE가 `@supabase/supabase-js`로 Supabase에 직접 로그인하고, 발급된 JWT를
`Authorization: Bearer`로 우리 API에 보낸다.

**프로비저닝 계약(초대 기반, 과설계 금지로 최소 흐름)**:

1. **신규 관리용 엔드포인트**(owner 전용, 슬라이스 O 범위에 포함):
   ```
   POST /organizations/{org_id}/users
   Authorization: Bearer <JWT>   # require_writer + owner 한정(operator/viewer 403)
   { "email": "...", "role": "owner"|"operator"|"viewer" }
   ```
   `users` 행을 `supabase_user_id=NULL` 상태로 생성(="초대장" 역할, DB 밖 별도 초대 테이블을
   만들지 않는다 — `users` 행 자체가 초대 레코드를 겸함). 응답 201 + `audit_logs`(Rule 9,
   entity='users', action='invite'). `(org_id, email)` 유니크 위반 시 409.
   실제 Supabase 계정 생성(이메일 발송 포함)은 **이번 Phase 범위 밖** — 컬리버 운영진이
   Supabase 대시보드(또는 Admin API)로 별도 처리하는 오프라인 절차로 취급한다(phase-3.md
   7.4절 결제 흐름과 동일한 "B2B 오프라인 프로세스" 판단 논리 재사용).

2. **첫 로그인 시 자동 연계(lazy linking)**: `get_auth_context`의 supabase 분기에서
   `users.supabase_user_id == sub`로 조회했는데 없으면, JWT의 `email` 클레임으로
   `users` 중 `supabase_user_id IS NULL AND email = :email`을 조회한다.
   - **정확히 1건** 매칭 → 그 행에 `supabase_user_id = sub`를 채운다(단일 UPDATE, 같은
     요청 트랜잭션 내에서 커밋). `audit_logs`(entity='users', action='link', actor_id=해당
     users.id) 기록. 이후 정상적으로 `AuthContext` 구성해 요청 계속 처리.
   - **0건** 매칭 → `403 "no invitation found for this account"`(토큰 자체는 유효하므로
     401이 아니라 403 — "신원은 확인됐으나 이 조직에 대한 권한 부여가 없다"는 의미를
     정확히 반영, OWASP A01 성격).
   - **2건 이상** 매칭(한 이메일이 서로 다른 org에 각각 초대된 엣지 케이스) →
     `409 "ambiguous invitation across multiple organizations, contact administrator"`.
     자동으로 임의 선택하지 않는다(잘못된 org에 잘못 연계되면 멀티테넌시 사고와 동급 —
     안전한 실패를 택한다). 이 케이스의 해소(예: org 선택 UI)는 **이번 Phase 범위 밖**으로
     명시 보류(파일럿 규모에서 한 사람이 두 고객사에 동시 소속될 가능성은 낮다).
3. **최초 org/owner 생성**(그린필드 조직 자체의 최초 가입)은 이번 Phase 범위 밖 — 지금까지와
   동일하게 컬리버 운영진이 시드/수동 프로비저닝한다(자기 서비스 org 가입 플로우는 MASTER
   어디에도 요구되지 않음, B2B 영업 프로세스로 판단 — phase-3.md 7.4절과 동일 논리).

### 5. ★테스트 전략 — `AUTH_MODE` 이중 검증 경로 (권장안 채택)

`Settings`에 `auth_mode: str = "test-local"` 필드를 추가한다. 값은 `"test-local"` 또는
`"supabase"` 둘 중 하나만 허용(그 외 값은 설정 로드 시 `ValueError`로 즉시 실패).

```python
# app/config.py (계약, 구현은 backend-engineer)
class Settings(BaseSettings):
    ...
    auth_mode: Literal["test-local", "supabase"] = "test-local"
    supabase_jwt_secret: str = ""
    supabase_url: str = ""

    @model_validator(mode="after")
    def _guard_production_auth_mode(self) -> "Settings":
        if self.environment == "production" and self.auth_mode != "supabase":
            raise ValueError(
                "production 환경에서는 AUTH_MODE=supabase 가 필수다 "
                "(test-local 경로가 운영에 노출되는 것을 설정 로드 시점에 차단, ADR 0005)"
            )
        if self.auth_mode == "supabase" and not self.supabase_jwt_secret:
            raise ValueError("AUTH_MODE=supabase 인데 SUPABASE_JWT_SECRET 이 비어 있다")
        return self
```
이 검증은 **설정 로드 시점**(앱 프로세스 기동 즉시, `get_settings()` 최초 호출)에 실패하므로
"프로덕션에 test-local이 실수로 떠 있는" 상태 자체가 물리적으로 불가능하다(ADR 0002의 "관례가
아닌 물리적 강제" 철학을 설정 계층에 동형 적용).

`get_auth_context`는 `settings.auth_mode`로 분기한다:
```python
def get_auth_context(credentials=..., session: Session = Depends(_get_unscoped_db)) -> AuthContext:
    if settings.auth_mode == "test-local":
        # 기존 코드 그대로: HS256 + settings.jwt_secret, 클레임에서 org_id/role/user_id 직접 추출.
        ...
    else:  # "supabase"
        # 1절 검증 + 2절 DB 조회/4절 lazy-link 분기.
        ...
```
**`conftest.py::_make_token`과 24개 이상 테스트 파일은 변경 없음** — 테스트는 계속
`AUTH_MODE=test-local`(`.env`/환경변수 미설정 시 기본값)로 돌며, 기존 `_make_token`이 만드는
"org_id/role/user_id를 직접 담은 HS256 토큰"이 그대로 유효하다.

**신규 테스트(슬라이스 O 수용 기준에 포함)**는 `AUTH_MODE=supabase`로 별도 테스트 모듈
(`tests/test_auth_supabase.py`)을 두고, `settings.supabase_jwt_secret`에 테스트용 값을 넣어
**합성 Supabase-형 JWT**(`sub`, `email`, `aud="authenticated"` 클레임을 담은 HS256 토큰, 진짜
Supabase 프로젝트 불요 — 검증 메커니즘이 순수 HS256 디코드이므로 로컬에서 완전히 재현 가능)로
lazy-linking 3가지 분기(0건/1건/2건 매칭)와 정상 흐름을 검증한다. **GoTrue 에뮬레이터나 실제
Supabase 프로젝트를 띄우지 않는다**(과설계 금지 — 1절에서 JWKS 대신 HS256을 택한 이유가
여기서도 그대로 이득으로 돌아온다: 검증 로직이 오프라인이라 테스트도 오프라인으로 충분하다).
추가로 `test_config.py`에 `_guard_production_auth_mode` 단위 테스트(환경=production +
auth_mode=test-local 조합이 `ValueError`를 내는지) 1건을 둔다.

**`get_db`/`get_auth_context` 의존성 그래프 변경 주의**: 현재 `get_db`는
`Depends(get_auth_context)`에 의존하고(org_id를 알아야 세션에 바인딩 가능), supabase 분기의
`get_auth_context`는 반대로 `users` 조회를 위해 세션이 먼저 필요하다(순환 의존 위험). 계약:
`get_auth_context`는 **org 컨텍스트가 세팅되지 않은 별도의 "unscoped" 세션 의존성**
(`_get_unscoped_db`, `set_org_context` 호출 없이 `SessionLocal()`만 열고 닫는 헬퍼, `users`
테이블이 RLS 미대상이므로 안전 — 2절 근거 재사용)을 쓰고, 기존 `get_db`(org 컨텍스트 바인딩)는
지금처럼 `get_auth_context` 결과의 `org_id`로 세션을 바인딩하는 별개 의존성으로 유지한다.
이 두 의존성 체인 분리는 backend-engineer가 `deps.py` 구현 시 반드시 지켜야 하는 계약이다
(순환 임포트/순환 Depends를 만들지 않는 것이 목적).

### 6. FE 계약 — `@supabase/supabase-js` 도입, 범위는 로그인+세션 유지로 최소화

`apps/web`에 `@supabase/supabase-js`를 신규 의존성으로 추가한다(`package.json`). 범위는
**로그인 페이지 + 세션 유지**로 좁힌다(회원가입/비밀번호 재설정 UI는 이번 Phase 범위 밖 —
4절의 초대 기반 흐름상 셀프서비스 가입 자체가 없다).

신규/변경 파일 계약:
- `apps/web/src/lib/supabase-client.ts`(신규): `createClient(VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY)` 싱글턴 생성. anon key는 공개 가능한 값(Supabase 설계상 anon key는
  클라이언트 노출 전제 — RLS/서버 검증이 실제 방어선, Rule 7 "비밀값" 범주 아님).
- `apps/web/src/lib/api-client.ts::getAuthToken()`(변경): 기존 `localStorage.getItem
  ("culiver.jwt")` 읽기를 **모듈 스코프 캐시 변수**로 교체한다. `supabase-client.ts`가 앱
  부트스트랩 시 `supabase.auth.onAuthStateChange((event, session) => { cachedToken =
  session?.access_token ?? null })`를 구독해 캐시를 갱신하고, `getAuthToken()`은 그 캐시를
  동기 반환한다(기존 함수 시그니처 `(): string | null` 불변 — api-client.ts 기존 주석
  "인증 모듈(Supabase 등)이 붙으면 이 함수만 교체한다"가 정확히 이 지점을 가리키고 있었다).
  세션 자동 갱신(refresh token)은 `@supabase/supabase-js`가 내부적으로 처리(신규 코드 불요).
- `apps/web/src/features/auth/LoginPage.tsx`(신규): 이메일+비밀번호 폼 →
  `supabase.auth.signInWithPassword({ email, password })`. 성공 시 라우팅(온보딩/대시보드로
  이동, 기존 라우터 재사용). 실패 시 Supabase 에러 메시지를 그대로 노출(계정 존재 여부 노출은
  Supabase Auth 표준 응답 형태를 따른다 — 이 부분의 정책은 Supabase 기본값을 그대로 신뢰,
  별도 마스킹 레이어는 과설계).
- `apps/web/src/hooks/useAuth.ts`(변경, ★설계상 중요 포인트): Supabase JWT에는
  `org_id`/`role`이 **없다**(2절 결정 — Auth Hook 미채택). 따라서 기존 `decodeJwtClaims`로
  role/org_id를 얻는 로직은 더 이상 유효하지 않다. `useAuth`를 기존 `useAuthMe()`
  (`GET /auth/me`, 이미 존재)의 결과를 1차 소스로 쓰도록 재구성한다:
  `role`/`orgId`/`userId`/`plan`은 `useAuthMe()` 쿼리 결과에서, `isAuthenticated`(토큰 존재
  여부)는 Supabase 세션 존재 여부(`supabase.auth.getSession()` 또는 `onAuthStateChange` 구독
  상태)에서 가져온다. 이는 우연이 아니라 **기존 설계와 일관적** — `GET /auth/me`가 이미
  "토큰에 plan을 굽지 않고 매 조회 시 DB에서 읽는다"는 정확히 같은 이유로 존재했다(2절에서
  role에도 동일 논리를 적용한 것과 대칭).
- `apps/web/src/lib/jwt.ts`: `readStoredToken`은 더 이상 쓰이지 않으므로 제거(또는
  `supabase-client.ts`로 대체). `decodeJwtClaims`는 `exp`/`sub`/`email` 등 UI 디버그 용도로만
  남기고, **`role`/`org_id`/`user_id`를 이 함수 반환값에서 읽는 모든 호출부를 제거**한다
  (실제 값이 더 이상 이 토큰에 없으므로 방치하면 조용히 `null`을 반환해 권한 게이팅이 항상
  "미인증"으로 오작동한다 — 반드시 함께 치워야 하는 세트).
- 신규 관리 화면(4절 `POST /organizations/{org_id}/users` 초대 폼)은 이번 슬라이스 O
  필수 범위가 아니다(P1로 미룰 수 있음 — API가 먼저 존재하면 `curl`/관리 스크립트로도 파일럿
  운영이 가능하다, 과설계 금지). 필요 시 온보딩 마법사(phase-3.md 7절) 다음 반복에서 추가.

### 7. 환경변수 계약

`infra/.env.example` 추가(백엔드):
```
# --- Auth (Phase 3 슬라이스 O, ADR 0005) ---
# test-local | supabase. production 환경에서는 supabase 가 필수(설정 로드 시 강제, 5절).
AUTH_MODE=test-local
# Supabase 프로젝트 설정 > API > JWT Secret(레거시 HS256 공유 비밀). AUTH_MODE=supabase 일 때 필수.
SUPABASE_JWT_SECRET=
# 참고용(현재 백엔드 코드는 사용하지 않음 — 향후 Admin API 연동 시 필요해질 수 있어 자리만 확보).
SUPABASE_URL=
```
기존 `JWT_SECRET`/`JWT_ALGORITHM`은 그대로 유지(`AUTH_MODE=test-local` 경로가 계속
사용하므로 — 테스트/개발 전용으로 의미가 좁혀짐, 값 자체는 변경 없음).

`apps/web/.env.example` 추가(프론트엔드):
```
# --- Supabase Auth (Phase 3 슬라이스 O, ADR 0005) ---
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

## 대안 (Alternatives considered)

- **JWKS/비대칭키(ES256) 검증**: 보안·회전 측면에서 우수하나 신규 의존성(`PyJWKClient` 또는
  동등 라이브러리)·네트워크 캐싱 로직·테스트 인프라(합성 토큰 서명이 개인키 발급을 요구,
  HS256보다 무겁다) 비용이 파일럿 규모 대비 과도하다고 판단해 기각. Supabase가 레거시 HS256
  공유 비밀 발급을 중단하거나 이 프로젝트가 사이트 규모를 크게 늘리는 시점에 재검토(마이그레이션
  트리거로 이 ADR에 명시).
- **Supabase Auth Hooks로 `org_id`/`role`을 JWT에 주입**: 2절에서 기각(운영 표면 증가 +
  기존 `GET /auth/me` 설계와의 stale-value 철학 불일치).
- **테스트가 실제 Supabase 프로젝트/로컬 GoTrue 에뮬레이터를 구동**: 5절에서 기각(무거움,
  CI 인프라 신규 요구, 100개 이상 기존 테스트에 영향 없는 대안이 이미 존재하므로 불필요한
  리스크).
- **자동 회원가입(첫 로그인 시 `users` 행 자동 생성, org_id는 임의/기본값)**: 4절에서 기각 —
  멀티테넌시 경계(누구를 어느 org에 배정할지)를 시스템이 추측하게 만드는 것은 Rule 4
  정신에 반한다. 초대 기반이 파일럿 규모에서 더 안전하다(사용자 프롬프트가 이미 이 방향을
  제안).
- **`password_hash` 컬럼 유지(자체 로그인과 Supabase 병행)**: 인증 소스 이원화는 "어느 쪽이
  진실인가"에 대한 혼란과 이중 유지보수 비용을 낳는다. 완전 전환이 명확하므로 기각.

## 결과 (Consequences)

- (+) 기존 `deps.py`의 HS256 검증 코드·`_make_token` 기반 100개 이상 테스트가 **회귀 없이**
  유지된다(5절).
- (+) `role`/`plan`을 토큰에 굽지 않는 기존 설계 철학(`GET /auth/me`)과 `org_id`/`role`
  처리 방식이 대칭적으로 일관된다.
- (+) `users` 테이블이 초대 레코드를 겸해 별도 invitations 테이블 없이 최소 스키마로 초대
  흐름을 구현한다(과설계 회피).
- (−) FE `useAuth`가 JWT 디코드 단독에서 `GET /auth/me` 네트워크 호출 의존으로 바뀌어, 로그인
  직후 아주 짧은 로딩 상태가 생긴다(수용 가능 — 기존에도 `usePlan`/`useAuthMe`가 이미 같은
  패턴으로 존재).
- (−) 공유 비밀(HS256) 회전 시 앱 재배포가 필요하다(1절 트레이드오프, 파일럿 규모에서 수용).
- (−) "한 이메일이 두 org에 동시 초대된" 엣지 케이스는 이번 Phase에서 안전하게 거부만 하고
  해소하지 않는다(4절, 알려진 제약으로 문서화).
- 후속(다음 ADR 트리거 조건): (a) Supabase가 레거시 HS256 발급을 제한/중단하는 경우,
  (b) 파일럿 규모를 넘어 조직당 여러 site별 세분화 권한이나 다중 org 소속 사용자가 실제
  요구사항이 되는 경우 — 그때 각각 별도 ADR로 JWKS 전환/권한 모델 확장을 다룬다.

## 실행 전제(사용자 확인 필요 항목, Proposed 상태 사유)

- [ ] Supabase 프로젝트 생성(사용자/컬리버 운영진).
- [ ] 프로젝트 설정 > API에서 **레거시 JWT Secret 발급 활성화**(신규 Supabase 프로젝트가
  기본적으로 비대칭키만 제공하는 경우, 설정에서 레거시 HS256 공유 비밀을 활성화해야 함 —
  이 항목은 사용자가 Supabase 대시보드에서 직접 확인/조작해야 하는 부분이며 architect가
  대신 확인할 수 없다).
- [ ] `SUPABASE_JWT_SECRET`/`SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` 값을 각각 `infra/.env`,
  `apps/web/.env`(커밋 금지)에 채움.
- [ ] **(2026-08-29 추가) ADR 0007 구현 완료** — `users` RLS 명령 분할 정책(마이그레이션 0013) +
      `_lazy_link` org 컨텍스트 바인딩. **이것 없이는 위 항목을 전부 채워도 로그인이 403 으로
      실패한다**(상단 정정 고지). 사용자 확인 항목이 아니라 개발 선행 작업이다.
- 위 항목이 완료되기 전까지 `AUTH_MODE=supabase`는 코드상 구현되어 있어도 **실제 운영 배포는
  불가**(5절 `_guard_production_auth_mode`가 값 부재 시 기동을 막는다 — 안전한 기본 실패).
  구현/테스트(`AUTH_MODE=test-local`)는 이 전제와 무관하게 즉시 진행 가능.

---

## 정정 이력 (Corrections)

### 2026-08-29 — 2절/5절 "`users` 는 RLS 비대상" 서술 무효 (ADR 0007)

| 항목 | 원문 서술(무효) | 실측 사실 |
|---|---|---|
| 2절 | "`users` 테이블은 `_RLS_TABLES`(`0001_initial_schema.py`)에 포함되어 있지 않다 — 즉 `users`에는 Postgres RLS 정책이 없으므로 ... 안전하게 동작한다(RLS에 막히지 않는다)" | `users` 는 **0002** `_RLS_TABLES` 의 첫 항목. `relrowsecurity=t, relforcerowsecurity=t`, 정책 `org_isolation_users` 존재. org 컨텍스트 없는 조회 → **0행** |
| 5절 | "`users` 테이블이 RLS 미대상이므로 안전 — 2절 근거 재사용" (`_get_unscoped_db` 계약) | 동일하게 무효. `_get_unscoped_db` 는 ADR 0007 의 `users_select_open` 정책이 있어야 비로소 성립한다 |

무효화되는 것은 **근거 문장뿐이며 결정 자체는 유지**된다:
- 2절 결정("`role`/`org_id` 를 토큰에 굽지 않고 매 요청 `users` 를 DB 조회한다") — **유지**.
- 5절 결정(`get_auth_context` 는 org 미바인딩 세션을 쓴다, 순환 Depends 방지) — **유지**.
- ADR 0007 이 DB 정책을 그 결정에 맞춰 교정한다(SELECT 개방 + INSERT/UPDATE/DELETE org 스코프).

추가 파급(본 ADR 4절 관련): `_lazy_link` 의 `users` UPDATE 와 `audit_logs`(action='link') INSERT 는
**org 컨텍스트를 요구**한다. ADR 0007 C3 이 "후보 1건 확정 직후 `set_org_context(session,
candidate.org_id)` 를 먼저 호출한다"를 계약으로 못박았다.
