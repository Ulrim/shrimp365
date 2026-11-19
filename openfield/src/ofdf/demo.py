"""상황별 시연 — 특정 상황이 오면 AI 가 무엇을 판단하고 어떤 조치를 내는지 보여 준다.

현장에서는 비·서리·고온이 실제로 올 때까지 기다려야 동작을 볼 수 있다.
이 모듈은 그 기다림 없이, **과거에 실제로 관측된 기상 사례**를 시간순으로
다시 흘려 넣어 그때 제어기가 무엇을 했을지를 보여 준다.

지키는 선:

* **판단은 실제 것을 쓴다.** 사례의 관측값은 상주 실행과 같은 피처 생성기 →
  같은 학습 모델 → 같은 조치 엔진(:func:`ofdf.cli.assess`)을 거친다. 등급을
  미리 적어 두고 조치만 보여 주는 것이 아니다. 그래서 AI 가 늦게 알아채는
  사례는 늦게 알아챈 그대로 나온다.
* **입력은 실제 관측이다.** 사례는 농업기상관측(AAOS) 나주 지점의 과거 기록이고,
  모델 학습에 쓰지 않은 시험 구간에서 골랐다(``scripts/build_demo_cases.py``).
  강풍·통신두절·과전류처럼 관측 기록에 없는 안전 상황만 값을 바꿔 넣으며,
  그 단계에는 '입력모사'라고 적는다.
* **현장 기록과 섞이지 않는다.** 판단 이력(``logs/journal.jsonl``)·서버 업로드
  큐·현장 화면(``dashboard/data.json``)에 아무것도 쓰지 않는다. 시연 결과는
  ``dashboard/demo.json`` 한 파일에만 쓰고, 그 화면에는 '시연'이 항상 표시된다.
  이 이력이 성능평가(제어응답·수집률)의 측정 대상이기 때문이다.
* **장치를 움직이지 않는다.** 조치는 '이 상황이면 이렇게 한다'는 결정까지만
  보여 준다.
"""

from __future__ import annotations

import dataclasses
import datetime
import json
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

from ofdf import __version__
from ofdf.action.recommend import SensorState
from ofdf.features.derived import add_derived
from ofdf.features.weather import build_features
from ofdf.labels.risk import RISK_LABELS_KO
from ofdf.upload import FEATURE_LABELS_KO

CASES_DIR = Path(__file__).resolve().parent / "demo_cases"
INDEX_FILE = "cases.json"

LEVEL_NAMES = {0: "정상", 1: "주의", 2: "경계"}

#: 입력 종류 — 화면과 출력에 그대로 찍힌다(보고 원칙: 자연사례와 입력모사를 구분)
KIND_REPLAY = "과거 관측 재생"
KIND_SIMULATED = "과거 관측 재생 + 안전 입력모사"

#: 판단에 쓰는 관측창 길이. 상주 실행(``cli.WINDOW_HOURS``)과 같아야 한다.
WINDOW_HOURS = 48

#: 화면에 보여 줄 관측값 (열 이름, 표시 이름, 단위)
ENVIRONMENT = [
    ("t_air", "기온", "℃"), ("rh", "습도", "%"), ("rain", "강수", "mm/h"),
    ("wind_speed", "풍속", "m/s"), ("solar_w", "일사", "W/㎡"),
    ("canopy_temp", "초관부 온도", "℃"), ("leaf_wetness", "엽면습윤", ""),
    ("soil_index", "토양수분 지수", ""),
]

#: 값을 바꿔 넣을 수 있는 안전 입력 (SensorState 필드, 표시 이름)
SIMULATABLE = {
    "gust_3s": "순간최대풍속(m/s)",
    "overcurrent": "구동부 과전류",
    "emergency_stop": "비상정지 버튼",
    "comms_down": "서버 통신 두절",
}


#: 판단근거에 나오는 피처 중 업로드용 이름표(``upload.FEATURE_LABELS_KO``)에 없는 것
EXTRA_LABELS = {
    "compound_score": "복합위험 점수",
    "hour_sin": "시각(주기)", "hour_cos": "시각(주기)",
    "doy_sin": "계절(주기)", "doy_cos": "계절(주기)",
    "is_night": "야간 여부", "month": "월",
    "run_wet": "엽면습윤 지속시간", "run_rh90": "습도 90% 이상 지속시간",
    "run_rain": "강우 지속시간", "run_dry": "무강수 지속시간",
    "run_hot30": "30℃ 이상 지속시간", "run_cold4": "4℃ 이하 지속시간",
    "run_canopy2": "초관부 2℃ 이하 지속시간", "run_soil_low": "토양 건조 지속시간",
    "run_dry_warm": "건조·고온 지속시간", "run_hot_solar": "고온·강일사 지속시간",
    "t_min_night": "전일 야간 최저기온", "rh_max_daily": "전일 최고습도",
}


