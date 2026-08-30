"""KPI 조립 계층 차분 검증용 기준값 생성기 (원본 Python → JSON).

`lib/mrv/kpi-service.ts::computeSiteKpiResults` 는 DB 행을 KPI 엔진 입력으로 옮기는
계층이다. 산식(엔진)과 설정 해석(config)은 이미 각각 대조해 뒀지만, 그 사이에서
**어떤 행을 골라 어떤 필드에 넣는가**는 아직 검증된 적이 없다. 이 계층이 어긋나면
— 계측값 기간을 반대로 자르거나, 폭기 서브미터를 잘못 가르거나, 생체량 개시/마감을
다르게 고르면 — 엔진이 아무리 정확해도 결과가 틀린다.

그래서 같은 DB 행을 양쪽에 넣고 산출을 비교한다. 원본은 in-memory SQLite 에 실제
SQLAlchemy 모델로 행을 앉히고 `compute_site_kpi_results` 를 돌린다. 이식본은 같은 행을
가짜 Supabase 질의 빌더로 돌려받아 `computeSiteKpiResults` 를 돌린다.

실행:
    python3 scripts/mrv/gen_pipeline_fixtures.py > scripts/mrv/pipeline-fixtures.json
"""

from __future__ import annotations

import json
import os
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
API = ROOT / "mrv-platform" / "apps" / "api"

os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")
os.environ.setdefault("AUTH_MODE", "test-local")
os.environ.setdefault("JWT_SECRET", "x" * 32)

sys.path.insert(0, str(API))
sys.path.insert(0, str(ROOT / "mrv-platform" / "packages" / "kpi"))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.models import Base  # noqa: E402
from app.models.batch import Batch  # noqa: E402
from app.models.feed_log import FeedLog  # noqa: E402
from app.models.harvest_log import HarvestLog  # noqa: E402
from app.models.kpi_config import KpiConfig  # noqa: E402
from app.models.meter import Meter  # noqa: E402
from app.models.mortality_log import MortalityLog  # noqa: E402
from app.models.organization import Organization  # noqa: E402
from app.models.reading import Reading  # noqa: E402
from app.models.site import Site  # noqa: E402
from app.models.tank import Tank  # noqa: E402
from app.services.kpi_service import compute_site_kpi_results  # noqa: E402

