"""시연 사례 만들기 — ``ofdf demo`` 가 다시 흘려 넣을 과거 실제 관측 사례를 고른다.

농업기상관측(AAOS) 원자료에서, **모델 학습에 쓰지 않은 시험 구간** 안의 실제
위험 발생 사례를 위험유형마다 하나씩 골라 ``src/ofdf/demo_cases/`` 에 적는다.
원자료는 저장소에 없으므로(용량) 이 스크립트는 원자료가 있는 곳에서만 돌린다.
라즈베리파이는 여기서 만든 작은 CSV 만 읽는다.

고르는 기준(위험유형마다, 최근 사례부터 본다):

1. 사례 시작 전 몇 시간이 '정상' 상태였을 것 — 정상에서 위험으로 넘어가는
   모습을 보여 주기 위해서다.
2. 시연 구간 전체가 시험 구간일 것 — 학습 때 본 날을 보여 주면 잘 맞는 것이
   당연하다.
3. 그중 **AI 가 실제 발생 전에 알린 사례**를 먼저 고른다. 없으면 발생 시각에
   가장 가깝게 알린 사례를 고르고, 늦게 알렸다는 사실은 시연 요약에 그대로 나온다.

3번 때문에 시연은 '잘 된 사례'를 보여 준다. 전체 성능은 성능평가서의 수치로
말해야 하고, 시연을 성능의 근거로 쓰면 안 된다(사례 목록 파일에도 적는다).

사용 예::

    python scripts/build_demo_cases.py --aaos-dir data/raw/aaos \
        --agera5 data/raw/AgERA5_Naju-Daegyo_2x2mean_daily_2015-2026.csv \
        --cache artifacts/dataset.pkl --models artifacts/weather
"""

from __future__ import annotations

import argparse
import datetime
import json
import pickle
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from ofdf import cli, demo  # noqa: E402
from ofdf.data import aaos, agera5, quality  # noqa: E402
from ofdf.data.dataset import _regional_wind  # noqa: E402
from ofdf.features.derived import add_derived  # noqa: E402
from ofdf.labels.risk import RISK_LABELS_KO, build_states  # noqa: E402
from ofdf.models import weather_risk  # noqa: E402

#: 사례 CSV 에 적는 열 — 판단 입력이 되는 관측·파생값
INPUT_COLUMNS = [
    "t_air", "rh", "rain", "solar_w", "wind_speed",
    "canopy_temp", "leaf_wetness", "soil_index",
    "et0", "cloud_cover", "t_min_night", "rh_max_daily",
]

#: 위험유형별 시연 구간 — (발생 전 시간, 발생 뒤 시간, 발생 전 '정상'이어야 하는 시간)
SPANS = {
    "heat_dry": (4, 6, 3),
    "rain_wet": (6, 3, 6),
    "disease": (6, 3, 6),
    "frost": (8, 2, 6),
    "compound": (6, 3, 6),
}

TITLES = {
    "heat_dry": "고온·건조 — 관수 권고와 차광 한정 전개",
    "rain_wet": "강우·과습 — 관수 중단과 배수 확인",
    "disease": "병해 유리환경 — 예찰 알림과 살수 금지",
    "frost": "저온·서리 — 야간 사전경보",
    "compound": "복합위험 — 비 온 뒤 다습·저온이 겹칠 때",
}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--aaos-dir", required=True)
    p.add_argument("--agera5", required=True)
    p.add_argument("--cache", required=True,
                   help="학습에 쓴 데이터셋 pickle(시험 구간을 다시 구한다)")
    p.add_argument("--models", required=True)
    p.add_argument("--out", default=str(demo.CASES_DIR))
    p.add_argument("--seed", type=int, default=42, help="학습 때의 분할 시드")
    p.add_argument("--candidates", type=int, default=200, help="위험유형마다 살펴볼 최근 사례 수")
    return p.parse_args()


