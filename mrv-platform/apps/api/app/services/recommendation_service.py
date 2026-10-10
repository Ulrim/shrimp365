"""recommendation_service — 추천(운전 레시피) 조립 + 버전 영속화(phase-2 슬라이스 K, 2.2/2.3절).

★ Rule 1: 산식은 `culiver_kpi.compute_recommendation` 을 호출만 한다(data-kpi-engineer 소관).
이 모듈의 책임은 순수 조립(assembly)과 저장 최적화(2.3절 "동일 입력 파라미터 해시가 직전
버전과 같으면 새 버전 생성 생략" — 이건 산식이 아니라 영속화 규칙):
  1) DB 행(readings/meters/tanks/harvest_logs/feed_logs)을 `RecommendationInput` 으로 변환.
  2) `compute_recommendation` 호출.
  3) 결과를 recipe/recipe_versions 에 영속화(신규/변경 시에만).
  4) 라우터가 응답으로 감쌀 수 있는 `RecommendationItemData` 리스트 반환.

결정론(Rule 6) 경계: `generated_at`/조회 lookback 기간은 배치 실행 시각/데이터 적재 범위를
정하는 조립 메타데이터이지 산식 입력이 아니다(alert_jobs.py 의 evaluated_at 과 동일 전제).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from culiver_kpi import (
    DoBand,
    DoReading,
    FeedReading,
    RecommendationInput,
    compute_recommendation,
)
from culiver_kpi.config import DEFAULT_CONFIG_VERSION, recommend_config_from_params
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.batch import Batch
from app.models.feed_log import FeedLog
from app.models.harvest_log import HarvestLog
from app.models.kpi_config import KpiConfig
from app.models.meter import Meter
from app.models.reading import Reading
from app.models.recipe import Recipe, RecipeVersion
from app.models.tank import Tank

RECIPE_TYPES: tuple[str, ...] = ("feed", "oxygen", "circulation")

# 급이 이력/폭기 전력 조회 lookback(산식 파라미터 아님 — 데이터 적재 범위의 조립 결정,
# Rule 2 대상 아님. alert_jobs.py 의 lookback_hours 와 동일 경계).
FEED_HISTORY_LOOKBACK_DAYS = 14
AERATION_LOOKBACK_DAYS = 14

_RATIONALE_MARKERS: tuple[tuple[str, str], ...] = (
    ("[급이]", "feed"),
    ("[산소]", "oxygen"),
    ("[순환]", "circulation"),
)


def _as_utc(dt: datetime) -> datetime:
    """naive datetime(SQLite)을 UTC-aware 로 정규화(kpi_service.py 와 동일 규약)."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _load_active_config(session: Session) -> tuple[str, dict]:
    """가장 최근 effective_from 의 kpi_config 를 활성 설정으로 사용(kpi_service.py 패턴 재사용)."""
    cfg_row = session.execute(
        select(KpiConfig).order_by(KpiConfig.effective_from.desc())
    ).scalars().first()
    if cfg_row is not None:
        return cfg_row.version, (cfg_row.params_json or {})
    return DEFAULT_CONFIG_VERSION, {}


def _latest_do_reading(session: Session, site_id: str) -> DoReading | None:
    """meters(type='do') 최신 유효('ok') 샘플(alert_jobs._evaluate_do_low 와 동일 조회 규약)."""
    row = session.execute(
        select(Reading, Meter)
        .join(Meter, Reading.meter_id == Meter.id)
        .where(Meter.site_id == site_id)
        .where(Meter.type == "do")
        .where(Reading.quality_flag == "ok")
        .order_by(Reading.time.desc())
    ).first()
    if row is None:
        return None
    reading, meter = row
    return DoReading(
        meter_id=meter.id, ts=_as_utc(reading.time), do_mg_l=reading.value,
        quality_flag=reading.quality_flag,
    )


def _latest_water_temp(session: Session, site_id: str) -> float | None:
    """meters(type='temp') 최신 유효('ok') 샘플. 수온 계측기 미보유 site → None."""
    row = session.execute(
        select(Reading)
        .join(Meter, Reading.meter_id == Meter.id)
        .where(Meter.site_id == site_id)
        .where(Meter.type == "temp")
        .where(Reading.quality_flag == "ok")
        .order_by(Reading.time.desc())
    ).first()
    if row is None:
        return None
    (reading,) = row
    return reading.value


