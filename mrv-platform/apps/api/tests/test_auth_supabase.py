"""Supabase Auth 통합(AUTH_MODE=supabase) 회귀 테스트 — Phase 3 슬라이스 O(ADR 0005 5절).

실제 Supabase/GoTrue 는 띄우지 않는다(과설계 금지 — 검증 메커니즘이 순수 HS256 디코드이므로
로컬에서 완전히 재현 가능, ADR 0005 1/5절). 합성 Supabase-형 JWT(`sub`/`email`/
`aud="authenticated"`)를 테스트용 `SUPABASE_JWT_SECRET` 으로 직접 서명해 검증한다.

`app.deps.get_settings` 참조만 `monkeypatch` 로 교체해 AUTH_MODE=supabase 경로를 켠다 —
`tests/conftest.py::_make_token`/기존 test-local 테스트에는 영향이 없다(monkeypatch 는
각 테스트 종료 시 자동 원복, 함수 스코프).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import jwt
import pytest
from fastapi.testclient import TestClient

import app.deps as deps_module
from app.config import Settings
from app.db.session import SessionLocal
from app.models.audit_log import AuditLog
from app.models.user import User
from tests.conftest import ORG1_ID, ORG2_ID

SUPABASE_JWT_SECRET = "test-supabase-secret"


@pytest.fixture
def supabase_settings(monkeypatch: pytest.MonkeyPatch) -> Settings:
    """`deps.get_settings` 를 AUTH_MODE=supabase 설정으로 교체(함수 스코프, 자동 원복)."""
    settings = Settings(auth_mode="supabase", supabase_jwt_secret=SUPABASE_JWT_SECRET)
    monkeypatch.setattr(deps_module, "get_settings", lambda: settings)
    return settings


def _make_supabase_token(
    *,
    sub: str,
    email: str | None,
    aud: str = "authenticated",
    secret: str = SUPABASE_JWT_SECRET,
    expires_in: timedelta = timedelta(hours=1),
) -> str:
    payload: dict = {
        "sub": sub,
        "aud": aud,
        "exp": datetime.now(UTC) + expires_in,
    }
    if email is not None:
        payload["email"] = email
    return jwt.encode(payload, secret, algorithm="HS256")


def _hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _insert_invited_user(org_id: str, email: str, role: str = "operator") -> User:
    """`users` 행을 `supabase_user_id=NULL` 로 직접 삽입(=초대 완료, 첫 로그인 전 상태)."""
    user = User(
        id=f"user-{uuid4().hex}", org_id=org_id, email=email, role=role,
        supabase_user_id=None,
    )
    with SessionLocal() as session:
        session.add(user)
        session.commit()
        session.refresh(user)
    return user


def _unique_email(label: str) -> str:
    return f"{label}-{uuid4().hex[:8]}@example.com"


# --- 정상 로그인(lazy-link 1건 매칭) + 재요청 -------------------------------


def test_supabase_login_lazy_links_then_second_request_reuses_link(
    client: TestClient, supabase_settings: Settings
):
    email = _unique_email("owner-invite")
    invited = _insert_invited_user(ORG1_ID, email, role="operator")
    supabase_uid = str(uuid4())
    token = _make_supabase_token(sub=supabase_uid, email=email)

    resp1 = client.get("/auth/me", headers=_hdr(token))
    assert resp1.status_code == 200, resp1.text
    body1 = resp1.json()
    assert body1["org_id"] == ORG1_ID
    assert body1["role"] == "operator"
    assert body1["user_id"] == invited.id

    # audit_logs 에 link 액션이 기록됐는지 확인.
    with SessionLocal() as session:
        logs = (
            session.query(AuditLog)
            .filter(AuditLog.entity == "users", AuditLog.entity_id == invited.id)
            .all()
        )
    assert any(log.action == "link" for log in logs)

    # 재요청: 이미 연계됐으므로 lazy-link 재조회 없이 바로 통과(동일 결과).
    resp2 = client.get("/auth/me", headers=_hdr(token))
    assert resp2.status_code == 200, resp2.text
    assert resp2.json() == body1


# --- 미초대 계정(0건 매칭) → 403 --------------------------------------------


def test_supabase_no_invitation_returns_403(client: TestClient, supabase_settings: Settings):
    email = _unique_email("no-such-invite")
    token = _make_supabase_token(sub=str(uuid4()), email=email)

    resp = client.get("/auth/me", headers=_hdr(token))
    assert resp.status_code == 403
    assert "no invitation" in resp.json()["detail"]


def test_supabase_missing_email_claim_returns_403(
    client: TestClient, supabase_settings: Settings
):
    """email 클레임 자체가 없으면 연계 단서가 없으므로 403.

    FED-1(ADR 0006 4절): 0건 매칭과 **원인이 다르므로 문구를 분리**한다 — 카카오처럼
    email 을 주지 않는 provider 가 여기 오며, 운영자를 UID 선연계 초대로 안내해야 한다.
    """
    token = _make_supabase_token(sub=str(uuid4()), email=None)

    resp = client.get("/auth/me", headers=_hdr(token))
    assert resp.status_code == 403
    detail = resp.json()["detail"]
    assert "supabase user id" in detail
    assert "no email claim" in detail
    # 0건 매칭 문구와 섞이지 않아야 FE(FED-3)/운영자가 원인을 구분할 수 있다.
    assert "no invitation" not in detail


# --- 이중 초대(2건 매칭) → 409 ----------------------------------------------


def test_supabase_ambiguous_invitation_returns_409(
    client: TestClient, supabase_settings: Settings
):
    email = _unique_email("dual-invite")
    _insert_invited_user(ORG1_ID, email, role="operator")
    _insert_invited_user(ORG2_ID, email, role="viewer")
    token = _make_supabase_token(sub=str(uuid4()), email=email)

    resp = client.get("/auth/me", headers=_hdr(token))
    assert resp.status_code == 409
    assert "ambiguous" in resp.json()["detail"]


# --- aud 불일치 / 만료 토큰 → 401 -------------------------------------------


def test_supabase_wrong_audience_returns_401(client: TestClient, supabase_settings: Settings):
    email = _unique_email("wrong-aud")
    _insert_invited_user(ORG1_ID, email)
    token = _make_supabase_token(sub=str(uuid4()), email=email, aud="service_role")

    resp = client.get("/auth/me", headers=_hdr(token))
    assert resp.status_code == 401


def test_supabase_expired_token_returns_401(client: TestClient, supabase_settings: Settings):
    email = _unique_email("expired")
    _insert_invited_user(ORG1_ID, email)
    token = _make_supabase_token(
        sub=str(uuid4()), email=email, expires_in=timedelta(hours=-1)
    )

    resp = client.get("/auth/me", headers=_hdr(token))
    assert resp.status_code == 401


def test_supabase_wrong_secret_signature_returns_401(
    client: TestClient, supabase_settings: Settings
):
    email = _unique_email("bad-sig")
    _insert_invited_user(ORG1_ID, email)
    token = _make_supabase_token(sub=str(uuid4()), email=email, secret="not-the-real-secret")

    resp = client.get("/auth/me", headers=_hdr(token))
    assert resp.status_code == 401


# --- FED-1: 선연계(pre-linked) 초대 → 카카오 시나리오 관통 (ADR 0006 3절) -------


def _enable_supabase_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    """`supabase_settings` 픽스처와 동일한 전환을 테스트 중간에 수행한다.

    선연계 초대(POST /organizations/.../users)는 test-local owner 토큰으로 호출해야 하므로,
    초대를 먼저 끝낸 뒤 이 함수로 AUTH_MODE=supabase 경로를 켠다(픽스처를 쓰면 초대 호출까지
    supabase 모드가 되어 시나리오가 성립하지 않는다).
    """
    settings = Settings(auth_mode="supabase", supabase_jwt_secret=SUPABASE_JWT_SECRET)
    monkeypatch.setattr(deps_module, "get_settings", lambda: settings)


def test_prelinked_invite_allows_login_without_email_claim(
    client: TestClient, owner_token: str, monkeypatch: pytest.MonkeyPatch
):
    """★FED-1 핵심: UID 선연계 초대를 받은 계정은 email 클레임 없이도 인증을 통과한다.

    카카오 가입자의 Supabase JWT 에는 email 클레임이 없다(비즈앱 승인 전 profile_nickname
    만 요청 — ADR 0006 3절). 선연계된 users 행이 `supabase_user_id == sub` 직접 조회로
    잡히므로 `_lazy_link` 를 **아예 타지 않는다**. 이 테스트가 그 사실을 증명한다.
    """
    supabase_uid = str(uuid4())
    email = _unique_email("kakao-prelinked")

    # 1) owner 가 UID 선연계로 초대(test-local 모드).
    resp_invite = client.post(
        f"/organizations/{ORG1_ID}/users",
        json={"email": email, "role": "operator", "supabase_user_id": supabase_uid},
        headers=_hdr(owner_token),
    )
    assert resp_invite.status_code == 201, resp_invite.text
    invited_id = resp_invite.json()["id"]
    assert resp_invite.json()["linked"] is True

    # 2) 그 UID 로 발급된 Supabase JWT — email 클레임 없음(카카오).
    _enable_supabase_mode(monkeypatch)
    token = _make_supabase_token(sub=supabase_uid, email=None)

    resp = client.get("/auth/me", headers=_hdr(token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["org_id"] == ORG1_ID
    assert body["role"] == "operator"
    assert body["user_id"] == invited_id

    # 3) `_lazy_link` 를 타지 않았음을 감사 로그로 증명한다(action='link' 가 없어야 한다).
    with SessionLocal() as session:
        logs = (
            session.query(AuditLog)
            .filter(AuditLog.entity == "users", AuditLog.entity_id == invited_id)
            .all()
        )
    actions = {log.action for log in logs}
    assert "invite" in actions
    assert "link" not in actions, "선연계 계정은 lazy-link 경로를 타면 안 된다"


def test_lazy_link_guard_still_blocks_unlinked_account_without_email(
    client: TestClient, owner_token: str, monkeypatch: pytest.MonkeyPatch
):
    """선연계되지 **않은** 초대는 email 클레임 없는 토큰을 여전히 403 으로 막는다.

    선연계 경로가 열렸다고 해서 "email 없으면 아무 초대장이나 집어간다"가 되면 안 된다
    (임의 매칭은 멀티테넌시 사고와 동급 — Hard Rule 4).
    """
    email = _unique_email("kakao-not-prelinked")
    resp_invite = client.post(
        f"/organizations/{ORG1_ID}/users",
        json={"email": email, "role": "operator"},
        headers=_hdr(owner_token),
    )
    assert resp_invite.status_code == 201, resp_invite.text

    _enable_supabase_mode(monkeypatch)
    resp = client.get("/auth/me", headers=_hdr(_make_supabase_token(sub=str(uuid4()), email=None)))
    assert resp.status_code == 403
    assert "supabase user id" in resp.json()["detail"]


def test_zero_candidate_branch_keeps_legacy_detail_message(
    client: TestClient, supabase_settings: Settings
):
    """회귀 가드: 0건 매칭 분기의 문구는 **바뀌지 않는다**(FED-1 은 첫 분기만 분리했다)."""
    token = _make_supabase_token(sub=str(uuid4()), email=_unique_email("legacy-msg"))

    resp = client.get("/auth/me", headers=_hdr(token))
    assert resp.status_code == 403
    assert resp.json()["detail"] == "no invitation found for this account"
