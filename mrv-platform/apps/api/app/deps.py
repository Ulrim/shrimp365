"""인증/테넌시 의존성 — sprint-0 2.3절 3중 방어의 1번째 계층(인증).

- Bearer JWT 에서 org_id/role/user_id 를 얻는다. `settings.auth_mode` 로 두 경로 분기
  (Phase 3 슬라이스 O, ADR 0005 / `docs/design/phase-3-auth.md` 3절):
    - "test-local"(기본값): 기존 코드 그대로 — HS256(대칭키 `jwt_secret`)으로 서명된 토큰의
      org_id/role/user_id 클레임을 직접 신뢰한다(스프린트 0 2.5절 관례, 100개 이상 기존
      테스트가 이 경로만 사용 — 절대 회귀 금지).
    - "supabase": Supabase 발급 HS256 JWT(`supabase_jwt_secret`, aud="authenticated")를
      검증해 `sub`(Supabase UUID)를 얻고, `users.supabase_user_id` 로 우리 도메인의
      org_id/role/user_id 를 조회한다(매 요청 DB 조회 — role/plan 을 토큰에 굽지 않는
      기존 `GET /auth/me` 철학과 대칭, ADR 0005 2절). 최초 로그인 시 미연계 상태면
      `_lazy_link` 로 이메일 기반 자동 연계를 시도한다(3절).
- 인증 성공 후 DB 세션에 org_id 컨텍스트(SET app.current_org_id)를 바인딩한다(2번째 계층,
  `get_db`). `get_auth_context` 자체는 org_id 를 아직 모르는 시점에 실행될 수 있으므로
  (특히 supabase 분기의 users 조회) `get_db` 를 재사용하지 않고 org 컨텍스트 미바인딩
  `_get_unscoped_db` 를 쓴다(순환 Depends 방지, ADR 0005 5절).
  ★ `users` 는 **RLS 대상 테이블이다**(마이그레이션 0002 `_RLS_TABLES` 첫 항목,
  `ENABLE/FORCE ROW LEVEL SECURITY` 적용). unscoped 조회가 성립하는 근거는 "RLS 비대상"이
  아니라 **마이그레이션 0013 의 명령 분할 정책 `users_select_open`(ADR 0007 1절)** 이다 —
  SELECT 만 개방되고 INSERT/UPDATE/DELETE 는 여전히 org 스코프로 물리 강제된다.
  (ADR 0005 2절/5절의 "users 는 RLS 비대상" 서술은 사실과 다르며 ADR 0007 이 정정했다.)
- 토큰 없음/검증 실패 → 401.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.session import SessionLocal, set_org_context
from app.models.user import User
from app.services.audit import record_audit

# auto_error=False 로 두어 토큰 부재를 직접 401 로 처리(메시지 일관성).
_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class AuthContext:
    """인증된 요청 컨텍스트(요청 스코프에 주입)."""

    org_id: str
    role: str
    user_id: str


def _get_unscoped_db() -> Iterator[Session]:
    """org 컨텍스트를 바인딩하지 않는 DB 세션(ADR 0005 5절 순환 Depends 방지 계약).

    `SessionLocal()` 을 열고 닫기만 한다(`set_org_context` 호출 없음). `get_auth_context`
    가 org_id 를 아직 모르는 시점(로그인 직후)에 `users` 를 조회할 때만 쓴다.

    ★ 정정(ADR 0007 1절): `users` 는 **RLS 대상 테이블이다**(0002 `_RLS_TABLES`).
    이 세션으로 조회가 가능한 이유는 마이그레이션 0013 의 명령 분할 정책
    `users_select_open`(`FOR SELECT USING (true)`)이 **SELECT 만** org 컨텍스트 없이
    허용하기 때문이다. 쓰기 정책(`users_insert_org`/`_update_org`/`_delete_org`)은 그대로
    org 스코프로 강제된다.

    ⚠ 따라서 **이 세션으로 쓰기를 하려면 반드시 `set_org_context(session, org_id)` 를 먼저
    호출해야 한다.** 그러지 않으면 UPDATE 는 조용히 0행이 되고(`_lazy_link` 실측), 함께 쓰는
    `audit_logs`(여전히 `FOR ALL` org 스코프 정책) INSERT 는 RLS 위반으로 거부된다.
    """
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _decode(
    token: str,
    secret: str,
    algorithm: str,
    *,
    audience: str | None = None,
    options: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """`jwt.decode` 래퍼 — 만료/서명불일치/형식오류를 401 로 통일 변환.

    test-local/supabase 두 분기가 동일한 오류 처리 패턴을 공유하도록 공통화(기존 로직 그대로
    재사용, 신규 audience/options 인자는 supabase 분기 전용).
    """
    kwargs: dict[str, Any] = {}
    if audience is not None:
        kwargs["audience"] = audience
    if options is not None:
        kwargs["options"] = options
    try:
        return jwt.decode(token, secret, algorithms=[algorithm], **kwargs)
    except jwt.PyJWTError as exc:  # 만료/서명불일치/형식오류/aud 불일치 등
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"invalid token: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


def _lazy_link(session: Session, supabase_uid: str, email: str | None) -> User:
    """첫 로그인 자동 연계(ADR 0005 4절/`phase-3-auth.md` 3.3절).

    - email 클레임 없음 → 403(신원은 확인됐으나 연계할 단서가 없음). 카카오처럼 email 을
      제공하지 않는 provider 가 여기 온다 — 0건 매칭과 원인이 다르므로 문구를 분리해
      운영자가 UID 선연계 초대(ADR 0006 3절)로 안내할 수 있게 한다.
    - `users.email == email AND supabase_user_id IS NULL` 후보 0건 → 403(초대 없음).
    - 후보 1건 → `supabase_user_id` 를 채우고 audit_logs(action='link') 기록 후 그 행 반환.
    - 후보 2건 이상(같은 이메일이 여러 org 에 각각 미연계 초대된 엣지 케이스) → 409, 자동
      선택하지 않는다(잘못된 org 연계는 멀티테넌시 사고와 동급 — 안전한 실패를 택한다).
    """
    if not email:
        # ADR 0006 3절/4절: 카카오 등 email 클레임이 없는 계정이 여기 온다. 상태 코드는 403
        # 유지(신원은 확인됐고 권한이 없는 것 — 401 아님), 문구만 0건 매칭과 분리한다.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "account has no email claim; ask your administrator to link "
                "this account by supabase user id"
            ),
        )
    candidates = session.execute(
        select(User).where(User.email == email, User.supabase_user_id.is_(None))
    ).scalars().all()
    if len(candidates) == 0:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="no invitation found for this account",
        )
    if len(candidates) > 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="ambiguous invitation across multiple organizations, contact administrator",
        )
    user_row = candidates[0]
    # ★ 쓰기 전 org 컨텍스트 바인딩(ADR 0007 C3, 필수).
    # 이 세션은 `_get_unscoped_db` 가 준 org 컨텍스트 미바인딩 세션이다. `users_select_open`
    # 덕분에 위 후보 조회까지는 되지만, 여기서부터는 **쓰기**다:
    #   - `users` UPDATE 는 `users_update_org` 에 막혀 조용히 0행이 된다(실측: UPDATE 0).
    #   - `audit_logs` INSERT 는 `org_isolation_audit_logs`(FOR ALL)에 막혀 거부된다.
    # 이 한 줄이 없으면 D1 을 고쳐도 첫 로그인이 여전히 실패한다.
    set_org_context(session, user_row.org_id)
    user_row.supabase_user_id = supabase_uid
    record_audit(
        session,
        org_id=user_row.org_id,
        actor_id=user_row.id,
        entity="users",
        entity_id=user_row.id,
        action="link",
        diff={"before": None, "after": {"supabase_user_id": supabase_uid}},
    )
    session.commit()
    return user_row


def get_auth_context(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    session: Session = Depends(_get_unscoped_db),
) -> AuthContext:
    """JWT 검증 → AuthContext. 토큰 없음/오류 시 401(`settings.auth_mode` 로 분기)."""
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    settings = get_settings()

    if settings.auth_mode == "test-local":
        # 기존 코드 100% 그대로 — org_id/role/user_id 클레임 직접 신뢰(스프린트 0 2.5절).
        payload = _decode(credentials.credentials, settings.jwt_secret, settings.jwt_algorithm)
        org_id = payload.get("org_id")
        if not org_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="token missing org_id claim",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return AuthContext(
            org_id=str(org_id),
            role=str(payload.get("role", "viewer")),
            user_id=str(payload.get("user_id", payload.get("sub", "unknown"))),
        )

    # settings.auth_mode == "supabase"
    payload = _decode(
        credentials.credentials,
        settings.supabase_jwt_secret,
        "HS256",
        audience="authenticated",
        options={"require": ["exp", "sub"]},
    )
    supabase_uid = str(payload["sub"])
    email = payload.get("email")

    user_row = session.execute(
        select(User).where(User.supabase_user_id == supabase_uid)
    ).scalar_one_or_none()

    if user_row is None:
        user_row = _lazy_link(session, supabase_uid, email)  # 없으면 403/409 raise

    return AuthContext(org_id=user_row.org_id, role=user_row.role, user_id=user_row.id)


# 쓰기(잠금·수기입력) 권한 등급. viewer 는 제외(403).
WRITER_ROLES = frozenset({"owner", "operator"})


def require_writer(auth: AuthContext = Depends(get_auth_context)) -> AuthContext:
    """owner/operator 만 통과(viewer/기타는 403).

    baseline lock·수기입력 등 상태 변경 엔드포인트의 권한 게이트(2.3절).
    """
    if auth.role not in WRITER_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="requires owner or operator role",
        )
    return auth


def require_owner(auth: AuthContext = Depends(get_auth_context)) -> AuthContext:
    """owner 단독만 통과(operator/viewer 는 403).

    `require_writer`(owner+operator)는 조직 구성원 초대처럼 "owner 한정" 계약에는 너무
    관대하다(operator 까지 통과시킴) — 별도의 얕은 역할 체크를 둔다(comparison.py 의
    "viewer 만 차단" 커스텀 게이트와 동일한 논리, 역방향).
    `POST /organizations/{org_id}/users`(Phase 3 슬라이스 O, ADR 0005 4절) 전용 게이트.
    """
    if auth.role != "owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="requires owner role",
        )
    return auth


def require_plan(*allowed_plans: str):
    """플랜 게이팅 의존성 팩토리(phase-2.md 2.4/3.2절 — PRO 이상 전용 엔드포인트).

    `organizations.plan` 을 세션에서 조회해 `allowed_plans` 에 없으면 403.
    조직 행이 없으면(이론상 발생 불가하나 방어적으로) 'START' 로 취급해 게이팅한다.
    사용: `Depends(require_plan("PRO", "ENTERPRISE"))`.
    """

    def _dependency(
        auth: AuthContext = Depends(get_auth_context),
        session: Session = Depends(get_db),
    ) -> AuthContext:
        # 지연 임포트: deps.py는 여러 모듈에서 조기 임포트되므로 순환 임포트를 피한다.
        from app.models.organization import Organization

        org = session.execute(
            select(Organization).where(Organization.id == auth.org_id)
        ).scalar_one_or_none()
        plan = org.plan if org is not None else "START"
        if plan not in allowed_plans:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"requires plan in {sorted(allowed_plans)}, got {plan!r}",
            )
        return auth

    return _dependency


def get_db(auth: AuthContext = Depends(get_auth_context)) -> Iterator[Session]:
    """인증된 org_id 컨텍스트가 바인딩된 DB 세션(2.3절 2번째 계층 = RLS).

    세션을 시작하고 트랜잭션을 열어 `SET LOCAL app.current_org_id` 를 적용한다.
    Postgres 가 아니면 set_org_context 는 no-op(서비스 재검증이 격리를 보장).
    """
    session = SessionLocal()
    try:
        # 트랜잭션을 명시적으로 시작한 뒤 org 컨텍스트를 건다.
        set_org_context(session, auth.org_id)
        yield session
    finally:
        session.close()
