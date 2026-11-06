"""GET /sites/{site_id}/readings — phase-2 4.1절 계약 테스트(슬라이스 I).

이 엔드포인트는 대시보드 차트 전용 조회이며 KPI 산식과 무관하다(Rule 1 무관).
자체 격리된 site/tank/meter/readings 를 이 파일 안에서 직접 삽입해(시드 스크립트
비변경, apps/api 디렉터리 범위 준수) hourly/daily 집계값을 수기 검산한다.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete

from app.db.session import SessionLocal
from app.models.meter import Meter
from app.models.organization import Organization
from app.models.reading import Reading
from app.models.site import Site
from app.models.tank import Tank
from tests.conftest import ORG2_ID, SITE1_ID, SITE2_ID, _make_token

# --- 이 테스트 전용 고정 테넌트(다른 스위트의 KPI 산출에 영향 주지 않도록 격리) ---
RORG_ID = "org-READINGS-0001"
RSITE_ID = "site-readings-0001"
RTANK_ID = "tank-readings-0001"

METER_POWER_ID = "meter-readings-power-0001"
METER_DO_A_ID = "meter-readings-do-a-0001"
METER_DO_B_ID = "meter-readings-do-b-0001"
METER_CAP_ID = "meter-readings-cap-0001"

BASE_TS = datetime(2026, 8, 1, 0, 0, 0, tzinfo=UTC)


@pytest.fixture(scope="module", autouse=True)
def _seed_readings_fixture():
    """전용 org/site/tank/meter + 수기 검산용 readings 삽입(모듈 스코프, 1회)."""
    with SessionLocal() as session:
        session.add(Organization(id=RORG_ID, name="readings 테스트 법인", plan="START"))
        session.flush()
        session.add(Site(id=RSITE_ID, org_id=RORG_ID, name="readings 테스트 사이트"))
        session.flush()
        session.add(Tank(id=RTANK_ID, site_id=RSITE_ID, org_id=RORG_ID, name="수조 R1"))
        session.add(Meter(
            id=METER_POWER_ID, site_id=RSITE_ID, org_id=RORG_ID,
            type="power", unit="kWh_interval", is_aeration=False, tank_id=RTANK_ID,
        ))
        session.add(Meter(
            id=METER_DO_A_ID, site_id=RSITE_ID, org_id=RORG_ID,
            type="do", unit="mg_L", is_aeration=False, tank_id=RTANK_ID,
        ))
        session.add(Meter(
            id=METER_DO_B_ID, site_id=RSITE_ID, org_id=RORG_ID,
            type="do", unit="mg_L", is_aeration=False, tank_id=RTANK_ID,
        ))
        session.add(Meter(
            id=METER_CAP_ID, site_id=RSITE_ID, org_id=RORG_ID,
            type="power", unit="kWh_interval", is_aeration=False, tank_id=None,
        ))
        session.flush()

        rows: list[Reading] = []

        # --- power meter: 3시간(H0/H1/H2), 시간당 2행 → SUM 검산 + quality_flag 규칙 ---
        # H0: 10(ok) + 5(ok)  = 15, flag=ok
        # H1: 8(ok)  + 2(bad) = 10, flag=bad(우선)
        # H2: 4(suspect) + 6(ok) = 10, flag=suspect
        power_plan = [
            (0, 0, 10.0, "ok"), (0, 30, 5.0, "ok"),
            (1, 0, 8.0, "ok"), (1, 30, 2.0, "bad"),
            (2, 0, 4.0, "suspect"), (2, 30, 6.0, "ok"),
        ]
        for hour, minute, value, flag in power_plan:
            rows.append(Reading(
                time=BASE_TS + timedelta(hours=hour, minutes=minute),
                meter_id=METER_POWER_ID, org_id=RORG_ID, value=value, quality_flag=flag,
            ))

        # --- do meter A/B: H0 에 각 2행 → AVG 검산 + tank_id+type 병합(meter_id 구분) ---
        # A: 6.0, 6.4 → avg 6.2 / B: 7.0, 7.2 → avg 7.1
        rows.append(Reading(
            time=BASE_TS, meter_id=METER_DO_A_ID, org_id=RORG_ID,
            value=6.0, quality_flag="ok",
        ))
        rows.append(Reading(
            time=BASE_TS + timedelta(minutes=30), meter_id=METER_DO_A_ID, org_id=RORG_ID,
            value=6.4, quality_flag="ok",
        ))
        rows.append(Reading(
            time=BASE_TS, meter_id=METER_DO_B_ID, org_id=RORG_ID,
            value=7.0, quality_flag="ok",
        ))
        rows.append(Reading(
            time=BASE_TS + timedelta(minutes=30), meter_id=METER_DO_B_ID, org_id=RORG_ID,
            value=7.2, quality_flag="ok",
        ))

        # --- cap meter: 1초 간격 5,001 행(raw 캡 초과 시나리오 전용) ---
        cap_base = BASE_TS + timedelta(days=1)
        for i in range(5001):
            rows.append(Reading(
                time=cap_base + timedelta(seconds=i),
                meter_id=METER_CAP_ID, org_id=RORG_ID, value=1.0, quality_flag="ok",
            ))

        session.add_all(rows)
        session.commit()

    yield

    with SessionLocal() as session:
        session.execute(delete(Reading).where(Reading.org_id == RORG_ID))
        session.execute(delete(Meter).where(Meter.org_id == RORG_ID))
        session.execute(delete(Tank).where(Tank.org_id == RORG_ID))
        session.execute(delete(Site).where(Site.org_id == RORG_ID))
        session.execute(delete(Organization).where(Organization.id == RORG_ID))
        session.commit()


@pytest.fixture
def rorg_token() -> str:
    return _make_token(RORG_ID)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


# --- 정상: raw 조회 ---


def test_raw_power_meter_returns_original_rows(client, rorg_token):
    resp = client.get(
        f"/sites/{RSITE_ID}/readings",
        params={
            "meter_id": METER_POWER_ID,
            "from": _iso(BASE_TS),
            "to": _iso(BASE_TS + timedelta(hours=3)),
            "granularity": "raw",
        },
        headers={"Authorization": f"Bearer {rorg_token}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["site_id"] == RSITE_ID
    assert body["meter_id"] == METER_POWER_ID
    assert body["type"] == "power"
    assert body["granularity"] == "raw"
    assert body["unit"] == "kWh"
    assert len(body["points"]) == 6
    values = [p["value"] for p in body["points"]]
    assert values == [10.0, 5.0, 8.0, 2.0, 4.0, 6.0]
    flags = [p["quality_flag"] for p in body["points"]]
    assert flags == ["ok", "ok", "ok", "bad", "suspect", "ok"]
    # additive point-level meter_id.
    assert all(p["meter_id"] == METER_POWER_ID for p in body["points"])


def test_raw_cap_exceeded_422(client, rorg_token):
    resp = client.get(
        f"/sites/{RSITE_ID}/readings",
        params={
            "meter_id": METER_CAP_ID,
            "from": _iso(BASE_TS + timedelta(days=1)),
            "to": _iso(BASE_TS + timedelta(days=1, hours=3)),
            "granularity": "raw",
        },
        headers={"Authorization": f"Bearer {rorg_token}"},
    )
    assert resp.status_code == 422, resp.text
    assert "narrow the range or use granularity" in resp.text


# --- 정상: hourly/daily 집계 + quality_flag 규칙(수기 검산) ---


def test_hourly_aggregation_sum_and_quality_flag(client, rorg_token):
    resp = client.get(
        f"/sites/{RSITE_ID}/readings",
        params={
            "meter_id": METER_POWER_ID,
            "from": _iso(BASE_TS),
            "to": _iso(BASE_TS + timedelta(hours=3)),
            "granularity": "hourly",
        },
        headers={"Authorization": f"Bearer {rorg_token}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["granularity"] == "hourly"
    points = body["points"]
    assert len(points) == 3
    # 수기 검산: H0=15(ok), H1=10(bad 우선), H2=10(suspect).
    assert points[0]["value"] == pytest.approx(15.0)
    assert points[0]["quality_flag"] == "ok"
    assert points[1]["value"] == pytest.approx(10.0)
    assert points[1]["quality_flag"] == "bad"
    assert points[2]["value"] == pytest.approx(10.0)
    assert points[2]["quality_flag"] == "suspect"


def test_daily_aggregation_sum_and_quality_flag(client, rorg_token):
    resp = client.get(
        f"/sites/{RSITE_ID}/readings",
        params={
            "meter_id": METER_POWER_ID,
            "from": _iso(BASE_TS),
            "to": _iso(BASE_TS + timedelta(hours=3)),
            "granularity": "daily",
        },
        headers={"Authorization": f"Bearer {rorg_token}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    points = body["points"]
    assert len(points) == 1
    # 수기 검산: 하루 합계 = 15+10+10 = 35, bad 가 하나라도 있으므로 flag=bad.
    assert points[0]["value"] == pytest.approx(35.0)
    assert points[0]["quality_flag"] == "bad"


def test_hourly_aggregation_avg_for_non_power_type(client, rorg_token):
    """type != power(DO) 는 AVG 집계(4.1절 타입별 규칙)."""
    resp = client.get(
        f"/sites/{RSITE_ID}/readings",
        params={
            "meter_id": METER_DO_A_ID,
            "from": _iso(BASE_TS),
            "to": _iso(BASE_TS + timedelta(hours=1)),
            "granularity": "hourly",
        },
        headers={"Authorization": f"Bearer {rorg_token}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["unit"] == "mg/L"
    points = body["points"]
    assert len(points) == 1
    # 수기 검산: (6.0 + 6.4) / 2 = 6.2.
    assert points[0]["value"] == pytest.approx(6.2)


# --- tank_id+type 병합 조회 ---


def test_tank_and_type_merges_multiple_meters(client, rorg_token):
    resp = client.get(
        f"/sites/{RSITE_ID}/readings",
        params={
            "tank_id": RTANK_ID,
            "type": "do",
            "from": _iso(BASE_TS),
            "to": _iso(BASE_TS + timedelta(hours=1)),
            "granularity": "hourly",
        },
        headers={"Authorization": f"Bearer {rorg_token}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # tank_id+type 조회는 최상위 meter_id 가 null(4.1절 확장 규칙).
    assert body["meter_id"] is None
    assert body["type"] == "do"
    points = body["points"]
    assert len(points) == 2
    by_meter = {p["meter_id"]: p["value"] for p in points}
    assert by_meter[METER_DO_A_ID] == pytest.approx(6.2)
    assert by_meter[METER_DO_B_ID] == pytest.approx(7.1)


def test_tank_and_type_no_matching_meters_returns_empty(client, rorg_token):
    """유효한 tank+type 조합이나 해당 계측기가 없으면 200/빈 points."""
    resp = client.get(
        f"/sites/{RSITE_ID}/readings",
        params={
            "tank_id": RTANK_ID,
            "type": "temp",
            "from": _iso(BASE_TS),
            "to": _iso(BASE_TS + timedelta(hours=1)),
            "granularity": "hourly",
        },
        headers={"Authorization": f"Bearer {rorg_token}"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["points"] == []


# --- 422: 파라미터 조합 오류 ---


def test_missing_meter_and_tank_params_422(client, rorg_token):
    resp = client.get(
        f"/sites/{RSITE_ID}/readings",
        params={"from": _iso(BASE_TS), "to": _iso(BASE_TS + timedelta(hours=1))},
        headers={"Authorization": f"Bearer {rorg_token}"},
    )
    assert resp.status_code == 422


def test_tank_id_without_type_422(client, rorg_token):
    resp = client.get(
        f"/sites/{RSITE_ID}/readings",
        params={
            "tank_id": RTANK_ID,
            "from": _iso(BASE_TS),
            "to": _iso(BASE_TS + timedelta(hours=1)),
        },
        headers={"Authorization": f"Bearer {rorg_token}"},
    )
    assert resp.status_code == 422


def test_bad_period_422(client, rorg_token):
    resp = client.get(
        f"/sites/{RSITE_ID}/readings",
        params={
            "meter_id": METER_POWER_ID,
            "from": _iso(BASE_TS + timedelta(hours=3)),
            "to": _iso(BASE_TS),
        },
        headers={"Authorization": f"Bearer {rorg_token}"},
    )
    assert resp.status_code == 422


def test_bad_granularity_422(client, rorg_token):
    resp = client.get(
        f"/sites/{RSITE_ID}/readings",
        params={
            "meter_id": METER_POWER_ID,
            "from": _iso(BASE_TS),
            "to": _iso(BASE_TS + timedelta(hours=1)),
            "granularity": "weekly",
        },
        headers={"Authorization": f"Bearer {rorg_token}"},
    )
    assert resp.status_code == 422


# --- 401/403/404: 테넌시 격리 ---


def test_missing_token_401(client):
    resp = client.get(
        f"/sites/{RSITE_ID}/readings",
        params={
            "meter_id": METER_POWER_ID,
            "from": _iso(BASE_TS),
            "to": _iso(BASE_TS + timedelta(hours=1)),
        },
    )
    assert resp.status_code == 401


def test_other_org_site_403(client, rorg_token):
    """RSITE 는 RORG 소속 — SITE1(다른 org)에 rorg 토큰으로 접근하면 403."""
    resp = client.get(
        f"/sites/{SITE1_ID}/readings",
        params={
            "meter_id": METER_POWER_ID,
            "from": _iso(BASE_TS),
            "to": _iso(BASE_TS + timedelta(hours=1)),
        },
        headers={"Authorization": f"Bearer {rorg_token}"},
    )
    assert resp.status_code == 403


def test_unknown_site_404(client, rorg_token):
    resp = client.get(
        "/sites/does-not-exist/readings",
        params={
            "meter_id": METER_POWER_ID,
            "from": _iso(BASE_TS),
            "to": _iso(BASE_TS + timedelta(hours=1)),
        },
        headers={"Authorization": f"Bearer {rorg_token}"},
    )
    assert resp.status_code == 404


def test_meter_from_other_org_403(client, rorg_token):
    """SITE1 소속 meter 를 RSITE 스코프로 조회 — meter.org_id != auth.org_id → 403."""
    resp = client.get(
        f"/sites/{RSITE_ID}/readings",
        params={
            "meter_id": "meter-power-main-0001",  # seed_demo_site.METER_MAIN_ID(org1 소속)
            "from": _iso(BASE_TS),
            "to": _iso(BASE_TS + timedelta(hours=1)),
        },
        headers={"Authorization": f"Bearer {rorg_token}"},
    )
    assert resp.status_code == 403


def test_meter_not_found_404(client, rorg_token):
    resp = client.get(
        f"/sites/{RSITE_ID}/readings",
        params={
            "meter_id": "meter-does-not-exist",
            "from": _iso(BASE_TS),
            "to": _iso(BASE_TS + timedelta(hours=1)),
        },
        headers={"Authorization": f"Bearer {rorg_token}"},
    )
    assert resp.status_code == 404


def test_tank_not_found_404(client, rorg_token):
    resp = client.get(
        f"/sites/{RSITE_ID}/readings",
        params={
            "tank_id": "tank-does-not-exist",
            "type": "do",
            "from": _iso(BASE_TS),
            "to": _iso(BASE_TS + timedelta(hours=1)),
        },
        headers={"Authorization": f"Bearer {rorg_token}"},
    )
    assert resp.status_code == 404


def test_tank_from_other_org_403(client, rorg_token):
    """org1 시드 tank 를 RSITE 스코프로 조회 — tank.org_id != auth.org_id → 403."""
    resp = client.get(
        f"/sites/{RSITE_ID}/readings",
        params={
            "tank_id": "tank-0001",  # seed_demo_site.TANK_ID(org1 소속)
            "type": "do",
            "from": _iso(BASE_TS),
            "to": _iso(BASE_TS + timedelta(hours=1)),
        },
        headers={"Authorization": f"Bearer {rorg_token}"},
    )
    assert resp.status_code == 403


def test_org2_cannot_access_rsite_readings(client):
    """org2(무관 테넌트) 토큰으로 RSITE 접근 시 403(누수 테스트)."""
    token = _make_token(ORG2_ID)
    resp = client.get(
        f"/sites/{RSITE_ID}/readings",
        params={
            "meter_id": METER_POWER_ID,
            "from": _iso(BASE_TS),
            "to": _iso(BASE_TS + timedelta(hours=1)),
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


def test_org2_site_not_leaked_to_rorg(client, rorg_token):
    """SITE2(org2 소속)를 RORG 토큰으로 조회 시 403(양방향 누수 테스트)."""
    resp = client.get(
        f"/sites/{SITE2_ID}/readings",
        params={
            "meter_id": METER_POWER_ID,
            "from": _iso(BASE_TS),
            "to": _iso(BASE_TS + timedelta(hours=1)),
        },
        headers={"Authorization": f"Bearer {rorg_token}"},
    )
    assert resp.status_code == 403