@dataclass
class Case:
    """시연 사례 하나."""

    id: str
    title: str
    risk: str                    # 주로 보여 주려는 위험유형
    kind: str
    station: str
    source: str                  # 자료 출처 설명
    summary: str                 # 무슨 상황인지 한두 문장
    steps: int                   # 보여 줄 시점 수(마지막 ``steps`` 시간)
    frame: pd.DataFrame          # 시간순 관측(시연 시점들 + 그 앞 48시간)
    onset: str | None = None     # 실제 위험 상태가 시작된 시각(관측 기준)
    #: 안전 입력모사 — ``{시점 번호(0부터): {SensorState 필드: 값}}``
    simulate: dict[int, dict] = field(default_factory=dict)

    @property
    def times(self) -> list[pd.Timestamp]:
        return list(self.frame.index[-self.steps:])


def load_cases(directory: Path | None = None) -> list[Case]:
    """저장소에 들어 있는 시연 사례를 읽는다."""
    directory = Path(directory or CASES_DIR)
    index = json.loads((directory / INDEX_FILE).read_text(encoding="utf-8"))
    cases = []
    for entry in index["cases"]:
        frame = pd.read_csv(directory / entry["file"], parse_dates=["ts"]).set_index("ts")
        cases.append(Case(
            id=entry["id"], title=entry["title"], risk=entry["risk"], kind=entry["kind"],
            station=entry["station"], source=entry["source"], summary=entry["summary"],
            steps=int(entry["steps"]), frame=frame, onset=entry.get("onset"),
            simulate={int(k): v for k, v in (entry.get("simulate") or {}).items()},
        ))
    return cases


def find_case(cases: list[Case], case_id: str) -> Case:
    for case in cases:
        if case.id == case_id:
            return case
    known = ", ".join(c.id for c in cases)
    raise KeyError(f"시연 사례 '{case_id}' 가 없다. 있는 사례: {known}")


def _feature_label(name: str) -> str:
    """피처 이름을 읽을 수 있는 말로 바꾼다(없으면 이름 그대로)."""
    if name in FEATURE_LABELS_KO:
        return FEATURE_LABELS_KO[name]
    if name in EXTRA_LABELS:
        return EXTRA_LABELS[name]
    for suffix, text in (
        ("_mean", "{}시간 평균"), ("_max", "{}시간 최고"), ("_min", "{}시간 최저"),
        ("_sum", "{}시간 합계"), ("_delta", "{}시간 변화"),
    ):
        if suffix in name:
            base, _, window = name.partition(suffix)
            return f"{FEATURE_LABELS_KO.get(base, base)} {text.format(window)}"
    return name


