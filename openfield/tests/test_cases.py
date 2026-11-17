"""위험 사례 묶기·월간 리포트·CSV 내보내기 검증 — 화면 M5 · M7."""

from __future__ import annotations

import csv
import datetime
import io
import json

import pytest

from ofdf.action import cases
from ofdf.action.journal import Evidence, Journal, RiskJudgement, record_from_decision
from ofdf.action.recommend import SensorState, apply_user_responses, decide

INSTALLED = frozenset({"관수밸브", "야간피복"})


def make(when: datetime.datetime, levels: dict[str, int], *, confidence=0.9,
         responses: dict | None = None, recorded_at: datetime.datetime | None = None,
         **sensor) -> dict:
    decision = decide(levels, SensorState(hour=when.hour, **sensor),
                      confidence={r: confidence for r in levels}, installed_devices=INSTALLED)
    applied = apply_user_responses(decision, responses or {})
    judgements = [
        RiskJudgement(risk, 3, level, {1: "주의", 2: "경계"}[level], confidence,
                      expected_onset=(when + datetime.timedelta(hours=3)).isoformat(),
                      evidence=[Evidence("canopy_temp", -0.4 * level, 1.5)])
        for risk, level in levels.items() if level > 0
    ]
    record = record_from_decision(when, "실증포장", "ofdf-weather-0.1.0",
                                  {"t_air": 2.0, "canopy_temp": -0.4}, judgements, decision,
                                  user_responses=applied, recorded_at=recorded_at)
    return json.loads(record.to_json())


def night(day: int, start_hour: int, steps: int, levels, **kwargs) -> list[dict]:
    """5분 간격으로 이어지는 판단들."""
    start = datetime.datetime(2026, 11, day, start_hour)
    return [make(start + datetime.timedelta(minutes=5 * i), levels, **kwargs)
            for i in range(steps)]


@pytest.fixture
def month():
    """11월 — 서리 두 번(3일 밤, 10일 밤), 같은 밤 잠깐 끊긴 것은 한 사례."""
    records = night(3, 20, 12, {"frost": 1})                    # 20:00~20:55 주의
    records += night(3, 21, 6, {})                              # 정상 30분
    records += night(3, 22, 12, {"frost": 2})                   # 22:00~ 경계 (같은 사례)
    records += night(10, 21, 24, {"frost": 2})                  # 일주일 뒤 — 새 사례
    records += night(15, 13, 6, {"heat_dry": 1})
    return records


def test_continuous_risk_is_one_case(month):
    found = cases.risk_cases(month)
    frost = [c for c in found if c["risk"] == "frost"]
    assert len(frost) == 2 and len(found) == 3
    assert found[0]["start"] > found[-1]["start"]               # 새 사례부터
    first = frost[-1]
    assert first["start"] == "2026-11-03T20:00" and first["end"] == "2026-11-03T22:55"
    assert first["durationMinutes"] == 175 and first["records"] == 24
    assert first["peakLevel"] == 2 and first["peakLevelName"] == "경계"
    assert "야간피복 야간 피복 전개" in first["executed"]
    assert first["evidence"][0]["value"] == pytest.approx(-0.8)     # 가장 위험했던 때의 근거


def test_gap_longer_than_rule_starts_new_case():
    """서리는 12시간 넘게 풀려 있어야 다음 발생을 새 사례로 센다(학습·평가와 같은 기준)."""
    records = night(3, 2, 2, {"frost": 1}) + night(3, 13, 2, {"frost": 1})    # 11시간 뒤
    assert len(cases.risk_cases(records)) == 1
    records = night(3, 2, 2, {"frost": 1}) + night(3, 15, 2, {"frost": 1})    # 13시간 뒤
    assert len(cases.risk_cases(records)) == 2


def test_case_filter_and_other_risks_actions_stay_out(month):
    only = cases.risk_cases(month, risk="heat_dry")
    assert [c["risk"] for c in only] == ["heat_dry"]
    assert all("피복" not in name for name in only[0]["executed"])


