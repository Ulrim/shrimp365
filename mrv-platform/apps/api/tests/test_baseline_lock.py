"""baseline lock — 슬라이스 C(★ Phase 1 헤드라인, ADR 0002) 검증.

201+4종+snapshot_id, 재잠금 409, viewer 403, 기간오류 422, cross-org 403,
audit_logs 1행(before=null), config_version 고정, 잠금 후 UPDATE 차단(sqlite 서비스 가드).

sqlite 는 부분 유니크/트리거가 없으므로 재잠금 409 는 선제 조회 가드로, 불변성은
ORM 이벤트 가드(BaselineImmutableError)로 검증한다(Postgres 는 DB 계층이 강제).
"""

from __future__ import annotations

import pytest
from sqlalchemy import select, text

from app.db.session import SessionLocal
from app.models.audit_log import AuditLog
from app.models.baseline import Baseline, BaselineImmutableError
from tests.conftest import ORG2_ID, SITE1_ID, _make_token

_METRIC_KEYS = ("ei_total", "ei_aeration", "oei", "fcr", "mortality_rate")


def _purge_site1() -> None:
    """테스트 격리: site1 의 locked baseline·스냅샷·감사 로그 제거(원시 SQL: 이벤트 가드 우회)."""
    with SessionLocal() as s:
        # FK RESTRICT(baselines→kpi_snapshots) 때문에 baselines 를 먼저 지운다.
        s.execute(text("DELETE FROM baselines WHERE site_id = :sid"), {"sid": SITE1_ID})
        s.execute(text("DELETE FROM kpi_snapshots WHERE site_id = :sid"), {"sid": SITE1_ID})
        s.execute(text("DELETE FROM audit_logs WHERE entity = 'baselines'"))
        s.commit()


@pytest.fixture(autouse=True)
def _clean(_prepare_db):
    _purge_site1()
    yield
    _purge_site1()


def _lock(client, token, period):
    return client.post(
        f"/sites/{SITE1_ID}/baseline/lock",
        json={"period": period},
        headers={"Authorization": f"Bearer {token}"},
    )


def test_lock_creates_locked_baseline_with_snapshot_and_relock_409(
    client, owner_token, full_period
):
    """201 + 4종(5스칼라) + snapshot_id + audit 1행 + config_version 고정, 재잠금 409."""
    resp = _lock(client, owner_token, full_period)
    assert resp.status_code == 201, resp.text
    body = resp.json()

    assert body["status"] == "locked"
    assert body["site_id"] == SITE1_ID
    # 5개 스칼라(EI 2종 포함) 전부 존재 + 시드는 전부 산출 가능(green).
    for k in _METRIC_KEYS:
        assert body["metrics"][k]["value"] is not None, k
        assert body["metrics"][k]["status"] == "green", k
    assert body["metrics"]["fcr"]["unit"] == "kg/kg"
    assert body["metrics"]["oei"]["unit"] == "index"
    assert body["metrics"]["mortality_rate"]["unit"] == "%"

    # snapshot_id 영속 참조 + config_version 고정.
    snap_id = body["provenance"]["kpi_snapshot_id"]
    assert snap_id is not None and snap_id.startswith("snap-")
    assert body["kpi_config"]["version"] == "2026.1.0"
    assert body["locked_by"] is not None
    assert body["locked_at"] is not None

    # audit_logs 1행(before=null).
    with SessionLocal() as s:
        audits = s.execute(
            select(AuditLog)
            .where(AuditLog.entity == "baselines")
            .where(AuditLog.action == "lock")
        ).scalars().all()
        assert len(audits) == 1
        assert audits[0].diff_json["before"] is None
        assert audits[0].diff_json["after"]["config_version"] == "2026.1.0"
        # baseline 행에 config_version·snapshot_id 고정.
        bsl = s.execute(
            select(Baseline).where(Baseline.site_id == SITE1_ID)
        ).scalar_one()
        assert bsl.config_version == "2026.1.0"
        assert bsl.kpi_snapshot_id == snap_id

    # 재잠금 → 409(재잠금 금지, ADR 0002).
    relock = _lock(client, owner_token, full_period)
    assert relock.status_code == 409, relock.text


def test_lock_viewer_forbidden(client, viewer_token, full_period):
    """viewer 는 잠금 불가 → 403."""
    resp = _lock(client, viewer_token, full_period)
    assert resp.status_code == 403


def test_lock_bad_period_422(client, owner_token):
    """기간 역전(from>=to) → 422."""
    resp = _lock(
        client,
        owner_token,
        {"from": "2026-06-30T00:00:00Z", "to": "2026-06-01T00:00:00Z"},
    )
    assert resp.status_code == 422


def test_lock_cross_org_forbidden(client, full_period):
    """타 org owner 가 site1 을 잠그려 하면 → 403(테넌시 격리)."""
    token = _make_token(ORG2_ID, role="owner")
    resp = _lock(client, token, full_period)
    assert resp.status_code == 403


def test_get_baseline_404_then_200(client, owner_token, org1_token, full_period):
    """GET: 잠금 전 404 → 잠금 후 200(locked 반환)."""
    before = client.get(
        f"/sites/{SITE1_ID}/baseline",
        headers={"Authorization": f"Bearer {org1_token}"},
    )
    assert before.status_code == 404

    assert _lock(client, owner_token, full_period).status_code == 201

    after = client.get(
        f"/sites/{SITE1_ID}/baseline",
        headers={"Authorization": f"Bearer {org1_token}"},
    )
    assert after.status_code == 200
    body = after.json()
    assert body["status"] == "locked"
    for k in _METRIC_KEYS:
        assert k in body["metrics"]


def test_locked_baseline_update_blocked(client, owner_token, full_period):
    """잠금 후 UPDATE 시도가 서비스 가드(sqlite)로 차단됨(ADR 0002)."""
    resp = _lock(client, owner_token, full_period)
    assert resp.status_code == 201
    bid = resp.json()["id"]

    with SessionLocal() as s:
        bsl = s.get(Baseline, bid)
        assert bsl.status == "locked"
        bsl.ei_total = 999.0  # locked 값 변조 시도
        with pytest.raises(BaselineImmutableError):
            s.flush()
