"""계측값 정규화 차분 검증용 기준값 생성기 (원본 Python → JSON).

`lib/mrv/ingestion.ts::normalizeReadings` 는 게이트웨이가 보낸 원 계측값(적산 kWh /
순시 kW / 구간 kWh / DO)을 `readings.value` 저장 규약인 **구간 kWh** 로 옮기고 초기
quality_flag 를 판정한다(ADR 0001). 여기서 나온 값이 그대로 DB 에 앉고 KPI 엔진의
입력이 되므로, 이 계층이 원본과 어긋나면 **산식이 멀쩡해도 모든 KPI 가 틀린다**.

순수 함수(DB 접근 없음)라 원본과 직접 대조할 수 있다.

실행:
    python3 scripts/mrv/gen_ingestion_fixtures.py > scripts/mrv/ingestion-fixtures.json
"""

from __future__ import annotations

import json
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "mrv-platform" / "apps" / "api"))

from app.services.ingestion import (  # noqa: E402
    PriorState,
    RawReading,
    normalize_readings,
)

T0 = datetime(2026, 4, 1, tzinfo=timezone.utc)
KINDS = ("cumulative_kwh", "instant_kw", "interval_kwh", "do_mg_l")


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def raw_json(r: RawReading) -> dict:
    return {
        "index": r.index,
        "meterId": r.meter_id,
        "ts": iso(r.ts),
        "value": r.value,
        "readingKind": r.reading_kind,
        "seq": r.seq,
    }


