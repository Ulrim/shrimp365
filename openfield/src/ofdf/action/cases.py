"""판단 이력을 위험 사례·월간 리포트·CSV 로 정리한다 (화면 M5 · M7).

판단 이력(``journal.jsonl``)은 5분에 한 줄이다. 서리가 하룻밤 이어지면
같은 서리가 백 줄 넘게 적힌다. 사람이 묻는 것은 줄이 아니라 **사례**다 —
'11월에 서리가 몇 번 왔고, 그때마다 무엇을 했는가'.

사례를 가르는 기준은 학습·평가와 같은 것을 쓴다
(:data:`ofdf.labels.risk.EVENT_GAP_HOURS`). 화면이 세는 사례 수와
성능평가서가 세는 사례 수가 다른 규칙에서 나오면 두 숫자를 맞춰 볼 수 없다.
"""

from __future__ import annotations

import csv
import datetime
import io
from collections import Counter
from collections.abc import Iterable
from typing import Any

from ofdf.labels.risk import EVENT_GAP_HOURS, RISK_LABELS_KO

LEVEL_NAMES = {0: "정상", 1: "주의", 2: "경계"}

#: 사업계획서의 정량 성과목표 — 유효 제어명령 60회 이상.
CONTROL_COMMAND_TARGET = 60

#: 사례 분리 기준이 없는 유형(복합위험 등)에 쓰는 값(시간).
DEFAULT_GAP_HOURS = 6

#: 구동부가 아닌 '장치'. 제어명령 횟수에는 넣지 않는다 — 알림은 조치이지만
#: 기계를 움직인 것이 아니다.
NON_CONTROL_DEVICES = frozenset({"알림"})


def _parse(stamp: Any) -> datetime.datetime | None:
    try:
        parsed = datetime.datetime.fromisoformat(str(stamp))
    except ValueError:
        return None
    # 이력의 시각은 시간대 없는 현장 시각이다. 시간대가 붙어 온 것도 같은
    # 벽시계 값으로 맞춰 비교한다.
    return parsed.replace(tzinfo=None)


def _iso(moment: datetime.datetime | None) -> str | None:
    return moment.isoformat(timespec="minutes") if moment else None


def _label(action: dict) -> str:
    return f"{action.get('device', '')} {action.get('command', '')}".strip()


