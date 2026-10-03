"""KPI 산식 차분 검증용 기준값 생성기 (원본 Python 엔진 → JSON).

`lib/mrv/kpi/*.ts` 는 `mrv-platform/packages/kpi/culiver_kpi` 를 TypeScript 로 이식한
것이다. 이식 과정에서 산식이 어긋나지 않았음을 기계적으로 증명하기 위해, 원본 Python
엔진으로 시나리오별 산출값을 계산해 JSON 으로 떨군다. `verify-kpi.mjs` 가 같은 입력을
TypeScript 엔진에 넣고 이 JSON 과 대조한다.

실행:
    python3 scripts/mrv/gen_kpi_fixtures.py > scripts/mrv/kpi-fixtures.json

시나리오는 난수 시드를 고정해 생성하므로 매 실행 동일하다(엔진 자체가 결정론적이라
기준값도 결정론적이다). 경계/예외 케이스는 난수와 별개로 손으로 열거한다.
"""

from __future__ import annotations

import json
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "mrv-platform" / "packages" / "kpi"))

from culiver_kpi import (  # noqa: E402
    DEFAULT_CONFIG_VERSION,
    BiomassPoint,
    DoBand,
    DoReading,
    EiConfig,
    FcrConfig,
    FeedReading,
    MortalityConfig,
    MortalityReading,
    OeiConfig,
    PowerReading,
    RecommendConfig,
    RecommendationInput,
    Scope2Input,
    compute_ei,
    compute_fcr,
    compute_mortality,
    compute_oei,
    compute_recommendation,
    compute_scope2_reduction,
)
from culiver_kpi.comparison import compare_metric  # noqa: E402
from culiver_kpi.status import DEFAULT_KPI_THRESHOLDS, classify_metric_status  # noqa: E402

T0 = datetime(2026, 4, 1, tzinfo=timezone.utc)
FLAGS = ("ok", "ok", "ok", "suspect", "bad")


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def make_power(rng: random.Random, n: int, span_h: int) -> list[PowerReading]:
    return [
        PowerReading(
            meter_id=f"meter-{rng.randrange(3)}",
            ts=T0 + timedelta(minutes=rng.randrange(span_h * 60)),
            kwh=round(rng.uniform(0.0, 12.0), 4),
            is_aeration=rng.random() < 0.5,
            quality_flag=rng.choice(FLAGS),
        )
        for _ in range(n)
    ]


def make_do(rng: random.Random, n: int, span_h: int) -> list[DoReading]:
    return [
        DoReading(
            meter_id=f"do-{rng.randrange(2)}",
            ts=T0 + timedelta(minutes=rng.randrange(span_h * 60)),
            do_mg_l=round(rng.uniform(2.0, 9.0), 3),
            quality_flag=rng.choice(FLAGS),
        )
        for _ in range(n)
    ]


def make_feed(rng: random.Random, n: int, span_h: int) -> list[FeedReading]:
    return [
        FeedReading(
            source_ref=f"feed-{i:03d}",
            batch_id="batch-1",
            ts=T0 + timedelta(minutes=rng.randrange(span_h * 60)),
            feed_kg=round(rng.uniform(0.0, 40.0), 3),
            quality_flag=rng.choice(FLAGS),
        )
        for i in range(n)
    ]


def make_mortality(rng: random.Random, n: int, span_h: int) -> list[MortalityReading]:
    return [
        MortalityReading(
            source_ref=f"mort-{i:03d}",
            batch_id="batch-1",
            ts=T0 + timedelta(minutes=rng.randrange(span_h * 60)),
            dead_count=rng.randrange(0, 60),
        )
        for i in range(n)
    ]


def power_json(r: PowerReading) -> dict:
    return {
        "meterId": r.meter_id,
        "ts": iso(r.ts),
        "kwh": r.kwh,
        "isAeration": r.is_aeration,
        "qualityFlag": r.quality_flag,
    }


