# Phase 3 슬라이스 O — Supabase Auth 통합 설계 (로그인 발급)

- 작성: architect
- 날짜: 2026-07-07
- 상태: **설계 확정, 구현 착수 가능**(ADR 0005: Proposed — 운영 키 발급은 사용자 몫, 4절 참고)
- 기준 문서: `docs/design/phase-3.md` 8.0절(갭 발견)/9절 슬라이스 O(본 문서로 대체·구체화),
  `docs/adr/0005-supabase-auth-integration.md`(결정 근거 전문 — 본 문서는 **구현 계약**에
  집중, 근거/대안은 ADR을 인용만 한다)
- 배경: `phase-3.md` 8.0절에서 architect는 자체 JWT 로그인(bcrypt + `POST /auth/login`)을
  권고했으나, 최종 결정권자인 사용자가 **Supabase Auth**를 명시적으로 선택했다(MASTER 5장이
  애초에 두 옵션을 모두 후보로 열어 두었으므로 MASTER 개정은 불요, ADR 0005로 확정).

> 이 문서는 `phase-3.md` 9절 "슬라이스 O"를 대체한다. `phase-3.md` 본문은 이 문서를 가리키는
> 요약만 남긴다(중복 방지). 산식/도메인 로직 변경 없음 — 인증 인프라 전환만 다룬다.

---

## 1. 스키마 변경 (`apps/api/app/models/user.py` + 신규 마이그레이션)

```python
# app/models/user.py — 변경분만
class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("org_id", "email", name="ux_users_org_email"),
    )
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    org_id: Mapped[str] = mapped_column(String(64), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="viewer")
    # 신규: Supabase auth.users.id(UUID) 매핑. NULL = "초대는 됐으나 아직 첫 로그인 전"(3.2절).
    supabase_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
```

마이그레이션(다음 가용 번호 — 슬라이스 M과 번호 충돌 여부 backend-engineer 상호 확인):
```sql
ALTER TABLE users ADD COLUMN supabase_user_id VARCHAR(64) NULL;
CREATE UNIQUE INDEX ux_users_supabase_user_id ON users (supabase_user_id) WHERE supabase_user_id IS NOT NULL;
CREATE INDEX ix_users_email ON users (email);
```
`password_hash` 컬럼은 **추가하지 않는다**(8.0절 초안 폐기 — ADR 0005 결정 4).
> **정정(2026-08-29, ADR 0007)** — 원문: "`users`는 RLS 대상 테이블 목록
> (`0001_initial_schema.py` `_RLS_TABLES`)에 없다 — 이번 변경도 이 상태를 유지한다."
> **사실과 다르다.** `users` 는 **0002**`_phase1_schema.py` 의 `_RLS_TABLES` 첫 항목이며
> `ENABLE/FORCE ROW LEVEL SECURITY` + `org_isolation_users` 가 적용된다(0001 을 인용한 것이
> 오류의 원인 — `users` 는 0001 에 아직 존재하지 않는다). 실 Postgres 재현 결과 org 컨텍스트
> 없는 조회는 0행이다.
> **현재 계약**: `users` 는 RLS 대상으로 **유지**하되, 마이그레이션 0013(ADR 0007 1절)이 정책을
> 명령별로 분할해 **SELECT 만 개방**하고 INSERT/UPDATE/DELETE 는 org 스코프를 물리 강제한다.
> 따라서 아래의 "org_id 를 모르는 시점의 조회"는 성립하지만, **같은 세션에서 쓰기를 하려면
> `set_org_context` 를 먼저 호출해야 한다**(`_lazy_link` 필수 계약 — ADR 0007 C3).

---

## 2. `app/config.py` 계약

```python
from typing import Literal
from pydantic import model_validator

class Settings(BaseSettings):
    ...
    auth_mode: Literal["test-local", "supabase"] = "test-local"
    supabase_jwt_secret: str = ""
    supabase_url: str = ""

    @model_validator(mode="after")
    def _guard_production_auth_mode(self) -> "Settings":
        if self.environment == "production" and self.auth_mode != "supabase":
            raise ValueError(
                "production 환경에서는 AUTH_MODE=supabase 가 필수다 (ADR 0005)"
            )
        if self.auth_mode == "supabase" and not self.supabase_jwt_secret:
            raise ValueError("AUTH_MODE=supabase 인데 SUPABASE_JWT_SECRET 이 비어 있다")
        return self
```
`environment == "production"`인 배포에서 `auth_mode`가 `supabase`가 아니면 **설정 로드
시점에 프로세스가 기동하지 않는다**(ADR 0005 5절, ADR 0002와 동형의 물리적 강제).

---

## 3. `app/deps.py` 계약

### 3.1 의존성 그래프(순환 방지, ★구현 시 반드시 지킬 제약)

