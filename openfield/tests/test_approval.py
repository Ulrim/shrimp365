"""농가 승인·거부(L3)와 현장 즉응규칙 기준값 검증 — 화면 M2 · M6."""

from __future__ import annotations

import datetime
import json

from ofdf.action.journal import record_from_decision
from ofdf.action.recommend import (
    USER_REJECT_NOTE,
    FieldRules,
    SensorState,
    apply_user_responses,
    decide,
)

INSTALLED = frozenset({"관수밸브", "야간피복"})
COVER = "frost|야간피복|야간 피복 전개"


def low_confidence_frost(**sensor):
    return decide({"frost": 2}, SensorState(hour=23, **sensor),
                  confidence={"frost": 0.55}, installed_devices=INSTALLED)


def by_id(decision):
    return {a.action_id: a for a in decision.actions}


def test_low_confidence_actions_wait_for_approval():
    decision = low_confidence_frost()
    cover = by_id(decision)[COVER]
    assert cover.advisory and cover.needs_approval
    assert decision.mode == "권고(농가 승인 필요)"
    assert cover not in decision.executable()


def test_high_confidence_needs_no_approval():
    decision = decide({"frost": 2}, SensorState(hour=23), confidence={"frost": 0.9},
                      installed_devices=INSTALLED)
    assert not any(a.needs_approval for a in decision.actions)


def test_missing_actuator_is_not_approvable():
    """구동부가 없으면 승인해도 움직일 기계가 없다 — 단추를 내지 않는다."""
    decision = decide({"frost": 2}, SensorState(hour=23), confidence={"frost": 0.55},
                      installed_devices=frozenset({"관수밸브"}))
    cover = by_id(decision)[COVER]
    assert cover.advisory and not cover.needs_approval
    assert apply_user_responses(decision, {COVER: "approve"}) == []
    assert cover.advisory                                    # 그대로 권고


def test_approval_executes_the_action():
    decision = low_confidence_frost()
    applied = apply_user_responses(decision, {COVER: "approve"})
    cover = by_id(decision)[COVER]
    assert applied == [{"id": COVER, "device": "야간피복",
                        "command": "야간 피복 전개", "response": "approve"}]
    assert cover in decision.executable() and "농가 승인" in cover.reason
    assert not cover.needs_approval and cover.user_response == "approve"


def test_rejection_blocks_and_keeps_reason():
    decision = low_confidence_frost()
    apply_user_responses(decision, {COVER: "reject"})
    cover = by_id(decision)[COVER]
    assert cover.rejected_by == USER_REJECT_NOTE
    assert cover not in decision.executable()


def test_mode_reflects_remaining_requests():
    decision = low_confidence_frost()
    ids = [a.action_id for a in decision.actions if a.needs_approval]
    assert len(ids) >= 2
    apply_user_responses(decision, {ids[0]: "approve"})
    assert decision.mode == "권고(농가 승인 필요)"            # 아직 남았다
    apply_user_responses(decision, {i: "approve" for i in ids})
    assert decision.mode == "권고(농가 응답 반영)"


def test_user_cannot_override_upper_layer():
    """L3 는 가장 낮은 계층이다. 강풍(L1)이 막은 전개는 승인해도 풀리지 않는다."""
    decision = low_confidence_frost(gust_3s=12.0)
    cover = by_id(decision)[COVER]
    assert cover.rejected_by and not cover.needs_approval
    apply_user_responses(decision, {COVER: "approve"})
    assert cover.rejected_by and cover not in decision.executable()


def test_unrelated_or_unknown_responses_do_nothing():
    decision = low_confidence_frost()
    assert apply_user_responses(decision, {"frost|없는장치|없는 명령": "approve",
                                           COVER: "maybe"}) == []
    assert by_id(decision)[COVER].needs_approval


def test_journal_records_user_responses():
    decision = low_confidence_frost()
    ids = [a.action_id for a in decision.actions if a.needs_approval]
    applied = apply_user_responses(decision, {ids[0]: "approve", ids[1]: "reject"})
    record = json.loads(record_from_decision(
        datetime.datetime(2026, 11, 17, 23, 0), "A", "v1", {}, [], decision,
        user_responses=applied).to_json())
    assert record["user_approved"] is True
    assert {r["response"] for r in record["user_responses"]} == {"approve", "reject"}
    assert any(a.get("user_response") == "approve" for a in record["executed"])
    assert any(a.get("user_response") == "reject" for a in record["rejected"])


def test_journal_without_responses_keeps_none():
    record = record_from_decision(
        datetime.datetime(2026, 11, 17, 23, 0), "A", "v1", {}, [], low_confidence_frost())
    assert record.user_approved is None and record.user_responses == []


def test_field_rules_defaults_match_plan():
    """기본값은 사업계획서 초기 기준 그대로다 — 설정을 건드리지 않으면 동작이 같다."""
    blocked = decide({}, SensorState(gust_3s=7.5))
    assert [a.command for a in blocked.actions] == ["전개 금지"]
    assert decide({}, SensorState(gust_3s=6.9)).actions == []


def test_field_rules_can_be_tightened():
    rules = FieldRules(wind_no_deploy=5.0, wind_recover=8.0, wind_lock=12.0, spray_stop_wind=3.0)
    assert [a.command for a in decide({}, SensorState(gust_3s=5.5), field_rules=rules).actions] \
        == ["전개 금지"]
    commands = [a.command for a in decide({}, SensorState(gust_3s=12.5), field_rules=rules).actions]
    assert "경보·구동 잠금" in commands and "즉시 완전 회수(5분 이내)" in commands
    spray = decide({}, SensorState(gust_3s=3.5, spraying=True), field_rules=rules)
    assert any("3m/s 초과" in a.reason for a in spray.actions)


def test_confidence_threshold_setting_changes_mode():
    args = ({"frost": 2}, SensorState(hour=23))
    assert decide(*args, confidence={"frost": 0.75}).mode == "자동"
    assert decide(*args, confidence={"frost": 0.75},
                  confidence_threshold=0.8).mode == "권고(농가 승인 필요)"
