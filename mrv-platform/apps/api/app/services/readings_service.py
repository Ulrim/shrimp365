"""readings_service — GET /sites/{site_id}/readings 조회/집계(phase-2 4.1절).

★ Rule 1 무관: 이 서비스가 만드는 `value` 는 **차트 전용 표시값**이며 KPI 산식
(compute_ei/compute_fcr/compute_oei/compute_mortality)에 절대 투입되지 않는다
(설계문서 4.1절 "value는 KPI 산식에 들어가지 않는 차트 전용 표시값"). 여기서 하는
집계(SUM/AVG, quality_flag 우선순위)는 "표시 로직"이지 도메인 산식이 아니다(4.1/3.1절 경계).

책임:
  1) meter_id 단일 또는 tank_id+type 조합으로 대상 meter_id 목록 해석(3중 방어 재사용).
  2) granularity=raw: [from, to) 원본 반환, 상한 캡(5,000행) 초과 시 422.
  3) granularity=hourly|daily: dialect-aware SQL GROUP BY 집계(Postgres=date_trunc,
     SQLite=strftime). power=SUM, 그 외=AVG. quality_flag 는 bad>suspect>ok 우선순위.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.db.session import engine
from app.models.meter import Meter
from app.models.reading import Reading
from app.models.site import Site
from app.schemas.readings import ReadingPoint, ReadingsResponse
from app.services.tenancy import resolve_meter_for_site, resolve_tank_for_site

# 4.1절: raw 조회 상한 캡(초과 시 422 "narrow the range or use granularity").
RAW_ROW_CAP = 5000

# 4.1/4.3절: 타입별 표시 단위(원 저장 단위와 별개인 차트 표시용 단위).
_DISPLAY_UNIT: dict[str, str] = {
    "power": "kWh",
    "do": "mg/L",
    "temp": "degC",
    "ph": "pH",
    "orp": "mV",
    "ec": "mS/cm",
}

# quality_flag 집계 우선순위(4.1절 최소 규칙: bad 하나라도 있으면 bad,
# 아니면 suspect 하나라도 있으면 suspect, 전부 ok 면 ok).
_QUALITY_RANK: dict[str, int] = {"ok": 0, "suspect": 1, "bad": 2}
_RANK_QUALITY: dict[int, str] = {0: "ok", 1: "suspect", 2: "bad"}


def _is_postgres() -> bool:
    return engine.dialect.name in ("postgresql", "postgres")


def _as_utc(dt: datetime) -> datetime:
    """naive datetime(SQLite 반환값)을 UTC-aware 로 정규화(kpi_service._as_utc 와 동일 패턴)."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _resolve_meter_ids(
    session: Session,
    site_id: str,
    org_id: str,
    meter_id: str | None,
    tank_id: str | None,
    type_: str | None,
) -> tuple[list[str], str | None, str]:
    """(meter_ids, response_meter_id, response_type) 해석.

    - meter_id 단일: 그 meter 하나만 대상. response_meter_id=meter_id, type=meter.type.
    - tank_id+type: 해당 tank 소속 + type 일치 meter 전체(0개 이상). response_meter_id=None
      (여러 meter 병합 조회이므로 최상위 meter_id 는 null — 4.1절 확장 규칙).
    """
    if meter_id:
        meter = resolve_meter_for_site(session, meter_id, site_id, org_id)
        return [meter.id], meter.id, meter.type

    # 라우터에서 meter_id 없으면 tank_id/type 둘 다 있음을 이미 보장함.
    assert tank_id is not None and type_ is not None
    tank = resolve_tank_for_site(session, tank_id, site_id, org_id)
    meters = session.execute(
        select(Meter)
        .where(Meter.tank_id == tank.id)
        .where(Meter.type == type_)
        .order_by(Meter.id)
    ).scalars().all()
    return [m.id for m in meters], None, type_


