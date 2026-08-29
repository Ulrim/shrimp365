"""seed_demo_site — 결정론적·멱등 데모 시드(sprint-0 2.5절 + phase-1 S0 확장).

생성물:
  org 1(plan=START) → site 1
    → users 3(owner/operator/viewer)
    → meters 3(power main, power blower[is_aeration=true], DO[type='do'])
    → tanks 1(target_do_min/max 설정) → batches 1(stocked_count=100000)
    → 한 달치 시간단위 readings:
        · power(main/blower) interval kWh 더미(sprint-0 그대로)
        · DO(원값 mg/L, 목표대역 근처, interval 아님)
    → feed_logs 30행(일 1회, FCR 산출 가능) → mortality_logs 30행(소량 폐사)
    → harvest_logs 2행(0 → 2560kg) → kpi_config 1행(version='2026.1.0').

특성:
  - 결정론: 고정 ID + random.Random(FIXED_SEED). now()/시스템 난수 미사용.
  - 멱등: 재실행 시 org-scoped 행을 자식→부모 역순으로 정리 후 재삽입(중복 없음).

RLS 주의: Postgres 는 FORCE RLS 로 인해 org-scoped INSERT 전에
`app.current_org_id` 를 세팅해야 한다. 이 스크립트가 세션에 컨텍스트를 건다.
"""

from __future__ import annotations

import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# apps/api 와 packages/kpi 를 import 경로에 추가(스크립트 단독 실행 대비).
_HERE = Path(__file__).resolve()
_REPO_ROOT = _HERE.parents[2]
sys.path.insert(0, str(_REPO_ROOT / "apps" / "api"))
sys.path.insert(0, str(_REPO_ROOT / "packages" / "kpi"))

from sqlalchemy import delete, text  # noqa: E402

from culiver_kpi import (  # noqa: E402
    ei_config_to_params,
    fcr_config_to_params,
    mortality_config_to_params,
    oei_config_to_params,
)
from culiver_kpi.config import DEFAULT_CONFIG_VERSION  # noqa: E402
from culiver_kpi.types import (  # noqa: E402
    EiConfig,
    FcrConfig,
    MortalityConfig,
    OeiConfig,
)

from app.db.base import Base  # noqa: E402
from app.db.session import SessionLocal, engine  # noqa: E402
from app.models.api_key import ApiKey  # noqa: E402
from app.services.api_key_auth import hash_api_key  # noqa: E402
from app.models.baseline import Baseline  # noqa: E402
from app.models.batch import Batch  # noqa: E402
from app.models.feed_log import FeedLog  # noqa: E402
from app.models.harvest_log import HarvestLog  # noqa: E402
from app.models.kpi_config import KpiConfig  # noqa: E402
from app.models.kpi_snapshot import KpiSnapshot  # noqa: E402
from app.models.meter import Meter  # noqa: E402
from app.models.mortality_log import MortalityLog  # noqa: E402
from app.models.organization import Organization  # noqa: E402
from app.models.reading import Reading  # noqa: E402
from app.models.site import Site  # noqa: E402
from app.models.tank import Tank  # noqa: E402
from app.models.user import User  # noqa: E402

# --- 고정 식별자(결정론) ---
FIXED_SEED = 42
ORG_ID = "org-START-0001"
SITE_ID = "site-0001"
METER_MAIN_ID = "meter-power-main-0001"
METER_BLOWER_ID = "meter-power-blower-0001"
METER_DO_ID = "meter-do-tank1-0001"
TANK_ID = "tank-0001"
BATCH_ID = "batch-0001"
USER_OWNER_ID = "user-owner-0001"
USER_OPERATOR_ID = "user-operator-0001"
USER_VIEWER_ID = "user-viewer-0001"
HARVEST_OPEN_ID = "harvest-open-0001"
HARVEST_CLOSE_ID = "harvest-close-0001"
KPICFG_ID = "kpicfg-2026-1-0"

