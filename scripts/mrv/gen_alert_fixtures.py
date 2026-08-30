"""알림 배치 평가 차분 검증용 기준값 생성기 (원본 Python → JSON).

`lib/mrv/alert-jobs.ts::jobEvaluateAlerts` 는 원본 `app/services/alert_jobs.py` 의
이식본이다. 이 계층은 **위험을 사람에게 알리는 마지막 관문**이라, 틀리면 알림이 안 오거나
(놓친 사고) 쓸데없이 와서(경보 피로) 결국 아무도 안 보게 된다. 눈으로 대조할 자리가 아니다.

같은 DB 행을 양쪽에 넣고 "어떤 알림이 몇 개, 어떤 payload 로 만들어지는가"를 비교한다.
검증이 실제로 태우는 경로:

  - 3종 트리거가 각각 켜지는 조건과 켜지지 않는 조건
  - 구독 스위치(alert_enabled_types[type] = false)가 생성을 막는가
  - 중복 억제(같은 site+type 에 open 알림이 이미 있으면 안 만든다)
  - kpi_red 가 여러 지표에서 동시에 red 여도 type 단위로 하나만 만드는가
  - 사이트가 여럿일 때 사이트마다 독립으로 판정하는가

실행:
    python3 scripts/mrv/gen_alert_fixtures.py > scripts/mrv/alert-fixtures.json
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
from app.models.alert import Alert  # noqa: E402
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
from app.services.alert_jobs import job_evaluate_alerts  # noqa: E402

ORG = "org-a"
# 배치 실행 시각을 고정한다. 원본은 기본값이 now() 지만 인자로 받으므로 결정론이 된다.
EVAL_AT = datetime(2026, 6, 20, 9, 0, tzinfo=timezone.utc)
QUALITY = ("ok", "ok", "ok", "suspect", "bad")


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def make_scenario(rng: random.Random, index: int) -> dict:
    """사이트 1~3개짜리 조직 하나를 만든다(원본과 이식본에 똑같이 넣을 행)."""
    n_sites = rng.randrange(1, 4)
    sites, tanks, meters, readings = [], [], [], []
    batches, mortality_logs, feed_logs, harvest_logs = [], [], [], []
    existing_alerts = []

    for s in range(n_sites):
        site_id = f"site-{index}-{s}"

        # 구독 스위치: 대부분 전부 켜 두되 가끔 한 종류를 끈다(생성 차단 경로).
        enabled = {"do_low": True, "mortality_spike": True, "kpi_red": True}
        if rng.random() < 0.25:
            enabled[rng.choice(list(enabled))] = False
        sites.append({"id": site_id, "org_id": ORG, "name": f"사이트 {s}",
                      "alert_enabled_types": enabled})

        # 이미 열려 있는 알림을 가끔 심는다(중복 억제 경로).
        if rng.random() < 0.3:
            t = rng.choice(["do_low", "mortality_spike", "kpi_red"])
            existing_alerts.append({
                "id": f"alert-pre-{index}-{s}", "site_id": site_id, "org_id": ORG,
                "type": t, "severity": "warning",
                "payload_json": {"seeded": True}, "status": "open",
            })

        tank_id = f"tank-{index}-{s}"
        tanks.append({"id": tank_id, "site_id": site_id, "org_id": ORG, "name": "수조",
                      "volume_m3": 100.0, "target_do_min": 4.0, "target_do_max": 7.0})

        # power(메인) · power(폭기) · do — 셋이 있어야 EI/OEI 가 실제로 산출된다.
        mids = []
        for i, (mtype, aer) in enumerate(
            [("power", False), ("power", True), ("do", False)]
        ):
            mid = f"mtr-{index}-{s}-{i}"
            mids.append((mid, mtype))
            meters.append({"id": mid, "site_id": site_id, "org_id": ORG, "type": mtype,
                           "unit": "kWh_interval" if mtype == "power" else "raw",
                           "is_aeration": aer, "tank_id": tank_id})

        # 계측값은 평가 시각 이전 30일에 흩뿌린다. DO 는 임계(기본 3.0) 아래위를 오가게
        # 폭을 잡아, do_low 가 켜지는 시나리오와 안 켜지는 시나리오가 모두 나오게 한다.
        do_low_case = rng.random() < 0.5
        for _ in range(rng.randrange(20, 90)):
            mid, mtype = rng.choice(mids)
            minutes_ago = rng.randrange(0, 30 * 24 * 60)
            if mtype == "do":
                value = round(rng.uniform(1.0, 2.9) if do_low_case
                              else rng.uniform(3.5, 8.0), 4)
            else:
                value = round(rng.uniform(0.0, 15.0), 4)
            readings.append({
                "time": iso(EVAL_AT - timedelta(minutes=minutes_ago)),
                "meter_id": mid, "org_id": ORG, "value": value,
                "quality_flag": rng.choice(QUALITY),
            })

        # do_low 는 **최근 24시간 안의 최신 유효 샘플** 하나만 본다. 위 30일 산포만으로는
        # 그 창에 DO 가 걸리는 일이 드물어 트리거가 거의 안 태워진다. 최근 창에 몇 개를
        # 몰아 넣어 "켜짐"과 "안 켜짐" 양쪽이 고르게 나오게 한다.
        do_mid = next(mid for mid, mtype in mids if mtype == "do")
        for _ in range(rng.randrange(1, 5)):
            recent_min = rng.randrange(0, 24 * 60)
            readings.append({
                "time": iso(EVAL_AT - timedelta(minutes=recent_min)),
                "meter_id": do_mid, "org_id": ORG,
                "value": round(rng.uniform(1.0, 2.9) if do_low_case
                               else rng.uniform(3.5, 8.0), 4),
                # 최신 샘플이 'ok' 가 아니면 그 다음 유효 샘플을 봐야 한다 — 그 경로도 태운다.
                "quality_flag": rng.choice(QUALITY),
            })

        batch_id = f"batch-{index}-{s}"
        batches.append({"id": batch_id, "tank_id": tank_id, "org_id": ORG,
                        "species": "litopenaeus_vannamei",
                        "stocked_count": rng.choice([0, 8000, 20000]),
                        "stocked_at": iso(EVAL_AT - timedelta(days=60)),
                        "closed_at": None})

        # 폐사: 평소는 적게, 당일은 크게(급증 경로) 또는 평소만큼(비급증 경로).
        spike_case = rng.random() < 0.5
        for d in range(1, 9):
            for _ in range(rng.randrange(0, 3)):
                mortality_logs.append({
                    "id": f"mort-{index}-{s}-{d}-{rng.randrange(10**6)}",
                    "batch_id": batch_id, "org_id": ORG,
                    "ts": iso(EVAL_AT - timedelta(days=d, hours=rng.randrange(0, 20))),
                    "dead_count": rng.randrange(0, 6), "cause_note": None,
                })
        today_dead = rng.randrange(30, 90) if spike_case else rng.randrange(0, 4)
        mortality_logs.append({
            "id": f"mort-{index}-{s}-today",
            "batch_id": batch_id, "org_id": ORG,
            "ts": iso(EVAL_AT - timedelta(hours=1)),
            "dead_count": today_dead, "cause_note": None,
        })

        for j in range(rng.randrange(0, 20)):
            feed_logs.append({
                "id": f"feed-{index}-{s}-{j:03d}", "batch_id": batch_id, "org_id": ORG,
                "ts": iso(EVAL_AT - timedelta(days=rng.randrange(0, 30))),
                "feed_kg": round(rng.uniform(0.0, 60.0), 3),
                "source": "manual", "quality_flag": rng.choice(QUALITY),
            })

        # 생체량은 대체로 늘린다 — 그래야 EI/FCR 이 산출돼 kpi_red 판정이 실제로 돈다.
        biomass = round(rng.uniform(50.0, 400.0), 3)
        n_h = rng.choice([0, 2, 4])
        for j in range(n_h):
            harvest_logs.append({
                "id": f"hv-{index}-{s}-{j}", "batch_id": None, "site_id": site_id,
                "org_id": ORG,
                "ts": iso(EVAL_AT - timedelta(days=28 - j * 7)),
                "biomass_kg": biomass, "count": None,
            })
            biomass = round(max(0.0, biomass + rng.uniform(20.0, 600.0)), 3)

    # kpi_config: 없거나(엔진 기본값) 임계·구독 목록을 바꾼 실증 보정본이거나.
    kpi_config = None
    if rng.random() < 0.55:
        kpi_config = {
            "id": f"cfg-{index}", "version": "2026.2.0",
            "params_json": {
                "alerting": {
                    "do_low_mg_l": rng.choice([2.5, 3.0, 4.0]),
                    "mortality_spike_ratio": rng.choice([1.5, 2.0, 3.0]),
                    "mortality_spike_min_count": rng.choice([1, 5, 20]),
                    # 순서가 결과를 가른다(dedup 이 type 단위라 첫 red 가 알림을 차지한다).
                    "kpi_red_metrics": rng.choice([
                        ["ei_total", "fcr", "mortality_rate", "oei"],
                        ["mortality_rate", "fcr"],
                        ["oei"],
                        [],
                    ]),
                    "thresholds": {
                        "ei_total": {"red_threshold": rng.choice([1.0, 8.5]),
                                     "amber_threshold": 0.5},
                        "fcr": {"red_threshold": rng.choice([0.5, 1.6]),
                                "amber_threshold": 0.4},
                        "mortality_rate": {"red_threshold": rng.choice([0.5, 12.0]),
                                           "amber_threshold": 0.2},
                        # oei 는 higher_is_better 라 red <= amber 여야 한다(엔진이 검증한다).
                        # 9999/99999 쪽은 어떤 실제 OEI 도 red 가 되는 조합이다.
                        "oei": rng.choice([
                            {"red_threshold": 50.0, "amber_threshold": 60.0},
                            {"red_threshold": 9999.0, "amber_threshold": 99999.0},
                        ]),
                        "ei_aeration": {"red_threshold": 6.0, "amber_threshold": 5.0},
                    },
                },
            },
            "effective_from": iso(EVAL_AT - timedelta(days=90)),
        }

    return {
        "name": f"alerts-{index}",
        "evaluatedAt": iso(EVAL_AT),
        "rows": {
            "sites": sites, "tanks": tanks, "meters": meters, "readings": readings,
            "batches": batches, "feed_logs": feed_logs,
            "mortality_logs": mortality_logs, "harvest_logs": harvest_logs,
            "alerts": existing_alerts, "kpi_config": kpi_config,
        },
    }


def run_original(scenario: dict) -> list[dict]:
    """in-memory SQLite 에 행을 앉히고 원본 배치를 돌린다."""
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    rows = scenario["rows"]

    def dt(s: str) -> datetime:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))

    with Session(engine) as session:
        session.add(Organization(id=ORG, name="조직", plan="ENTERPRISE"))
        for s in rows["sites"]:
            session.add(Site(**s))
        for t in rows["tanks"]:
            session.add(Tank(**t))
        for m in rows["meters"]:
            session.add(Meter(**m))
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
        for a in rows["alerts"]:
            session.add(Alert(**a))
        if rows["kpi_config"]:
            c = rows["kpi_config"]
            session.add(KpiConfig(id=c["id"], version=c["version"],
                                  params_json=c["params_json"],
                                  effective_from=dt(c["effective_from"])))
        session.commit()

        created = job_evaluate_alerts(session, evaluated_at=dt(scenario["evaluatedAt"]))
        # ★ 커밋 전에 속성을 읽는다(원본 docstring 의 반환값 사용 계약).
        out = [{"siteId": a.site_id, "type": a.type, "severity": a.severity,
                "payload": a.payload_json} for a in created]
        session.commit()

    # 생성 순서는 사이트 순회 순서에 달려 있다. 양쪽 순회 순서가 다를 수 있으므로
    # (site_id, type) 로 정렬해 **집합으로** 비교한다 — 무엇이 만들어졌는가가 계약이다.
    out.sort(key=lambda a: (a["siteId"], a["type"]))
    return out


def main() -> None:
    rng = random.Random(20260620)
    cases = []
    for i in range(60):
        sc = make_scenario(rng, i)
        sc["expected"] = run_original(sc)
        cases.append(sc)

    total = sum(len(c["expected"]) for c in cases)
    n_sites = sum(len(c["rows"]["sites"]) for c in cases)
    print(json.dumps({"cases": cases, "meta": {
        "scenarios": len(cases), "sites": n_sites, "alertsCreated": total,
    }}, ensure_ascii=False))


if __name__ == "__main__":
    main()