def do_json(r: DoReading) -> dict:
    return {"meterId": r.meter_id, "ts": iso(r.ts), "doMgL": r.do_mg_l,
            "qualityFlag": r.quality_flag}


def feed_json(r: FeedReading) -> dict:
    return {"sourceRef": r.source_ref, "batchId": r.batch_id, "ts": iso(r.ts),
            "feedKg": r.feed_kg, "qualityFlag": r.quality_flag}


def mort_json(r: MortalityReading) -> dict:
    return {"sourceRef": r.source_ref, "batchId": r.batch_id, "ts": iso(r.ts),
            "deadCount": r.dead_count}


def biomass_json(p: BiomassPoint) -> dict:
    return {"ts": iso(p.ts), "biomassKg": p.biomass_kg, "sourceRef": p.source_ref}


def ei_out(res) -> dict:
    return {
        "eiTotal": res.ei_total, "eiAeration": res.ei_aeration,
        "totalPowerKwh": res.total_power_kwh, "aerationPowerKwh": res.aeration_power_kwh,
        "biomassStartKg": res.biomass_start_kg, "biomassEndKg": res.biomass_end_kg,
        "biomassDeltaKg": res.biomass_delta_kg,
        "includedReadingCount": res.included_reading_count,
        "excludedReadingCount": res.excluded_reading_count,
        "sourceMeterIds": list(res.source_meter_ids),
        "sourceBiomassRefs": list(res.source_biomass_refs),
        "configVersion": res.config_version,
    }


def fcr_out(res) -> dict:
    return {
        "fcr": res.fcr, "totalFeedKg": res.total_feed_kg,
        "biomassStartKg": res.biomass_start_kg, "biomassEndKg": res.biomass_end_kg,
        "biomassDeltaKg": res.biomass_delta_kg,
        "includedFeedCount": res.included_feed_count,
        "excludedFeedCount": res.excluded_feed_count,
        "sourceFeedRefs": list(res.source_feed_refs),
        "sourceBiomassRefs": list(res.source_biomass_refs),
        "configVersion": res.config_version,
    }


def oei_out(res) -> dict:
    return {
        "oei": res.oei, "doInBandFraction": res.do_in_band_fraction,
        "doTotalSamples": res.do_total_samples, "doInBandSamples": res.do_in_band_samples,
        "doExcludedSamples": res.do_excluded_samples,
        "aerationPowerKwh": res.aeration_power_kwh, "biomassDeltaKg": res.biomass_delta_kg,
        "bandMin": res.band_min, "bandMax": res.band_max,
        "oeiRaw": res.oei_raw, "scaleFactor": res.scale_factor, "method": res.method,
        "sourceDoMeterIds": list(res.source_do_meter_ids),
        "sourceAerationMeterIds": list(res.source_aeration_meter_ids),
        "sourceBiomassRefs": list(res.source_biomass_refs),
        "configVersion": res.config_version,
    }


def mort_out(res) -> dict:
    return {
        "cumulativeRatePct": res.cumulative_rate_pct,
        "totalDeadCount": res.total_dead_count, "stockedCount": res.stocked_count,
        "daily": [{"date": d.date.isoformat(), "deadCount": d.dead_count,
                   "dailyRatePct": d.daily_rate_pct} for d in res.daily],
        "movingAvg": [{"date": m.date.isoformat(), "maRatePct": m.ma_rate_pct}
                      for m in res.moving_avg],
        "sourceRefs": list(res.source_refs),
        "configVersion": res.config_version,
    }


