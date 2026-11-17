"""엣지 루프가 화면에 내보내는 자료 검증 — 구간 비교(M1)·승인(M2)·설정(M6)."""

from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pytest

from ofdf import cli, site
from ofdf.action.journal import Journal
from tests.test_cli import field_dir, models  # noqa: F401  (pytest fixture)

#: 시험용 현장 자료는 낮 11시에서 끝난다. 낮에는 피복을 펴지 않고 준비만 한다.
COVER = "야간피복|일몰 후 피복 준비"


def hourly_frame(columns: dict[str, list[float]]) -> pd.DataFrame:
    index = pd.date_range("2026-11-17 00:00", periods=len(next(iter(columns.values()))), freq="h")
    return pd.DataFrame(columns, index=index)


def test_compare_series_pairs_both_zones():
    hours = 30
    frame = hourly_frame({
        "treatment.canopy_temp": list(np.linspace(3.0, 1.0, hours)),
        "control.canopy_temp": list(np.linspace(2.0, 0.0, hours)),
        "treatment.soil_moisture": [40.0] * hours,
        "control.soil_moisture": [35.0] * hours,
    })
    compare = cli.compare_series(frame)
    assert len(compare["time"]) == 25                          # 최근 24시간(양 끝 포함)
    canopy = next(v for v in compare["variables"] if v["key"] == "canopy_temp")
    assert len(canopy["treatment"]) == len(canopy["control"]) == 25
    assert canopy["lastDiff"] == 1.0 and canopy["meanDiff"] == 1.0
    assert canopy["treatment"][-1] == 1.0 and canopy["control"][-1] == 0.0
    soil = next(v for v in compare["variables"] if v["key"] == "soil_moisture")
    assert soil["meanDiff"] == 5.0 and soil["unit"] == "%"


def test_compare_series_uses_only_directly_measured_values():
    """마스트 값으로 채운 항목을 비교하면 같은 선 두 개가 겹쳐 '차이 없음'으로 읽힌다."""
    frame = hourly_frame({
        "mast.t_air": [10.0] * 5, "mast.rh": [80.0] * 5,
        "treatment.t_air": [9.0] * 5, "control.t_air": [9.5] * 5,
        "treatment.rh": [85.0] * 5,                            # 비교구간에 습도 센서 없음
        "treatment.canopy_temp": [7.0] * 5, "control.canopy_temp": [np.nan] * 5,   # 전부 결측
    })
    compare = cli.compare_series(frame)
    assert [v["key"] for v in compare["variables"]] == ["t_air"]


def test_compare_series_is_none_without_control_zone(field_dir):  # noqa: F811
    """비교구간 자료가 없으면 그래프를 숨긴다 — 빈 축을 그리지 않는다."""
    config = cli.EdgeConfig(field_dir=field_dir, model_dir=field_dir, journal_path=field_dir / "j")
    assert cli.compare_series(cli.read_hourly(config)) is None
    assert cli.compare_series(None) is None


def test_compare_series_keeps_gaps_as_null():
    frame = hourly_frame({"treatment.t_air": [1.0, np.nan, 3.0], "control.t_air": [1.0, 2.0, 2.0]})
    values = cli.compare_series(frame)["variables"][0]
    assert values["treatment"] == [1.0, None, 3.0]
    assert values["meanDiff"] == 0.5                           # 둘 다 있는 시각만 뺀다
    assert json.dumps(values)                                  # NaN 이 JSON 에 새지 않는다


def force_frost(monkeypatch, confidence: float):
    """모델 대신 정해진 판단을 낸다 — 서리 경계, 주어진 신뢰도."""
    def fake(_models, _features):
        levels = {"heat_dry": 0, "rain_wet": 0, "disease": 0, "frost": 2, "compound": 0}
        confidences = {**{r: 0.95 for r in levels}, "frost": confidence}
        evidence = {"frost": [{"feature": "canopy_temp", "value": -0.4, "contribution": 1.8}]}
        return {1: (levels, confidences, evidence), 3: (levels, confidences, evidence)}
    monkeypatch.setattr(cli, "judge_all", fake)