def test_times(cache: Path, seed: int) -> set[tuple[str, pd.Timestamp]]:
    """학습 스크립트와 같은 분할로 시험 구간의 (지점, 시각)을 구한다."""
    with open(cache, "rb") as handle:
        dataset = pickle.load(handle)
    meta = dataset.meta.reset_index(drop=True)
    states = dataset.states.reset_index(drop=True)
    groups = weather_risk.shared_group_keys(meta, states)
    _, _, test_idx = weather_risk.split_by_event(groups, seed=seed)
    picked = meta.iloc[test_idx]
    return set(zip(picked["station"], pd.to_datetime(picked["ts"]), strict=True))


def station_frames(aaos_dir: str, agera5_csv: str) -> dict[str, pd.DataFrame]:
    """지점별 시간순 관측 + 파생변수 + 실제 위험 상태.

    ``ofdf.data.dataset.build`` 의 지점 루프와 같은 절차다(품질관리 → 시간 격자 →
    지역 풍속 보충 → 하루 전 일자료 병합 → 파생변수). 그 함수는 피처만 돌려주고
    관측 원값을 버리므로 여기서 같은 절차를 다시 밟는다.
    """
    hourly = aaos.load_directory(aaos_dir)
    daily = agera5.read_daily(agera5_csv)
    flagged, _ = quality.run(hourly)
    hourly = quality.apply_mask(flagged)
    wind = _regional_wind(hourly)

    frames = {}
    for station in hourly["station"].unique():
        one = (hourly[hourly["station"] == station]
               .drop_duplicates(subset="ts").set_index("ts").sort_index())
        one = one.reindex(pd.date_range(one.index.min(), one.index.max(), freq="h"))
        one["wind_speed"] = one["wind_speed"].fillna(wind.reindex(one.index))
        prev_day = one.index.normalize() - pd.Timedelta(days=1)
        for col in ("et0", "cloud_cover", "t_min_night", "rh_max_daily"):
            if col in daily.columns:
                one[col] = pd.Series(prev_day, index=one.index).map(
                    daily.set_index("date")[col])
        one["et0"] = one["et0"] / 24.0
        one = add_derived(one)
        states = build_states(one).add_prefix("actual_")
        frames[station] = pd.concat([one[[c for c in INPUT_COLUMNS if c in one]], states], axis=1)
    return frames


def onsets(frame: pd.DataFrame, risk: str, quiet_hours: int) -> list[pd.Timestamp]:
    """정상 상태가 ``quiet_hours`` 이어진 뒤 위험 상태가 시작된 시각들."""
    state = frame[f"actual_{risk}"].fillna(0)
    risky = state >= 1
    quiet = (~risky).rolling(quiet_hours).sum().shift(1) == quiet_hours
    return list(frame.index[risky & quiet])


def cut(frame: pd.DataFrame, onset: pd.Timestamp, before: int, after: int) -> pd.DataFrame:
    start = onset - pd.Timedelta(hours=before + demo.WINDOW_HOURS)
    piece = frame.loc[start: onset + pd.Timedelta(hours=after)].copy()
    piece.index.name = "ts"
    return piece.round(3)


def summarise(risk: str, piece: pd.DataFrame, steps: int) -> str:
    """관측값에서 상황 설명을 만든다(숫자는 사례 자료에서 읽는다)."""
    shown = piece.tail(steps)
    t0, t1 = shown.index[0], shown.index[-1]
    when = f"{t0.year}년 {t0.month}월 {t0.day}일 {t0.hour:02d}시~{t1.day}일 {t1.hour:02d}시"
    t_lo, t_hi = shown["t_air"].min(), shown["t_air"].max()
    rain = shown["rain"].sum()
    rh_hi = shown["rh"].max()
    if risk == "heat_dry":
        return (f"{when}. 기온이 {t_hi:.1f}℃까지 오르고 "
                f"습도가 {shown['rh'].min():.0f}%까지 내려간 낮.")
    if risk == "rain_wet":
        return f"{when}. 이 구간에 비가 {rain:.1f}mm 내렸다(시간 최대 {shown['rain'].max():.1f}mm)."
    if risk == "disease":
        return (f"{when}. 습도가 {rh_hi:.0f}%까지 오르고 "
                f"기온 {t_lo:.1f}~{t_hi:.1f}℃가 이어진 다습한 시간대.")
    if risk == "frost":
        return f"{when}. 기온이 {shown['t_air'].iloc[0]:.1f}℃에서 {t_lo:.1f}℃까지 내려간 밤."
    return (f"{when}. 비 {rain:.1f}mm, 습도 최고 {rh_hi:.0f}%, "
            f"기온 {t_lo:.1f}~{t_hi:.1f}℃가 겹친 구간.")