def risk_cases(records: Iterable[dict], *, risk: str | None = None) -> list[dict]:
    """판단 기록을 위험 사례로 묶는다. 새 사례부터 돌려준다.

    같은 위험유형이 주의 이상으로 이어지는 동안은 한 사례다. 위험이 풀린 뒤
    유형별 분리 기준(시간)보다 오래 지나야 다음 발생을 새 사례로 센다.
    """
    ordered = sorted(
        (r for r in records if _parse(r.get("timestamp")) is not None),
        key=lambda r: str(r.get("timestamp")),
    )
    open_cases: dict[str, dict] = {}
    done: list[dict] = []

    for record in ordered:
        moment = _parse(record["timestamp"])
        for judgement in record.get("judgements", []):
            kind = judgement.get("risk_type")
            level = int(judgement.get("level", 0) or 0)
            if level < 1 or not kind or (risk and kind != risk):
                continue

            gap = datetime.timedelta(hours=EVENT_GAP_HOURS.get(kind, DEFAULT_GAP_HOURS))
            case = open_cases.get(kind)
            if case is not None and moment - case["_end"] > gap:
                done.append(case)
                case = None
            if case is None:
                case = open_cases[kind] = {
                    "risk": kind, "_start": moment, "_end": moment, "_peak": 0,
                    "_conf": [], "_executed": Counter(), "_advisory": Counter(),
                    "_rejected": Counter(), "_responses": set(),
                    "records": 0, "expectedOnset": judgement.get("expected_onset"),
                    "evidence": [], "inputs": {},
                }

            case["_end"] = moment
            case["records"] += 1
            confidence = judgement.get("confidence")
            if isinstance(confidence, (int, float)):
                case["_conf"].append(float(confidence))
            if level > case["_peak"]:
                # 가장 위험했던 순간의 근거와 실측을 사례의 대표값으로 둔다
                case["_peak"] = level
                case["evidence"] = list(judgement.get("evidence") or [])[:3]
                case["inputs"] = dict(record.get("inputs") or {})

            # 조치는 그 위험유형이 부른 것만 사례에 붙인다
            executed = {(_label(a)) for a in record.get("executed", [])
                        if a.get("risk_type") == kind}
            for action in record.get("recommended", []):
                if action.get("risk_type") != kind:
                    continue
                name = _label(action)
                if name in executed:
                    case["_executed"][name] += 1
                elif action.get("advisory"):
                    case["_advisory"][name] += 1
            for action in record.get("rejected", []):
                if action.get("risk_type") == kind:
                    case["_rejected"][
                        f"{_label(action)} — {action.get('rejected_by', '')}"] += 1
            for response in record.get("user_responses", []):
                if str(response.get("id", "")).startswith(kind + "|"):
                    case["_responses"].add(
                        (response.get("id"), response.get("response")))

    done.extend(open_cases.values())

    out = []
    for case in done:
        confidences = case.pop("_conf")
        start, end = case.pop("_start"), case.pop("_end")
        peak = case.pop("_peak")
        responses = case.pop("_responses")
        out.append({
            "id": f"{case['risk']}-{start:%Y%m%d%H%M}",
            "risk": case["risk"],
            "riskName": RISK_LABELS_KO.get(case["risk"], case["risk"]),
            "start": _iso(start), "end": _iso(end),
            "durationMinutes": int((end - start).total_seconds() // 60),
            "peakLevel": peak, "peakLevelName": LEVEL_NAMES.get(peak, str(peak)),
            "records": case["records"],
            "meanConfidence": round(sum(confidences) / len(confidences), 3)
                              if confidences else None,
            "minConfidence": round(min(confidences), 3) if confidences else None,
            "expectedOnset": case["expectedOnset"],
            "executed": sorted(case.pop("_executed")),
            "advisory": sorted(case.pop("_advisory")),
            "rejected": sorted(case.pop("_rejected")),
            "approved": sum(1 for _, r in responses if r == "approve"),
            "declined": sum(1 for _, r in responses if r == "reject"),
            "evidence": case["evidence"], "inputs": case["inputs"],
        })
    out.sort(key=lambda c: c["start"], reverse=True)
    return out


#: 판단 기록이 이보다 오래 끊겼으면 제어기가 꺼져 있었던 것으로 본다(분).
#: 판단 주기가 5분이므로 여섯 번 연속 빠진 셈이다.
OUTAGE_MINUTES = 30


def new_commands(records: Iterable[dict]) -> Counter:
    """새로 내린 장치 제어명령을 센다 ``{"장치 명령": 횟수}``.

    제어기는 5분마다 판단하므로 밤새 이어진 '야간 피복 전개'는 이력에 백 번
    넘게 적힌다. 그것은 명령 한 번이다. 직전 주기에 없던 명령이 나타난
    때만 한 번으로 센다. 알림은 넣지 않는다 — 기계를 움직인 것이 아니다.

    기록이 :data:`OUTAGE_MINUTES` 넘게 끊겼다가 이어지면 제어기가 꺼졌다
    켜진 것이므로 직전 상태를 잊는다. 그러지 않으면 일주일 전 마지막 줄의
    명령이 오늘의 같은 명령과 '이어진 것'으로 세어진다.
    """
    counts: Counter = Counter()
    previous: set[str] = set()
    last: datetime.datetime | None = None
    outage = datetime.timedelta(minutes=OUTAGE_MINUTES)
    for record in sorted(records, key=lambda r: str(r.get("timestamp"))):
        moment = _parse(record.get("timestamp"))
        if moment is not None:
            if last is not None and moment - last > outage:
                previous = set()
            last = moment
        current = {
            _label(a) for a in record.get("executed", [])
            if a.get("device") not in NON_CONTROL_DEVICES
        }
        for name in current - previous:
            counts[name] += 1
        previous = current
    return counts


def monthly_summary(records: list[dict], year: int, month: int) -> dict:
    """월간 리포트 화면(M7)이 쓰는 집계.

    ``records`` 는 그 달의 판단 기록이다(:meth:`Journal.read_range`).
    """
    cases = risk_cases(records)
    by_risk: dict[str, dict] = {}
    for case in cases:
        entry = by_risk.setdefault(case["risk"], {
            "risk": case["risk"], "riskName": case["riskName"],
            "cases": 0, "warningCases": 0, "minutes": 0,
        })
        entry["cases"] += 1
        entry["warningCases"] += int(case["peakLevel"] >= 2)
        entry["minutes"] += case["durationMinutes"]

    daily: dict[str, dict] = {}
    rejected_reasons: Counter = Counter()
    responses: set[tuple] = set()
    advisory_records = 0
    executed_entries = 0
    upper_rejected = 0
    for record in records:
        day = str(record.get("timestamp", ""))[:10]
        entry = daily.setdefault(day, {"date": day, "records": 0, "levels": {}})
        entry["records"] += 1
        for judgement in record.get("judgements", []):
            kind, level = judgement.get("risk_type"), int(judgement.get("level", 0) or 0)
            if kind and level > entry["levels"].get(kind, 0):
                entry["levels"][kind] = level
        executed_entries += len(record.get("executed", []))
        for action in record.get("rejected", []):
            if action.get("user_response") == "reject":
                continue                       # 농가 거부는 따로 센다
            upper_rejected += 1
            rejected_reasons[
                f"{_label(action)} — {action.get('rejected_by', '')}"] += 1
        if str(record.get("operating_mode", "")).startswith("권고"):
            advisory_records += 1
        for response in record.get("user_responses", []):
            responses.add((response.get("id"), response.get("response"), day))

    commands = new_commands(records)
    total = len(records)
    command_total = sum(commands.values())
    return {
        "month": f"{year:04d}-{month:02d}",
        "records": total,
        "daysWithData": len(daily),
        "caseTotal": len(cases),
        "byRisk": sorted(by_risk.values(), key=lambda e: -e["cases"]),
        "cases": cases,
        # 새로 내린 장치 제어명령 — 연속 실행은 1회, 알림 제외
        "controlCommands": command_total,
        "controlCommandTarget": CONTROL_COMMAND_TARGET,
        "commandsByDevice": [
            {"command": name, "count": count} for name, count in commands.most_common()
        ],
        # Journal.monthly_report 와 같은 정의(주기마다 실행으로 적힌 줄 수)
        "executedEntries": executed_entries,
        "upperRejected": upper_rejected,
        "rejectedReasons": [
            {"reason": reason, "count": count}
            for reason, count in rejected_reasons.most_common(8)
        ],
        "advisoryRatio": round(advisory_records / total, 3) if total else 0.0,
        "userApproved": sum(1 for _, r, _ in responses if r == "approve"),
        "userDeclined": sum(1 for _, r, _ in responses if r == "reject"),
        "daily": [daily[day] for day in sorted(daily)],
    }


# --------------------------------------------------------------------------
# CSV
# --------------------------------------------------------------------------

def _csv(header: list[str], rows: Iterable[list]) -> str:
    """엑셀이 한글을 깨지 않고 열도록 BOM 을 붙인 CSV 문자열."""
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\r\n")
    writer.writerow(header)
    for row in rows:
        writer.writerow(["" if v is None else _safe_cell(v) for v in row])
    return "﻿" + buffer.getvalue()


def _safe_cell(value: Any) -> Any:
    """수식으로 읽힐 수 있는 글자로 시작하는 칸 앞에 작은따옴표를 붙인다.

    스프레드시트는 ``=``·``+``·``-``·``@`` 로 시작하는 칸을 수식으로 실행한다.
    이력의 사유 문구는 사람이 쓴 글이 섞일 수 있으므로 막아 둔다. 숫자는
    그대로 둔다(음수 기온이 글자가 되면 안 된다).
    """
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


def _evidence_text(evidence: list[dict], label) -> list[str]:
    cells = []
    for item in list(evidence or [])[:3]:
        text = label(str(item.get("feature", "")))
        value, contribution = item.get("value"), item.get("contribution")
        if isinstance(value, (int, float)):
            text += f"={value:.2f}"
        if isinstance(contribution, (int, float)):
            text += f" (기여 {contribution:+.2f})"
        cells.append(text)
    return cells + [""] * (3 - len(cells))


def cases_csv(cases: list[dict]) -> str:
    """위험 사례 목록."""
    header = ["사례번호", "위험유형", "시작", "종료", "지속(분)", "최고등급", "판단 건수",
              "평균 신뢰도", "최저 신뢰도", "첫 예상시점", "실행 조치", "권고 조치",
              "거부 조치", "농가 승인", "농가 거부"]
    return _csv(header, (
        [c["id"], c["riskName"], c["start"], c["end"], c["durationMinutes"],
         c["peakLevelName"], c["records"], c["meanConfidence"], c["minConfidence"],
         c["expectedOnset"], " / ".join(c["executed"]), " / ".join(c["advisory"]),
         " / ".join(c["rejected"]), c["approved"], c["declined"]]
        for c in cases
    ))


INPUT_COLUMNS = [
    ("t_air", "기온(℃)"), ("canopy_temp", "초관부 온도(℃)"), ("rh", "상대습도(%)"),
    ("soil_moisture", "토양수분(%)"), ("soil_index", "토양수분 지수"),
]


def judgements_csv(records: list[dict], label=str) -> str:
    """판단 원자료 — 판단 한 건(위험유형 하나)이 한 줄.

    위험이 없던 주기도 한 줄로 남긴다(위험유형 칸이 빈다). '그 시각에
    제어기가 돌고 있었고 정상이라고 판단했다'는 것도 자료이기 때문이다.
    """
    header = (["시각", "지점", "모델 버전", "운전모드", "위험유형", "등급", "신뢰도",
               "예상시점", "판단근거 1", "판단근거 2", "판단근거 3"]
              + [name for _, name in INPUT_COLUMNS]
              + ["실행 조치", "거부 조치", "농가 응답"])

    def rows():
        for record in sorted(records, key=lambda r: str(r.get("timestamp"))):
            inputs = record.get("inputs") or {}
            tail = (
                [inputs.get(key) for key, _ in INPUT_COLUMNS]
                + [" / ".join(_label(a) for a in record.get("executed", [])),
                   " / ".join(f"{_label(a)} — {a.get('rejected_by', '')}"
                              for a in record.get("rejected", [])),
                   " / ".join(
                       f"{r.get('device', '')} {r.get('command', '')}: "
                       f"{'승인' if r.get('response') == 'approve' else '거부'}"
                       for r in record.get("user_responses", []))]
            )
            head = [record.get("timestamp"), record.get("station"),
                    record.get("model_version"), record.get("operating_mode")]
            judgements = record.get("judgements") or [None]
            for judgement in judgements:
                if judgement is None:
                    yield head + ["", "정상", "", "", "", "", ""] + tail
                    continue
                kind = judgement.get("risk_type", "")
                yield head + [
                    RISK_LABELS_KO.get(kind, kind), judgement.get("level_name"),
                    judgement.get("confidence"), judgement.get("expected_onset"),
                    *_evidence_text(judgement.get("evidence"), label),
                ] + tail

    return _csv(header, rows())


def control_csv(records: list[dict]) -> str:
    """제어 이력 — 조치 하나가 한 줄(화면 M3 과 같은 내용)."""
    header = ["시각", "계층", "장치", "명령", "결과", "사유", "위험유형"]

    def rows():
        for record in sorted(records, key=lambda r: str(r.get("timestamp"))):
            executed = {_label(a) for a in record.get("executed", [])}
            blocked = {_label(a): a.get("rejected_by", "")
                       for a in record.get("rejected", [])}
            for action in record.get("recommended", []):
                name = _label(action)
                if name in blocked:
                    result, reason = "거부", blocked[name]
                elif name in executed:
                    result, reason = "실행", action.get("reason", "")
                else:
                    result, reason = "권고", action.get("reason", "")
                kind = action.get("risk_type", "")
                yield [record.get("timestamp"), f"L{action.get('layer', '')}",
                       action.get("device"), action.get("command"), result, reason,
                       RISK_LABELS_KO.get(kind, kind)]

    return _csv(header, rows())
