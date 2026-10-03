"""alert_jobs — 임계치 배치 평가(phase-2 슬라이스 H, docs/design/phase-2.md 1.5절 의사코드 배선).

★ Rule 1 경계: 판정 임계값(숫자)·신호등 판정 함수는 `culiver_kpi`(data-kpi-engineer 소관)에서
로드해 비교만 한다. 이 모듈은 "언제 무엇을 비교하는가"(배치 배선/조립)만 담당한다.
mortality_spike 의 "당일 dead_count vs 최근 N일 평균 dead_count" 비교는 이미 산출된
`MortalityResult.daily`(compute_mortality, 기존 엔진 재사용) 값의 단순 평균/부등호
비교일 뿐 새 산식이 아니다(compare_metric 과 동일 경계, phase-2.md 3.1절 정신 재적용).

3종 트리거(1.3절):
  - do_low: 최근 평가 윈도 내 최신 유효('ok') DO 샘플 < alerting.do_low_mg_l.
  - mortality_spike: 당일 dead_count > alerting.mortality_spike_ratio × (직전
    mortality_window_days 캘린더일 평균 dead_count) **and** 당일 dead_count >=
    alerting.mortality_spike_min_count.
  - kpi_red: alerting.kpi_red_metrics 각각에 대해 classify_metric_status(...) == 'red'.

중복 억제(1.5절): 같은 (site_id, type) 에 이미 status='open' 인 alert 가 있으면 재삽입하지
않는다(kpi_red 는 지표 단위가 아니라 type 단위 dedup — 최소 규칙).
구독 스위치(1.7절): site.alert_enabled_types[type]=false 인 type 은 생성 자체를 차단한다
(조회 필터링이 아니라 생성 단계 차단).

커밋은 호출자 책임(audit.py/snapshots.py 와 동일 관례) — worker 가 사이트 순회 후 1회 커밋.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from culiver_kpi import AlertingConfig, KpiThresholds, classify_metric_status
from culiver_kpi.config import alerting_config_from_params
from culiver_kpi.status import METRIC_DIRECTIONS
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import set_org_context
from app.models.alert import Alert
from app.models.kpi_config import KpiConfig
from app.models.meter import Meter
from app.models.organization import Organization
from app.models.reading import Reading
from app.models.site import Site
from app.services.kpi_service import compute_site_kpi_results

# alert type → 표시 심각도(도메인 판정 아님, UI 라벨링 편의 — 임계 판정 자체는 위 3종 함수).
_SEVERITY_BY_TYPE: dict[str, str] = {
    "do_low": "critical",
    "mortality_spike": "warning",
    "kpi_red": "critical",
}


def _load_active_alerting_config(session: Session) -> AlertingConfig:
    """가장 최근 effective_from 의 kpi_config.alerting 서브키를 로드(kpi_service 패턴 재사용)."""
    cfg_row = session.execute(
        select(KpiConfig).order_by(KpiConfig.effective_from.desc())
    ).scalars().first()
    params = (cfg_row.params_json if cfg_row is not None else None) or {}
    return alerting_config_from_params(params)


def _subscription_enabled(site: Site, alert_type: str) -> bool:
    enabled = site.alert_enabled_types or {}
    return bool(enabled.get(alert_type, True))


def _has_open_duplicate(session: Session, site_id: str, alert_type: str) -> bool:
    existing = session.execute(
        select(Alert.id)
        .where(Alert.site_id == site_id)
        .where(Alert.type == alert_type)
        .where(Alert.status == "open")
    ).first()
    return existing is not None


def _try_create_alert(
    session: Session, *, site: Site, alert_type: str, payload: dict
) -> Alert | None:
    """구독 스위치(1.7절) → 중복 억제(1.5절) → 삽입 순으로 게이트."""
    if not _subscription_enabled(site, alert_type):
        return None
    if _has_open_duplicate(session, site.id, alert_type):
        return None
    alert = Alert(
        id=f"alert-{uuid4().hex}",
        site_id=site.id,
        org_id=site.org_id,
        type=alert_type,
        severity=_SEVERITY_BY_TYPE[alert_type],
        payload_json=payload,
        status="open",
    )
    session.add(alert)
    session.flush()
    return alert


def _evaluate_do_low(
    session: Session,
    site: Site,
    evaluated_at: datetime,
    lookback_hours: int,
    cfg: AlertingConfig,
) -> Alert | None:
    """readings(meter.type='do') 의 최신 유효 샘플 < alerting.do_low_mg_l → 'do_low'."""
    window_start = evaluated_at - timedelta(hours=lookback_hours)
    row = session.execute(
        select(Reading, Meter)
        .join(Meter, Reading.meter_id == Meter.id)
        .where(Meter.site_id == site.id)
        .where(Meter.type == "do")
        .where(Reading.quality_flag == "ok")
        .where(Reading.time >= window_start)
        .where(Reading.time <= evaluated_at)
        .order_by(Reading.time.desc())
    ).first()
    if row is None:
        return None
    reading, meter = row
    if reading.value >= cfg.do_low_mg_l:
        return None
    payload = {
        "metric": "do",
        "value": reading.value,
        "threshold": cfg.do_low_mg_l,
        "meter_id": meter.id,
        "ts": reading.time.isoformat(),
    }
    return _try_create_alert(session, site=site, alert_type="do_low", payload=payload)


def _evaluate_mortality_spike(
    session: Session,
    site: Site,
    evaluated_at: datetime,
    window_days: int,
    cfg: AlertingConfig,
) -> Alert | None:
    """당일 dead_count vs 직전 window_days 평균 dead_count(MortalityResult.daily 재사용)."""
    period_from = evaluated_at - timedelta(days=window_days + 1)
    period_to = evaluated_at
    comp = compute_site_kpi_results(session, site.id, period_from, period_to)
    daily = comp.mortality.daily
    if not daily:
        return None

    today_date = evaluated_at.date()
    by_date = {d.date: d.dead_count for d in daily}
    dead_today = by_date.get(today_date, 0)

    prior_counts = [
        by_date.get(today_date - timedelta(days=k), 0) for k in range(1, window_days + 1)
    ]
    ma_dead_count = sum(prior_counts) / window_days if window_days > 0 else 0.0

    if dead_today < cfg.mortality_spike_min_count:
        return None
    if dead_today <= cfg.mortality_spike_ratio * ma_dead_count:
        return None

    payload = {
        "metric": "mortality",
        "date": today_date.isoformat(),
        "dead_count_today": dead_today,
        "moving_avg_dead_count": ma_dead_count,
        "ratio_threshold": cfg.mortality_spike_ratio,
        "min_count_threshold": cfg.mortality_spike_min_count,
    }
    return _try_create_alert(session, site=site, alert_type="mortality_spike", payload=payload)


def _evaluate_kpi_red(
    session: Session,
    site: Site,
    evaluated_at: datetime,
    period_days: int,
    cfg: AlertingConfig,
    thresholds: KpiThresholds,
) -> list[Alert]:
    """cfg.kpi_red_metrics 각각을 classify_metric_status 로 판정, 'red' 이면 'kpi_red' 알림."""
    period_from = evaluated_at - timedelta(days=period_days)
    period_to = evaluated_at
    comp = compute_site_kpi_results(session, site.id, period_from, period_to)

    value_by_metric: dict[str, float | None] = {
        "ei_total": comp.ei.ei_total,
        "ei_aeration": comp.ei.ei_aeration,
        "fcr": comp.fcr.fcr,
        "oei": comp.oei.oei if comp.oei is not None else None,
        "mortality_rate": comp.mortality.cumulative_rate_pct,
    }

    created: list[Alert] = []
    for metric_name in cfg.kpi_red_metrics:
        value = value_by_metric.get(metric_name)
        direction = METRIC_DIRECTIONS[metric_name]
        metric_thresholds = getattr(thresholds, metric_name)
        status = classify_metric_status(value, direction, metric_thresholds)
        if status != "red":
            continue
        payload = {
            "metric": metric_name,
            "value": value,
            "threshold": metric_thresholds.red_threshold,
            "config_version": comp.config_version,
        }
        alert = _try_create_alert(session, site=site, alert_type="kpi_red", payload=payload)
        if alert is not None:
            created.append(alert)
    return created


def job_evaluate_alerts(
    session: Session,
    evaluated_at: datetime | None = None,
    *,
    do_low_lookback_hours: int = 24,
    mortality_window_days: int = 7,
    kpi_period_days: int = 30,
) -> list[Alert]:
    """3종 트리거 배치 평가(1.5절 의사코드 배선). org → site 순회. 커밋은 호출자 책임.

    evaluated_at 은 배치 실행 시각(기본 now, UTC) — 결정론 산식 입력이 아니라 배치
    스케줄 메타데이터이므로 Rule 6 위반이 아니다(kpi_snapshot 배치 패턴과 동일).

    ★ 반환값 사용 계약(ADR 0007 3절 부수 결과): 반환된 Alert 인스턴스의 **속성은 커밋 전에**
    읽어라. 순회가 끝나면 세션의 org 컨텍스트는 마지막 org 에 남아 있으므로, 커밋 후
    (expire_on_commit=True) 타 org 인스턴스의 속성 접근은 만료 재조회가 RLS 에 막혀
    ObjectDeletedError 가 된다. `worker.py` 는 `len(created)` 만 쓰므로 영향이 없다.
    """
    if evaluated_at is None:
        evaluated_at = datetime.now(UTC)

    cfg = _load_active_alerting_config(session)
    created: list[Alert] = []

    # ★ org 별 스코프 순회(ADR 0007 3절 / D4). 워커 세션에는 org 컨텍스트가 없으므로
    # `select(Site)` 전 순회는 Postgres RLS 하에서 **0행**이 된다(예외도 로그도 없는
    # 조용한 영구 무동작). BYPASSRLS 역할이나 escape hatch 를 만들지 않고, RLS 비대상인
    # `organizations` 를 열거해 org 마다 컨텍스트를 건 뒤 그 org 의 site 만 읽는다.
    # 부수 효과로 org 경계가 코드에 명시되어 Rule 4 가독성이 올라간다.
    # sqlite 는 set_org_context 가 GUC 적용을 건너뛰지만 순회 결과는 동일하다(무회귀).
    org_ids = session.execute(select(Organization.id)).scalars().all()
    for org_id in org_ids:
        set_org_context(session, org_id)
        sites = session.execute(select(Site).where(Site.org_id == org_id)).scalars().all()
        for site in sites:
            do_alert = _evaluate_do_low(
                session, site, evaluated_at, do_low_lookback_hours, cfg
            )
            if do_alert is not None:
                created.append(do_alert)

            mort_alert = _evaluate_mortality_spike(
                session, site, evaluated_at, mortality_window_days, cfg
            )
            if mort_alert is not None:
                created.append(mort_alert)

            created.extend(
                _evaluate_kpi_red(
                    session, site, evaluated_at, kpi_period_days, cfg, cfg.thresholds
                )
            )

    return created


__all__ = ["job_evaluate_alerts"]
