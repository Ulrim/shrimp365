"""승인형 제어 콘솔 API — phase-3.md 3절(★핵심: DB CHECK 제약으로 승인 게이트 물리적 강제) 검증.

전체 상태전이(propose→approve/reject→apply), 승인 게이트 우회 시도(CHECK 제약 직접 검증),
3중 테넌시(tank/recipe_version 소유권), viewer 조회 가능/쓰기 403, START/PRO 403(ENTERPRISE
만), audit_logs 4종(propose/approve/reject/apply) 기록을 검증한다.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
import seed_demo_site as seed_mod
from sqlalchemy import delete, select, text
from sqlalchemy.exc import IntegrityError

from app.db.session import SessionLocal
from app.models.audit_log import AuditLog
from app.models.control_action import ControlAction
from app.models.organization import Organization
from app.models.recipe import Recipe, RecipeVersion
from tests.conftest import ORG1_ID, ORG2_ID, SITE1_ID, _make_token

TANK1_ID = seed_mod.TANK_ID


def _hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _set_plan(org_id: str, plan: str) -> None:
    with SessionLocal() as s:
        org = s.execute(select(Organization).where(Organization.id == org_id)).scalar_one()
        org.plan = plan
        s.commit()


@pytest.fixture(autouse=True)
def _clean(_prepare_db):
    yield
    with SessionLocal() as s:
        s.execute(delete(ControlAction))
        s.execute(delete(RecipeVersion))
        s.execute(delete(Recipe))
        s.execute(delete(AuditLog).where(AuditLog.entity == "control_actions"))
        s.commit()
    _set_plan(ORG1_ID, "START")
    _set_plan(ORG2_ID, "START")


@pytest.fixture
def enterprise_plan():
    _set_plan(ORG1_ID, "ENTERPRISE")
    yield


def _make_recipe_version(
    org_id: str, site_id: str, *, params: dict | None = None, suffix: str | None = None
) -> str:
    """recipe + recipe_version 1행을 만들고 recipe_version_id 를 반환."""
    suffix = suffix or uuid4().hex[:8]
    recipe_id = f"recipe-ca-test-{suffix}"
    rv_id = f"recipever-ca-test-{suffix}"
    with SessionLocal() as s:
        s.add(
            Recipe(
                id=recipe_id, site_id=site_id, org_id=org_id,
                type="oxygen", current_version=1,
            )
        )
        s.add(
            RecipeVersion(
                id=rv_id, recipe_id=recipe_id, org_id=org_id, version=1,
                params_json=params or {"oxygen_target_do_mg_l": 6.5},
                rationale="테스트용 추천", created_by="tester",
            )
        )
        s.commit()
    return rv_id


def _propose(client, token, *, tank_id=TANK1_ID, recipe_version_id=None):
    return client.post(
        "/control-actions",
        json={"tank_id": tank_id, "recipe_version_id": recipe_version_id},
        headers=_hdr(token),
    )


# --- 정상 흐름(propose → approve → apply) ------------------------------------


def test_propose_snapshot_and_tenancy(client, owner_token, enterprise_plan):
    """제안 등록: 3중 테넌시 통과 + recommended_json 스냅샷 복사 확인."""
    params = {"oxygen_target_do_mg_l": 6.7, "note": "산소 목표 상향"}
    rv_id = _make_recipe_version(ORG1_ID, SITE1_ID, params=params)

    resp = _propose(client, owner_token, recipe_version_id=rv_id)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["tank_id"] == TANK1_ID
    assert body["recipe_version_id"] == rv_id
    assert body["site_id"] == SITE1_ID
    assert body["org_id"] == ORG1_ID
    assert body["status"] == "pending"
    assert body["recommended_json"] == params
    assert body["approved_by"] is None
    assert body["approved_at"] is None
    assert body["applied_at"] is None
    assert body["result_json"] is None

    with SessionLocal() as s:
        log = s.execute(
            select(AuditLog).where(
                AuditLog.entity == "control_actions",
                AuditLog.entity_id == body["id"],
                AuditLog.action == "propose",
            )
        ).scalar_one()
        assert log.diff_json["before"] is None
        assert log.diff_json["after"]["status"] == "pending"


def test_propose_snapshot_immune_to_later_recipe_version_changes(
    client, owner_token, enterprise_plan
):
    """스냅샷 불변: 제안 이후 recipe 가 새 버전으로 바뀌어도 저장된 recommended_json 은 불변."""
    rv_id = _make_recipe_version(ORG1_ID, SITE1_ID, params={"oxygen_target_do_mg_l": 6.0})
    resp = _propose(client, owner_token, recipe_version_id=rv_id)
    assert resp.status_code == 201
    ca_id = resp.json()["id"]

    # 부모 recipe_version 의 params_json 을 사후 변경(실제로는 append-only 라 불가하지만
    # 스냅샷 로직이 참조가 아니라 복사임을 명시적으로 검증하기 위해 직접 갱신).
    with SessionLocal() as s:
        rv = s.get(RecipeVersion, rv_id)
        rv.params_json = {"oxygen_target_do_mg_l": 9.9}
        s.commit()

    resp2 = client.get(f"/control-actions/{ca_id}", headers=_hdr(owner_token))
    assert resp2.status_code == 200
    assert resp2.json()["recommended_json"] == {"oxygen_target_do_mg_l": 6.0}


def test_full_lifecycle_propose_approve_apply(client, owner_token, enterprise_plan):
    rv_id = _make_recipe_version(ORG1_ID, SITE1_ID)
    ca_id = _propose(client, owner_token, recipe_version_id=rv_id).json()["id"]

    approve_resp = client.post(
        f"/control-actions/{ca_id}/approve", json={}, headers=_hdr(owner_token)
    )
    assert approve_resp.status_code == 200, approve_resp.text
    approved = approve_resp.json()
    assert approved["status"] == "approved"
    assert approved["approved_by"] is not None
    assert approved["approved_at"] is not None

    apply_resp = client.post(
        f"/control-actions/{ca_id}/apply",
        json={"result_json": {"applied_note": "완료", "observed_do_mg_l": 6.4}},
        headers=_hdr(owner_token),
    )
    assert apply_resp.status_code == 200, apply_resp.text
    applied = apply_resp.json()
    assert applied["status"] == "applied"
    assert applied["applied_at"] is not None
    assert applied["result_json"] == {"applied_note": "완료", "observed_do_mg_l": 6.4}

    with SessionLocal() as s:
        actions = {
            a
            for a, in s.execute(
                select(AuditLog.action).where(
                    AuditLog.entity == "control_actions", AuditLog.entity_id == ca_id
                )
            ).all()
        }
        assert actions == {"propose", "approve", "apply"}


def test_reject_flow(client, owner_token, enterprise_plan):
    rv_id = _make_recipe_version(ORG1_ID, SITE1_ID)
    ca_id = _propose(client, owner_token, recipe_version_id=rv_id).json()["id"]

    resp = client.post(
        f"/control-actions/{ca_id}/reject",
        json={"note": "설비 점검 중이라 보류"},
        headers=_hdr(owner_token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "rejected"
    assert body["result_json"] is None  # 거부 사유는 result_json 을 오염시키지 않는다.

    with SessionLocal() as s:
        log = s.execute(
            select(AuditLog).where(
                AuditLog.entity == "control_actions",
                AuditLog.entity_id == ca_id,
                AuditLog.action == "reject",
            )
        ).scalar_one()
        assert log.note == "설비 점검 중이라 보류"
        assert "applied_note" not in str(log.diff_json)


# --- 상태 전이 규칙(409) -------------------------------------------------------


def test_apply_without_approval_returns_409(client, owner_token, enterprise_plan):
    """★ 승인 게이트 핵심 실행 지점: pending 상태에서 apply 시도 → 409."""
    rv_id = _make_recipe_version(ORG1_ID, SITE1_ID)
    ca_id = _propose(client, owner_token, recipe_version_id=rv_id).json()["id"]

    resp = client.post(
        f"/control-actions/{ca_id}/apply",
        json={"result_json": {"note": "무단 적용 시도"}},
        headers=_hdr(owner_token),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "control action not approved"

    with SessionLocal() as s:
        ca = s.get(ControlAction, ca_id)
        assert ca.status == "pending"  # 거부되어 상태 변화 없음


def test_approve_non_pending_returns_409(client, owner_token, enterprise_plan):
    rv_id = _make_recipe_version(ORG1_ID, SITE1_ID)
    ca_id = _propose(client, owner_token, recipe_version_id=rv_id).json()["id"]
    assert client.post(
        f"/control-actions/{ca_id}/approve", json={}, headers=_hdr(owner_token)
    ).status_code == 200

    # 이미 approved 인데 재차 approve 시도.
    resp = client.post(
        f"/control-actions/{ca_id}/approve", json={}, headers=_hdr(owner_token)
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "invalid transition"


def test_reject_non_pending_returns_409(client, owner_token, enterprise_plan):
    rv_id = _make_recipe_version(ORG1_ID, SITE1_ID)
    ca_id = _propose(client, owner_token, recipe_version_id=rv_id).json()["id"]
    assert client.post(
        f"/control-actions/{ca_id}/reject", json={"note": "1차 거부"}, headers=_hdr(owner_token)
    ).status_code == 200

    resp = client.post(
        f"/control-actions/{ca_id}/reject", json={"note": "2차 거부"}, headers=_hdr(owner_token)
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "invalid transition"


def test_reapply_or_reapprove_after_applied_returns_409(client, owner_token, enterprise_plan):
    """이미 applied 인데 재차 approve/apply 시도 → 둘 다 409(우회 불가)."""
    rv_id = _make_recipe_version(ORG1_ID, SITE1_ID)
    ca_id = _propose(client, owner_token, recipe_version_id=rv_id).json()["id"]
    assert client.post(
        f"/control-actions/{ca_id}/approve", json={}, headers=_hdr(owner_token)
    ).status_code == 200
    assert client.post(
        f"/control-actions/{ca_id}/apply",
        json={"result_json": {"note": "정상 적용"}},
        headers=_hdr(owner_token),
    ).status_code == 200

    reapprove = client.post(
        f"/control-actions/{ca_id}/approve", json={}, headers=_hdr(owner_token)
    )
    assert reapprove.status_code == 409
    assert reapprove.json()["detail"] == "invalid transition"

    reapply = client.post(
        f"/control-actions/{ca_id}/apply",
        json={"result_json": {"note": "재적용 시도"}},
        headers=_hdr(owner_token),
    )
    assert reapply.status_code == 409
    assert reapply.json()["detail"] == "control action not approved"


# --- ★ CHECK 제약 직접 우회 시도(수동 SQL 시뮬레이션) --------------------------


def test_check_constraint_blocks_applied_without_approved_at(owner_token):
    """DB 에 직접 status='applied', approved_at=NULL 행을 넣으려 하면 CHECK 위반으로 실패."""
    rv_id = _make_recipe_version(ORG1_ID, SITE1_ID, suffix="checkA")
    with SessionLocal() as s:
        with pytest.raises(IntegrityError):
            s.execute(
                text(
                    """
                    INSERT INTO control_actions
                    (id, tank_id, recipe_version_id, site_id, org_id, recommended_json,
                     status, approved_by, approved_at, applied_at, result_json)
                    VALUES
                    (:id, :tank_id, :rv_id, :site_id, :org_id, '{}',
                     'applied', NULL, NULL, NULL, NULL)
                    """
                ),
                {
                    "id": f"ca-bypass-{uuid4().hex[:8]}",
                    "tank_id": TANK1_ID,
                    "rv_id": rv_id,
                    "site_id": SITE1_ID,
                    "org_id": ORG1_ID,
                },
            )
            s.commit()
        s.rollback()


def test_check_constraint_blocks_approved_without_approved_by(owner_token):
    """DB 에 직접 status='approved', approved_by=NULL 행을 넣으려 하면 CHECK 위반으로 실패."""
    rv_id = _make_recipe_version(ORG1_ID, SITE1_ID, suffix="checkB")
    with SessionLocal() as s:
        with pytest.raises(IntegrityError):
            s.execute(
                text(
                    """
                    INSERT INTO control_actions
                    (id, tank_id, recipe_version_id, site_id, org_id, recommended_json,
                     status, approved_by, approved_at, applied_at, result_json)
                    VALUES
                    (:id, :tank_id, :rv_id, :site_id, :org_id, '{}',
                     'approved', NULL, NULL, NULL, NULL)
                    """
                ),
                {
                    "id": f"ca-bypass-{uuid4().hex[:8]}",
                    "tank_id": TANK1_ID,
                    "rv_id": rv_id,
                    "site_id": SITE1_ID,
                    "org_id": ORG1_ID,
                },
            )
            s.commit()
        s.rollback()


# --- 3중 테넌시(tank/recipe_version 소유권) -----------------------------------


def test_propose_cross_org_tank_403(client, enterprise_plan):
    """org2 가 org1 소유 tank 로 제안 시도 → 403(존재는 하나 접근 거부)."""
    _set_plan(ORG2_ID, "ENTERPRISE")
    rv_id = _make_recipe_version(ORG1_ID, SITE1_ID)
    token2 = _make_token(ORG2_ID, role="owner")

    resp = _propose(client, token2, recipe_version_id=rv_id)
    assert resp.status_code == 403


def test_propose_cross_org_recipe_version_403(client, owner_token, enterprise_plan):
    """org1 이 org2 소유 recipe_version 을 참조 → 403(recipe_version 소유권 위반)."""
    from app.models.site import Site

    site2_id = "site-ca-test-9999"
    with SessionLocal() as s:
        s.add(Site(id=site2_id, org_id=ORG2_ID, name="교차 org 테스트 사이트"))
        s.commit()
    try:
        rv_id_org2 = _make_recipe_version(ORG2_ID, site2_id, suffix="crossorg")
        resp = _propose(client, owner_token, recipe_version_id=rv_id_org2)
        assert resp.status_code == 403
    finally:
        with SessionLocal() as s:
            s.execute(delete(Site).where(Site.id == site2_id))
            s.commit()


def test_propose_missing_tank_404(client, owner_token, enterprise_plan):
    rv_id = _make_recipe_version(ORG1_ID, SITE1_ID)
    resp = _propose(client, owner_token, tank_id="tank-does-not-exist", recipe_version_id=rv_id)
    assert resp.status_code == 404


def test_propose_missing_recipe_version_404(client, owner_token, enterprise_plan):
    resp = _propose(client, owner_token, recipe_version_id="recipever-does-not-exist")
    assert resp.status_code == 404


def test_propose_tank_and_recipe_different_site_same_org_422(client, owner_token, enterprise_plan):
    """같은 org 라도 tank 와 recipe(recipe_version 부모)의 site 가 다르면 422.

    org 격리(3중 방어)는 통과하지만, 다른 site 데이터로 산출된 추천을 엉뚱한 site 의
    tank 에 적용하는 것은 도메인상 무효이므로 별도로 막는다."""
    from app.models.site import Site

    site2_id = "site-ca-test-samesite"
    with SessionLocal() as s:
        s.add(Site(id=site2_id, org_id=ORG1_ID, name="같은 org 다른 site"))
        s.commit()
    try:
        rv_id = _make_recipe_version(ORG1_ID, site2_id, suffix="diffsite")
        resp = _propose(client, owner_token, recipe_version_id=rv_id)
        assert resp.status_code == 422
    finally:
        with SessionLocal() as s:
            s.execute(delete(Site).where(Site.id == site2_id))
            s.commit()


# --- 역할/플랜 게이팅 -----------------------------------------------------------


def test_propose_viewer_403(client, viewer_token, enterprise_plan):
    rv_id = _make_recipe_version(ORG1_ID, SITE1_ID)
    resp = _propose(client, viewer_token, recipe_version_id=rv_id)
    assert resp.status_code == 403


def test_propose_start_plan_403(client, owner_token):
    """플랜 미승격(START 기본값) 상태에서 제안 시도 → 403(ENTERPRISE 전용)."""
    rv_id = _make_recipe_version(ORG1_ID, SITE1_ID)
    resp = _propose(client, owner_token, recipe_version_id=rv_id)
    assert resp.status_code == 403


def test_propose_pro_plan_403(client, owner_token):
    """PRO 플랜도 ENTERPRISE 미만이므로 403."""
    _set_plan(ORG1_ID, "PRO")
    rv_id = _make_recipe_version(ORG1_ID, SITE1_ID)
    resp = _propose(client, owner_token, recipe_version_id=rv_id)
    assert resp.status_code == 403


def test_approve_reject_apply_viewer_403(client, owner_token, viewer_token, enterprise_plan):
    rv_id = _make_recipe_version(ORG1_ID, SITE1_ID)
    ca_id = _propose(client, owner_token, recipe_version_id=rv_id).json()["id"]

    assert client.post(
        f"/control-actions/{ca_id}/approve", json={}, headers=_hdr(viewer_token)
    ).status_code == 403
    assert client.post(
        f"/control-actions/{ca_id}/reject", json={"note": "x"}, headers=_hdr(viewer_token)
    ).status_code == 403
    assert client.post(
        f"/control-actions/{ca_id}/apply",
        json={"result_json": {}},
        headers=_hdr(viewer_token),
    ).status_code == 403


# --- 조회(viewer 허용, ENTERPRISE 게이팅) --------------------------------------


def test_viewer_can_list_and_get(client, owner_token, viewer_token, enterprise_plan):
    rv_id = _make_recipe_version(ORG1_ID, SITE1_ID)
    ca_id = _propose(client, owner_token, recipe_version_id=rv_id).json()["id"]

    list_resp = client.get("/control-actions", headers=_hdr(viewer_token))
    assert list_resp.status_code == 200, list_resp.text
    assert any(item["id"] == ca_id for item in list_resp.json()["items"])

    get_resp = client.get(f"/control-actions/{ca_id}", headers=_hdr(viewer_token))
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == ca_id


def test_list_filters_by_site_id_and_status(client, owner_token, enterprise_plan):
    rv_id = _make_recipe_version(ORG1_ID, SITE1_ID)
    ca_id = _propose(client, owner_token, recipe_version_id=rv_id).json()["id"]
    client.post(f"/control-actions/{ca_id}/approve", json={}, headers=_hdr(owner_token))

    resp = client.get(
        "/control-actions", params={"site_id": SITE1_ID, "status": "approved"},
        headers=_hdr(owner_token),
    )
    assert resp.status_code == 200
    ids = [item["id"] for item in resp.json()["items"]]
    assert ca_id in ids
    assert all(item["status"] == "approved" for item in resp.json()["items"])

    resp_pending = client.get(
        "/control-actions", params={"status": "pending"}, headers=_hdr(owner_token)
    )
    assert ca_id not in [item["id"] for item in resp_pending.json()["items"]]


def test_list_and_get_start_plan_403(client, owner_token):
    resp = client.get("/control-actions", headers=_hdr(owner_token))
    assert resp.status_code == 403


def test_get_cross_org_403(client, owner_token, enterprise_plan):
    """타 org 가 control_action 단건 조회 시도 → 403(본문 미노출)."""
    _set_plan(ORG2_ID, "ENTERPRISE")
    rv_id = _make_recipe_version(ORG1_ID, SITE1_ID)
    ca_id = _propose(client, owner_token, recipe_version_id=rv_id).json()["id"]

    token2 = _make_token(ORG2_ID, role="owner")
    resp = client.get(f"/control-actions/{ca_id}", headers=_hdr(token2))
    assert resp.status_code == 403
    assert "recommended_json" not in resp.json()


def test_list_scoped_to_org_no_cross_org_leak(client, owner_token, enterprise_plan):
    """org2 가 org1 소속 control_action 을 목록에서 볼 수 없다(누수 0)."""
    _set_plan(ORG2_ID, "ENTERPRISE")
    rv_id = _make_recipe_version(ORG1_ID, SITE1_ID)
    ca_id = _propose(client, owner_token, recipe_version_id=rv_id).json()["id"]

    token2 = _make_token(ORG2_ID, role="owner")
    resp = client.get("/control-actions", headers=_hdr(token2))
    assert resp.status_code == 200
    assert ca_id not in [item["id"] for item in resp.json()["items"]]