def test_case_collects_advisory_rejected_and_user_responses():
    cover = "야간피복|야간 피복 전개"
    records = night(3, 22, 3, {"frost": 2}, confidence=0.5)                       # 권고
    records += night(3, 23, 3, {"frost": 2}, confidence=0.5, responses={cover: "approve"})
    records += [make(datetime.datetime(2026, 11, 4, 0, 0), {"frost": 2}, gust_3s=12.0)]
    case = cases.risk_cases(records)[0]
    assert "야간피복 야간 피복 전개" in case["advisory"]
    assert "야간피복 야간 피복 전개" in case["executed"]
    assert any("풍속" in text for text in case["rejected"])
    assert case["approved"] == 1 and case["declined"] == 0
    assert case["minConfidence"] == 0.5


def test_new_commands_count_starts_not_cycles(month):
    """밤새 이어진 피복 전개는 명령 한 번이다. 알림은 세지 않는다."""
    counts = cases.new_commands(month)
    # 3일 밤 20시, 잠깐 풀렸다가 다시 22시, 그리고 10일 밤 — 세 번이다.
    # 이력에는 48줄(12 + 12 + 24)로 적혀 있다.
    assert counts["야간피복 야간 피복 전개"] == 3
    assert not any(name.startswith("알림") for name in counts)


def test_new_commands_forget_state_across_an_outage():
    """제어기가 꺼졌다 켜지면 같은 명령도 새로 내린 것이다."""
    continuous = night(3, 22, 12, {"frost": 2})
    assert cases.new_commands(continuous)["야간피복 야간 피복 전개"] == 1
    resumed = continuous[:4] + night(4, 0, 4, {"frost": 2})        # 100분 동안 기록 없음
    assert cases.new_commands(resumed)["야간피복 야간 피복 전개"] == 2


def test_monthly_summary(month, tmp_path):
    summary = cases.monthly_summary(month, 2026, 11)
    assert summary["month"] == "2026-11" and summary["records"] == len(month)
    assert summary["caseTotal"] == 3 and summary["daysWithData"] == 3
    frost = next(e for e in summary["byRisk"] if e["risk"] == "frost")
    assert frost["cases"] == 2 and frost["warningCases"] == 2
    assert summary["controlCommandTarget"] == 60
    assert summary["controlCommands"] == sum(e["count"] for e in summary["commandsByDevice"])
    by_day = {d["date"]: d for d in summary["daily"]}
    assert by_day["2026-11-03"]["levels"] == {"frost": 2}
    assert by_day["2026-11-15"]["levels"] == {"heat_dry": 1}

    # 주기 단위 집계는 기존 Journal.monthly_report 와 같은 값이어야 한다
    journal = Journal(tmp_path / "journal.jsonl")
    journal.path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in month),
                            encoding="utf-8")
    assert summary["executedEntries"] == journal.monthly_report(2026, 11)["유효 제어명령"]


def test_monthly_summary_separates_user_rejections():
    cover = "야간피복|야간 피복 전개"
    records = night(3, 22, 4, {"frost": 2}, confidence=0.5, responses={cover: "reject"})
    summary = cases.monthly_summary(records, 2026, 11)
    assert summary["userDeclined"] == 1 and summary["userApproved"] == 0
    assert summary["upperRejected"] == 0                       # 농가 거부는 상위 계층 거부가 아니다
    assert summary["advisoryRatio"] == 1.0


def test_empty_month():
    summary = cases.monthly_summary([], 2026, 2)
    assert summary["records"] == 0 and summary["cases"] == [] and summary["advisoryRatio"] == 0.0


def parse(text: str) -> list[list[str]]:
    assert text.startswith("﻿")                           # 엑셀이 한글을 읽게
    return list(csv.reader(io.StringIO(text[1:])))


def test_cases_csv(month):
    rows = parse(cases.cases_csv(cases.risk_cases(month)))
    assert rows[0][:6] == ["사례번호", "위험유형", "시작", "종료", "지속(분)", "최고등급"]
    assert len(rows) == 4
    assert rows[-1][1] == "저온·서리" and rows[-1][5] == "경계"