@pytest.fixture
def edge(field_dir, models, tmp_path):  # noqa: F811
    config = cli.EdgeConfig(
        field_dir=field_dir, model_dir=models, journal_path=tmp_path / "logs" / "journal.jsonl",
        dashboard_path=tmp_path / "dash" / "data.json", state_dir=tmp_path / "state",
        installed_devices=frozenset({"관수밸브", "야간피복"}),
    )
    journal = Journal(config.journal_path)

    def run() -> dict:
        assert cli.run_once(config, cli.load_models(models), journal)
        return json.loads(config.dashboard_path.read_text(encoding="utf-8"))

    return type("Edge", (), {"run": staticmethod(run), "config": config, "journal": journal})


def action(payload: dict, action_id: str) -> dict:
    return next(a for a in payload["actions"] if a["id"] == action_id)


def test_low_confidence_action_waits_then_runs_after_approval(edge, monkeypatch):
    force_frost(monkeypatch, 0.55)

    waiting = edge.run()
    cover = action(waiting, COVER)
    assert cover["needsApproval"] and cover["advisory"] and not cover["executed"]
    assert waiting["mode"] == "권고(농가 승인 필요)"

    site.record_response(edge.config.state_dir, COVER, "approve")       # 농가가 화면에서 누름
    approved = edge.run()
    cover = action(approved, COVER)
    assert cover["executed"] and not cover["needsApproval"]
    assert cover["userResponse"] == "approve" and cover["respondedAt"]
    record = edge.journal.read()[-1]
    assert record["user_approved"] is True
    assert any(a["command"] == "일몰 후 피복 준비" for a in record["executed"])

    site.record_response(edge.config.state_dir, COVER, "reject")        # 마음을 바꿈
    rejected = edge.run()
    cover = action(rejected, COVER)
    assert not cover["executed"] and "농가 거부" in cover["rejectedBy"]
    assert edge.journal.read()[-1]["user_approved"] is False

    site.record_response(edge.config.state_dir, COVER, "clear")         # 취소 → 다시 묻는다
    assert action(edge.run(), COVER)["needsApproval"]


def test_high_confidence_runs_without_asking(edge, monkeypatch):
    force_frost(monkeypatch, 0.92)
    payload = edge.run()
    assert action(payload, COVER)["executed"] and payload["mode"] == "자동"
    assert not any(a["needsApproval"] for a in payload["actions"])


def test_screen_settings_take_effect_next_cycle(edge, monkeypatch):
    """화면에서 신뢰도 기준을 올리면 재시작 없이 다음 판단부터 권고로 내려간다."""
    force_frost(monkeypatch, 0.75)
    assert edge.run()["mode"] == "자동"

    _, errors = site.save_overrides(
        edge.config.state_dir, edge.config.base_settings(), {"confidence_threshold": 0.8})
    assert not errors
    payload = edge.run()
    assert payload["mode"] == "권고(농가 승인 필요)"
    assert payload["settings"]["confidence_threshold"] == 0.8

    # 구동부를 끄면 승인 대상이 아니라 '농가가 직접' 이 된다
    site.save_overrides(edge.config.state_dir, edge.config.base_settings(),
                        {"installed_devices": ["관수밸브"]})
    cover = action(edge.run(), COVER)
    assert cover["advisory"] and not cover["needsApproval"] and "구동부 미설치" in cover["reason"]


def test_soil_limit_setting_reaches_field_rule(edge, monkeypatch):
    """현장 자료의 흙 수분은 30% 다. 상한을 기본 90% 로 두면 관수 금지가 없다."""
    force_frost(monkeypatch, 0.92)
    assert not any(a["command"] == "관수 금지" for a in edge.run()["actions"])
    sensors = cli.sensors_from(pd.DataFrame({"soil_moisture": [72.0]}), pd.Timestamp("2026-11-17"),
                               soil_upper_limit=70.0)
    assert sensors.soil_above_limit
    assert not cli.sensors_from(pd.DataFrame({"soil_moisture": [72.0]}),
                                pd.Timestamp("2026-11-17")).soil_above_limit


