"""ingestion 파이프라인 검증 — phase-1 슬라이스 E(3.1~3.4절).

커버리지:
  - 정규화: cumulative→interval, instant→interval(사다리꼴), 롤오버→suspect, 결측→bad.
  - 비전력(do_mg_l) 원값 저장.
  - 멱등: (meter_id, ts) 재전송 중복 흡수(deduped, 신규 삽입 0).
  - API Key 스코프 밖 meter → 부분 거부(rejected). 무효/부재 키 → 401.
  - 결정론: 입력 순서 무관 동일 결과(normalize_readings 순수 함수).

격리: seed KPI 회귀 보호를 위해 전용 test meter(seed readings 없음)를 만들고,
각 테스트 후 해당 meter 의 readings 를 정리한다(2026-04, 6월 seed 기간 밖).
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
import seed_demo_site as seed_mod
from sqlalchemy import delete, select

from app.db.session import SessionLocal
from app.models.meter import Meter
from app.models.reading import Reading
from app.services.ingestion import (
    NormalizedReading,
    PriorState,
    RawReading,
    normalize_readings,
)
from tests.conftest import ORG1_ID, ORG2_ID, SITE1_ID, SITE2_ID

# seed 의 데모 API Key 원문(DB 에는 해시만 저장됨).
DEMO_KEY = seed_mod.DEMO_API_KEY_PLAINTEXT

# 전용 test meter(seed readings 없음).
POWER_METER = "meter-ingest-power-0001"
DO_METER = "meter-ingest-do-0001"
# 스코프 밖(타 org/site) meter — 존재하지만 key 스코프 밖.
OTHER_METER = "meter-ingest-other-9001"

_TEST_METERS = (POWER_METER, DO_METER, OTHER_METER)


def _ts(hour: int) -> str:
    return datetime(2026, 4, 1, hour, 0, 0, tzinfo=UTC).isoformat()


@pytest.fixture(scope="module", autouse=True)
def _ingest_meters(_prepare_db):
    """전용 test meter 생성(모듈 1회) → 종료 시 meter+readings 제거."""
    with SessionLocal() as s:
        s.add(Meter(id=POWER_METER, site_id=SITE1_ID, org_id=ORG1_ID,
                    type="power", unit="kWh_interval", is_aeration=False))
        s.add(Meter(id=DO_METER, site_id=SITE1_ID, org_id=ORG1_ID,
                    type="do", unit="mg_L", is_aeration=False))
        # 스코프 밖: 타 org(ORG2)/site(SITE2) 소속 meter.
        s.add(Meter(id=OTHER_METER, site_id=SITE2_ID, org_id=ORG2_ID,
                    type="power", unit="kWh_interval", is_aeration=False))
        s.commit()
    yield
    with SessionLocal() as s:
        s.execute(delete(Reading).where(Reading.meter_id.in_(_TEST_METERS)))
        s.execute(delete(Meter).where(Meter.id.in_(_TEST_METERS)))
        s.commit()


@pytest.fixture(autouse=True)
def _clear_readings():
    """각 테스트 전후 test meter 의 readings 정리(테스트 독립성·멱등 검증 신뢰성)."""
    with SessionLocal() as s:
        s.execute(delete(Reading).where(Reading.meter_id.in_(_TEST_METERS)))
        s.commit()
    yield
    with SessionLocal() as s:
        s.execute(delete(Reading).where(Reading.meter_id.in_(_TEST_METERS)))
        s.commit()


def _hdr(key: str = DEMO_KEY) -> dict:
    return {"X-API-Key": key}


def _fetch(meter_id: str) -> list[Reading]:
    with SessionLocal() as s:
        return list(
            s.execute(
                select(Reading)
                .where(Reading.meter_id == meter_id)
                .order_by(Reading.time.asc())
            ).scalars().all()
        )


# --- 정규화: cumulative → interval ---

def test_cumulative_to_interval(client):
    """적산 kWh → 직전 대비 Δ = interval kWh. 최초는 기준선(bad, 0)."""
    resp = client.post(
        "/ingest/readings",
        json={"gateway_id": "gw-1", "readings": [
            {"meter_id": POWER_METER, "ts": _ts(0), "value": 1000.0, "reading_kind": "cumulative_kwh"},
            {"meter_id": POWER_METER, "ts": _ts(1), "value": 1012.0, "reading_kind": "cumulative_kwh"},
            {"meter_id": POWER_METER, "ts": _ts(2), "value": 1025.0, "reading_kind": "cumulative_kwh"},
        ]},
        headers=_hdr(),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["accepted"] == 3 and body["deduped"] == 0 and body["rejected"] == []

    rows = _fetch(POWER_METER)
    assert [r.quality_flag for r in rows] == ["bad", "ok", "ok"]
    assert rows[0].value == pytest.approx(0.0)   # 최초 기준선(interval 없음)
    assert rows[1].value == pytest.approx(12.0)  # 1012-1000
    assert rows[2].value == pytest.approx(13.0)  # 1025-1012


# --- 정규화: instant → interval(사다리꼴) + 결측 → bad ---

def test_instant_to_interval_trapezoid(client):
    """순시 kW × Δt(h) 사다리꼴. 직전 없는 최초는 결측 → bad."""
    resp = client.post(
        "/ingest/readings",
        json={"gateway_id": "gw-1", "readings": [
            {"meter_id": POWER_METER, "ts": _ts(0), "value": 100.0, "reading_kind": "instant_kw"},
            {"meter_id": POWER_METER, "ts": _ts(1), "value": 100.0, "reading_kind": "instant_kw"},
            {"meter_id": POWER_METER, "ts": _ts(2), "value": 120.0, "reading_kind": "instant_kw"},
        ]},
        headers=_hdr(),
    )
    assert resp.status_code == 200, resp.text
    rows = _fetch(POWER_METER)
    assert [r.quality_flag for r in rows] == ["bad", "ok", "ok"]
    assert rows[0].value == pytest.approx(0.0)     # 최초: 직전 없음 → 결측
    assert rows[1].value == pytest.approx(100.0)   # (100+100)/2 * 1h
    assert rows[2].value == pytest.approx(110.0)   # (100+120)/2 * 1h


def test_single_instant_missing_is_bad(client):
    """단일 순시값(직전 간격 없음) → 결측 → bad."""
    resp = client.post(
        "/ingest/readings",
        json={"gateway_id": "gw-1", "readings": [
            {"meter_id": POWER_METER, "ts": _ts(5), "value": 90.0, "reading_kind": "instant_kw"},
        ]},
        headers=_hdr(),
    )
    assert resp.status_code == 200, resp.text
    rows = _fetch(POWER_METER)
    assert len(rows) == 1 and rows[0].quality_flag == "bad"


# --- 정규화: 롤오버/리셋 → suspect ---

def test_cumulative_rollover_suspect(client):
    """적산 카운터 리셋(음수 Δ) → suspect(원값 보존, ADR 0001)."""
    resp = client.post(
        "/ingest/readings",
        json={"gateway_id": "gw-1", "readings": [
            {"meter_id": POWER_METER, "ts": _ts(0), "value": 1000.0, "reading_kind": "cumulative_kwh"},
            {"meter_id": POWER_METER, "ts": _ts(1), "value": 1012.0, "reading_kind": "cumulative_kwh"},
            {"meter_id": POWER_METER, "ts": _ts(2), "value": 5.0, "reading_kind": "cumulative_kwh"},
        ]},
        headers=_hdr(),
    )
    assert resp.status_code == 200, resp.text
    rows = _fetch(POWER_METER)
    assert [r.quality_flag for r in rows] == ["bad", "ok", "suspect"]
    assert rows[2].value == pytest.approx(5.0)  # 리셋 후 원값 보존


# --- 비전력: do_mg_l 원값 저장 ---

def test_do_raw_value_stored(client):
    """DO(mg/L)는 변환 없이 원값 저장, 범위 내 → ok."""
    resp = client.post(
        "/ingest/readings",
        json={"gateway_id": "gw-1", "readings": [
            {"meter_id": DO_METER, "ts": _ts(0), "value": 6.8, "reading_kind": "do_mg_l"},
            {"meter_id": DO_METER, "ts": _ts(1), "value": 99.0, "reading_kind": "do_mg_l"},
        ]},
        headers=_hdr(),
    )
    assert resp.status_code == 200, resp.text
    rows = _fetch(DO_METER)
    assert rows[0].value == pytest.approx(6.8) and rows[0].quality_flag == "ok"
    # 범위 밖(>20) → 원값 저장 + suspect.
    assert rows[1].value == pytest.approx(99.0) and rows[1].quality_flag == "suspect"


# --- 멱등: (meter_id, ts) 재전송 중복 흡수 ---

def test_idempotent_resend(client):
    """같은 배치 2회 전송 → 2번째는 전부 deduped, 신규 삽입 0."""
    payload = {"gateway_id": "gw-1", "readings": [
        {"meter_id": POWER_METER, "ts": _ts(0), "value": 1000.0, "reading_kind": "cumulative_kwh"},
        {"meter_id": POWER_METER, "ts": _ts(1), "value": 1012.0, "reading_kind": "cumulative_kwh"},
    ]}
    first = client.post("/ingest/readings", json=payload, headers=_hdr())
    assert first.json()["accepted"] == 2 and first.json()["deduped"] == 0
    second = client.post("/ingest/readings", json=payload, headers=_hdr())
    assert second.json()["accepted"] == 0 and second.json()["deduped"] == 2
    # 실제 저장 행수 불변(정확히 한 번).
    assert len(_fetch(POWER_METER)) == 2


# --- 스코프/인증 ---

def test_out_of_scope_meter_rejected(client):
    """key 스코프(org1/site1) 밖 meter → 부분 거부(rejected), in-scope 는 저장."""
    resp = client.post(
        "/ingest/readings",
        json={"gateway_id": "gw-1", "readings": [
            {"meter_id": POWER_METER, "ts": _ts(0), "value": 500.0, "reading_kind": "interval_kwh"},
            {"meter_id": OTHER_METER, "ts": _ts(0), "value": 500.0, "reading_kind": "interval_kwh"},
        ]},
        headers=_hdr(),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["accepted"] == 1
    assert len(body["rejected"]) == 1
    assert body["rejected"][0]["index"] == 1
    assert "scope" in body["rejected"][0]["reason"]
    assert _fetch(OTHER_METER) == []  # 스코프 밖은 저장 안 됨


def test_unknown_meter_rejected(client):
    """미지 meter_id → rejected."""
    resp = client.post(
        "/ingest/readings",
        json={"gateway_id": "gw-1", "readings": [
            {"meter_id": "no-such-meter", "ts": _ts(0), "value": 1.0, "reading_kind": "interval_kwh"},
        ]},
        headers=_hdr(),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["accepted"] == 0 and len(resp.json()["rejected"]) == 1


def test_invalid_api_key_401(client):
    """무효 키 → 401."""
    resp = client.post(
        "/ingest/readings",
        json={"gateway_id": "gw-1", "readings": [
            {"meter_id": POWER_METER, "ts": _ts(0), "value": 1.0, "reading_kind": "interval_kwh"},
        ]},
        headers=_hdr("totally-wrong-key"),
    )
    assert resp.status_code == 401


def test_missing_api_key_401(client):
    """키 헤더 부재 → 401."""
    resp = client.post(
        "/ingest/readings",
        json={"gateway_id": "gw-1", "readings": [
            {"meter_id": POWER_METER, "ts": _ts(0), "value": 1.0, "reading_kind": "interval_kwh"},
        ]},
    )
    assert resp.status_code == 401


def test_empty_batch_422(client):
    """빈 배치(스키마 위반) → 422."""
    resp = client.post(
        "/ingest/readings",
        json={"gateway_id": "gw-1", "readings": []},
        headers=_hdr(),
    )
    assert resp.status_code == 422


# --- 결정론: 입력 순서 무관 동일 결과(순수 함수) ---

def test_normalize_deterministic_order_independent():
    """normalize_readings 는 입력 순서와 무관하게 동일 결과(ts 정렬 후 처리)."""
    raws = [
        RawReading(index=0, meter_id="m", ts=datetime(2026, 4, 1, 0, tzinfo=UTC),
                   value=1000.0, reading_kind="cumulative_kwh"),
        RawReading(index=1, meter_id="m", ts=datetime(2026, 4, 1, 1, tzinfo=UTC),
                   value=1012.0, reading_kind="cumulative_kwh"),
        RawReading(index=2, meter_id="m", ts=datetime(2026, 4, 1, 2, tzinfo=UTC),
                   value=1025.0, reading_kind="cumulative_kwh"),
    ]
    forward = normalize_readings(raws)
    shuffled = normalize_readings(list(reversed(raws)))
    assert forward == shuffled
    assert [n.value for n in forward] == pytest.approx([0.0, 12.0, 13.0])
    assert all(isinstance(n, NormalizedReading) for n in forward)


def test_normalize_cross_batch_boundary_suspect():
    """직전 저장 이력만 있고 배치 내 직전값 없으면 cumulative 는 산출불가 → suspect."""
    raws = [
        RawReading(index=0, meter_id="m", ts=datetime(2026, 4, 1, 3, tzinfo=UTC),
                   value=1040.0, reading_kind="cumulative_kwh"),
    ]
    prior = {"m": PriorState(ts=datetime(2026, 4, 1, 2, tzinfo=UTC), value=13.0)}
    out = normalize_readings(raws, prior)
    assert out[0].quality_flag == "suspect"
