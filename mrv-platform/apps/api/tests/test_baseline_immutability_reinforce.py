"""QA 보강 — baseline 불변성/재현성·슬라이스 관통 일관성·drill-down (qa-reviewer).

기존 test_baseline_lock.py 가 다루지 않은 핵심 게이트 항목을 실증한다:
  1) config_version 고정 실증(★): 잠금 후 kpi_config 가 바뀌어(새 version + FCR 산출불가로
     떨어지는 파라미터) live GET /kpi 값·version 은 변해도, locked baseline 의 5스칼라와
     config_version 은 잠금 당시 값(2026.1.0)으로 영원히 보존된다 → MRV 'Before' 무결성.
  2) 슬라이스 관통 일관성(Q1): 같은 기간 GET /kpi 의 5스칼라 == 잠금된 baseline 의 5스칼라.
  3) 잠금 후 DELETE 차단(sqlite 서비스 가드; Postgres 는 DB 트리거).
  4) drill-down: baseline.kpi_snapshot_id 로 참조되는 kpi_snapshots 행에 inputs_json/
     provenance_json 이 4종 근거(source_feed_refs/mortality/meter)를 담아 영속된다.
  5) 엔드포인트 격리 보강: baseline GET·mortality-logs 의 cross-org 403.

DB 오염 방지: 각 테스트 전후 site1 의 baselines/snapshots/audit 를 원시 SQL 로 정리하고,
config 변경 테스트는 삽입한 kpi_config 행을 반드시 제거해 다른 테스트의 version 회귀를 지킨다.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy import select, text

from app.db.session import SessionLocal
from app.models.baseline import Baseline, BaselineImmutableError
from app.models.kpi_config import KpiConfig
from app.models.kpi_snapshot import KpiSnapshot
from tests.conftest import (
    HOURS,
    ORG2_ID,
    PERIOD_START,
    SITE1_ID,
    _make_token,
)

_METRIC_KEYS = ("ei_total", "ei_aeration", "oei", "fcr", "mortality_rate")
_NEW_CFG_ID = "kpicfg-qa-reinforce-9999"
_NEW_CFG_VERSION = "2099.9.9"


def _purge_site1() -> None:
    """site1 의 baseline/snapshot/audit 정리(원시 SQL: ORM 이벤트 가드 우회)."""
    with SessionLocal() as s:
        s.execute(text("DELETE FROM baselines WHERE site_id = :sid"), {"sid": SITE1_ID})
        s.execute(text("DELETE FROM kpi_snapshots WHERE site_id = :sid"), {"sid": SITE1_ID})
        s.execute(text("DELETE FROM audit_logs WHERE entity = 'baselines'"))
        s.commit()


def _purge_new_cfg() -> None:
    """QA 가 삽입한 kpi_config 행 제거(다른 테스트의 version=2026.1.0 회귀 보호)."""
    with SessionLocal() as s:
        s.execute(text("DELETE FROM kpi_config WHERE id = :cid"), {"cid": _NEW_CFG_ID})
        s.commit()


@pytest.fixture(autouse=True)
def _clean(_prepare_db):
    _purge_site1()
    _purge_new_cfg()
    yield
    _purge_site1()
    _purge_new_cfg()


def _lock(client, token, period):
    return client.post(
        f"/sites/{SITE1_ID}/baseline/lock",
        json={"period": period},
        headers={"Authorization": f"Bearer {token}"},
    )


def _get_kpi(client, token, period):
    return client.get(
        f"/sites/{SITE1_ID}/kpi", params=period,
        headers={"Authorization": f"Bearer {token}"},
    )


def _get_baseline(client, token):
    return client.get(
        f"/sites/{SITE1_ID}/baseline",
        headers={"Authorization": f"Bearer {token}"},
    )


def test_baseline_scalars_equal_live_kpi_same_period(
    client, owner_token, org1_token, full_period
):
    """관통 일관성(Q1): 같은 기간 live GET /kpi 5스칼라 == 잠금 baseline 5스칼라."""
    kpi = _get_kpi(client, org1_token, full_period).json()["metrics"]
    resp = _lock(client, owner_token, full_period)
    assert resp.status_code == 201, resp.text
    locked = resp.json()["metrics"]
    for k in _METRIC_KEYS:
        assert locked[k]["value"] == pytest.approx(kpi[k]["value"]), k


def test_locked_baseline_frozen_against_config_change(
    client, owner_token, org1_token, full_period
):
    """★ config_version 고정: 잠금 후 kpi_config 가 바뀌어도 baseline 값·version 불변.

    잠금 → 새 kpi_config(version 2099.9.9, FCR min_biomass_delta_kg 를 Δbiomass 초과로
    설정해 live FCR 을 '산출불가'로 떨어뜨림) 삽입 → live GET /kpi 는 새 version 을 쓰고
    FCR=null 로 바뀌지만, GET /baseline 은 잠금 당시 값(FCR 수치)·version 2026.1.0 을 보존.
    """
    lock_resp = _lock(client, owner_token, full_period)
    assert lock_resp.status_code == 201
    locked_before = lock_resp.json()
    locked_fcr = locked_before["metrics"]["fcr"]["value"]
    assert locked_fcr is not None  # 시드는 FCR 산출 가능
    assert locked_before["kpi_config"]["version"] == "2026.1.0"

    # 잠금 후, 산출값을 바꾸는 새 config 를 더 늦은 effective_from 으로 활성화.
    with SessionLocal() as s:
        s.add(KpiConfig(
            id=_NEW_CFG_ID,
            version=_NEW_CFG_VERSION,
            params_json={
                "ei": {"included_quality_flags": ["ok"], "min_biomass_delta_kg": 0.0},
                # Δbiomass(2560)보다 큰 임계 → live FCR 산출불가(None).
                "fcr": {"included_quality_flags": ["ok"], "min_biomass_delta_kg": 9_999_999.0},
                "oei": {"included_quality_flags": ["ok"], "min_biomass_kg": 0.0,
                        "do_band_method": "sample_count", "oei_scale_factor": 1.0,
                        "clamp_max": 100.0},
                "mortality": {"moving_avg_window_days": 7},
            },
            effective_from=PERIOD_START + timedelta(hours=HOURS + 1),
        ))
        s.commit()

    # live GET /kpi 는 새 config 를 반영(version 바뀌고 FCR=null).
    live = _get_kpi(client, org1_token, full_period).json()
    assert live["kpi_config"]["version"] == _NEW_CFG_VERSION
    assert live["metrics"]["fcr"]["value"] is None

    # baseline 은 잠금 당시 값·version 을 영원히 보존(불변).
    after = _get_baseline(client, org1_token).json()
    assert after["kpi_config"]["version"] == "2026.1.0"
    assert after["metrics"]["fcr"]["value"] == pytest.approx(locked_fcr)
    for k in _METRIC_KEYS:
        assert after["metrics"][k]["value"] == pytest.approx(
            locked_before["metrics"][k]["value"]
        ), k

    # DB 행 자체도 잠금 당시 스칼라·version 유지.
    with SessionLocal() as s:
        bsl = s.execute(
            select(Baseline).where(Baseline.site_id == SITE1_ID)
        ).scalar_one()
        assert bsl.config_version == "2026.1.0"
        assert bsl.fcr == pytest.approx(locked_fcr)


def test_locked_baseline_delete_blocked(client, owner_token, full_period):
    """잠금 후 DELETE 시도가 서비스 가드(sqlite)로 차단(ADR 0002). Postgres 는 DB 트리거."""
    resp = _lock(client, owner_token, full_period)
    assert resp.status_code == 201
    bid = resp.json()["id"]
    with SessionLocal() as s:
        bsl = s.get(Baseline, bid)
        assert bsl.status == "locked"
        s.delete(bsl)
        with pytest.raises(BaselineImmutableError):
            s.flush()


def test_snapshot_drilldown_persisted(client, owner_token, full_period):
    """drill-down: baseline.kpi_snapshot_id → kpi_snapshots 에 4종 근거 영속(inputs/provenance)."""
    resp = _lock(client, owner_token, full_period)
    assert resp.status_code == 201
    snap_id = resp.json()["provenance"]["kpi_snapshot_id"]
    assert snap_id is not None

    with SessionLocal() as s:
        snap = s.get(KpiSnapshot, snap_id)
        assert snap is not None
        assert snap.config_version == "2026.1.0"
        # inputs_json: 4종 서브키 존재(엔진 근거 그대로 직렬화).
        inp = snap.inputs_json
        assert set(inp.keys()) >= {"ei", "fcr", "oei", "mortality"}
        assert inp["fcr"]["total_feed_kg"] > 0
        assert inp["mortality"]["stocked_count"] > 0
        # provenance_json: 원천 reading/log 까지 역추적(drill-down).
        prov = snap.provenance_json
        assert len(prov["source_feed_refs"]) == 30
        assert len(prov["source_mortality_refs"]) == 30
        assert "meter-power-main-0001" in prov["source_meter_ids"]
        assert prov["source_biomass_refs"] == ["harvest-open-0001", "harvest-close-0001"]
        # 스냅샷 스칼라 == baseline 스칼라(동일 산출 근거).
        assert snap.fcr == pytest.approx(resp.json()["metrics"]["fcr"]["value"])


def test_baseline_get_cross_org_403(client, owner_token, full_period):
    """엔드포인트 격리: 타 org 가 site1 baseline 을 조회하면 403(본문 미노출)."""
    # 먼저 org1 이 잠가 baseline 이 실제 존재하게 만든다(존재해도 타 org 는 차단).
    assert _lock(client, owner_token, full_period).status_code == 201
    token2 = _make_token(ORG2_ID, role="owner")
    resp = _get_baseline(client, token2)
    assert resp.status_code == 403
    # 응답 본문에 site1 baseline 스칼라/식별자가 새지 않는다.
    assert "metrics" not in resp.json()


def test_mortality_log_cross_org_403(client):
    """엔드포인트 격리: 타 org 가 site1 에 폐사 입력 시도 → 403."""
    from tests.conftest import BATCH1_ID

    token2 = _make_token(ORG2_ID, role="owner")
    resp = client.post(
        f"/sites/{SITE1_ID}/mortality-logs",
        json={"batch_id": BATCH1_ID, "ts": "2026-06-16T18:00:00Z", "dead_count": 5},
        headers={"Authorization": f"Bearer {token2}"},
    )
    assert resp.status_code == 403