# --- 데모 ingestion API Key(phase-1 3.3절) ---
# 원문은 DB 에 저장하지 않는다 — key_hash(sha256)만 보관(모델 주석/Rule 7).
# 아래 원문은 **dev 편의용 로그/주석 전용**이다(운영 키 아님, 커밋된 데모값).
API_KEY_ID = "apikey-gw-0001"
DEMO_API_KEY_PLAINTEXT = "culiver-demo-gateway-key-0001"  # dev 전용 원문(로그/주석)

# --- 기간: 2026-06 한 달, 시간단위 ---
PERIOD_START = datetime(2026, 6, 1, 0, 0, 0, tzinfo=timezone.utc)
HOURS = 24 * 30  # 720 시간
DAYS = 30
BIOMASS_START_KG = 0.0
BIOMASS_END_KG = 2560.0

# --- 배치/DO 목표대역/폐사 파라미터(결정론 근거) ---
STOCKED_COUNT = 100_000
DO_TARGET_MIN = 6.0
DO_TARGET_MAX = 8.0
DO_TARGET_MID = 7.0  # 목표대역 중앙 근처 결정론적 변동


def _is_postgres() -> bool:
    return engine.dialect.name in ("postgresql", "postgres")


def _set_org_ctx(session) -> None:
    if _is_postgres():
        session.execute(
            text("SELECT set_config('app.current_org_id', :org, true)"),
            {"org": ORG_ID},
        )


def _generate_readings() -> list[dict]:
    """결정론적 시간단위 readings 생성(power main/blower + DO 원값 mg/L).

    - power: interval kWh(sprint-0 값 유지, 별도 rng 로 EI 회귀 방지).
    - DO: 원값 mg/L(목표대역 6~8 중앙 근처), interval 개념 아님.
    """
    rows: list[dict] = []

    # power(main/blower): sprint-0 과 동일한 단일 rng 시퀀스(EI 값 불변 보장).
    rng_power = random.Random(FIXED_SEED)
    for h in range(HOURS):
        ts = PERIOD_START + timedelta(hours=h)
        main_kwh = round(12.0 + rng_power.uniform(-1.5, 1.5), 3)
        blower_kwh = round(6.0 + rng_power.uniform(-0.8, 0.8), 3)
        rows.append(
            {"time": ts, "meter_id": METER_MAIN_ID, "org_id": ORG_ID,
             "value": main_kwh, "quality_flag": "ok"}
        )
        rows.append(
            {"time": ts, "meter_id": METER_BLOWER_ID, "org_id": ORG_ID,
             "value": blower_kwh, "quality_flag": "ok"}
        )

    # DO: 별도 rng(power 시퀀스에 영향 없음). 목표대역 중앙 근처(6.3~7.7).
    rng_do = random.Random(FIXED_SEED + 1)
    for h in range(HOURS):
        ts = PERIOD_START + timedelta(hours=h)
        do_mg_l = round(DO_TARGET_MID + rng_do.uniform(-0.7, 0.7), 3)
        rows.append(
            {"time": ts, "meter_id": METER_DO_ID, "org_id": ORG_ID,
             "value": do_mg_l, "quality_flag": "ok"}
        )
    return rows


def _generate_feed_logs() -> list[FeedLog]:
    """일 1회 급이(30행). 총 급이량으로 FCR 산출 가능(Δbiomass=2560kg 대비)."""
    rng = random.Random(FIXED_SEED + 2)
    logs: list[FeedLog] = []
    for d in range(DAYS):
        ts = PERIOD_START + timedelta(days=d, hours=8)  # 매일 08:00 급이
        feed_kg = round(120.0 + rng.uniform(-10.0, 10.0), 3)
        logs.append(FeedLog(
            id=f"feed-{d:04d}", batch_id=BATCH_ID, org_id=ORG_ID,
            ts=ts, feed_kg=feed_kg, source="manual", quality_flag="ok",
        ))
    return logs