def build() -> dict:
    cases: list[dict] = []
    rng = random.Random(20260830)

    # --- 손으로 고른 경계 케이스 ---------------------------------------------
    def case(name, raws, prior=None):
        prior = prior or {}
        out = normalize_readings(raws, {k: PriorState(ts=v[0], value=v[1])
                                        for k, v in prior.items()})
        cases.append({
            "name": name,
            "input": {
                "raws": [raw_json(r) for r in raws],
                "prior": {k: {"ts": iso(v[0]), "value": v[1]} for k, v in prior.items()},
            },
            "expected": [
                {"meterId": n.meter_id, "ts": iso(n.ts), "value": n.value,
                 "qualityFlag": n.quality_flag}
                for n in out
            ],
        })

    # 적산: 배치 안에서 이어지면 차분, 롤오버(감소)면 suspect, 이력만 있으면 suspect,
    #       아무것도 없으면 최초 기준선이라 bad.
    case("cumulative-normal", [
        RawReading(0, "m1", T0, 100.0, "cumulative_kwh"),
        RawReading(1, "m1", T0 + timedelta(hours=1), 105.5, "cumulative_kwh"),
        RawReading(2, "m1", T0 + timedelta(hours=2), 112.0, "cumulative_kwh"),
    ])
    case("cumulative-rollover", [
        RawReading(0, "m1", T0, 100.0, "cumulative_kwh"),
        RawReading(1, "m1", T0 + timedelta(hours=1), 3.0, "cumulative_kwh"),
    ])
    case("cumulative-with-history", [
        RawReading(0, "m1", T0 + timedelta(hours=5), 130.0, "cumulative_kwh"),
    ], prior={"m1": (T0, 4.5)})
    case("cumulative-no-history", [
        RawReading(0, "m1", T0, 100.0, "cumulative_kwh"),
    ])

    # 순시: 사다리꼴 적분, 간격 0 이하/2시간 초과면 bad, 배치 내 직전값 없으면 bad.
    case("instant-normal", [
        RawReading(0, "m1", T0, 10.0, "instant_kw"),
        RawReading(1, "m1", T0 + timedelta(hours=1), 14.0, "instant_kw"),
        RawReading(2, "m1", T0 + timedelta(minutes=90), 12.0, "instant_kw"),
    ])
    case("instant-gap-too-wide", [
        RawReading(0, "m1", T0, 10.0, "instant_kw"),
        RawReading(1, "m1", T0 + timedelta(hours=3), 12.0, "instant_kw"),
    ])
    case("instant-same-ts", [
        RawReading(0, "m1", T0, 10.0, "instant_kw"),
        RawReading(1, "m1", T0, 12.0, "instant_kw", seq=2),
    ])
    case("instant-exact-2h-boundary", [
        RawReading(0, "m1", T0, 10.0, "instant_kw"),
        RawReading(1, "m1", T0 + timedelta(hours=2), 20.0, "instant_kw"),
    ])

    # 구간: 음수는 suspect, 0 은 ok.
    case("interval-values", [
        RawReading(0, "m1", T0, 3.25, "interval_kwh"),
        RawReading(1, "m1", T0 + timedelta(hours=1), 0.0, "interval_kwh"),
        RawReading(2, "m1", T0 + timedelta(hours=2), -1.0, "interval_kwh"),
    ])

    # DO: 0~20 밖은 suspect(경계값 포함 여부까지).
    case("do-range", [
        RawReading(0, "d1", T0, 6.4, "do_mg_l"),
        RawReading(1, "d1", T0 + timedelta(minutes=1), 0.0, "do_mg_l"),
        RawReading(2, "d1", T0 + timedelta(minutes=2), 20.0, "do_mg_l"),
        RawReading(3, "d1", T0 + timedelta(minutes=3), 20.0001, "do_mg_l"),
        RawReading(4, "d1", T0 + timedelta(minutes=4), -0.1, "do_mg_l"),
    ])

    # 정렬 규약: (ts, seq, meter_id) 오름차순으로 처리한다 — 입력 순서를 뒤집어도
    # 같은 결과가 나와야 결정론이 성립한다.
    shuffled = [
        RawReading(0, "m1", T0 + timedelta(hours=2), 112.0, "cumulative_kwh", seq=3),
        RawReading(1, "m1", T0, 100.0, "cumulative_kwh", seq=1),
        RawReading(2, "m1", T0 + timedelta(hours=1), 105.5, "cumulative_kwh", seq=2),
    ]
    case("ordering-shuffled", shuffled)

    # 여러 계측기가 섞인 배치(계측기별로 직전값을 따로 추적해야 한다).
    case("multi-meter-interleaved", [
        RawReading(0, "m1", T0, 100.0, "cumulative_kwh"),
        RawReading(1, "m2", T0, 500.0, "cumulative_kwh"),
        RawReading(2, "m1", T0 + timedelta(hours=1), 104.0, "cumulative_kwh"),
        RawReading(3, "m2", T0 + timedelta(hours=1), 503.5, "cumulative_kwh"),
        RawReading(4, "d1", T0 + timedelta(hours=1), 7.2, "do_mg_l"),
    ])

    # 같은 (ts, seq) 에 서로 다른 계측기 — meter_id 로 순서가 갈린다.
    case("tiebreak-by-meter-id", [
        RawReading(0, "m2", T0, 1.0, "interval_kwh", seq=1),
        RawReading(1, "m1", T0, 2.0, "interval_kwh", seq=1),
    ])

    case("empty-batch", [])

    # --- 난수 배치(원본과 이식본이 같은 경로를 타는지 폭넓게 확인) -------------
    for i in range(30):
        n = rng.randrange(0, 25)
        raws = [
            RawReading(
                index=j,
                meter_id=f"m{rng.randrange(3)}",
                ts=T0 + timedelta(minutes=rng.randrange(0, 60 * 8)),
                value=round(rng.uniform(-5.0, 600.0), 3),
                reading_kind=rng.choice(KINDS),
                seq=rng.choice([None, rng.randrange(5)]),
            )
            for j in range(n)
        ]
        prior = {}
        for mid in {r.meter_id for r in raws}:
            if rng.random() < 0.5:
                prior[mid] = (T0 - timedelta(hours=1), round(rng.uniform(0, 400), 3))
        case(f"random-{i}", raws, prior)

    return {"generatedBy": "app.services.ingestion (python original)", "cases": cases}


if __name__ == "__main__":
    json.dump(build(), sys.stdout, ensure_ascii=False, indent=1)
    sys.stdout.write("\n")