def replay(case: Case, models: dict, installed_devices: frozenset[str] | None = None) -> list[dict]:
    """사례를 시간순으로 다시 흘려 넣고 시점마다의 판단·조치를 돌려준다.

    차광막은 제어기처럼 상태를 들고 다닌다 — 전개 명령이 나가면 펴진 것으로
    보고 누적시간을 쌓아, 2시간 한도·16시 회수 규칙이 실제처럼 걸리게 한다.
    관측 기록에는 차광막 상태가 없으므로 이 부분은 시연이 만들어 넣는 값이다.
    """
    # 순환 import 를 피한다 — cli 가 이 모듈을 부른다.
    from ofdf.cli import assess

    actual_cols = [c for c in case.frame.columns if c.startswith("actual_")]
    observed = case.frame.drop(columns=actual_cols)

    shade_minutes, shade_open = 0.0, False
    steps = []
    for number, now in enumerate(case.times):
        window = observed.loc[:now].tail(WINDOW_HOURS + 1)
        observations = add_derived(window)
        features = build_features(observations)
        simulated = dict(case.simulate.get(number, {}))

        def adjust(sensors: SensorState, simulated=simulated,
                   minutes=shade_minutes, is_open=shade_open) -> SensorState:
            changed = dict(simulated)
            if "gust_3s" in changed:
                # 관측 기록에는 순간풍속이 없다. 넣은 값이 어디서 왔는지 조치 사유에 남긴다.
                changed["gust_source"] = "3초 순간최대(입력모사) "
            return dataclasses.replace(
                sensors, shade_deployed_minutes=minutes, shade_open=is_open, **changed,
            )

        by_horizon, levels, confidences, evidence, decision = assess(
            models, observations, features, pd.Timestamp(now), installed_devices,
            adjust_sensors=adjust,
        )

        executed = decision.executable()
        if any("차광" in a.device and "전개" in a.command and "금지" not in a.command
               and "회수" not in a.command for a in executed):
            shade_open = True
        elif any("차광" in a.device and "회수" in a.command for a in executed):
            shade_open = False
        if shade_open:
            shade_minutes += 60.0

        last = observations.iloc[-1]
        steps.append({
            "time": pd.Timestamp(now).isoformat(),
            "environment": [
                {"key": key, "name": name, "unit": unit, "value": round(float(last[key]), 2)}
                for key, name, unit in ENVIRONMENT
                if key in observations.columns and pd.notna(last[key])
            ],
            "risks": [
                {
                    "risk": risk, "name": RISK_LABELS_KO[risk],
                    "horizons": {
                        str(h): {
                            "level": int(by_horizon[h][0].get(risk, 0)),
                            "levelName": LEVEL_NAMES[int(by_horizon[h][0].get(risk, 0))],
                            "confidence": round(float(by_horizon[h][1].get(risk, 1.0)), 3),
                        }
                        for h in sorted(by_horizon) if risk in by_horizon[h][0]
                    },
                    "evidence": [
                        {"label": _feature_label(e["feature"]),
                         "value": round(float(e["value"]), 2)}
                        for e in evidence.get(risk, []) if e["feature"] != "compound_score"
                    ],
                }
                for risk in levels
            ],
            "actual": {
                c.removeprefix("actual_"): int(case.frame.loc[now, c])
                for c in actual_cols if pd.notna(case.frame.loc[now, c])
            },
            "simulated": [
                {"field": key, "name": SIMULATABLE.get(key, key), "value": value}
                for key, value in simulated.items()
            ],
            "mode": decision.mode,
            "actions": [
                {"device": a.device, "command": a.command, "layer": int(a.layer),
                 "reason": a.reason, "riskType": a.risk_type,
                 "executed": not a.rejected_by and not a.advisory,
                 "rejectedBy": a.rejected_by, "advisory": a.advisory}
                for a in decision.actions
            ],
            "alerts": list(decision.alerts),
        })
    return steps


def first_alarm(steps: list[dict], risk: str, horizon: int | None = None) -> str | None:
    """그 위험을 AI 가 처음 주의 이상으로 올린 시각(없으면 ``None``)."""
    for step in steps:
        for item in step["risks"]:
            if item["risk"] != risk:
                continue
            horizons = item["horizons"]
            picked = [horizons[str(horizon)]] if horizon else list(horizons.values())
            if any(h["level"] > 0 for h in picked):
                return step["time"]
    return None


def safety_text(steps: list[dict]) -> str:
    """안전 입력모사 사례의 요약 — 안전 계층(L0·L1)이 낸 조치를 모아 적는다."""
    seen: list[str] = []
    for step in steps:
        if not step["simulated"]:
            continue
        for action in step["actions"]:
            text = f"{action['device']} {action['command']}"
            if action["layer"] <= 1 and action["executed"] and text not in seen:
                seen.append(text)
    modes = [s["mode"] for s in steps if s["simulated"] and s["mode"] != "자동"]
    mode = f" 운전모드는 '{modes[0]}'(으)로 바뀌었다." if modes else ""
    if not seen:
        return "입력모사 구간에서 안전 계층이 낸 조치가 없다." + mode
    return "입력모사 구간에서 안전 계층이 낸 조치: " + ", ".join(seen) + "." + mode


def lead_text(case: Case, steps: list[dict]) -> str:
    """AI 가 실제 발생보다 얼마나 먼저(또는 늦게) 알렸는지 한 문장으로."""
    if case.simulate:
        return safety_text(steps)
    alarm = first_alarm(steps, case.risk)
    name = RISK_LABELS_KO.get(case.risk, case.risk).removesuffix("위험")
    if alarm is None:
        return f"이 사례에서 AI 는 {name} 위험을 알리지 못했다."
    if not case.onset:
        return f"AI 가 {name} 위험을 처음 알린 시각: {_clock(alarm)}."
    gap = (pd.Timestamp(case.onset) - pd.Timestamp(alarm)) / pd.Timedelta(hours=1)
    if alarm == steps[0]["time"] and gap > 0:
        return (f"시연 첫 시점({_clock(alarm)})에 AI 가 이미 {name} 위험을 알리고 있었다 "
                f"— 실제 발생({_clock(case.onset)})보다 {gap:.0f}시간 이상 앞.")
    if gap > 0:
        return (f"AI 가 {_clock(alarm)}에 {name} 위험을 처음 알렸다 "
                f"— 실제 발생({_clock(case.onset)}) {gap:.0f}시간 전.")
    if gap == 0:
        return (f"AI 가 {name} 위험을 알린 것은 실제 발생과 같은 시각({_clock(alarm)})이다 "
                "— 미리 알리지는 못했다.")
    return (f"AI 가 {name} 위험을 알린 것은 {_clock(alarm)}로, 실제 발생({_clock(case.onset)})보다 "
            f"{-gap:.0f}시간 늦었다.")


