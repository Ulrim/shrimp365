"""현장 설정(M6)과 농가 응답(M2) 상태 파일 검증."""

from __future__ import annotations

import datetime
import json

from ofdf import site
from ofdf.action.recommend import DEFAULT_FIELD_RULES

NOW = datetime.datetime(2026, 11, 17, 20, 0)


def test_base_settings_read_fusion_yaml():
    """fusion.yaml 의 신뢰도 기준과 즉응규칙이 실제로 읽힌다(전에는 아무도 읽지 않았다)."""
    base = site.base_settings(
        {"edge": {"installed_devices": ["관수밸브", "전 구동부"]}},
        {"control": {"confidence_threshold": 0.8,
                     "field_rules": {"wind_no_deploy": 6.0, "wind_recover": 8.0}}},
    )
    assert base.confidence_threshold == 0.8
    assert base.field_rules.wind_no_deploy == 6.0 and base.field_rules.wind_recover == 8.0
    assert base.field_rules.wind_lock == DEFAULT_FIELD_RULES.wind_lock      # 적지 않은 값
    assert base.installed_devices == frozenset({"관수밸브", "전 구동부"})


def test_base_settings_ignore_out_of_range_file_values():
    """설정 파일의 오타 하나로 안전규칙이 꺼지면 안 된다."""
    base = site.base_settings(None, {"control": {
        "confidence_threshold": 0.0, "field_rules": {"wind_lock": 99, "wind_recover": "빠르게"}}})
    assert base.confidence_threshold == 0.70
    assert base.field_rules == DEFAULT_FIELD_RULES
    assert base.installed_devices is None                                  # 전부 달린 것으로


def test_validate_rejects_out_of_range_and_unknown_keys():
    clean, errors = site.validate({
        "confidence_threshold": 0.1, "wind_lock": 60, "soil_upper_limit": 85,
        "model_dir": "/etc", "installed_devices": ["관수밸브", "레이저"],
    })
    assert clean == {"soil_upper_limit": 85.0}
    assert len(errors) == 4
    assert site.validate("0.7")[1]                                         # 묶음이 아니다
    assert site.validate({"wind_lock": True})[1]                           # 참·거짓은 숫자가 아니다
    assert site.validate({"wind_lock": float("nan")})[1]


def test_save_overrides_then_edge_reads_them(tmp_path):
    base = site.SiteSettings(installed_devices=frozenset({"관수밸브", "전 구동부"}))
    saved, errors = site.save_overrides(
        tmp_path, base,
        {"confidence_threshold": 0.8, "installed_devices": ["관수밸브", "야간피복"]},
        now=NOW, source="192.168.0.9")
    assert not errors
    effective = site.effective_settings(base, tmp_path)
    assert effective == saved
    assert effective.confidence_threshold == 0.8
    # 야간피복을 켜면 같은 권취 구동부를 쓰는 묶음 명령도 달린 것이 되고,
    # 안전 차단은 화면이 끄지 못한다
    assert effective.installed_devices == frozenset(
        {"관수밸브", "야간피복", "차광막·피복", "전 구동부"})

    # 보내지 않은 값은 그대로 남는다
    site.save_overrides(tmp_path, base, {"soil_upper_limit": 80}, now=NOW)
    again = site.effective_settings(base, tmp_path)
    assert again.confidence_threshold == 0.8 and again.field_rules.soil_upper_limit == 80.0

    log = site.settings_log(tmp_path)
    assert log[0]["changes"] == {"soil_upper_limit": {"from": 90.0, "to": 80.0}}
    assert log[1]["source"] == "192.168.0.9" and "confidence_threshold" in log[1]["changes"]


def test_save_nothing_when_any_value_is_bad(tmp_path):
    """절반만 반영된 설정은 어느 값이 도는지 모르게 만든다."""
    base = site.SiteSettings()
    saved, errors = site.save_overrides(tmp_path, base, {"soil_upper_limit": 80, "wind_lock": 99})
    assert saved is None and errors
    assert not (tmp_path / site.SETTINGS_FILE).exists()
    assert site.effective_settings(base, tmp_path) == base


def test_wind_thresholds_must_stay_ordered(tmp_path):
    """전개 금지 < 즉시 회수 < 구동 잠금. 뒤집히면 회수보다 잠금이 먼저 걸린다."""
    base = site.SiteSettings()
    saved, errors = site.save_overrides(tmp_path, base, {"wind_no_deploy": 9.0})
    assert saved is None and "순서" in errors[0]
    saved, errors = site.save_overrides(
        tmp_path, base, {"wind_no_deploy": 8.0, "wind_recover": 10.0, "wind_lock": 15.0})
    assert not errors and saved.field_rules.wind_recover == 10.0