def test_screen_gets_judgement_history_and_series(edge, monkeypatch):
    """현장 제어기도 판단근거(M2)·제어 이력(M3)·24시간 추이(M1)를 채운다.

    전에는 이 셋을 빈 값으로 내보내 시연용 자료에서만 화면이 찼다.
    """
    force_frost(monkeypatch, 0.92)
    edge.run()
    payload = edge.run()

    judgement = payload["judgements"][0]
    assert judgement["risk"] == "frost" and judgement["levelName"] == "경계"
    assert judgement["evidence"][0]["label"] == "초관부 온도" and judgement["expectedOnset"]

    assert len(payload["history"]) == 2 * len(payload["actions"])      # 두 주기치
    assert {"time", "layer", "device", "command", "executed"} <= payload["history"][0].keys()

    series = payload["series"]
    assert len(series["time"]) == len(series["t_air"]) == len(series["canopy_temp"]) > 1
    assert payload["compare"] is None                                  # 이 현장엔 비교구간이 없다


def test_fusion_yaml_is_read(tmp_path):
    (tmp_path / "weather.yaml").write_text(
        "edge:\n  state_dir: var/state\n  installed_devices: [관수밸브]\n"
        "thresholds:\n  frost:\n    caution_canopy: 2.0\n", encoding="utf-8")
    (tmp_path / "fusion.yaml").write_text(
        "control:\n  confidence_threshold: 0.8\n  field_rules:\n    wind_recover: 8.0\n",
        encoding="utf-8")
    config = cli.load_config(cli.parse_args(["once", "--config", str(tmp_path / "weather.yaml")]))
    assert config.confidence_threshold == 0.8 and config.field_rules.wind_recover == 8.0
    assert str(config.state_dir) == "var/state"
    assert config.thresholds == {"frost": {"caution_canopy": 2.0}}

    explicit = cli.load_config(cli.parse_args(
        ["once", "--config", str(tmp_path / "weather.yaml"), "--state", str(tmp_path / "s")]))
    assert explicit.state_dir == tmp_path / "s"


def test_defaults_match_previous_behaviour():
    """설정을 주지 않으면 전과 같은 기준(0.70, 7·9·14m/s, 90%)으로 돈다."""
    config = cli.load_config(cli.parse_args(["once"]))
    settings = config.site_settings()
    assert settings.confidence_threshold == 0.70
    assert (settings.field_rules.wind_no_deploy, settings.field_rules.wind_recover,
            settings.field_rules.wind_lock, settings.field_rules.soil_upper_limit) \
        == (7.0, 9.0, 14.0, 90.0)
    assert settings.installed_devices is None


def test_serve_command_parses():
    args = cli.parse_args(["serve", "--port", "9090", "--bind", "127.0.0.1"])
    assert args.command == "serve" and args.port == 9090 and args.dashboard_dir is None


def test_broken_state_files_do_not_stop_the_cycle(edge, monkeypatch):
    """상태 파일이 어떻게 깨져 있어도 판단·기록·화면은 돈다."""
    force_frost(monkeypatch, 0.55)
    state = edge.config.state_dir
    state.mkdir(parents=True)
    (state / site.APPROVALS_FILE).write_bytes(b'{"id": "\xec\x95\xbc\xea')
    (state / site.SETTINGS_FILE).write_bytes(b"\xff\xfe not json")
    payload = edge.run()
    assert payload["settings"]["confidence_threshold"] == 0.70
    assert action(payload, COVER)["needsApproval"]

    # 읽는 쪽이 예외를 던져도(권한 등) 설정 파일 값으로 판단한다
    monkeypatch.setattr(site, "effective_settings",
                        lambda *a, **k: (_ for _ in ()).throw(PermissionError("state")))
    monkeypatch.setattr(site, "active_responses",
                        lambda *a, **k: (_ for _ in ()).throw(PermissionError("state")))
    assert edge.run()["mode"] == "권고(농가 승인 필요)"