def shade_deployed(step: dict) -> bool:
    return any("차광" in a["device"] and "전개" in a["command"] and a["executed"]
               and "금지" not in a["command"] for a in step["actions"])


def shows_action(risk: str, result: list[dict]) -> bool:
    """그 위험유형에서 보여 주려는 조치가 실제로 나왔는지.

    고온·건조는 '경계'까지 가야 차광이 나간다. 주의에서 끝나는 사례를 고르면
    관수 권고만 보이고 차광 한정 전개·회수는 보여 줄 수 없다.
    """
    if risk == "heat_dry":
        # 전개 뒤로 네 시점은 남아야 한도 소진·회수와 강풍 입력모사를 이어 보여 줄 수 있다.
        return any(shade_deployed(s) for s in result[:-4])
    return True


def pick(risk: str, frames: dict, tested: set, models: dict, limit: int):
    """위험유형 하나의 시연 사례를 고른다. ``(Case, 시점별 결과)``."""
    before, after, quiet = SPANS[risk]
    candidates = []
    for station, frame in frames.items():
        for onset in onsets(frame, risk, quiet):
            # 고온·건조 상태는 토양 건조가 이어지면 밤에도 시작된다(라벨 정의).
            # 시연에서는 차광 시간대(10~16시)가 걸리는 낮 사례를 쓴다.
            if risk == "heat_dry" and not 9 <= onset.hour <= 12:
                continue
            span = pd.date_range(onset - pd.Timedelta(hours=before),
                                 onset + pd.Timedelta(hours=after), freq="h")
            if all((station, ts) in tested for ts in span):
                candidates.append((onset, station))
    candidates.sort(reverse=True)
    print(f"[{RISK_LABELS_KO[risk]}] 시험 구간의 발생 사례 {len(candidates)}건", flush=True)

    best = None
    for onset, station in candidates[:limit]:
        piece = cut(frames[station], onset, before, after)
        steps = before + after + 1
        if len(piece) < steps + demo.WINDOW_HOURS or piece[INPUT_COLUMNS[:3]].tail(
                steps + 24).isna().any().any():
            continue
        case = demo.Case(
            id=risk, title=TITLES[risk], risk=risk, kind=demo.KIND_REPLAY, station=station,
            source=f"농업기상관측(AAOS) {station} 실제 관측 · 모델 학습에 쓰지 않은 시험 구간",
            summary=summarise(risk, piece, steps), steps=steps, frame=piece,
            onset=onset.isoformat(),
        )
        result = demo.replay(case, models)
        alarm = demo.first_alarm(result, risk)
        if alarm is None:
            continue
        gap = (onset - pd.Timestamp(alarm)) / pd.Timedelta(hours=1)
        starts_quiet = alarm != result[0]["time"]
        # 정상에서 시작해 발생 전에 알린 사례가 가장 좋다. 그다음은 발생에 가까운 것.
        shown = shows_action(risk, result)
        score = (starts_quiet and gap > 0 and shown, shown, starts_quiet, -abs(gap - 3))
        if best is None or score > best[0]:
            best = (score, case, result)
        if score[0]:
            break
    if best is None:
        raise SystemExit(f"{risk}: 조건에 맞는 사례가 없다")
    _, case, result = best
    print(f"    선택: {case.station} {case.onset} — {demo.lead_text(case, result)}", flush=True)
    return case, result