ORG = "org-p"
SITE = "site-p"
T0 = datetime(2026, 6, 1, tzinfo=timezone.utc)
QUALITY = ("ok", "ok", "ok", "suspect", "bad")


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def make_scenario(rng: random.Random, index: int) -> dict:
    """DB 행 묶음 하나를 만든다(양쪽에 똑같이 넣을 원본 데이터)."""
    n_tanks = rng.randrange(1, 4)
    tanks = []
    for i in range(n_tanks):
        # 목표대역이 없는 수조도 섞는다 — OEI 대상 수조 선택 규칙(첫 유효 대역)을 시험한다.
        has_band = rng.random() < 0.7
        tanks.append({
            "id": f"tank-{index}-{i}",
            "site_id": SITE,
            "org_id": ORG,
            "name": f"수조 {i}",
            "volume_m3": 100.0,
            "target_do_min": 4.0 if has_band else None,
            "target_do_max": 7.0 if has_band else None,
        })

    # 전력계(메인) · 폭기 서브미터 · DO 를 대부분 갖춘 사이트로 만든다. 셋이 모두 있어야
    # OEI 산출 경로가 실제로 돌아 양쪽 결과를 숫자로 비교할 수 있다. 일부 시나리오는
    # 일부러 비워 '산출 불가' 경로도 함께 태운다.
    def meter(i: int, mtype: str, is_aeration: bool) -> dict:
        return {
            "id": f"mtr-{index}-{i}",
            "site_id": SITE,
            "org_id": ORG,
            "type": mtype,
            "unit": "kWh_interval" if mtype == "power" else "raw",
            # 폭기 서브미터 여부가 폭기전력 EI 의 분자를 가른다.
            "is_aeration": is_aeration,
            "tank_id": tanks[rng.randrange(n_tanks)]["id"] if rng.random() < 0.6 else None,
        }

    meters = [meter(0, "power", False)]
    if rng.random() < 0.85:
        meters.append(meter(1, "power", True))
    if rng.random() < 0.85:
        meters.append(meter(2, "do", False))
    if rng.random() < 0.5:
        meters.append(meter(3, "temp", False))

    # 조회 기간을 먼저 정한다 — 계측값과 생체량을 이 구간에 걸쳐 놓아야 산출이 실제로 된다.
    win_start = T0 + timedelta(days=rng.randrange(0, 5))
    win_end = win_start + timedelta(days=rng.randrange(5, 16))
    span_min = int((win_end - win_start).total_seconds() // 60)

    readings = []
    for _ in range(rng.randrange(10, 120)):
        m = rng.choice(meters)
        # 대부분은 기간 안에, 일부는 밖에 둔다(기간 밖 제외 경로도 태운다).
        offset = (rng.randrange(0, span_min) if rng.random() < 0.85
                  else rng.randrange(-4000, span_min + 4000))
        readings.append({
            "time": iso(win_start + timedelta(minutes=offset)),
            "meter_id": m["id"],
            "org_id": ORG,
            # DO 계측기는 목표대역(4~7) 안팎이 섞이도록 폭을 잡는다.
            "value": (round(rng.uniform(2.0, 9.0), 4) if m["type"] == "do"
                      else round(rng.uniform(0.0, 12.0), 4)),
            "quality_flag": rng.choice(QUALITY),
        })
    # (time, meter_id) 가 PK 라 중복은 넣을 수 없다.
    seen = set()
    readings = [r for r in readings
                if not ((r["time"], r["meter_id"]) in seen or seen.add((r["time"], r["meter_id"])))]

    batches = [{
        "id": f"batch-{index}-{i}",
        "tank_id": tanks[i % n_tanks]["id"],
        "org_id": ORG,
        "species": "litopenaeus_vannamei",
        "stocked_count": rng.choice([0, 500, 12000]),
        "stocked_at": iso(T0),
        "closed_at": None,
    } for i in range(rng.randrange(1, 3))]

    feed_logs = [{
        "id": f"feed-{index}-{j:03d}",
        "batch_id": rng.choice(batches)["id"],
        "org_id": ORG,
        "ts": iso(win_start + timedelta(minutes=rng.randrange(-2000, span_min + 2000))),
        "feed_kg": round(rng.uniform(0.0, 40.0), 3),
        "source": "manual",
        "quality_flag": rng.choice(QUALITY),
    } for j in range(rng.randrange(0, 30))]

    mortality_logs = [{
        "id": f"mort-{index}-{j:03d}",
        "batch_id": rng.choice(batches)["id"],
        "org_id": ORG,
        "ts": iso(win_start + timedelta(minutes=rng.randrange(-2000, span_min + 2000))),
        "dead_count": rng.randrange(0, 60),
        "cause_note": None,
    } for j in range(rng.randrange(0, 25))]

    # 생체량은 대체로 늘어난다(실제 양식 사이클). 그래야 EI/FCR/OEI 가 '산출 불가'로
    # 빠지지 않고 실제 값이 나와 양쪽 산출을 숫자로 비교할 수 있다. 다만 가끔 감소·정체도
    # 섞어 '산출 불가' 경로도 함께 태운다.
    harvest_logs = []
    biomass = round(rng.uniform(0.0, 500.0), 3)
    n_harvest = rng.choice([0, 1, 3, 4, 5])
    for j in range(n_harvest):
        harvest_logs.append({
            "id": f"hv-{index}-{j}",
            "batch_id": None,
            "site_id": SITE,
            "org_id": ORG,
            # 조회 기간 안에 고르게 배치 — 개시/마감 두 시점이 잡혀야 Δbiomass 가 나온다.
            "ts": iso(win_start + timedelta(
                minutes=int(span_min * (j + 0.5) / max(1, n_harvest)))),
            "biomass_kg": biomass,
            "count": None,
        })
        # 대개 늘지만 가끔 줄기도 한다(줄면 '산출 불가' — 그 경로도 확인 대상이다).
        step = rng.uniform(-200.0, 100.0) if rng.random() < 0.15 else rng.uniform(80.0, 900.0)
        biomass = round(max(0.0, biomass + step), 3)

    # kpi_config: 없거나(엔진 기본값) 실증 보정본이거나.
    kpi_config = None
    if rng.random() < 0.5:
        kpi_config = {
            "id": f"cfg-{index}",
            "version": "2026.2.0",
            "params_json": {
                "ei": {"included_quality_flags": ["ok", "suspect"],
                       "min_biomass_delta_kg": rng.choice([0.0, 50.0])},
                "fcr": {"included_quality_flags": ["ok"], "min_biomass_delta_kg": 0.0},
                "oei": {"included_quality_flags": ["ok"], "min_biomass_kg": 0.0,
                        "do_band_method": "sample_count",
                        "oei_scale_factor": rng.choice([1.0, 12.5]),
                        "clamp_max": 100.0},
                "mortality": {"moving_avg_window_days": rng.choice([3, 7])},
            },
            "effective_from": iso(T0 - timedelta(days=30)),
        }

    return {
        "name": f"pipeline-{index}",
        "rows": {
            "tanks": tanks,
            "meters": meters,
            "readings": readings,
            "batches": batches,
            "feed_logs": feed_logs,
            "mortality_logs": mortality_logs,
            "harvest_logs": harvest_logs,
            "kpi_config": kpi_config,
        },
        "period": {"from": iso(win_start), "to": iso(win_end)},
    }


def run_original(scenario: dict) -> dict:
    """in-memory SQLite 에 행을 앉히고 원본 조립 계층을 돌린다."""
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    rows = scenario["rows"]

    def dt(s: str) -> datetime:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))

    with Session(engine) as session:
        session.add(Organization(id=ORG, name="조직", plan="ENTERPRISE"))
        session.add(Site(id=SITE, org_id=ORG, name="사이트"))
        for t in rows["tanks"]:
            session.add(Tank(**{**t}))
        for m in rows["meters"]:
            session.add(Meter(**{**m}))
        for r in rows["readings"]:
            session.add(Reading(time=dt(r["time"]), meter_id=r["meter_id"],
                                org_id=r["org_id"], value=r["value"],
                                quality_flag=r["quality_flag"]))
        for b in rows["batches"]:
            session.add(Batch(**{**b, "stocked_at": dt(b["stocked_at"]), "closed_at": None}))
        for f in rows["feed_logs"]:
            session.add(FeedLog(**{**f, "ts": dt(f["ts"])}))
        for m in rows["mortality_logs"]:
            session.add(MortalityLog(**{**m, "ts": dt(m["ts"])}))
        for h in rows["harvest_logs"]:
            session.add(HarvestLog(**{**h, "ts": dt(h["ts"])}))
        if rows["kpi_config"]:
            c = rows["kpi_config"]
            session.add(KpiConfig(id=c["id"], version=c["version"],
                                  params_json=c["params_json"],
                                  effective_from=dt(c["effective_from"])))
        session.commit()

        comp = compute_site_kpi_results(
            session, SITE, dt(scenario["period"]["from"]), dt(scenario["period"]["to"])
        )

    oei = comp.oei
    return {
        "configVersion": comp.config_version,
        "tankId": comp.tank_id,
        "ei": {
            "eiTotal": comp.ei.ei_total,
            "eiAeration": comp.ei.ei_aeration,
            "totalPowerKwh": comp.ei.total_power_kwh,
            "aerationPowerKwh": comp.ei.aeration_power_kwh,
            "biomassStartKg": comp.ei.biomass_start_kg,
            "biomassEndKg": comp.ei.biomass_end_kg,
            "biomassDeltaKg": comp.ei.biomass_delta_kg,
            "includedReadingCount": comp.ei.included_reading_count,
            "excludedReadingCount": comp.ei.excluded_reading_count,
            "sourceMeterIds": list(comp.ei.source_meter_ids),
            "sourceBiomassRefs": list(comp.ei.source_biomass_refs),
        },
        "fcr": {
            "fcr": comp.fcr.fcr,
            "totalFeedKg": comp.fcr.total_feed_kg,
            "includedFeedCount": comp.fcr.included_feed_count,
            "excludedFeedCount": comp.fcr.excluded_feed_count,
            "sourceFeedRefs": list(comp.fcr.source_feed_refs),
        },
        "oei": None if oei is None else {
            "oei": oei.oei,
            "doInBandFraction": oei.do_in_band_fraction,
            "doTotalSamples": oei.do_total_samples,
            "doInBandSamples": oei.do_in_band_samples,
            "doExcludedSamples": oei.do_excluded_samples,
            "aerationPowerKwh": oei.aeration_power_kwh,
            "bandMin": oei.band_min,
            "bandMax": oei.band_max,
            "oeiRaw": oei.oei_raw,
            "scaleFactor": oei.scale_factor,
            "sourceDoMeterIds": list(oei.source_do_meter_ids),
            "sourceAerationMeterIds": list(oei.source_aeration_meter_ids),
        },
        "mortality": {
            "cumulativeRatePct": comp.mortality.cumulative_rate_pct,
            "totalDeadCount": comp.mortality.total_dead_count,
            "stockedCount": comp.mortality.stocked_count,
            "daily": [{"date": d.date.isoformat(), "deadCount": d.dead_count,
                       "dailyRatePct": d.daily_rate_pct} for d in comp.mortality.daily],
            "movingAvg": [{"date": p.date.isoformat(), "maRatePct": p.ma_rate_pct}
                          for p in comp.mortality.moving_avg],
            "sourceRefs": list(comp.mortality.source_refs),
        },
    }


def build() -> dict:
    rng = random.Random(20260831)
    cases = []
    for i in range(25):
        scenario = make_scenario(rng, i)
        scenario["expected"] = run_original(scenario)
        cases.append(scenario)
    return {"generatedBy": "app.services.kpi_service (python original)", "cases": cases}


if __name__ == "__main__":
    json.dump(build(), sys.stdout, ensure_ascii=False, indent=1)
    sys.stdout.write("\n")