def _do_band_for_site(session: Session, site_id: str) -> DoBand:
    """kpi_service._pick tank band 규약 재사용(첫 유효 대역 tank).

    band 미설정 site(엣지케이스)는 어떤 실측 DO 도 margin 근접에 걸리지 않는 넓은 중립
    대역(0~100mg/L)으로 폴백한다 — 산식 판단이 아니라 '대역 데이터 부재 시 조립 기본값'
    (compute_recommendation 은 do_band.do_min < do_band.do_max 인 유한값을 요구하므로
    None 을 전달할 수 없다).
    """
    tanks = session.execute(
        select(Tank).where(Tank.site_id == site_id).order_by(Tank.id)
    ).scalars().all()
    for t in tanks:
        if t.target_do_min is not None and t.target_do_max is not None:
            return DoBand(do_min=t.target_do_min, do_max=t.target_do_max)
    return DoBand(do_min=0.0, do_max=100.0)


def _latest_biomass_kg(session: Session, site_id: str) -> float | None:
    """최근 harvest_logs 기준 생체량(가장 최근 ts 1행)."""
    row = session.execute(
        select(HarvestLog)
        .where(HarvestLog.site_id == site_id)
        .order_by(HarvestLog.ts.desc())
    ).scalars().first()
    return row.biomass_kg if row is not None else None


def _feed_history(
    session: Session, site_id: str, period_start: datetime, period_end: datetime
) -> list[FeedReading]:
    """site 소속 batch 들의 [period_start, period_end) 급이 이력(engine 이 quality_flag 필터)."""
    batch_ids = session.execute(
        select(Batch.id).join(Tank, Batch.tank_id == Tank.id).where(Tank.site_id == site_id)
    ).scalars().all()
    if not batch_ids:
        return []
    rows = session.execute(
        select(FeedLog)
        .where(FeedLog.batch_id.in_(batch_ids))
        .where(FeedLog.ts >= period_start)
        .where(FeedLog.ts < period_end)
        .order_by(FeedLog.ts)
    ).scalars().all()
    return [
        FeedReading(
            source_ref=f.id, batch_id=f.batch_id, ts=_as_utc(f.ts),
            feed_kg=f.feed_kg, quality_flag=f.quality_flag,
        )
        for f in rows
    ]


def _recent_aeration_power_kwh(
    session: Session, site_id: str, period_start: datetime, period_end: datetime
) -> float:
    """site 폭기(is_aeration) 계측기의 [period_start, period_end) 'ok' 전력 합."""
    meter_ids = session.execute(
        select(Meter.id)
        .where(Meter.site_id == site_id)
        .where(Meter.is_aeration.is_(True))
    ).scalars().all()
    if not meter_ids:
        return 0.0
    rows = session.execute(
        select(Reading.value)
        .where(Reading.meter_id.in_(meter_ids))
        .where(Reading.time >= period_start)
        .where(Reading.time < period_end)
        .where(Reading.quality_flag == "ok")
    ).scalars().all()
    return float(sum(rows))


def _split_rationale(rationale: str) -> dict[str, str]:
    """`compute_recommendation` 의 결합 rationale(`"[급이] .. [산소] .. [순환] .."`)을
    타입별 문장으로 분리한다 — 이미 산출된 텍스트의 표시용 분할일 뿐 새 판단이 아니다
    (Rule 1 비대상, phase-2.md 3.1절과 동일 경계: "이미 확정된 값"의 가공).

    recommend.py 는 항상 세 마커를 이 순서(급이→산소→순환)로 이어붙이므로(순수·결정론,
    Rule 6) 마커 위치 기준 분할은 안전하다. 마커가 발견되지 않으면(엔진 포맷 변경 등)
    전체 문자열을 해당 키에 그대로 담아 방어적으로 동작한다.
    """
    positions = [rationale.find(marker) for marker, _ in _RATIONALE_MARKERS]
    if any(p < 0 for p in positions):
        # 예상 포맷과 다르면 전체를 각 타입에 동일하게 노출(정보 손실 방지, 에러 대신 방어적 폴백).
        return {key: rationale for _, key in _RATIONALE_MARKERS}

    order = sorted(range(len(_RATIONALE_MARKERS)), key=lambda i: positions[i])
    parts: dict[str, str] = {}
    for pos_i, marker_i in enumerate(order):
        start = positions[marker_i]
        end = (
            positions[order[pos_i + 1]] if pos_i + 1 < len(order) else len(rationale)
        )
        parts[_RATIONALE_MARKERS[marker_i][1]] = rationale[start:end].strip()
    return parts


def _get_or_create_recipe(
    session: Session, site_id: str, org_id: str, recipe_type: str
) -> Recipe:
    """recipes(site_id, type) 유니크 행을 조회, 없으면 최초 생성(2.1절)."""
    recipe = session.execute(
        select(Recipe).where(Recipe.site_id == site_id).where(Recipe.type == recipe_type)
    ).scalar_one_or_none()
    if recipe is not None:
        return recipe
    recipe = Recipe(
        id=f"recipe-{uuid4().hex}", site_id=site_id, org_id=org_id,
        type=recipe_type, current_version=0,
    )
    session.add(recipe)
    session.flush()
    return recipe


