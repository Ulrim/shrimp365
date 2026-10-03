"""ingestion — 게이트웨이 수집값의 표현(representation) 정규화 + 멱등 저장.

phase-1 3.2절 / ADR 0001(Accepted) 구현. **KPI 산식이 아니다**(Rule 1 무관):
이 계층은 계측 원표현(적산 kWh / 순시 kW / 원값)을 `readings.value` 저장 규약인
**interval kWh** 로 정규화하고 초기 quality_flag 를 로컬 판정만 한다.

quality_flag 소유권 경계(3.1절): 여기서는 **표현계층 로컬 판정**만 한다 —
스키마/타입/결측/롤오버/단위/물리불가. **통계적 이상치(분포·N-sigma)는 이 계층의
책임이 아니며 Phase 2(data-kpi-engineer) 예약**이다.

결정론(Rule 6): 배치 입력을 (ts, seq, meter_id) 오름차순 정렬 후 처리 → 입력 순서
무관 동일 출력. now()/난수 미사용.

직전 상태(cross-batch) 한계(ADR 0001 귀결): readings 에는 interval(정규화값)만
저장되므로 적산/순시의 **원 카운터**는 재구성 불가하다. 따라서 배치 경계에서:
  - cumulative: 배치 내 직전값이 없고 과거 저장 이력만 있으면 interval 산출 불가 →
    'suspect'(보수적 배제). 이력도 없으면 최초 기준선 → 'bad'(interval 없음).
  - instant: 배치 내 직전 원 kW 가 없으면 사다리꼴 불가 → 'bad'(보간 금지, ADR 0001).
배치 내부(연속 원값 보유)에서는 정확히 변환한다. 완전한 cross-batch 연속성(원 카운터
영속화)은 Phase 2 범위(과설계 금지).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import engine
from app.models.meter import Meter
from app.models.reading import Reading

# 인식하는 reading_kind 집합. 그 외는 배치에서 rejected(스키마 판정).
RECOGNIZED_KINDS: frozenset[str] = frozenset(
    {"cumulative_kwh", "instant_kw", "interval_kwh", "do_mg_l"}
)

# 순시 kW 사다리꼴 적분 시 허용 최대 간격(시간). 초과 = 결측 구간 → 'bad'(보간 금지).
INSTANT_MAX_GAP_HOURS: float = 2.0
# DO(mg/L) 물리적 타당 범위. 벗어나면 원값 저장하되 'suspect'(범위 검증만, 3.1절).
DO_PLAUSIBLE_MAX: float = 20.0

_SCOPE_REJECT_REASON = "unknown meter_id or not in api key scope"


@dataclass(frozen=True)
class RawReading:
    """게이트웨이가 보낸 원 계측값 1건(정규화 이전)."""

    index: int          # 배치 내 원 위치(rejected[] 역참조용)
    meter_id: str
    ts: datetime
    value: float
    reading_kind: str
    seq: int | None = None


@dataclass(frozen=True)
class NormalizedReading:
    """정규화 후 저장 대상(readings 행 후보). value = interval kWh 또는 원값."""

    meter_id: str
    ts: datetime
    value: float
    quality_flag: str


@dataclass(frozen=True)
class PriorState:
    """meter 의 직전 저장 reading 상태(cross-batch 컨텍스트). value 는 interval(정규화값)."""

    ts: datetime
    value: float


@dataclass
class ProcessResult:
    """배치 처리 결과. accepted=신규 저장, deduped=중복 흡수, rejected=(index, reason)."""

    accepted: int = 0
    deduped: int = 0
    rejected: list[tuple[int, str]] = field(default_factory=list)


def _utc_key(dt: datetime) -> str:
    """(meter_id, ts) 멱등 비교용 정규 키. tz-aware→UTC, naive→UTC 가정 후 isoformat.

    sqlite 는 tz 를 보존하지 않아 저장/재조회 시 naive 로 돌아오므로 두 표현을
    동일 키로 접합한다(멱등 판정의 결정론 보장).
    """
    if dt.tzinfo is not None:
        dt = dt.astimezone(UTC).replace(tzinfo=None)
    return dt.isoformat()


def normalize_readings(
    raws: Sequence[RawReading],
    prior_by_meter: dict[str, PriorState] | None = None,
) -> list[NormalizedReading]:
    """원 계측값 배치를 interval kWh(+원값) 로 정규화. 순수·결정론(DB 접근 없음).

    (ts, seq, meter_id) 오름차순 정렬 후 meter 별 배치내 직전 원값을 추적하며 변환한다.
    """
    prior_by_meter = prior_by_meter or {}
    ordered = sorted(
        raws,
        key=lambda r: (r.ts, r.seq if r.seq is not None else 0, r.meter_id),
    )
    # meter_id -> (prev_ts, prev_raw_value). 배치 내부 직전 원값(정규화 근거).
    state: dict[str, tuple[datetime, float]] = {}
    out: list[NormalizedReading] = []

    for r in ordered:
        kind = r.reading_kind
        mid = r.meter_id
        prev = state.get(mid)
        has_history = mid in prior_by_meter

        if kind == "interval_kwh":
            # 이미 규약 단위. 검증만: 음수 interval kWh 는 물리 불가 → suspect.
            flag = "ok" if r.value >= 0.0 else "suspect"
            out.append(NormalizedReading(mid, r.ts, r.value, flag))

        elif kind == "cumulative_kwh":
            if prev is not None:
                delta = r.value - prev[1]
                if delta < 0.0:
                    # 카운터 롤오버/리셋: interval 불명 → 원값 보존 + suspect(ADR 0001).
                    out.append(NormalizedReading(mid, r.ts, r.value, "suspect"))
                else:
                    out.append(NormalizedReading(mid, r.ts, delta, "ok"))
            elif has_history:
                # 배치 경계: 원 카운터 재구성 불가 → interval 산출 불가 → suspect.
                out.append(NormalizedReading(mid, r.ts, r.value, "suspect"))
            else:
                # 최초 기준선: interval 없음 → bad(0 저장, KPI 에서 배제됨).
                out.append(NormalizedReading(mid, r.ts, 0.0, "bad"))
            state[mid] = (r.ts, r.value)

        elif kind == "instant_kw":
            if prev is not None:
                dt_h = (r.ts - prev[0]).total_seconds() / 3600.0
                if dt_h <= 0.0:
                    # 동일/역순 ts(중복·비단조) → 적분 불가 → bad.
                    out.append(NormalizedReading(mid, r.ts, 0.0, "bad"))
                elif dt_h > INSTANT_MAX_GAP_HOURS:
                    # 결측 구간(간격 과대) → 보간 금지(ADR 0001) → bad.
                    out.append(NormalizedReading(mid, r.ts, 0.0, "bad"))
                else:
                    # 사다리꼴 적분: (prev_kW + cur_kW)/2 × Δt(h).
                    energy = (prev[1] + r.value) / 2.0 * dt_h
                    out.append(NormalizedReading(mid, r.ts, energy, "ok"))
            else:
                # 배치 내 직전 원 kW 없음 → 사다리꼴 불가 → bad(결측 간격).
                out.append(NormalizedReading(mid, r.ts, 0.0, "bad"))
            state[mid] = (r.ts, r.value)

        elif kind == "do_mg_l":
            # 비전력: 원값 저장(변환 없음). 범위 검증만(3.1절).
            flag = "ok" if 0.0 <= r.value <= DO_PLAUSIBLE_MAX else "suspect"
            out.append(NormalizedReading(mid, r.ts, r.value, flag))

        # RECOGNIZED_KINDS 밖은 process_batch 가 이미 rejected 처리함.

    return out


def _insert_ignore(session: Session, rows: list[dict]) -> None:
    """(meter_id, time) PK 충돌 무시 삽입(at-least-once 재전송 안전). dialect 인지."""
    if not rows:
        return
    if engine.dialect.name in ("postgresql", "postgres"):
        from sqlalchemy.dialects.postgresql import insert as _pg_insert

        stmt = _pg_insert(Reading).values(rows).on_conflict_do_nothing(
            index_elements=["time", "meter_id"]
        )
    else:
        from sqlalchemy.dialects.sqlite import insert as _sqlite_insert

        stmt = _sqlite_insert(Reading).values(rows).on_conflict_do_nothing()
    session.execute(stmt)


def process_batch(
    session: Session,
    *,
    org_id: str,
    site_id: str,
    raws: Sequence[RawReading],
) -> ProcessResult:
    """스코프 검증 → 정규화 → 멱등 저장. 커밋은 호출자가 담당(트랜잭션 제어 일관).

    - meter 가 key 스코프(org_id, site_id) 밖이거나 미지 → rejected(부분 거부).
    - reading_kind 미인식 → rejected(스키마 판정).
    - (meter_id, ts) 중복(배치 내/DB 기존)은 deduped 로 흡수(정확히 한 번 저장).
    """
    result = ProcessResult()
    valid: list[RawReading] = []
    meter_cache: dict[str, Meter | None] = {}

    for r in raws:
        if r.meter_id not in meter_cache:
            meter_cache[r.meter_id] = session.execute(
                select(Meter).where(Meter.id == r.meter_id)
            ).scalar_one_or_none()
        meter = meter_cache[r.meter_id]
        # 스코프 진실 = api_key(org_id, site_id). 미지/타 org/타 site → 부분 거부.
        if meter is None or meter.org_id != org_id or meter.site_id != site_id:
            result.rejected.append((r.index, _SCOPE_REJECT_REASON))
            continue
        if r.reading_kind not in RECOGNIZED_KINDS:
            result.rejected.append(
                (r.index, f"unsupported reading_kind: {r.reading_kind}")
            )
            continue
        valid.append(r)

    if not valid:
        return result

    # 직전 저장 상태(cross-batch 컨텍스트): meter 별 최근 저장 reading 1건.
    meter_ids = {r.meter_id for r in valid}
    prior_by_meter: dict[str, PriorState] = {}
    for mid in meter_ids:
        last = session.execute(
            select(Reading)
            .where(Reading.meter_id == mid)
            .order_by(Reading.time.desc())
            .limit(1)
        ).scalar_one_or_none()
        if last is not None:
            prior_by_meter[mid] = PriorState(ts=last.time, value=last.value)

    normalized = normalize_readings(valid, prior_by_meter)

    # 배치 내부 (meter_id, ts) 중복 접합(마지막 값 우선; 재전송/중복 원소 흡수).
    unique: dict[tuple[str, str], NormalizedReading] = {}
    for n in normalized:
        unique[(n.meter_id, _utc_key(n.ts))] = n
    intrabatch_dupes = len(normalized) - len(unique)

    # DB 기존 (meter_id, ts) 집합(해당 meter 들 한정) → 멱등 판정.
    existing_keys: set[tuple[str, str]] = set()
    rows_existing = session.execute(
        select(Reading.meter_id, Reading.time).where(
            Reading.meter_id.in_(meter_ids)
        )
    ).all()
    for m_id, t in rows_existing:
        existing_keys.add((m_id, _utc_key(t)))

    new_rows: list[dict] = []
    deduped_from_db = 0
    for key, n in unique.items():
        if key in existing_keys:
            deduped_from_db += 1
            continue
        new_rows.append(
            {
                "time": n.ts,
                "meter_id": n.meter_id,
                "org_id": org_id,
                "value": n.value,
                "quality_flag": n.quality_flag,
            }
        )

    _insert_ignore(session, new_rows)

    result.accepted = len(new_rows)
    result.deduped = deduped_from_db + intrabatch_dupes
    return result
