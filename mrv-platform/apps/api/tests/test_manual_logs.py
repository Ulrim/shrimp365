"""수기 입력(급이/폐사) + 배치 조회 — MASTER 화면4 백엔드 검증.

201 정상 + audit 기록 + 검증 실패(422) + 권한(viewer 403) + 3중 테넌시 방어.
테스트가 삽입한 feed/mortality 행은 teardown 에서 제거해 시드 카운트 회귀를 지킨다.
"""

from __future__ import annotations

import pytest
from sqlalchemy import delete, select

from app.db.session import SessionLocal
from app.models.audit_log import AuditLog
from app.models.feed_log import FeedLog
from app.models.mortality_log import MortalityLog
from tests.conftest import BATCH1_ID, ORG1_ID, ORG2_ID, SITE1_ID, STOCKED_COUNT, _make_token


@pytest.fixture(autouse=True)
def _restore_logs(_prepare_db):
    """테스트 생성 feed/mortality 행 제거(시드 30/30 카운트 회귀 보호)."""
    with SessionLocal() as s:
        before_feed = set(
            s.execute(select(FeedLog.id).where(FeedLog.org_id == ORG1_ID)).scalars().all()
        )
        before_mort = set(
            s.execute(
                select(MortalityLog.id).where(MortalityLog.org_id == ORG1_ID)
            ).scalars().all()
        )
    yield
    with SessionLocal() as s:
        s.execute(delete(FeedLog).where(~FeedLog.id.in_(before_feed)).where(FeedLog.org_id == ORG1_ID))
        s.execute(
            delete(MortalityLog)
            .where(~MortalityLog.id.in_(before_mort))
            .where(MortalityLog.org_id == ORG1_ID)
        )
        s.execute(delete(AuditLog).where(AuditLog.entity.in_(("feed_logs", "mortality_logs"))))
        s.commit()


def _hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# --- feed-logs ---

def test_create_feed_log_201_and_audit(client, operator_token):
    """operator 급이 입력 201 + audit_logs 기록."""
    resp = client.post(
        f"/sites/{SITE1_ID}/feed-logs",
        json={"batch_id": BATCH1_ID, "ts": "2026-06-15T08:00:00Z", "feed_kg": 123.4},
        headers=_hdr(operator_token),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["feed_kg"] == 123.4
    assert body["batch_id"] == BATCH1_ID
    assert body["org_id"] == ORG1_ID
    assert body["id"].startswith("feed-")

    with SessionLocal() as s:
        audit = s.execute(
            select(AuditLog)
            .where(AuditLog.entity == "feed_logs")
            .where(AuditLog.entity_id == body["id"])
        ).scalar_one_or_none()
        assert audit is not None
        assert audit.action == "create"
        assert audit.diff_json["before"] is None


def test_feed_log_invalid_feed_kg_422(client, operator_token):
    """feed_kg <= 0 → 422(검증 실패)."""
    resp = client.post(
        f"/sites/{SITE1_ID}/feed-logs",
        json={"batch_id": BATCH1_ID, "ts": "2026-06-15T08:00:00Z", "feed_kg": 0},
        headers=_hdr(operator_token),
    )
    assert resp.status_code == 422


def test_feed_log_viewer_403(client, viewer_token):
    """viewer 는 수기입력 불가 → 403."""
    resp = client.post(
        f"/sites/{SITE1_ID}/feed-logs",
        json={"batch_id": BATCH1_ID, "ts": "2026-06-15T08:00:00Z", "feed_kg": 10.0},
        headers=_hdr(viewer_token),
    )
    assert resp.status_code == 403


def test_feed_log_unknown_batch_404(client, operator_token):
    """존재하지 않는 batch → 404."""
    resp = client.post(
        f"/sites/{SITE1_ID}/feed-logs",
        json={"batch_id": "no-such-batch", "ts": "2026-06-15T08:00:00Z", "feed_kg": 10.0},
        headers=_hdr(operator_token),
    )
    assert resp.status_code == 404


def test_feed_log_cross_org_403(client, full_period):
    """타 org owner 가 site1 에 입력 시도 → 403(테넌시 격리)."""
    token = _make_token(ORG2_ID, role="owner")
    resp = client.post(
        f"/sites/{SITE1_ID}/feed-logs",
        json={"batch_id": BATCH1_ID, "ts": "2026-06-15T08:00:00Z", "feed_kg": 10.0},
        headers=_hdr(token),
    )
    assert resp.status_code == 403


# --- mortality-logs ---

def test_create_mortality_log_201_and_audit(client, owner_token):
    """owner 폐사 입력 201 + audit 기록."""
    resp = client.post(
        f"/sites/{SITE1_ID}/mortality-logs",
        json={"batch_id": BATCH1_ID, "ts": "2026-06-16T18:00:00Z", "dead_count": 42},
        headers=_hdr(owner_token),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["dead_count"] == 42
    assert body["id"].startswith("mort-")
    with SessionLocal() as s:
        audit = s.execute(
            select(AuditLog)
            .where(AuditLog.entity == "mortality_logs")
            .where(AuditLog.entity_id == body["id"])
        ).scalar_one_or_none()
        assert audit is not None


def test_mortality_log_negative_422(client, operator_token):
    """dead_count < 0 → 422."""
    resp = client.post(
        f"/sites/{SITE1_ID}/mortality-logs",
        json={"batch_id": BATCH1_ID, "ts": "2026-06-16T18:00:00Z", "dead_count": -1},
        headers=_hdr(operator_token),
    )
    assert resp.status_code == 422


def test_mortality_log_viewer_403(client, viewer_token):
    """viewer 폐사 입력 불가 → 403."""
    resp = client.post(
        f"/sites/{SITE1_ID}/mortality-logs",
        json={"batch_id": BATCH1_ID, "ts": "2026-06-16T18:00:00Z", "dead_count": 5},
        headers=_hdr(viewer_token),
    )
    assert resp.status_code == 403


# --- GET batches ---

def test_list_batches_200(client, org1_token):
    """배치 목록 조회(드롭다운). 시드 batch 포함 + 최소 필드."""
    resp = client.get(f"/sites/{SITE1_ID}/batches", headers=_hdr(org1_token))
    assert resp.status_code == 200, resp.text
    items = resp.json()
    match = [b for b in items if b["id"] == BATCH1_ID]
    assert len(match) == 1
    b = match[0]
    assert b["species"] is not None
    assert b["stocked_count"] == STOCKED_COUNT
    assert "stocked_at" in b
    assert "closed_at" in b


def test_list_batches_viewer_can_read_200(client, viewer_token):
    """읽기는 viewer 도 허용(200)."""
    resp = client.get(f"/sites/{SITE1_ID}/batches", headers=_hdr(viewer_token))
    assert resp.status_code == 200


def test_list_batches_cross_org_403(client):
    """타 org 가 site1 배치 조회 시도 → 403."""
    token = _make_token(ORG2_ID, role="viewer")
    resp = client.get(f"/sites/{SITE1_ID}/batches", headers=_hdr(token))
    assert resp.status_code == 403