```
_get_unscoped_db()       # org 컨텍스트 미바인딩. SessionLocal() 열고 닫기만.
        │
        ▼
get_auth_context()        # JWT 검증 + (supabase 모드일 때만) users 조회/lazy-link.
        │  AuthContext(org_id, role, user_id)
        ▼
get_db()                  # 기존 그대로: SessionLocal() + set_org_context(auth.org_id).
```
`get_db`가 `get_auth_context`에 의존하는 기존 방향은 유지한다. `get_auth_context`가 DB가
필요할 때는 (org_id를 아직 모르므로) `get_db`를 재사용하지 않고 `_get_unscoped_db` 전용
의존성을 새로 쓴다(순환 Depends 방지).

> **정정(2026-08-29, ADR 0007)** — 원문의 "`users`가 RLS 미대상이므로 unscoped 조회가
> 안전하다(ADR 0005 2절)"는 근거는 **무효**다. unscoped 조회가 안전한 진짜 근거는 마이그레이션
> 0013 의 `users_select_open` 정책(`FOR SELECT USING (true)`)이다(ADR 0007 1절). `_get_unscoped_db`
> 세션은 **읽기 전용으로만** 쓸 수 있으며, `_lazy_link` 처럼 쓰기가 필요하면 후보 행에서 얻은
> `org_id` 로 `set_org_context` 를 먼저 호출해야 한다(그렇지 않으면 `users` UPDATE 는 조용히 0행,
> `audit_logs` INSERT 는 RLS 위반으로 거부된다 — 실측 확인).

### 3.2 `get_auth_context` 분기

```python
def get_auth_context(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    session: Session = Depends(_get_unscoped_db),
) -> AuthContext:
    if credentials is None or not credentials.credentials:
        raise HTTPException(401, "missing bearer token", headers={"WWW-Authenticate": "Bearer"})
    settings = get_settings()

    if settings.auth_mode == "test-local":
        # 기존 코드 100% 그대로 — org_id/role/user_id 클레임 직접 신뢰.
        payload = _decode(credentials.credentials, settings.jwt_secret, "HS256")
        org_id = payload.get("org_id")
        if not org_id:
            raise HTTPException(401, "token missing org_id claim")
        return AuthContext(
            org_id=str(org_id),
            role=str(payload.get("role", "viewer")),
            user_id=str(payload.get("user_id", payload.get("sub", "unknown"))),
        )

    # settings.auth_mode == "supabase"
    payload = _decode(
        credentials.credentials, settings.supabase_jwt_secret, "HS256",
        audience="authenticated", options={"require": ["exp", "sub"]},
    )
    supabase_uid = str(payload["sub"])
    email = payload.get("email")

    user_row = session.execute(
        select(User).where(User.supabase_user_id == supabase_uid)
    ).scalar_one_or_none()

    if user_row is None:
        user_row = _lazy_link(session, supabase_uid, email)  # 3.3절, 없으면 403/409 raise

    return AuthContext(org_id=user_row.org_id, role=user_row.role, user_id=user_row.id)
```
`_decode`는 `jwt.decode` 래퍼(만료/서명 오류를 401로 변환하는 기존 로직 그대로 재사용).

### 3.3 `_lazy_link` (첫 로그인 자동 연계, ADR 0005 4절)

```python
def _lazy_link(session: Session, supabase_uid: str, email: str | None) -> User:
    if not email:
        raise HTTPException(403, "no invitation found for this account")
    candidates = session.execute(
        select(User).where(User.email == email, User.supabase_user_id.is_(None))
    ).scalars().all()
    if len(candidates) == 0:
        raise HTTPException(403, "no invitation found for this account")
    if len(candidates) > 1:
        raise HTTPException(409, "ambiguous invitation across multiple organizations, contact administrator")
    user_row = candidates[0]
    before = None
    user_row.supabase_user_id = supabase_uid
    session.add(AuditLog(
        id=f"audit-{uuid4()}", org_id=user_row.org_id, entity="users",
        entity_id=user_row.id, action="link", actor_id=user_row.id,
        diff_json={"before": before, "after": {"supabase_user_id": supabase_uid}},
    ))
    session.commit()
    return user_row
```
(`AuditLog` 필드명은 기존 `audit_logs` 스키마에 맞춰 backend-engineer가 실제 컬럼명으로
조정 — 여기서는 계약 형태만 못박는다.)

---

## 4. 신규 엔드포인트 — 초대(invite)