def _clock(iso: str) -> str:
    ts = pd.Timestamp(iso)
    return f"{ts.month}월 {ts.day}일 {ts.hour:02d}시"


def _risk_cell(step: dict, risk: str) -> str:
    for item in step["risks"]:
        if item["risk"] == risk:
            return " / ".join(
                f"{h}시간 뒤 {v['levelName']}" + (f"({v['confidence']:.2f})" if v["level"] else "")
                for h, v in item["horizons"].items()
            )
    return "-"


def render_text(case: Case, steps: list[dict], number: int = 1, total: int = 1) -> str:
    """사례 하나의 시연 결과를 터미널에 찍을 글로 만든다."""
    env_keys = ("t_air", "rh", "rain", "wind_speed")
    lines = [
        "",
        "=" * 78,
        f"[시연 {number}/{total}] {case.title}",
        f"  ※ {case.kind} — 지금 현장에서 일어나는 일이 아니다. 장치는 움직이지 않는다.",
        "=" * 78,
        f"  상황   : {case.summary}",
        f"  자료   : {case.source}",
    ]
    if case.onset:
        lines.append(f"  실제   : {_clock(case.onset)}부터 "
                     f"{RISK_LABELS_KO.get(case.risk, case.risk)} 조건이 관측됨")
    lines.append("")

    for index, step in enumerate(steps):
        env = {e["key"]: e for e in step["environment"]}
        readings = "  ".join(
            f"{env[k]['name']} {env[k]['value']:g}{env[k]['unit']}" for k in env_keys if k in env
        )
        actual = step["actual"].get(case.risk)
        marker = f"  [이 시각 실제 상태: {LEVEL_NAMES.get(actual, actual)}]" if actual else ""
        lines.append(f"■ {_clock(step['time'])}   {readings}{marker}")
        for sim in step["simulated"]:
            value = "발생" if sim["value"] is True else sim["value"]
            lines.append(f"    (입력모사) {sim['name']} = {value}")

        active = [r for r in step["risks"]
                  if any(h["level"] > 0 for h in r["horizons"].values())]
        if not active:
            lines.append("    AI 판단 : 전 유형 정상")
        for item in active:
            lines.append(f"    AI 판단 : {item['name']} — {_risk_cell(step, item['risk'])}")
            if item["evidence"]:
                lines.append("      근거  : " + ", ".join(
                    f"{e['label']} {e['value']:g}" for e in item["evidence"]))

        shown = False
        for action in step["actions"]:
            if action["rejectedBy"]:
                tag = f"보류({action['rejectedBy']})"
            elif action["advisory"]:
                tag = "권고(농가 승인 후)"
            else:
                tag = "실행"
            lines.append(f"    조치    : [{tag}] {action['device']} · {action['command']}"
                         f"  — {action['reason']}")
            shown = True
        if not shown:
            lines.append("    조치    : 없음")
        if step["mode"] != "자동":
            lines.append(f"    운전모드: {step['mode']}")
        if index < len(steps) - 1:
            lines.append("")

    lines += ["", f"  요약   : {lead_text(case, steps)}"]
    return "\n".join(lines)


def case_payload(case: Case, steps: list[dict]) -> dict:
    return {
        "id": case.id, "title": case.title, "risk": case.risk,
        "riskName": RISK_LABELS_KO.get(case.risk, case.risk),
        "kind": case.kind, "station": case.station, "source": case.source,
        "summary": case.summary, "onset": case.onset,
        "lead": lead_text(case, steps), "steps": steps,
    }


def write_export(path: Path, payloads: list[dict], model_dir: Path) -> None:
    """시연 화면(``dashboard/demo.html``)이 읽을 파일을 쓴다.

    현장 화면의 ``data.json`` 과는 다른 파일이다. ``demo: true`` 를 넣어, 누가
    이 파일을 현장 화면에 잘못 물려도 시연임을 알 수 있게 한다.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    document = {
        "demo": True,
        "notice": "과거 실제 관측 사례를 다시 흘려 넣은 결과입니다. "
                  "지금 현장 상황이 아니며 장치는 움직이지 않습니다.",
        "generated": datetime.datetime.now().isoformat(timespec="seconds"),
        "modelVersion": f"ofdf-weather-{__version__}",
        "modelDir": str(model_dir),
        "cases": payloads,
    }
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")
    temp.replace(path)
