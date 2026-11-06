"""alerts — 배치 평가(job_evaluate_alerts) + API(GET/ack/subscriptions), phase-2 슬라이스 H.

3종 트리거 각각 최소 1개 시나리오(시드 데이터 위에 조건을 직접 만들어 검증) + 중복 open
억제 + ack idempotent + viewer 403 + 구독 off 시 미생성 + 타 org 404.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
import seed_demo_site as seed_mod
from sqlalchemy import delete, select

from app.db.session import SessionLocal
from app.models.alert import Alert
from app.models.audit_log import AuditLog
from app.models.mortality_log import MortalityLog
from app.models.reading import Reading
from app.models.site import DEFAULT_ALERT_ENABLED_TYPES, Site
from app.services.alert_jobs import job_evaluate_alerts
from tests.conftest import ORG1_ID, ORG2_ID, SITE1_ID, SITE2_ID, _make_token

PERIOD_START = seed_mod.PERIOD_START
HOURS = seed_mod.HOURS
PERIOD_END = PERIOD_START + timedelta(hours=HOURS)


def _hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def _clean_alerts_and_extra_rows(_prepare_db):
    """각 테스트 전후로 alerts/audit(alerts,sites)/추가 readings·mortality_logs 를 정리.

    시드 카운트(720 readings/30 mortality_logs) 회귀 및 다른 테스트 모듈과의 간섭을
    막기 위해 이 테스트 파일이 만든 행만 식별해 teardown 에서 제거한다.
    """
    with SessionLocal() as s:
        before_readings = set(
            s.execute(
                select(Reading.time, Reading.meter_id).where(Reading.org_id == ORG1_ID)
            ).all()
        )
        before_mort = set(
            s.execute(select(MortalityLog.id).where(MortalityLog.org_id == ORG1_ID)).scalars()
        )
    yield
    with SessionLocal() as s:
        s.execute(delete(Alert))
        s.execute(
            delete(AuditLog).where(AuditLog.entity.in_(("alerts", "sites")))
        )
        current_readings = s.execute(
            select(Reading.time, Reading.meter_id).where(Reading.org_id == ORG1_ID)
        ).all()
        for time_, meter_id in current_readings:
            if (time_, meter_id) not in before_readings:
                s.execute(
                    delete(Reading)
                    .where(Reading.time == time_)
                    .where(Reading.meter_id == meter_id)
                )
        s.execute(
            delete(MortalityLog)
            .where(~MortalityLog.id.in_(before_mort))
            .where(MortalityLog.org_id == ORG1_ID)
        )
        # 구독 스위치 원복(다른 테스트 파일 간섭 방지).
        site = s.execute(select(Site).where(Site.id == SITE1_ID)).scalar_one()
        site.alert_enabled_types = dict(DEFAULT_ALERT_ENABLED_TYPES)
        s.commit()


def _run_job(**kwargs):
    with SessionLocal() as s:
        created = job_evaluate_alerts(s, **kwargs)
        s.commit()
        return [a.id for a in created]


# --- 트리거 1: do_low ---------------------------------------------------


def test_do_low_trigger_creates_alert():
    """최신 유효 DO 샘플 < alerting.do_low_mg_l(기본 3.0) → 'do_low' 알림 1건."""
    low_ts = PERIOD_END + timedelta(hours=2)
    with SessionLocal() as s:
        s.add(
            Reading(
                time=low_ts, meter_id=seed_mod.METER_DO_ID, org_id=ORG1_ID,
                value=1.2, quality_flag="ok",
            )
        )
        s.commit()

    created_ids = _run_job(evaluated_at=low_ts, do_low_lookback_hours=1)

    with SessionLocal() as s:
        alerts = s.execute(
            select(Alert).where(Alert.site_id == SITE1_ID).where(Alert.type == "do_low")
        ).scalars().all()
        assert len(alerts) == 1
        assert alerts[0].id in created_ids
        assert alerts[0].severity == "critical"
        assert alerts[0].payload_json["value"] == 1.2
        assert alerts[0].payload_json["threshold"] == 3.0
        assert alerts[0].status == "open"


def test_do_low_not_triggered_when_within_band():
    """정상 범위(시드 DO ~6~8mg/L) 만 있는 시점엔 do_low 미생성."""
    eval_ts = PERIOD_START + timedelta(hours=10)
    _run_job(evaluated_at=eval_ts, do_low_lookback_hours=2)
    with SessionLocal() as s:
        alerts = s.execute(
            select(Alert).where(Alert.site_id == SITE1_ID).where(Alert.type == "do_low")
        ).scalars().all()
        assert alerts == []


# --- 트리거 2: mortality_spike -------------------------------------------


def test_mortality_spike_trigger_creates_alert():
    """당일 dead_count 가 7일 MA 대비 폭증(min_count 이상) → 'mortality_spike' 알림 1건."""
    spike_day = PERIOD_START + timedelta(days=30)
    spike_ts = spike_day + timedelta(hours=12)
    with SessionLocal() as s:
        s.add(
            MortalityLog(
                id="mort-alert-spike-test-0001", batch_id=seed_mod.BATCH_ID, org_id=ORG1_ID,
                ts=spike_ts, dead_count=100_000, cause_note=None,
            )
        )
        s.commit()

    created_ids = _run_job(evaluated_at=spike_ts + timedelta(minutes=1), mortality_window_days=7)

    with SessionLocal() as s:
        alerts = s.execute(
            select(Alert)
            .where(Alert.site_id == SITE1_ID)
            .where(Alert.type == "mortality_spike")
        ).scalars().all()
        assert len(alerts) == 1
        assert alerts[0].id in created_ids
        assert alerts[0].payload_json["dead_count_today"] == 100_000
        assert alerts[0].payload_json["moving_avg_dead_count"] < 1000


def test_mortality_spike_not_triggered_by_ordinary_day():
    """평범한 시드 하루(day 15)는 스파이크 조건 미충족 → 미생성."""
    eval_ts = PERIOD_START + timedelta(days=15, hours=20)
    _run_job(evaluated_at=eval_ts, mortality_window_days=7)
    with SessionLocal() as s:
        alerts = s.execute(
            select(Alert)
            .where(Alert.site_id == SITE1_ID)
            .where(Alert.type == "mortality_spike")
        ).scalars().all()
        assert alerts == []


# --- 트리거 3: kpi_red ----------------------------------------------------


def test_kpi_red_trigger_creates_alert_for_oei():
    """시드 전체 기간 OEI(~0.59) 는 DEFAULT_KPI_THRESHOLDS 기준 'red' → 'kpi_red' 알림."""
    created_ids = _run_job(evaluated_at=PERIOD_END, kpi_period_days=30)
    with SessionLocal() as s:
        alerts = s.execute(
            select(Alert).where(Alert.site_id == SITE1_ID).where(Alert.type == "kpi_red")
        ).scalars().all()
        assert len(alerts) == 1
        assert alerts[0].id in created_ids
        assert alerts[0].payload_json["metric"] == "oei"
        assert alerts[0].payload_json["config_version"] == "2026.1.0"


# --- 중복 억제 -------------------------------------------------------------


def test_duplicate_open_alert_not_reinserted():
    """같은 (site_id, type) 에 open 이 이미 있으면 재실행해도 재삽입하지 않는다(1.5절)."""
    low_ts = PERIOD_END + timedelta(hours=2)
    with SessionLocal() as s:
        s.add(
            Reading(
                time=low_ts, meter_id=seed_mod.METER_DO_ID, org_id=ORG1_ID,
                value=1.0, quality_flag="ok",
            )
        )
        s.commit()

    _run_job(evaluated_at=low_ts, do_low_lookback_hours=1)
    _run_job(evaluated_at=low_ts, do_low_lookback_hours=1)  # 재실행

    with SessionLocal() as s:
        alerts = s.execute(
            select(Alert).where(Alert.site_id == SITE1_ID).where(Alert.type == "do_low")
        ).scalars().all()
        assert len(alerts) == 1


# --- 구독 스위치(1.7절) ----------------------------------------------------


def test_subscription_disabled_type_not_generated(client, owner_token):
    """do_low 구독을 끄면 조건이 충족돼도 생성되지 않는다."""
    resp = client.patch(
        f"/sites/{SITE1_ID}/alert-subscriptions",
        json={"do_low": False},
        headers=_hdr(owner_token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["alert_enabled_types"]["do_low"] is False

    low_ts = PERIOD_END + timedelta(hours=2)
    with SessionLocal() as s:
        s.add(
            Reading(
                time=low_ts, meter_id=seed_mod.METER_DO_ID, org_id=ORG1_ID,
                value=1.0, quality_flag="ok",
            )
        )
        s.commit()

    _run_job(evaluated_at=low_ts, do_low_lookback_hours=1)

    with SessionLocal() as s:
        alerts = s.execute(
            select(Alert).where(Alert.site_id == SITE1_ID).where(Alert.type == "do_low")
        ).scalars().all()
        assert alerts == []


def test_subscription_update_writer_only_403(client, viewer_token):
    resp = client.patch(
        f"/sites/{SITE1_ID}/alert-subscriptions",
        json={"do_low": False},
        headers=_hdr(viewer_token),
    )
    assert resp.status_code == 403


def test_subscription_update_records_audit(client, owner_token):
    resp = client.patch(
        f"/sites/{SITE1_ID}/alert-subscriptions",
        json={"mortality_spike": False},
        headers=_hdr(owner_token),
    )
    assert resp.status_code == 200
    with SessionLocal() as s:
        audit = s.execute(
            select(AuditLog)
            .where(AuditLog.entity == "sites")
            .where(AuditLog.entity_id == SITE1_ID)
            .where(AuditLog.action == "update_alert_subscriptions")
        ).scalar_one_or_none()
        assert audit is not None
        assert audit.diff_json["after"]["mortality_spike"] is False


def test_get_subscriptions_reflects_persisted_state(client, owner_token, viewer_token):
    """GET 은 PATCH 로 저장된 실제 상태를 반환한다(FE 새로고침 시 로드용 보강)."""
    patch_resp = client.patch(
        f"/sites/{SITE1_ID}/alert-subscriptions",
        json={"do_low": False, "kpi_red": True},
        headers=_hdr(owner_token),
    )
    assert patch_resp.status_code == 200

    get_resp = client.get(
        f"/sites/{SITE1_ID}/alert-subscriptions", headers=_hdr(owner_token)
    )
    assert get_resp.status_code == 200
    body = get_resp.json()
    assert body["site_id"] == SITE1_ID
    assert body["alert_enabled_types"]["do_low"] is False
    assert body["alert_enabled_types"]["kpi_red"] is True

    # viewer 도 조회는 가능(읽기 전용, require_writer 아님).
    viewer_resp = client.get(
        f"/sites/{SITE1_ID}/alert-subscriptions", headers=_hdr(viewer_token)
    )
    assert viewer_resp.status_code == 200


def test_get_subscriptions_cross_org_403(client, viewer_token):
    """타 org site 조회는 403/404(스코프 밖) — resolve_site_for_org 재사용."""
    org2_viewer_token = _make_token(ORG2_ID, role="viewer")
    resp = client.get(
        f"/sites/{SITE1_ID}/alert-subscriptions", headers=_hdr(org2_viewer_token)
    )
    assert resp.status_code in (403, 404)


# --- GET /alerts + ack API -------------------------------------------------


def _seed_one_open_alert() -> str:
    low_ts = PERIOD_END + timedelta(hours=2)
    with SessionLocal() as s:
        s.add(
            Reading(
                time=low_ts, meter_id=seed_mod.METER_DO_ID, org_id=ORG1_ID,
                value=1.0, quality_flag="ok",
            )
        )
        s.commit()
    ids = _run_job(evaluated_at=low_ts, do_low_lookback_hours=1)
    assert len(ids) == 1
    return ids[0]


def test_list_alerts_default_open_filter(client, org1_token):
    alert_id = _seed_one_open_alert()
    resp = client.get(f"/sites/{SITE1_ID}/alerts", headers=_hdr(org1_token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["site_id"] == SITE1_ID
    assert body["total"] == 1
    assert body["items"][0]["id"] == alert_id
    assert body["items"][0]["status"] == "open"


def test_list_alerts_cross_org_403(client):
    _seed_one_open_alert()
    token = _make_token(ORG2_ID, role="viewer")
    resp = client.get(f"/sites/{SITE1_ID}/alerts", headers=_hdr(token))
    assert resp.status_code == 403


def test_ack_alert_200_and_audit(client, owner_token):
    alert_id = _seed_one_open_alert()
    resp = client.post(f"/alerts/{alert_id}/ack", headers=_hdr(owner_token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "ack"
    assert body["acked_by"] is not None
    assert body["acked_at"] is not None

    with SessionLocal() as s:
        audit = s.execute(
            select(AuditLog)
            .where(AuditLog.entity == "alerts")
            .where(AuditLog.entity_id == alert_id)
            .where(AuditLog.action == "ack")
        ).scalars().all()
        assert len(audit) == 1


def test_ack_alert_idempotent(client, owner_token):
    alert_id = _seed_one_open_alert()
    first = client.post(f"/alerts/{alert_id}/ack", headers=_hdr(owner_token))
    second = client.post(f"/alerts/{alert_id}/ack", headers=_hdr(owner_token))
    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["status"] == "ack"

    with SessionLocal() as s:
        audit = s.execute(
            select(AuditLog)
            .where(AuditLog.entity == "alerts")
            .where(AuditLog.entity_id == alert_id)
            .where(AuditLog.action == "ack")
        ).scalars().all()
        # idempotent: 두 번째 호출은 상태 변화가 없어 audit 재기록 없음.
        assert len(audit) == 1


def test_ack_alert_viewer_403(client, viewer_token):
    alert_id = _seed_one_open_alert()
    resp = client.post(f"/alerts/{alert_id}/ack", headers=_hdr(viewer_token))
    assert resp.status_code == 403


def test_ack_alert_cross_org_404(client, owner_token):
    """타 org(site2/org2) 소속 alert 를 org1 owner 가 ack 시도 → 404."""
    with SessionLocal() as s:
        alert = Alert(
            id="alert-other-org-0001",
            site_id=SITE2_ID,
            org_id=ORG2_ID,
            type="do_low",
            severity="critical",
            payload_json={"metric": "do", "value": 1.0, "threshold": 3.0},
            status="open",
        )
        s.add(alert)
        s.commit()
    resp = client.post("/alerts/alert-other-org-0001/ack", headers=_hdr(owner_token))
    assert resp.status_code == 404
    with SessionLocal() as s:
        s.execute(delete(Alert).where(Alert.id == "alert-other-org-0001"))
        s.commit()


def test_ack_unknown_alert_404(client, owner_token):
    resp = client.post("/alerts/alert-does-not-exist/ack", headers=_hdr(owner_token))
    assert resp.status_code == 404
