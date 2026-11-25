"""상황별 시연(ofdf.demo) — 사례 자료가 온전한지, 현장 기록과 섞이지 않는지."""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path

import pytest

from ofdf import cli, demo
from ofdf.action.recommend import SensorState

MODEL_DIR = Path(__file__).resolve().parents[1] / "artifacts" / "weather"


def fake_judge_all(levels_by_step):
    """모델 없이 돌리기 위한 대역 — 부를 때마다 다음 등급을 돌려준다."""
    calls = iter(levels_by_step)

    def judge_all(_models, _features):
        levels = next(calls)
        confidence = {risk: 0.9 for risk in levels}
        return {1: (levels, confidence, {}), 3: (levels, confidence, {})}
    return judge_all


def test_cases_are_complete():
    cases = demo.load_cases()
    assert {c.id for c in cases} >= {"heat_dry", "rain_wet", "disease", "frost", "compound",
                                     "wind_safety", "comms_outage"}
    fields = {f.name for f in dataclasses.fields(SensorState)}
    for case in cases:
        # 시연 시점마다 48시간 관측창이 있어야 상주 실행과 같은 조건으로 판단한다
        assert len(case.frame) >= case.steps + demo.WINDOW_HOURS, case.id
        shown = case.frame.tail(case.steps)
        assert not shown[["t_air", "rh", "rain"]].isna().any().any(), case.id
        assert f"actual_{case.risk}" in case.frame.columns
        for number, changes in case.simulate.items():
            assert 0 <= number < case.steps
            assert set(changes) <= fields
            assert set(changes) <= set(demo.SIMULATABLE)
        # 입력모사가 들어가면 종류에 적혀 있어야 한다(자연사례와 구분 표기)
        assert bool(case.simulate) == (case.kind == demo.KIND_SIMULATED), case.id


def test_real_observation_cases_start_before_onset():
    for case in demo.load_cases():
        assert case.onset is not None
        times = [t.isoformat() for t in case.times]
        assert case.onset in times and times.index(case.onset) > 0, case.id


def test_simulated_inputs_reach_the_safety_rules(monkeypatch):
    case = demo.find_case(demo.load_cases(), "wind_safety")
    monkeypatch.setattr(cli, "judge_all", fake_judge_all([{"heat_dry": 2}] * case.steps))
    steps = demo.replay(case, models={})

    for number, step in enumerate(steps):
        gust = case.simulate.get(number, {}).get("gust_3s")
        commands = [(a["device"], a["command"]) for a in step["actions"] if a["executed"]]
        assert bool(step["simulated"]) == (number in case.simulate)
        if gust and gust >= 9.0:
            assert any("회수" in command for _, command in commands)
            # 넣은 값이라는 사실이 조치 사유에 남는다
            assert any("입력모사" in a["reason"] for a in step["actions"])
        if case.simulate.get(number, {}).get("overcurrent"):
            assert step["mode"] == "안전정지"


def test_shade_state_is_carried_between_steps(monkeypatch):
    case = demo.find_case(demo.load_cases(), "heat_dry")
    monkeypatch.setattr(cli, "judge_all", fake_judge_all([{"heat_dry": 2}] * case.steps))
    steps = demo.replay(case, models={})

    def count(word):
        return sum(1 for s in steps for a in s["actions"]
                   if a["device"] == "차광막" and word in a["command"] and a["executed"])
    # 전개는 한 번만 나가고(펴진 상태가 유지된다) 2시간 한도에서 걷는다
    assert count("전개") == 1
    assert count("회수") >= 1


def test_demo_writes_only_its_own_file(monkeypatch, tmp_path, capsys):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "load_models", lambda _dir: {3: {}})
    monkeypatch.setattr(cli, "judge_all", lambda *_: {1: ({"frost": 1}, {"frost": 0.9}, {}),
                                                     3: ({"frost": 2}, {"frost": 0.9}, {})})
    assert cli.main(["demo", "--case", "frost", "--export", "out/demo.json"]) == 0

    # 판단 이력·업로드 큐·현장 화면 자료는 만들지 않는다
    written = sorted(str(p.relative_to(tmp_path)) for p in tmp_path.rglob("*") if p.is_file())
    assert written == ["out/demo.json"]
    document = json.loads((tmp_path / "out/demo.json").read_text(encoding="utf-8"))
    assert document["demo"] is True
    assert [c["id"] for c in document["cases"]] == ["frost"]

    out = capsys.readouterr().out
    assert "지금 현장에서 일어나는 일이 아니다" in out
    assert "서리 경보" in out


def test_unknown_case_is_an_error(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    assert cli.main(["demo", "--case", "없는사례"]) == 2
    assert not any(tmp_path.iterdir())


def test_list_needs_no_models(capsys):
    assert cli.main(["demo", "--list"]) == 0
    assert "wind_safety" in capsys.readouterr().out


@pytest.mark.skipif(not MODEL_DIR.exists(), reason="학습된 모델이 없다(artifacts/weather)")
def test_real_models_raise_each_risk_in_its_case():
    """실제 모델로 돌렸을 때 사례마다 그 위험을 알리는지 — 사례를 고른 기준 그대로."""
    models = cli.load_models(MODEL_DIR)
    for case in demo.load_cases():
        if case.simulate:
            continue
        steps = demo.replay(case, models)
        alarm = demo.first_alarm(steps, case.risk)
        assert alarm is not None and alarm <= case.onset, case.id