def _latest_recipe_version(session: Session, recipe_id: str) -> RecipeVersion | None:
    return session.execute(
        select(RecipeVersion)
        .where(RecipeVersion.recipe_id == recipe_id)
        .order_by(RecipeVersion.version.desc())
    ).scalars().first()


def _persist_version_if_changed(
    session: Session,
    recipe: Recipe,
    params_json: dict,
    rationale: str,
    created_by: str,
) -> int:
    """params_json 이 최신 버전과 동일하면 생성 생략, 다르면 새 버전 추가(2.3절 저장 최적화).

    "해시 비교"는 canonical 값(JSON 라운드트립 가능한 dict/list/scalar)의 `==` 비교로
    대체한다 — 동일 입력이면 동일 표현이 보장되므로(결정론) 해시와 동치이며 더 단순하다.
    """
    latest = _latest_recipe_version(session, recipe.id)
    if latest is not None and latest.params_json == params_json:
        return recipe.current_version

    new_version = recipe.current_version + 1
    row = RecipeVersion(
        id=f"recipever-{uuid4().hex}",
        recipe_id=recipe.id,
        org_id=recipe.org_id,  # 항상 부모 recipe 와 동일(갭2 하드닝, RLS 앵커).
        version=new_version,
        params_json=params_json,
        rationale=rationale,
        created_by=created_by,
    )
    session.add(row)
    recipe.current_version = new_version
    session.flush()
    return new_version


@dataclass(frozen=True)
class RecommendationItemData:
    """단일 타입(feed/oxygen/circulation) 산출 + 영속화 결과(라우터 응답 조립용)."""

    type: str
    recipe_id: str
    current_version: int
    params: dict
    source_refs: list[str]
    rationale: str
    config_version: str


def compute_site_recommendations(
    session: Session, site_id: str, org_id: str, actor_id: str,
) -> list[RecommendationItemData]:
    """3종 추천을 산출 + recipe_versions 영속화(phase-2.md 2.3절 read-only 라이브 계산).

    호출 전 tenancy.resolve_site_for_org 로 site 소유권이 검증되어 있어야 한다.
    커밋은 호출자(라우터) 책임 — alerts.py/alert_jobs.py 관례 재사용.
    """
    config_version, params = _load_active_config(session)
    recommend_config = recommend_config_from_params(params)

    generated_at = datetime.now(UTC)
    period_start = generated_at - timedelta(days=FEED_HISTORY_LOOKBACK_DAYS)
    period_end = generated_at
    aeration_period_start = generated_at - timedelta(days=AERATION_LOOKBACK_DAYS)

    inputs = RecommendationInput(
        do_latest=_latest_do_reading(session, site_id),
        do_band=_do_band_for_site(session, site_id),
        water_temp_latest=_latest_water_temp(session, site_id),
        biomass_latest_kg=_latest_biomass_kg(session, site_id),
        feed_history=_feed_history(session, site_id, period_start, period_end),
        aeration_power_recent_kwh=_recent_aeration_power_kwh(
            session, site_id, aeration_period_start, generated_at
        ),
        period_start=period_start,
        period_end=period_end,
    )

    output = compute_recommendation(inputs, recommend_config, config_version)
    rationale_by_type = _split_rationale(output.rationale)

    value_by_type: dict[str, dict] = {
        "feed": {"feed_kg_per_day": output.feed_kg_per_day},
        "oxygen": {"oxygen_target_do_mg_l": output.oxygen_target_do_mg_l},
        "circulation": {"circulation_setting": output.circulation_setting},
    }
    refs_by_type: dict[str, tuple[str, ...]] = {
        "feed": output.source_refs.get("feed", ()),
        "oxygen": output.source_refs.get("do", ()),
        "circulation": output.source_refs.get("do", ()),
    }

    items: list[RecommendationItemData] = []
    for recipe_type in RECIPE_TYPES:
        recipe = _get_or_create_recipe(session, site_id, org_id, recipe_type)
        value = value_by_type[recipe_type]
        refs = list(refs_by_type[recipe_type])
        persisted_params = {**value, "source_refs": refs}
        current_version = _persist_version_if_changed(
            session, recipe, persisted_params, rationale_by_type[recipe_type], actor_id,
        )
        items.append(
            RecommendationItemData(
                type=recipe_type,
                recipe_id=recipe.id,
                current_version=current_version,
                params=value,
                source_refs=refs,
                rationale=rationale_by_type[recipe_type],
                config_version=config_version,
            )
        )
    return items


__all__ = ["compute_site_recommendations", "RecommendationItemData", "RECIPE_TYPES"]