def test_judgements_csv_keeps_normal_cycles(month):
    rows = parse(cases.judgements_csv(month, label=lambda name: f"[{name}]"))
    assert len(rows) == len(month) + 1                         # 위험이 하나씩이라 판단당 한 줄
    head = rows[0]
    level, kind, first = head.index("등급"), head.index("위험유형"), head.index("판단근거 1")
    normal = [r for r in rows[1:] if r[level] == "정상"]
    assert len(normal) == 6 and normal[0][kind] == ""
    risky = next(r for r in rows[1:] if r[level] == "경계")
    assert risky[first].startswith("[canopy_temp]=-0.80") and "기여 +1.50" in risky[first]
    # 1.0 기록(판단 시각 없음)은 판단 시각 칸에 관측 시각이 들어간다
    assert risky[head.index("판단 시각")] == risky[head.index("관측 시각")]
    assert risky[rows[0].index("기온(℃)")] == "2.0"


def test_control_csv_marks_results():
    cover = "야간피복|야간 피복 전개"
    records = [make(datetime.datetime(2026, 11, 3, 22), {"frost": 2}, confidence=0.5,
                    responses={cover: "reject"})]
    rows = parse(cases.control_csv(records))
    results = {row[3]: row[4] for row in rows[1:]}
    assert results["야간 피복 전개"] == "거부"
    assert results["야간·새벽 관수 금지"] == "권고"
    assert all(row[1].startswith("L") for row in rows[1:])


def test_csv_cells_cannot_become_formulas():
    """사유 문구가 '=' 로 시작해도 스프레드시트가 수식으로 실행하지 않는다."""
    record = make(datetime.datetime(2026, 11, 3, 22), {"frost": 2})
    record["recommended"][0]["reason"] = "=HYPERLINK(\"http://x\")"
    record["inputs"]["t_air"] = -3.5
    control = parse(cases.control_csv([record]))
    assert control[1][5].startswith("'=")
    judgements = parse(cases.judgements_csv([record]))
    assert judgements[1][judgements[0].index("기온(℃)")] == "-3.5"        # 음수는 숫자 그대로


def test_journal_read_range_and_tail(tmp_path, month):
    journal = Journal(tmp_path / "journal.jsonl")
    with journal.path.open("w", encoding="utf-8") as handle:
        for record in month:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
        handle.write('{"timestamp": "2026-11-20T0\n')                     # 쓰다 끊긴 줄
        # 열쇠 순서가 다른 줄도 읽는다(시각이 맨 앞이 아니다)
        handle.write(json.dumps({"station": "A", "timestamp": "2026-11-21T00:00:00"}) + "\n")

    day3 = journal.read_range("2026-11-03", "2026-11-04")
    assert len(day3) == 30 and all(r["timestamp"].startswith("2026-11-03") for r in day3)
    assert len(journal.read_range("2026-11-10")) == 24 + 6 + 1
    assert len(journal.read_range(None, "2026-11-04")) == 30
    assert len(journal.read_range()) == len(month) + 1
    assert journal.read_range("2027-01-01") == []
    assert Journal(tmp_path / "none.jsonl").read_range() == []

    last = journal.tail(5)
    assert len(last) == 5 and last[-1]["timestamp"] == "2026-11-21T00:00:00"
    assert len(journal.tail(3, max_bytes=4000)) == 3                       # 파일 끝만 읽어도 된다


def test_actions_shared_by_two_risks_reach_both_cases():
    """같은 명령을 병해와 강우가 함께 부르면 유형이 'a+b' 로 합쳐진다 — 두 사례 모두에 붙는다."""
    when = datetime.datetime(2026, 11, 3, 13)
    decision = decide({"disease": 1, "rain_wet": 1}, SensorState(hour=13),
                      confidence={"disease": 0.5, "rain_wet": 0.5},
                      installed_devices=frozenset({"살수"}))
    shared = next(a for a in decision.actions if "+" in a.risk_type)
    applied = apply_user_responses(decision, {shared.action_id: "approve"})
    record = json.loads(record_from_decision(
        when, "A", "v1", {},
        [RiskJudgement(r, 3, 1, "주의", 0.5) for r in ("disease", "rain_wet")],
        decision, user_responses=applied).to_json())
    name = f"{shared.device} {shared.command}"
    found = {c["risk"]: c for c in cases.risk_cases([record])}
    for risk in shared.risk_type.split("+"):
        assert name in found[risk]["executed"] and found[risk]["approved"] == 1