def _generate_mortality_logs() -> list[MortalityLog]:
    """일 1회 폐사 기록(30행). 소량(입식 100,000 대비 수 % 수준)."""
    rng = random.Random(FIXED_SEED + 3)
    logs: list[MortalityLog] = []
    for d in range(DAYS):
        ts = PERIOD_START + timedelta(days=d, hours=18)  # 매일 18:00 점검
        dead_count = rng.randint(30, 150)
        logs.append(MortalityLog(
            id=f"mort-{d:04d}", batch_id=BATCH_ID, org_id=ORG_ID,
            ts=ts, dead_count=dead_count, cause_note=None,
        ))
    return logs


def seed(session) -> dict:
    """멱등 시드 실행. 생성 요약 dict 반환."""
    _set_org_ctx(session)

    # --- 멱등: 기존 org-scoped 행 제거(자식→부모 역순) ---
    session.execute(delete(Baseline).where(Baseline.org_id == ORG_ID))
    session.execute(delete(KpiSnapshot).where(KpiSnapshot.org_id == ORG_ID))
    session.execute(delete(ApiKey).where(ApiKey.org_id == ORG_ID))
    session.execute(delete(FeedLog).where(FeedLog.org_id == ORG_ID))
    session.execute(delete(MortalityLog).where(MortalityLog.org_id == ORG_ID))
    session.execute(delete(Reading).where(Reading.org_id == ORG_ID))
    session.execute(delete(HarvestLog).where(HarvestLog.org_id == ORG_ID))
    session.execute(delete(Batch).where(Batch.org_id == ORG_ID))
    session.execute(delete(Tank).where(Tank.org_id == ORG_ID))
    session.execute(delete(Meter).where(Meter.org_id == ORG_ID))
    session.execute(delete(User).where(User.org_id == ORG_ID))
    session.execute(delete(Site).where(Site.org_id == ORG_ID))
    session.execute(delete(Organization).where(Organization.id == ORG_ID))
    session.execute(delete(KpiConfig).where(KpiConfig.id == KPICFG_ID))
    session.flush()

    # --- organization ---
    session.add(Organization(id=ORG_ID, name="데모 양식장 법인", plan="START"))
    session.flush()  # org 존재 후 org-scoped 삽입(RLS WITH CHECK 통과)

    # --- site ---
    session.add(Site(
        id=SITE_ID, org_id=ORG_ID, name="1호 양식장",
        region="충남 서산", ras_type="indoor_ras",
    ))
    session.flush()

    # --- users (owner/operator/viewer) ---
    session.add(User(
        id=USER_OWNER_ID, org_id=ORG_ID, email="owner@demo.culiver.io", role="owner",
    ))
    session.add(User(
        id=USER_OPERATOR_ID, org_id=ORG_ID,
        email="operator@demo.culiver.io", role="operator",
    ))
    session.add(User(
        id=USER_VIEWER_ID, org_id=ORG_ID, email="viewer@demo.culiver.io", role="viewer",
    ))

    # --- meters (power main + power blower[폭기] + DO) ---
    session.add(Meter(
        id=METER_MAIN_ID, site_id=SITE_ID, org_id=ORG_ID,
        type="power", unit="kWh_interval", sub_meter_of=None, is_aeration=False,
    ))
    session.add(Meter(
        id=METER_BLOWER_ID, site_id=SITE_ID, org_id=ORG_ID,
        type="power", unit="kWh_interval", sub_meter_of=METER_MAIN_ID, is_aeration=True,
    ))
    session.add(Meter(
        id=METER_DO_ID, site_id=SITE_ID, org_id=ORG_ID,
        type="do", unit="mg_L", sub_meter_of=None, is_aeration=False,
    ))

    # --- api_keys (ingestion 게이트웨이 인증; org1/site1 스코프) ---
    # 원문(DEMO_API_KEY_PLAINTEXT)은 저장하지 않고 sha256 해시만 보관한다.
    session.add(ApiKey(
        id=API_KEY_ID, org_id=ORG_ID, site_id=SITE_ID,
        key_hash=hash_api_key(DEMO_API_KEY_PLAINTEXT),
        label="데모 게이트웨이 A", revoked=False,
    ))

    # --- tanks (DO 목표대역 설정) ---
    session.add(Tank(
        id=TANK_ID, site_id=SITE_ID, org_id=ORG_ID, name="1번 수조",
        volume_m3=50.0, target_do_min=DO_TARGET_MIN, target_do_max=DO_TARGET_MAX,
    ))
    session.flush()

    # --- batches (입식 100,000 개체) ---
    session.add(Batch(
        id=BATCH_ID, tank_id=TANK_ID, org_id=ORG_ID,
        species="litopenaeus_vannamei",  # 흰다리새우
        stocked_count=STOCKED_COUNT, stocked_at=PERIOD_START, closed_at=None,
    ))
    session.flush()

    # --- harvest_logs (개시 0kg → 마감 2560kg; batch 연동은 nullable 유지) ---
    session.add(HarvestLog(
        id=HARVEST_OPEN_ID, batch_id=None, site_id=SITE_ID, org_id=ORG_ID,
        ts=PERIOD_START, biomass_kg=BIOMASS_START_KG, count=0,
    ))
    session.add(HarvestLog(
        id=HARVEST_CLOSE_ID, batch_id=None, site_id=SITE_ID, org_id=ORG_ID,
        ts=PERIOD_START + timedelta(hours=HOURS - 1),
        biomass_kg=BIOMASS_END_KG, count=125000,
    ))

    # --- readings (720h × [main, blower, DO]) ---
    reading_rows = _generate_readings()
    session.bulk_insert_mappings(Reading, reading_rows)

    # --- feed_logs (FCR 분자) / mortality_logs (폐사 분자) ---
    feed_logs = _generate_feed_logs()
    for fl in feed_logs:
        session.add(fl)
    mortality_logs = _generate_mortality_logs()
    for ml in mortality_logs:
        session.add(ml)

    # --- kpi_config (version 2026.1.0, 지표별 서브키 nested 문서) ---
    # phase-1 1.4절: params_json 은 지표별 서브키(ei/fcr/oei/mortality)를 갖는 단일 버전
    # 문서다(버전은 전 지표 공유). KPI 파서(culiver_kpi.*_config_from_params)가 nested 를
    # 정식 지원하며 평면 문서(ei 서브키 부재)는 EI 로 폴백한다. 각 서브 dict 는 엔진 기본값을
    # *_config_to_params 로 직렬화해 라운드트립(from∘to=항등)을 보장한다. EI 값은 불변(회귀).
    session.add(KpiConfig(
        id=KPICFG_ID,
        version=DEFAULT_CONFIG_VERSION,
        params_json={
            "ei": ei_config_to_params(EiConfig()),
            "fcr": fcr_config_to_params(FcrConfig()),
            "oei": oei_config_to_params(OeiConfig()),
            "mortality": mortality_config_to_params(MortalityConfig()),
        },
        effective_from=PERIOD_START,
    ))

    session.commit()
    return {
        "org_id": ORG_ID,
        "site_id": SITE_ID,
        "users": [USER_OWNER_ID, USER_OPERATOR_ID, USER_VIEWER_ID],
        "meters": [METER_MAIN_ID, METER_BLOWER_ID, METER_DO_ID],
        "tanks": [TANK_ID],
        "batches": [BATCH_ID],
        "reading_rows": len(reading_rows),
        "feed_logs": len(feed_logs),
        "mortality_logs": len(mortality_logs),
        "stocked_count": STOCKED_COUNT,
        "kpi_config_version": DEFAULT_CONFIG_VERSION,
        # dev 편의: 데모 API Key 원문(로그 전용, DB 에는 해시만 저장됨).
        "api_key_id": API_KEY_ID,
        "api_key_plaintext_dev_only": DEMO_API_KEY_PLAINTEXT,
    }


def main() -> None:
    # dev/sqlite 편의: 테이블 없으면 생성(마이그레이션 미적용 환경 대비).
    Base.metadata.create_all(engine, checkfirst=True)
    with SessionLocal() as session:
        summary = seed(session)
    print("seed complete:", summary)


if __name__ == "__main__":
    main()