def derive_safety(cases: dict[str, demo.Case], results: dict[str, list[dict]]) -> list[demo.Case]:
    """관측 기록에 없는 안전 상황 — 실제 사례 위에 안전 입력만 바꿔 넣는다."""
    out = []

    heat, steps = cases["heat_dry"], results["heat_dry"]
    # 차광 전개가 실제로 나간 시점부터 바람을 올린다 — 고온 차광 요청과 강풍이
    # 부딪칠 때 안전이 이기는지를 보여 주기 위해서다.
    deploy = next((i for i, s in enumerate(steps) if shade_deployed(s)), None)
    start = min(deploy + 1 if deploy is not None else heat.steps - 4, heat.steps - 4)
    gusts = [6.0, 7.5, 9.5, 14.5]
    simulate = {start + i: {"gust_3s": g} for i, g in enumerate(gusts)}
    last = max(simulate)
    simulate[last] = {**simulate[last], "overcurrent": True}
    out.append(demo.Case(
        id="wind_safety", title="강풍 안전보호 — 차광 중 돌풍과 구동부 과전류",
        risk="heat_dry", kind=demo.KIND_SIMULATED, station=heat.station,
        source=heat.source + " · 순간풍속과 과전류는 입력모사(관측 기록에 없음)",
        summary=("고온 경계로 차광막을 편 뒤" if deploy is not None else "고온인 낮에")
                + " 순간풍속이 6→7.5→9.5→14.5m/s 로 오르고, 마지막에 구동부 과전류가 걸린 상황. "
                "고온 조치보다 안전 규칙이 먼저인지 본다.",
        steps=heat.steps, frame=heat.frame, onset=heat.onset, simulate=simulate,
    ))

    frost = cases["frost"]
    down = {i: {"comms_down": True} for i in range(2, frost.steps - 2)}
    out.append(demo.Case(
        id="comms_outage", title="통신 두절 — 서버 없이 서리 밤을 넘길 때",
        risk="frost", kind=demo.KIND_SIMULATED, station=frost.station,
        source=frost.source + " · 통신 두절은 입력모사",
        summary="서리가 오는 밤 중간에 서버 통신이 끊겼다가 끝에 복구되는 상황. "
                "끊긴 동안에도 현장에서 판단·조치가 이어지는지 본다.",
        steps=frost.steps, frame=frost.frame, onset=frost.onset, simulate=down,
    ))
    return out


def main() -> int:
    args = parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    models = cli.load_models(Path(args.models))
    if not models:
        raise SystemExit(f"모델이 없다: {args.models}")
    print("[자료] 시험 구간과 지점별 관측을 준비한다", flush=True)
    tested = test_times(Path(args.cache), args.seed)
    frames = station_frames(args.aaos_dir, args.agera5)

    cases, results = {}, {}
    for risk in SPANS:
        cases[risk], results[risk] = pick(risk, frames, tested, models, args.candidates)
    ordered = list(cases.values()) + derive_safety(cases, results)

    index = {
        "note": "ofdf demo 가 다시 흘려 넣는 과거 실제 관측 사례. "
                "scripts/build_demo_cases.py 가 만든다. "
                "AI 가 발생 전에 알린 사례를 먼저 골랐으므로 성능의 근거로 쓰지 않는다 — "
                "전체 성능은 reports/성능평가서.md 의 수치로 말한다.",
        "built": datetime.date.today().isoformat(),
        "split_seed": args.seed,
        "cases": [],
    }
    written: dict[int, str] = {}
    for case in ordered:
        # 안전 입력모사 사례는 바탕이 된 실제 사례의 관측 파일을 그대로 가리킨다.
        name = written.get(id(case.frame))
        if name is None:
            name = written[id(case.frame)] = f"{case.id}.csv"
            case.frame.to_csv(out / name, encoding="utf-8")
        index["cases"].append({
            "id": case.id, "title": case.title, "risk": case.risk, "kind": case.kind,
            "station": case.station, "source": case.source, "summary": case.summary,
            "steps": case.steps, "onset": case.onset, "file": name,
            "simulate": {str(k): v for k, v in case.simulate.items()},
        })
    (out / demo.INDEX_FILE).write_text(
        json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[완료] 사례 {len(ordered)}건 → {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