def test_streamed_records_give_the_same_answers(month):
    """파일에서 흘려 읽은 것(목록이 아닌 것)도 같은 결과를 낸다."""
    assert cases.risk_cases(iter(month)) == cases.risk_cases(month)
    assert cases.monthly_summary(iter(month), 2026, 11) == cases.monthly_summary(month, 2026, 11)
    assert "".join(cases.judgements_csv_lines(iter(month))) == cases.judgements_csv(month)
    assert "".join(cases.control_csv_lines(iter(month))) == cases.control_csv(month)


def test_hourly_stamps_do_not_inflate_command_count():
    """제어기는 판단 시각을 시간 칸으로 적는다 — 한 시간에 같은 시각이 열두 줄이다.

    정각이 바뀔 때마다 새 명령으로 세면 하룻밤 서리가 열 번으로 불어난다.
    """
    records = []
    for hour in range(20, 24):
        for _ in range(12):
            records.append(make(datetime.datetime(2026, 11, 3, hour), {"frost": 2}))
    assert cases.new_commands(records)["야간피복 야간 피복 전개"] == 1
    case = cases.risk_cases(records)[0]
    assert case["records"] == 48 and case["durationMinutes"] == 180


def live_night(day: int, hour: int, steps: int, levels, **kwargs) -> list[dict]:
    """현장 제어기가 실제로 적는 모양 — 관측 시각은 시간 칸, 판단 시각은 5분마다."""
    start = datetime.datetime(2026, 11, day, hour)
    out = []
    for i in range(steps):
        decided = start + datetime.timedelta(minutes=5 * i, seconds=7)
        out.append(make(decided.replace(minute=0, second=0), levels,
                        recorded_at=decided, **kwargs))
    return out


def test_recorded_time_gives_minute_accurate_cases():
    """판단 시각이 있으면 사례의 시작·끝·지속시간이 분 단위로 맞는다."""
    records = live_night(3, 22, 7, {"frost": 2})                 # 22:00 ~ 22:30, 판단 7건
    case = cases.risk_cases(records)[0]
    assert case["start"] == "2026-11-03T22:00" and case["end"] == "2026-11-03T22:30"
    assert case["durationMinutes"] == 30 and case["records"] == 7
    # 관측 시각만 보면 일곱 건이 모두 22:00 이라 길이가 0 이었다
    assert all(r["timestamp"] == "2026-11-03T22:00:00" for r in records)


def test_recorded_time_detects_short_outage():
    """판단 시각이 있으면 30분 넘는 끊김을 알아본다(관측 시각만 있을 때는 90분)."""
    before = live_night(3, 22, 3, {"frost": 2})                  # 22:00 ~ 22:10
    after = live_night(3, 23, 3, {"frost": 2})                   # 23:00 ~ 23:10 — 50분 끊김
    assert cases.new_commands(before + after)["야간피복 야간 피복 전개"] == 2
    continuous = live_night(3, 22, 24, {"frost": 2})             # 두 시간 내리
    assert cases.new_commands(continuous)["야간피복 야간 피복 전개"] == 1


def test_csv_shows_both_times():
    records = live_night(3, 22, 2, {"frost": 2})
    rows = parse(cases.judgements_csv(records))
    head = rows[0]
    assert rows[1][head.index("판단 시각")] == "2026-11-03T22:00:07"
    assert rows[2][head.index("판단 시각")] == "2026-11-03T22:05:07"
    assert rows[2][head.index("관측 시각")] == "2026-11-03T22:00:00"
    control = parse(cases.control_csv(records))
    assert control[0][0] == "판단 시각" and control[-1][0] == "2026-11-03T22:05:07"