def test_bounds_stop_short_of_switching_rules_off():
    """상한은 '규칙이 꺼진 것과 같은 값'보다 안쪽이다."""
    _, errors = site.validate({"soil_upper_limit": 100, "spray_stop_wind": 10,
                               "wind_lock": 25, "confidence_threshold": 0.5})
    assert len(errors) == 4


def test_torn_state_files_never_raise(tmp_path):
    """글자 중간에서 잘린 파일이 판단 주기를 멈추면 안 된다."""
    (tmp_path / site.APPROVALS_FILE).write_bytes(
        '{"id": "야간피복|야간 피복 전개", "response": "approve", "at": "2026-11-17T20:00:00"}\n'
        .encode() + b'{"id": "\xec\x95\xbc\xea')
    assert list(site.active_responses(tmp_path, NOW)) == ["야간피복|야간 피복 전개"]
    (tmp_path / site.SETTINGS_FILE).write_bytes(b'{"values": {"wind_lock": 1' + b"0" * 400 + b"}}")
    assert site.effective_settings(site.SiteSettings(), tmp_path) == site.SiteSettings()
    (tmp_path / site.SETTINGS_FILE).write_bytes(b'{"values": {"x": "\xea')
    assert site.effective_settings(site.SiteSettings(), tmp_path) == site.SiteSettings()


def test_broken_settings_file_falls_back_to_base(tmp_path):
    (tmp_path / site.SETTINGS_FILE).write_text('{"values": {"wind_lock": 9', encoding="utf-8")
    assert site.effective_settings(site.SiteSettings(), tmp_path) == site.SiteSettings()
    # 손으로 고쳐 범위 밖 값을 넣어도 제어기는 받지 않는다
    (tmp_path / site.SETTINGS_FILE).write_text(
        json.dumps({"values": {"confidence_threshold": 0.0, "soil_upper_limit": 70}}),
        encoding="utf-8")
    effective = site.effective_settings(site.SiteSettings(), tmp_path)
    assert effective.confidence_threshold == 0.70 and effective.field_rules.soil_upper_limit == 70


def test_reset_returns_to_file_values_and_logs(tmp_path):
    base = site.SiteSettings()
    site.save_overrides(tmp_path, base, {"wind_lock": 16.0}, now=NOW)
    assert site.reset_overrides(tmp_path, base, now=NOW) == base
    assert site.effective_settings(base, tmp_path) == base
    assert site.settings_log(tmp_path)[0]["reset"] is True


def test_settings_without_state_dir_are_file_values():
    base = site.SiteSettings(confidence_threshold=0.75)
    assert site.effective_settings(base, None) == base
    assert site.active_responses(None) == {}


def test_last_response_wins_and_clear_reopens(tmp_path):
    action = "야간피복|야간 피복 전개"
    site.record_response(tmp_path, action, "reject", now=NOW)
    active = site.record_response(tmp_path, action, "approve",
                                  now=NOW + datetime.timedelta(minutes=1))
    assert active[action]["response"] == "approve"
    assert site.record_response(tmp_path, action, "clear",
                                now=NOW + datetime.timedelta(minutes=2)) == {}


def test_response_expires(tmp_path):
    """어제의 승인이 오늘의 다른 기상사례에 붙으면 안 된다."""
    action = "야간피복|야간 피복 전개"
    site.record_response(tmp_path, action, "approve", now=NOW)
    inside = NOW + datetime.timedelta(hours=site.RESPONSE_TTL_HOURS - 1)
    outside = NOW + datetime.timedelta(hours=site.RESPONSE_TTL_HOURS + 1)
    assert action in site.active_responses(tmp_path, inside)
    assert site.active_responses(tmp_path, outside) == {}


def test_bad_responses_are_refused(tmp_path):
    import pytest

    with pytest.raises(ValueError):
        site.record_response(tmp_path, "야간피복|야간 피복 전개", "maybe")
    with pytest.raises(ValueError):
        site.record_response(tmp_path, "아무거나", "approve")
    assert not (tmp_path / site.APPROVALS_FILE).exists()


def test_corrupt_response_lines_are_skipped(tmp_path):
    action = "야간피복|야간 피복 전개"
    site.record_response(tmp_path, action, "approve", now=NOW)
    with (tmp_path / site.APPROVALS_FILE).open("a", encoding="utf-8") as handle:
        handle.write('{"id": "frost|야간\n')
    assert site.active_responses(tmp_path, NOW)[action]["response"] == "approve"
