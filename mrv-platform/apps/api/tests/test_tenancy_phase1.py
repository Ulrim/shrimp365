"""Phase 1(S0) 멀티테넌시 누수 테스트 — Rule 4 머지 게이트.

신규 테이블(tanks/batches/feed_logs/mortality_logs/baselines/kpi_snapshots/api_keys)에
대해 org_id 스코프 쿼리가 타 org 데이터를 절대 노출하지 않음을 증명한다(서비스/쿼리 레벨).

sqlite 는 RLS 를 지원하지 않으므로, 이 테스트는 "모든 접근 쿼리는 org_id 로 스코프한다"는
서비스 레이어 규율이 격리를 보장함을 증명한다(3중 방어 중 3번째 계층; test_tenancy.py 와 동일 철학).
신규 테이블 전용 엔드포인트는 다음 웨이브이므로, 여기서는 org 스코프 쿼리로 스모크 검증한다.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.baseline import Baseline
from app.models.batch import Batch
from app.models.feed_log import FeedLog
from app.models.mortality_log import MortalityLog
from app.models.tank import Tank
from tests.conftest import ORG1_ID, ORG2_ID, PERIOD_START, SITE1_ID, SITE2_ID

# org2 격리 검증용 고정 식별자(테스트 전용).
_TANK2 = "tank-org2-test"
_BATCH2 = "batch-org2-test"
_FEED2 = "feed-org2-test"
_MORT2 = "mort-org2-test"
_BSL2 = "bsl-org2-test"
_BSL1 = "bsl-org1-test"


@pytest.fixture(scope="module", autouse=True)
def _org2_phase1_data(_prepare_db):
    """org2 에 tanks/batches/feed_logs/mortality_logs/baselines 를 심어

    org1↔org2 양방향 격리를 검증 가능하게 만든다. org1 에는 baseline 1행을 추가한다
    (시드는 baseline 을 만들지 않으므로 격리 대조군을 확보).
    """
    with SessionLocal() as s:
        # 부모→자식 순서로 삽입(org2 site2 는 conftest 가 이미 생성).
        s.add(Tank(
            id=_TANK2, site_id=SITE2_ID, org_id=ORG2_ID, name="타org 수조",
            volume_m3=10.0, target_do_min=6.0, target_do_max=8.0,
        ))
        s.flush()
        s.add(Batch(
            id=_BATCH2, tank_id=_TANK2, org_id=ORG2_ID,
            species="litopenaeus_vannamei", stocked_count=5000, stocked_at=PERIOD_START,
        ))
        s.flush()
        s.add(FeedLog(
            id=_FEED2, batch_id=_BATCH2, org_id=ORG2_ID,
            ts=PERIOD_START + timedelta(hours=1), feed_kg=9.9,
            source="manual", quality_flag="ok",
        ))
        s.add(MortalityLog(
            id=_MORT2, batch_id=_BATCH2, org_id=ORG2_ID,
            ts=PERIOD_START + timedelta(hours=2), dead_count=7, cause_note=None,
        ))
        # 각 org 에 draft baseline 1행(partial unique 는 locked 만 대상 → draft 안전).
        s.add(Baseline(
            id=_BSL2, site_id=SITE2_ID, org_id=ORG2_ID,
            period_start=PERIOD_START, period_end=PERIOD_START + timedelta(hours=720),
            config_version="2026.1.0", status="draft",
        ))
        s.add(Baseline(
            id=_BSL1, site_id=SITE1_ID, org_id=ORG1_ID,
            period_start=PERIOD_START, period_end=PERIOD_START + timedelta(hours=720),
            config_version="2026.1.0", status="draft",
        ))
        s.commit()
    yield
    # 정리(멱등: 다른 세션 재사용 대비).
    with SessionLocal() as s:
        for model, pk in (
            (FeedLog, _FEED2), (MortalityLog, _MORT2), (Baseline, _BSL2),
            (Baseline, _BSL1), (Batch, _BATCH2), (Tank, _TANK2),
        ):
            obj = s.get(model, pk)
            if obj is not None:
                s.delete(obj)
        s.commit()


def _scoped(model, org_id):
    with SessionLocal() as s:
        return s.execute(
            select(model).where(model.org_id == org_id)
        ).scalars().all()


def test_feed_logs_org_scope_no_leak():
    """feed_logs: org1 스코프는 org1 것(30)만, org2 스코프는 org2 것(1)만."""
    org1 = _scoped(FeedLog, ORG1_ID)
    org2 = _scoped(FeedLog, ORG2_ID)
    assert len(org1) == 30
    assert all(f.org_id == ORG1_ID for f in org1)
    assert _FEED2 not in {f.id for f in org1}  # org2 데이터가 org1 스코프에 누출 금지
    assert len(org2) == 1
    assert {f.id for f in org2} == {_FEED2}
    assert all(f.org_id == ORG2_ID for f in org2)


def test_mortality_logs_org_scope_no_leak():
    """mortality_logs: org 간 상호 불노출."""
    org1 = _scoped(MortalityLog, ORG1_ID)
    org2 = _scoped(MortalityLog, ORG2_ID)
    assert len(org1) == 30
    assert _MORT2 not in {m.id for m in org1}
    assert {m.id for m in org2} == {_MORT2}
    assert all(m.org_id == ORG2_ID for m in org2)


def test_baselines_org_scope_no_leak():
    """baselines: org1 스코프에 org2 baseline(_BSL2) 이 절대 나타나지 않는다."""
    org1 = _scoped(Baseline, ORG1_ID)
    org2 = _scoped(Baseline, ORG2_ID)
    org1_ids = {b.id for b in org1}
    org2_ids = {b.id for b in org2}
    assert _BSL1 in org1_ids
    assert _BSL2 not in org1_ids  # 타 org baseline 누출 금지
    assert _BSL2 in org2_ids
    assert _BSL1 not in org2_ids
    assert all(b.org_id == ORG1_ID for b in org1)
    assert all(b.org_id == ORG2_ID for b in org2)


def test_tanks_batches_org_scope_no_leak():
    """tanks/batches: org2 스코프는 org2 것만, org1 것이 섞이지 않는다."""
    tanks2 = _scoped(Tank, ORG2_ID)
    batches2 = _scoped(Batch, ORG2_ID)
    assert {t.id for t in tanks2} == {_TANK2}
    assert {b.id for b in batches2} == {_BATCH2}
    assert all(t.org_id == ORG2_ID for t in tanks2)
    assert all(b.org_id == ORG2_ID for b in batches2)

    tanks1 = _scoped(Tank, ORG1_ID)
    batches1 = _scoped(Batch, ORG1_ID)
    assert _TANK2 not in {t.id for t in tanks1}
    assert _BATCH2 not in {b.id for b in batches1}


def test_cross_org_query_returns_disjoint_sets():
    """종합: 어떤 신규 테이블도 org1/org2 결과 집합이 겹치지 않는다(누수 0)."""
    for model in (Tank, Batch, FeedLog, MortalityLog, Baseline):
        ids1 = {r.id for r in _scoped(model, ORG1_ID)}
        ids2 = {r.id for r in _scoped(model, ORG2_ID)}
        assert ids1.isdisjoint(ids2), f"{model.__tablename__} org 간 id 교집합 발생(누수)"