def build() -> dict:
    cases: list[dict] = []
    rng = random.Random(20260829)

    # --- EI / FCR / OEI / Mortality: 난수 시나리오 40건 ---
    for i in range(40):
        span_h = rng.choice([24, 72, 168])
        p_end = T0 + timedelta(hours=span_h)
        # 기간을 일부러 좁혀 '기간 밖 제외' 경로도 타게 한다.
        win_start = T0 + timedelta(hours=rng.randrange(0, span_h // 2))
        win_end = win_start + timedelta(hours=rng.randrange(1, span_h))

        powers = make_power(rng, rng.randrange(0, 60), span_h)
        dos = make_do(rng, rng.randrange(0, 60), span_h)
        feeds = make_feed(rng, rng.randrange(0, 40), span_h)
        morts = make_mortality(rng, rng.randrange(0, 40), span_h)

        b_start = BiomassPoint(ts=win_start, biomass_kg=round(rng.uniform(0.0, 500.0), 3),
                               source_ref=f"h-start-{i}")
        # delta 가 음수/0 인 '산출 불가' 경로도 섞이도록 폭을 넓게 잡는다.
        b_end = BiomassPoint(ts=win_end,
                             biomass_kg=round(b_start.biomass_kg + rng.uniform(-50.0, 400.0), 3),
                             source_ref=f"h-end-{i}")

        ei_cfg = EiConfig(
            included_quality_flags=rng.choice([("ok",), ("ok", "suspect")]),
            min_biomass_delta_kg=rng.choice([0.0, 1.0, 10.0]),
        )
        fcr_cfg = FcrConfig(
            included_quality_flags=rng.choice([("ok",), ("ok", "suspect")]),
            min_biomass_delta_kg=rng.choice([0.0, 5.0]),
        )
        oei_cfg = OeiConfig(
            included_quality_flags=("ok",),
            min_biomass_kg=rng.choice([0.0, 3.0]),
            oei_scale_factor=rng.choice([1.0, 12.5, 250.0]),
            clamp_max=rng.choice([100.0, 1000.0]),
        )
        mort_cfg = MortalityConfig(moving_avg_window_days=rng.choice([1, 3, 7]))
        stocked = rng.choice([0, 500, 12000])
        band = DoBand(do_min=4.0, do_max=7.0)

        cases.append({
            "name": f"ei-{i}",
            "kind": "ei",
            "input": {
                "powerReadings": [power_json(r) for r in powers],
                "biomassStart": biomass_json(b_start), "biomassEnd": biomass_json(b_end),
                "periodStart": iso(win_start), "periodEnd": iso(win_end),
                "config": {"includedQualityFlags": list(ei_cfg.included_quality_flags),
                           "minBiomassDeltaKg": ei_cfg.min_biomass_delta_kg},
                "configVersion": DEFAULT_CONFIG_VERSION,
            },
            "expected": ei_out(compute_ei(powers, b_start, b_end, win_start, win_end,
                                          ei_cfg, DEFAULT_CONFIG_VERSION)),
        })

        cases.append({
            "name": f"fcr-{i}",
            "kind": "fcr",
            "input": {
                "feedReadings": [feed_json(r) for r in feeds],
                "biomassStart": biomass_json(b_start), "biomassEnd": biomass_json(b_end),
                "periodStart": iso(win_start), "periodEnd": iso(win_end),
                "config": {"includedQualityFlags": list(fcr_cfg.included_quality_flags),
                           "minBiomassDeltaKg": fcr_cfg.min_biomass_delta_kg},
                "configVersion": DEFAULT_CONFIG_VERSION,
            },
            "expected": fcr_out(compute_fcr(feeds, b_start, b_end, win_start, win_end,
                                            fcr_cfg, DEFAULT_CONFIG_VERSION)),
        })

        cases.append({
            "name": f"oei-{i}",
            "kind": "oei",
            "input": {
                "doReadings": [do_json(r) for r in dos],
                "aerationReadings": [power_json(r) for r in powers],
                "biomassStart": biomass_json(b_start), "biomassEnd": biomass_json(b_end),
                "band": {"doMin": band.do_min, "doMax": band.do_max},
                "periodStart": iso(win_start), "periodEnd": iso(win_end),
                "config": {"includedQualityFlags": list(oei_cfg.included_quality_flags),
                           "minBiomassKg": oei_cfg.min_biomass_kg,
                           "doBandMethod": oei_cfg.do_band_method,
                           "oeiScaleFactor": oei_cfg.oei_scale_factor,
                           "clampMax": oei_cfg.clamp_max},
                "configVersion": DEFAULT_CONFIG_VERSION,
            },
            "expected": oei_out(compute_oei(dos, powers, b_start, b_end, band,
                                            win_start, win_end, oei_cfg,
                                            DEFAULT_CONFIG_VERSION)),
        })

        cases.append({
            "name": f"mortality-{i}",
            "kind": "mortality",
            "input": {
                "mortalityReadings": [mort_json(r) for r in morts],
                "stockedCount": stocked,
                "periodStart": iso(win_start), "periodEnd": iso(win_end),
                "config": {"movingAvgWindowDays": mort_cfg.moving_avg_window_days},
                "configVersion": DEFAULT_CONFIG_VERSION,
            },
            "expected": mort_out(compute_mortality(morts, stocked, win_start, win_end,
                                                   mort_cfg, DEFAULT_CONFIG_VERSION)),
        })

    # --- Scope2: 난수 + 경계(EI None / baseline 전력 None) ---
    for i in range(20):
        base_ei = rng.choice([None, round(rng.uniform(3.0, 9.0), 4)])
        after_ei = rng.choice([None, round(rng.uniform(3.0, 9.0), 4)])
        base_mwh = rng.choice([None, round(rng.uniform(0.0, 60.0), 4)])
        s = Scope2Input(
            baseline_ei_total=base_ei,
            after_ei_total=after_ei,
            after_biomass_delta_kg=round(rng.uniform(1.0, 5000.0), 3),
            baseline_power_mwh=base_mwh,
            after_power_mwh=round(rng.uniform(0.0, 60.0), 4),
            emission_factor_tco2e_per_mwh=rng.choice([0.4747, 0.4594, 0.125]),
            emission_factor_source="환경부 온실가스종합정보센터(GIR)",
            emission_factor_year=rng.choice([2024, 2025]),
            emission_factor_version=f"KR-GRID-{rng.choice([2024, 2025])}.1",
        )
        res = compute_scope2_reduction(s)
        cases.append({
            "name": f"scope2-{i}",
            "kind": "scope2",
            "input": {
                "baselineEiTotal": s.baseline_ei_total,
                "afterEiTotal": s.after_ei_total,
                "afterBiomassDeltaKg": s.after_biomass_delta_kg,
                "baselinePowerMwh": s.baseline_power_mwh,
                "afterPowerMwh": s.after_power_mwh,
                "emissionFactorTco2ePerMwh": s.emission_factor_tco2e_per_mwh,
                "emissionFactorSource": s.emission_factor_source,
                "emissionFactorYear": s.emission_factor_year,
                "emissionFactorVersion": s.emission_factor_version,
            },
            "expected": {
                "scope2TCo2eBaseline": res.scope2_tco2e_baseline,
                "scope2TCo2eAfter": res.scope2_tco2e_after,
                "reductionTco2e": res.reduction_tco2e,
                "formulaText": res.formula_text,
                "emissionFactorVersion": res.emission_factor_version,
            },
        })

    # --- 신호등: 5개 지표 × 경계 주변 값 ---
    for metric in ("ei_total", "ei_aeration", "fcr", "oei", "mortality_rate"):
        th = getattr(DEFAULT_KPI_THRESHOLDS, metric)
        direction = "higher_is_better" if metric == "oei" else "lower_is_better"
        probes = [None, th.red_threshold, th.amber_threshold,
                  th.red_threshold + 0.001, th.red_threshold - 0.001,
                  th.amber_threshold + 0.001, th.amber_threshold - 0.001, 0.0]
        for j, v in enumerate(probes):
            cases.append({
                "name": f"status-{metric}-{j}",
                "kind": "status",
                "input": {"value": v, "direction": direction, "metric": metric},
                "expected": classify_metric_status(v, direction, th),
            })

    # --- 전·후 비교: 경계(None/0/음수 baseline) 포함 ---
    probes = [(None, 1.0), (1.0, None), (0.0, 1.0), (-2.0, 1.0), (5.0, 4.0), (4.0, 5.0)]
    for metric in ("ei_total", "oei", "fcr"):
        direction = "higher_is_better" if metric == "oei" else "lower_is_better"
        for j, (b, c) in enumerate(probes):
            res = compare_metric(b, c, direction)
            cases.append({
                "name": f"comparison-{metric}-{j}",
                "kind": "comparison",
                "input": {"baselineValue": b, "currentValue": c, "direction": direction},
                "expected": {"baselineValue": res.baseline_value,
                             "currentValue": res.current_value,
                             "delta": res.delta, "improvementPct": res.improvement_pct,
                             "direction": res.direction},
            })

    # --- 추천: 근거 있음/DO 하한·상한 근접/고수온/근거 없음 ---
    rec_rng = random.Random(777)
    for i in range(12):
        span_h = 168
        win_start = T0
        win_end = T0 + timedelta(hours=span_h)
        feeds = [
            FeedReading(source_ref=f"rf-{i}-{j:02d}", batch_id="batch-1",
                        ts=T0 + timedelta(hours=j * 6),
                        feed_kg=round(rec_rng.uniform(1.0, 30.0), 3),
                        quality_flag="ok")
            for j in range(rec_rng.randrange(0, 20))
        ]
        band = DoBand(do_min=4.0, do_max=7.0)
        do_choice = rec_rng.choice([None, 4.1, 6.9, 5.5, 3.0, 8.0])
        do_latest = (None if do_choice is None
                     else DoReading(meter_id="do-0", ts=T0 + timedelta(hours=1),
                                    do_mg_l=do_choice, quality_flag="ok"))
        temp = rec_rng.choice([None, 24.0, 30.0, 33.5])
        biomass = rec_rng.choice([None, 0.0, 1200.0, 8000.0])
        cfg = RecommendConfig()
        inp = RecommendationInput(
            do_latest=do_latest, do_band=band, water_temp_latest=temp,
            biomass_latest_kg=biomass, feed_history=feeds,
            aeration_power_recent_kwh=0.0,
            period_start=win_start, period_end=win_end,
        )
        res = compute_recommendation(inp, cfg, DEFAULT_CONFIG_VERSION)
        cases.append({
            "name": f"recommend-{i}",
            "kind": "recommend",
            "input": {
                "doLatest": (None if do_latest is None else do_json(do_latest)),
                "doBand": {"doMin": band.do_min, "doMax": band.do_max},
                "waterTempLatest": temp,
                "biomassLatestKg": biomass,
                "feedHistory": [feed_json(f) for f in feeds],
                "aerationPowerRecentKwh": 0.0,
                "periodStart": iso(win_start), "periodEnd": iso(win_end),
                "configVersion": DEFAULT_CONFIG_VERSION,
            },
            "expected": {
                "feedKgPerDay": res.feed_kg_per_day,
                "oxygenTargetDoMgL": res.oxygen_target_do_mg_l,
                "circulationSetting": res.circulation_setting,
                "rationale": res.rationale,
                "sourceRefs": {k: list(v) for k, v in res.source_refs.items()},
                "configVersion": res.config_version,
            },
        })

    return {"generatedBy": "culiver_kpi (python original)",
            "configVersion": DEFAULT_CONFIG_VERSION,
            "cases": cases}


if __name__ == "__main__":
    json.dump(build(), sys.stdout, ensure_ascii=False, indent=1)
    sys.stdout.write("\n")