```
POST /organizations/{org_id}/users
Authorization: Bearer <JWT>   # require_writer + owner 한정(operator/viewer 403)
{ "email": "user@example.com", "role": "owner"|"operator"|"viewer" }
```
처리: 3중 테넌시 방어(`org_id` 경로 파라미터 == `auth.org_id`, 아니면 404) → `role` 값
검증(그 외 422) → `(org_id, email)` 유니크 위반 시 409 → `supabase_user_id=NULL`로 삽입 →
`audit_logs`(action='invite') → 201.
```jsonc
// 201 응답
{ "id": "user-...", "org_id": "...", "email": "...", "role": "...", "linked": false }
```
`GET /organizations/{org_id}/users`(초대 목록, `linked` = `supabase_user_id IS NOT NULL`
여부)는 이번 슬라이스 필수 범위는 아니다(P1, 운영 확인용 — 필요 시 QA 단계에서 backend-engineer
판단으로 추가해도 계약 위반 아님, 단순 조회이므로 architect 재확인 불요).

실 Supabase 계정 생성(이메일 발송)은 이 엔드포인트가 하지 않는다(ADR 0005 4절 — 오프라인
운영 절차).

---

## 5. FE 계약 요약 (전문은 ADR 0005 6절)

- 신규 의존성: `@supabase/supabase-js`.
- 신규: `apps/web/src/lib/supabase-client.ts`, `apps/web/src/features/auth/LoginPage.tsx`.
- 변경: `apps/web/src/lib/api-client.ts::getAuthToken()`(Supabase 세션 캐시로 소스 교체,
  시그니처 불변), `apps/web/src/hooks/useAuth.ts`(role/orgId/userId를 `useAuthMe()` 소스로
  전환 — Supabase JWT엔 이 클레임들이 없음), `apps/web/src/lib/jwt.ts`(`readStoredToken`
  제거, `decodeJwtClaims`는 디버그용 `exp`/`sub`/`email`만 남김).
- 범위 제외(P1 이후): 회원가입/비밀번호 재설정 UI, 초대 관리 화면(4절 API는 curl/스크립트로도
  파일럿 운영 가능).

---

## 6. 환경변수 (전문은 ADR 0005 7절)

`infra/.env.example`: `AUTH_MODE`, `SUPABASE_JWT_SECRET`, `SUPABASE_URL`.
`apps/web/.env.example`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

---

## 7. 테스트 전략 (전문은 ADR 0005 5절)

- 기존 `apps/api/tests/conftest.py::_make_token` 및 이를 쓰는 전 테스트 파일: **무변경**
  (`AUTH_MODE=test-local` 기본값 유지).
- 신규 `apps/api/tests/test_auth_supabase.py`: `AUTH_MODE=supabase` + 테스트용
  `SUPABASE_JWT_SECRET`로 합성 JWT(`sub`/`email`/`aud="authenticated"`) 발급 → lazy-link
  0건(403)/1건(정상 연계+재요청 시 재조회 없이 바로 통과)/2건(409) 분기 + 정상 로그인 흐름
  테스트. 실제 Supabase/GoTrue 불요.
- 신규 `apps/api/tests/test_config.py`(또는 기존 파일에 추가): `environment="production"`
  + `auth_mode="test-local"` 조합이 `Settings()` 생성 시 `ValueError`를 내는지 단위 테스트.

---

## 8. 수용 기준 (슬라이스 O, `phase-3.md` 9절 대체)

- `AUTH_MODE=test-local`에서 기존 100개 이상 테스트 **전부 green**(회귀 없음, ★최우선 게이트).
- `AUTH_MODE=supabase` 신규 테스트: 정상 로그인(연계 완료 후 재요청) 200, 미초대 계정 403,
  이중 초대 409, `aud` 클레임 불일치/만료 토큰 401.
- `environment=production` + `auth_mode=test-local` 조합 기동 실패(`ValueError`) 확인.
- `POST /organizations/{org_id}/users`: owner만 성공(operator/viewer 403), 중복 이메일 409,
  `audit_logs` 기록 확인, 3중 테넌시 방어(타 org_id 경로 파라미터 404).
- FE: 로그인 성공 시 대시보드 진입, 실패 시 에러 메시지 노출, 새로고침 후 세션 유지(Supabase
  자동 갱신), `useAuth` 기반 권한 게이팅(잠금/입력 버튼)이 `GET /auth/me` 값 기준으로 정확히
  동작.
- 누수 테스트: 다른 org owner가 타 org에 `POST /organizations/{org_id}/users` 호출 시 404.

## 9. 위임

- **backend-engineer**: 1~4절(스키마 마이그레이션, `config.py`, `deps.py`, 초대 엔드포인트),
  `.env.example` 갱신, 7절 신규 테스트.
- **frontend-engineer**: 5절(로그인 페이지, `api-client`/`useAuth`/`jwt.ts` 갱신).
- **qa-reviewer**: 8절 수용 기준 전체 게이트, ★특히 "기존 테스트 회귀 없음"과 "production
  가드"를 최우선 확인 항목으로 검증.
- 계약(본 문서 1~7절)은 architect가 못박았다 — 구현 중 변경이 필요하면 architect에 되돌려
  합의한다(산식 변경 없으므로 data-kpi-engineer 합의는 불요).
