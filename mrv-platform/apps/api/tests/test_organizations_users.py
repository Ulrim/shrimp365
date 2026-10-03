"""POST /organizations/{org_id}/users — 조직 구성원 초대 API(Phase 3 슬라이스 O, ADR 0005 4절).

owner 전용(operator/viewer 403), 3중 테넌시 방어(타 org 경로 404), (org_id,email) 유니크
위반 409, role 값 검증 422, audit_logs(action='invite') 기록을 검증한다.

FED-1(ADR 0006 3절) 확장: 선택 필드 `supabase_user_id` 로 만드는 "선연계(pre-linked)" 초대
— 201 + linked=true + DB 행에 UID 주입, 이미 연계된 UID 재사용 시 409, UUID 형식 위반 422,
미지정 시 기존과 100% 동일 동작(회귀 금지). 선연계 계정의 실제 로그인 통과는
`tests/test_auth_supabase.py::test_prelinked_invite_allows_login_without_email_claim` 이
검증한다(카카오 시나리오의 핵심 증명).
"""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.audit_log import AuditLog
from app.models.user import User
from tests.conftest import ORG1_ID, ORG2_ID, _make_token


def _hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _unique_email(label: str) -> str:
    return f"{label}-{uuid4().hex[:8]}@example.com"


def test_owner_can_invite_user(client, owner_token: str):
    email = _unique_email("invite-owner-ok")
    resp = client.post(
        f"/organizations/{ORG1_ID}/users",
        json={"email": email, "role": "operator"},
        headers=_hdr(owner_token),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["org_id"] == ORG1_ID
    assert body["email"] == email
    assert body["role"] == "operator"
    assert body["linked"] is False
    assert body["id"]

    # DB 에 supabase_user_id=NULL 상태로 삽입됐는지 확인.
    with SessionLocal() as session:
        user_row = session.execute(
            select(User).where(User.id == body["id"])
        ).scalar_one()
        assert user_row.supabase_user_id is None
        assert user_row.org_id == ORG1_ID

        # audit_logs(action='invite') 기록 확인.
        logs = session.execute(
            select(AuditLog).where(
                AuditLog.entity == "users", AuditLog.entity_id == body["id"]
            )
        ).scalars().all()
    assert any(log.action == "invite" for log in logs)


def test_operator_cannot_invite_user(client, operator_token: str):
    email = _unique_email("invite-operator-403")
    resp = client.post(
        f"/organizations/{ORG1_ID}/users",
        json={"email": email, "role": "viewer"},
        headers=_hdr(operator_token),
    )
    assert resp.status_code == 403


def test_viewer_cannot_invite_user(client, viewer_token: str):
    email = _unique_email("invite-viewer-403")
    resp = client.post(
        f"/organizations/{ORG1_ID}/users",
        json={"email": email, "role": "viewer"},
        headers=_hdr(viewer_token),
    )
    assert resp.status_code == 403


def test_duplicate_email_in_same_org_returns_409(client, owner_token: str):
    email = _unique_email("invite-dup")
    resp1 = client.post(
        f"/organizations/{ORG1_ID}/users",
        json={"email": email, "role": "viewer"},
        headers=_hdr(owner_token),
    )
    assert resp1.status_code == 201, resp1.text

    resp2 = client.post(
        f"/organizations/{ORG1_ID}/users",
        json={"email": email, "role": "operator"},
        headers=_hdr(owner_token),
    )
    assert resp2.status_code == 409


def test_invalid_role_returns_422(client, owner_token: str):
    email = _unique_email("invite-bad-role")
    resp = client.post(
        f"/organizations/{ORG1_ID}/users",
        json={"email": email, "role": "superadmin"},
        headers=_hdr(owner_token),
    )
    assert resp.status_code == 422


def test_cross_org_path_returns_404(client, owner_token: str):
    """org1 owner 토큰으로 org2 경로에 초대 시도 → 404(타 org 존재 자체를 노출하지 않음)."""
    email = _unique_email("invite-cross-org")
    resp = client.post(
        f"/organizations/{ORG2_ID}/users",
        json={"email": email, "role": "viewer"},
        headers=_hdr(owner_token),
    )
    assert resp.status_code == 404


def test_org2_owner_cannot_invite_into_org1(client):
    """반대 방향 누수 테스트: org2 owner 토큰으로 org1 경로 시도 → 404."""
    org2_owner_token = _make_token(ORG2_ID, role="owner")
    email = _unique_email("invite-cross-org-reverse")
    resp = client.post(
        f"/organizations/{ORG1_ID}/users",
        json={"email": email, "role": "viewer"},
        headers=_hdr(org2_owner_token),
    )
    assert resp.status_code == 404


def test_missing_token_returns_401(client):
    email = _unique_email("invite-no-token")
    resp = client.post(
        f"/organizations/{ORG1_ID}/users",
        json={"email": email, "role": "viewer"},
    )
    assert resp.status_code == 401


# --- FED-1: 선연계(pre-linked) 초대, ADR 0006 3절 -----------------------------


def _audit_after(user_id: str) -> dict:
    """해당 users 행의 action='invite' 감사 로그의 diff.after 를 돌려준다."""
    with SessionLocal() as session:
        logs = session.execute(
            select(AuditLog).where(
                AuditLog.entity == "users",
                AuditLog.entity_id == user_id,
                AuditLog.action == "invite",
            )
        ).scalars().all()
    assert len(logs) == 1, f"expected exactly one invite audit log, got {len(logs)}"
    return logs[0].diff_json["after"]


def test_invite_with_supabase_user_id_creates_prelinked_user(client, owner_token: str):
    """선연계 초대 → 201 + linked=true + users.supabase_user_id 가 채워진다."""
    email = _unique_email("invite-prelinked")
    uid = str(uuid4())
    resp = client.post(
        f"/organizations/{ORG1_ID}/users",
        json={"email": email, "role": "operator", "supabase_user_id": uid},
        headers=_hdr(owner_token),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["linked"] is True
    assert body["email"] == email
    assert body["org_id"] == ORG1_ID

    with SessionLocal() as session:
        user_row = session.execute(select(User).where(User.id == body["id"])).scalar_one()
        assert user_row.supabase_user_id == uid
        assert user_row.org_id == ORG1_ID
        assert user_row.role == "operator"

    # audit_logs: action 은 'invite' 그대로, 구분은 diff.after 로만 한다.
    after = _audit_after(body["id"])
    assert after["linked"] is True
    assert after["supabase_user_id"] == uid


def test_invite_without_supabase_user_id_is_unchanged(client, owner_token: str):
    """미지정 초대는 기존과 동일: linked=false, DB NULL, audit.after.supabase_user_id=None."""
    email = _unique_email("invite-not-prelinked")
    resp = client.post(
        f"/organizations/{ORG1_ID}/users",
        json={"email": email, "role": "viewer"},
        headers=_hdr(owner_token),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["linked"] is False

    with SessionLocal() as session:
        user_row = session.execute(select(User).where(User.id == body["id"])).scalar_one()
        assert user_row.supabase_user_id is None

    after = _audit_after(body["id"])
    assert after["linked"] is False
    assert after["supabase_user_id"] is None


def test_invite_with_explicit_null_supabase_user_id_behaves_as_omitted(
    client, owner_token: str
):
    """명시적 null 도 미지정과 동일(하위호환 — 프런트가 항상 키를 보내도 안전)."""
    email = _unique_email("invite-explicit-null")
    resp = client.post(
        f"/organizations/{ORG1_ID}/users",
        json={"email": email, "role": "viewer", "supabase_user_id": None},
        headers=_hdr(owner_token),
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["linked"] is False


def test_invite_with_already_linked_supabase_user_id_returns_409(client, owner_token: str):
    """이미 그 UID 로 연계된 행이 있으면 409 — 이메일 중복 409 와 메시지를 구분한다."""
    uid = str(uuid4())
    resp1 = client.post(
        f"/organizations/{ORG1_ID}/users",
        json={"email": _unique_email("invite-uid-dup-1"), "role": "viewer",
              "supabase_user_id": uid},
        headers=_hdr(owner_token),
    )
    assert resp1.status_code == 201, resp1.text

    resp2 = client.post(
        f"/organizations/{ORG1_ID}/users",
        json={"email": _unique_email("invite-uid-dup-2"), "role": "operator",
              "supabase_user_id": uid},
        headers=_hdr(owner_token),
    )
    assert resp2.status_code == 409, resp2.text
    detail = resp2.json()["detail"]
    assert "already linked" in detail
    # 이메일 중복 메시지와 혼동되지 않아야 운영자가 원인을 안다.
    assert "email" not in detail


def test_invite_reusing_uid_from_another_org_returns_409(client, owner_token: str):
    """타 org 에 이미 연계된 UID 재사용도 409(한 Supabase 계정 = 한 users 행).

    상태 코드만 단언한다: Postgres 에서는 `users` 가 org 스코프 RLS 대상이라 라우터의 선조회가
    타 org 행을 보지 못하고 부분 유니크 인덱스(ux_users_supabase_user_id)가 IntegrityError 로
    막는다 — 두 경로 모두 409 지만 detail 문구는 다를 수 있다(설계서 FED-1 2절 "최종 방어선").
    """
    uid = str(uuid4())
    org2_owner_token = _make_token(ORG2_ID, role="owner")
    resp1 = client.post(
        f"/organizations/{ORG2_ID}/users",
        json={"email": _unique_email("prelink-org2"), "role": "viewer",
              "supabase_user_id": uid},
        headers=_hdr(org2_owner_token),
    )
    assert resp1.status_code == 201, resp1.text

    resp2 = client.post(
        f"/organizations/{ORG1_ID}/users",
        json={"email": _unique_email("prelink-org1-steal"), "role": "owner",
              "supabase_user_id": uid},
        headers=_hdr(owner_token),
    )
    assert resp2.status_code == 409, resp2.text

    # 그 UID 에 연계된 행은 여전히 org2 것 하나뿐이다(탈취 불가).
    with SessionLocal() as session:
        rows = session.execute(
            select(User).where(User.supabase_user_id == uid)
        ).scalars().all()
    assert len(rows) == 1
    assert rows[0].org_id == ORG2_ID


def test_invite_uid_conflict_does_not_create_row(client, owner_token: str):
    """409 로 거절된 재초대는 users 행을 남기지 않는다(부분 삽입 방지)."""
    uid = str(uuid4())
    client.post(
        f"/organizations/{ORG1_ID}/users",
        json={"email": _unique_email("invite-uid-norow-1"), "role": "viewer",
              "supabase_user_id": uid},
        headers=_hdr(owner_token),
    )
    dup_email = _unique_email("invite-uid-norow-2")
    resp = client.post(
        f"/organizations/{ORG1_ID}/users",
        json={"email": dup_email, "role": "viewer", "supabase_user_id": uid},
        headers=_hdr(owner_token),
    )
    assert resp.status_code == 409

    with SessionLocal() as session:
        rows = session.execute(
            select(User).where(User.supabase_user_id == uid)
        ).scalars().all()
        assert len(rows) == 1
        assert rows[0].email != dup_email


def test_invite_with_malformed_supabase_user_id_returns_422(client, owner_token: str):
    """UUID 형식이 아니면 pydantic 이 422(백엔드는 Supabase 실존 검증을 하지 않는다)."""
    for bad in ["not-a-uuid", "", "8f3c-1234", str(uuid4()) + "x", " " + str(uuid4())]:
        resp = client.post(
            f"/organizations/{ORG1_ID}/users",
            json={"email": _unique_email("invite-bad-uid"), "role": "viewer",
                  "supabase_user_id": bad},
            headers=_hdr(owner_token),
        )
        assert resp.status_code == 422, f"{bad!r} should be rejected: {resp.text}"


def test_operator_cannot_prelink_invite(client, operator_token: str):
    """선연계 초대도 owner 단독 게이트를 그대로 탄다(operator 403)."""
    resp = client.post(
        f"/organizations/{ORG1_ID}/users",
        json={"email": _unique_email("prelink-operator-403"), "role": "viewer",
              "supabase_user_id": str(uuid4())},
        headers=_hdr(operator_token),
    )
    assert resp.status_code == 403


def test_viewer_cannot_prelink_invite(client, viewer_token: str):
    resp = client.post(
        f"/organizations/{ORG1_ID}/users",
        json={"email": _unique_email("prelink-viewer-403"), "role": "viewer",
              "supabase_user_id": str(uuid4())},
        headers=_hdr(viewer_token),
    )
    assert resp.status_code == 403


def test_prelink_into_other_org_returns_404_and_creates_nothing(client, owner_token: str):
    """타 org 경로로의 선연계 시도 → 404(테넌시 방어 회귀 없음) + 행 생성 0건."""
    uid = str(uuid4())
    resp = client.post(
        f"/organizations/{ORG2_ID}/users",
        json={"email": _unique_email("prelink-cross-org"), "role": "viewer",
              "supabase_user_id": uid},
        headers=_hdr(owner_token),
    )
    assert resp.status_code == 404

    with SessionLocal() as session:
        rows = session.execute(
            select(User).where(User.supabase_user_id == uid)
        ).scalars().all()
    assert rows == []