def get_site_readings(
    session: Session,
    site: Site,
    org_id: str,
    meter_id: str | None,
    tank_id: str | None,
    type_: str | None,
    period_from: datetime,
    period_to: datetime,
    granularity: str,
) -> ReadingsResponse:
    """[period_from, period_to) 시계열을 조회/집계해 ReadingsResponse 로 반환.

    호출 전 tenancy.resolve_site_for_org 로 site 소유권이 검증되어 있어야 한다.
    """
    meter_ids, resp_meter_id, resp_type = _resolve_meter_ids(
        session, site.id, org_id, meter_id, tank_id, type_
    )
    unit = _DISPLAY_UNIT.get(resp_type, resp_type)

    if not meter_ids:
        # tank_id+type 조합 자체는 유효하나 해당 계측기가 없는 경우 — 빈 결과(200).
        return ReadingsResponse(
            site_id=site.id, meter_id=resp_meter_id, type=resp_type,
            granularity=granularity, unit=unit, points=[],
        )

    if granularity == "raw":
        points = _query_raw(session, meter_ids, period_from, period_to)
    else:
        points = _query_aggregated(
            session, meter_ids, period_from, period_to, granularity, resp_type
        )

    return ReadingsResponse(
        site_id=site.id,
        meter_id=resp_meter_id,
        type=resp_type,
        granularity=granularity,
        unit=unit,
        points=points,
    )


def _query_raw(
    session: Session,
    meter_ids: list[str],
    period_from: datetime,
    period_to: datetime,
) -> list[ReadingPoint]:
    """raw 조회: [from, to) 원본 반환, 캡 초과 시 422."""
    count_stmt = (
        select(func.count())
        .select_from(Reading)
        .where(Reading.meter_id.in_(meter_ids))
        .where(Reading.time >= period_from)
        .where(Reading.time < period_to)
    )
    total = session.execute(count_stmt).scalar_one()
    if total > RAW_ROW_CAP:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"raw result exceeds cap ({total} > {RAW_ROW_CAP} rows); "
                "narrow the range or use granularity"
            ),
        )

    rows = session.execute(
        select(Reading)
        .where(Reading.meter_id.in_(meter_ids))
        .where(Reading.time >= period_from)
        .where(Reading.time < period_to)
        .order_by(Reading.time, Reading.meter_id)
    ).scalars().all()

    return [
        ReadingPoint(
            ts=_as_utc(r.time),
            value=r.value,
            quality_flag=r.quality_flag,
            meter_id=r.meter_id,
        )
        for r in rows
    ]


def _bucket_expr(granularity: str):
    """dialect-aware 버킷 표현식(Postgres=date_trunc, SQLite=strftime; 4.1절)."""
    if _is_postgres():
        unit = "hour" if granularity == "hourly" else "day"
        return func.date_trunc(unit, Reading.time)
    fmt = "%Y-%m-%d %H:00:00" if granularity == "hourly" else "%Y-%m-%d"
    return func.strftime(fmt, Reading.time)


def _parse_bucket(bucket: object, granularity: str) -> datetime:
    """버킷 표현식 결과를 datetime(UTC) 으로 정규화(Postgres=datetime, SQLite=str)."""
    if isinstance(bucket, datetime):
        return _as_utc(bucket)
    fmt = "%Y-%m-%d %H:%M:%S" if granularity == "hourly" else "%Y-%m-%d"
    return datetime.strptime(str(bucket), fmt).replace(tzinfo=UTC)


def _query_aggregated(
    session: Session,
    meter_ids: list[str],
    period_from: datetime,
    period_to: datetime,
    granularity: str,
    type_: str,
) -> list[ReadingPoint]:
    """hourly|daily 집계: power=SUM, 그 외=AVG. quality_flag=bad>suspect>ok."""
    bucket = _bucket_expr(granularity)
    agg_value = func.sum(Reading.value) if type_ == "power" else func.avg(Reading.value)
    quality_rank = case(
        (Reading.quality_flag == "bad", 2),
        (Reading.quality_flag == "suspect", 1),
        else_=0,
    )
    quality_agg = func.max(quality_rank)

    stmt = (
        select(
            Reading.meter_id.label("meter_id"),
            bucket.label("bucket"),
            agg_value.label("agg_value"),
            quality_agg.label("qrank"),
        )
        .where(Reading.meter_id.in_(meter_ids))
        .where(Reading.time >= period_from)
        .where(Reading.time < period_to)
        .group_by(Reading.meter_id, bucket)
        .order_by(bucket, Reading.meter_id)
    )
    rows = session.execute(stmt).all()

    points: list[ReadingPoint] = []
    for meter_id, bucket_val, value, qrank in rows:
        points.append(
            ReadingPoint(
                ts=_parse_bucket(bucket_val, granularity),
                value=float(value),
                quality_flag=_RANK_QUALITY.get(int(qrank), "ok"),
                meter_id=meter_id,
            )
        )
    return points
