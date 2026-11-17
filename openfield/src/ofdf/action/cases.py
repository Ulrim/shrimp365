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
from collections.abc import Iterable, Iterator
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


def _ordered(records: Iterable[dict]) -> Iterable[dict]:
    """목록이면 시각순으로 세우고, 그 밖의 것(파일에서 흘려 읽는 중)은 그대로 둔다.

    판단 이력은 적힌 순서가 곧 시각순이다. 한 해치를 통째로 메모리에 올려
    정렬하면 라즈베리파이의 화면 서버(메모리 상한 256MB)가 죽는다.
    """
    if isinstance(records, (list, tuple)):
        return sorted(records, key=lambda r: str(r.get("timestamp")))
    return records


def _kinds(risk_type: Any) -> list[str]:
    """조치를 부른 위험유형들. 같은 명령을 여러 위험이 부르면 ``a+b`` 로 합쳐져 있다."""
    return [k for k in str(risk_type or "").split("+") if k]


class _CaseBuilder:
    """판단 기록을 하나씩 받아 위험 사례로 묶는다."""

    def __init__(self, risk: str | None = None):
        self.risk = risk
        self.open: dict[str, dict] = {}
        self.done: list[dict] = []

    def add(self, record: dict) -> None:
        moment = _parse(record.get("timestamp"))
        if moment is None:
            return
        for judgement in record.get("judgements", []):
            kind = judgement.get("risk_type")
            level = int(judgement.get("level", 0) or 0)
            if level < 1 or not kind or (self.risk and kind != self.risk):
                continue

            gap = datetime.timedelta(hours=EVENT_GAP_HOURS.get(kind, DEFAULT_GAP_HOURS))
            case = self.open.get(kind)
            if case is not None and moment - case["_end"] > gap:
                self.done.append(case)
                case = None
            if case is None:
                case = self.open[kind] = {
                    "risk": kind, "_start": moment, "_end": moment, "_peak": 0,
                    "_conf_sum": 0.0, "_conf_n": 0, "_conf_min": None,
                    "_executed": Counter(), "_advisory": Counter(),
                    "_rejected": Counter(), "_responses": set(),
                    "records": 0, "expectedOnset": judgement.get("expected_onset"),
                    "evidence": [], "inputs": {},
                }

            case["_end"] = moment
            case["records"] += 1
            confidence = judgement.get("confidence")
            if isinstance(confidence, (int, float)):
                case["_conf_sum"] += float(confidence)
                case["_conf_n"] += 1
                if case["_conf_min"] is None or confidence < case["_conf_min"]:
                    case["_conf_min"] = float(confidence)
            if level > case["_peak"]:
                # 가장 위험했던 순간의 근거와 실측을 사례의 대표값으로 둔다
                case["_peak"] = level
                case["evidence"] = list(judgement.get("evidence") or [])[:3]
                case["inputs"] = dict(record.get("inputs") or {})

            # 조치는 그 위험유형이 부른 것만 사례에 붙인다. 여러 위험이 함께
            # 부른 조치(disease+compound)는 그 위험들 모두의 사례에 붙는다.
            executed = {_label(a) for a in record.get("executed", [])
                        if kind in _kinds(a.get("risk_type"))}
            for action in record.get("recommended", []):
                if kind not in _kinds(action.get("risk_type")):
                    continue
                name = _label(action)
                if name in executed:
                    case["_executed"][name] += 1
                elif action.get("advisory"):
                    case["_advisory"][name] += 1
            for action in record.get("rejected", []):
                if kind in _kinds(action.get("risk_type")):
                    case["_rejected"][
                        f"{_label(action)} — {action.get('rejected_by', '')}"] += 1
            for response in record.get("user_responses", []):
                if kind in _kinds(response.get("risk_type")):
                    case["_responses"].add(
                        (response.get("id"), response.get("response")))

    def finish(self) -> list[dict]:
        out = []
        for case in [*self.done, *self.open.values()]:
            start, end, peak = case["_start"], case["_end"], case["_peak"]
            responses = case["_responses"]
            out.append({
                "id": f"{case['risk']}-{start:%Y%m%d%H%M}",
                "risk": case["risk"],
                "riskName": RISK_LABELS_KO.get(case["risk"], case["risk"]),
                "start": _iso(start), "end": _iso(end),
                "durationMinutes": int((end - start).total_seconds() // 60),
                "peakLevel": peak, "peakLevelName": LEVEL_NAMES.get(peak, str(peak)),
                "records": case["records"],
                "meanConfidence": round(case["_conf_sum"] / case["_conf_n"], 3)
                                  if case["_conf_n"] else None,
                "minConfidence": round(case["_conf_min"], 3)
                                 if case["_conf_min"] is not None else None,
                "expectedOnset": case["expectedOnset"],
                "executed": sorted(case["_executed"]),
                "advisory": sorted(case["_advisory"]),
                "rejected": sorted(case["_rejected"]),
                "approved": sum(1 for _, r in responses if r == "approve"),
                "declined": sum(1 for _, r in responses if r == "reject"),
                "evidence": case["evidence"], "inputs": case["inputs"],
            })
        out.sort(key=lambda c: c["start"], reverse=True)
        return out


def risk_cases(records: Iterable[dict], *, risk: str | None = None) -> list[dict]:
    """판단 기록을 위험 사례로 묶는다. 새 사례부터 돌려준다.

    같은 위험유형이 주의 이상으로 이어지는 동안은 한 사례다. 위험이 풀린 뒤
    유형별 분리 기준(시간)보다 오래 지나야 다음 발생을 새 사례로 센다.
    기록을 하나씩 흘려 읽으므로 ``records`` 는 파일에서 읽는 중인 것이어도 된다.
    """
    builder = _CaseBuilder(risk)
    for record in _ordered(records):
        builder.add(record)
    return builder.finish()


#: 판단 기록이 이보다 오래 끊겼으면 제어기가 꺼져 있었던 것으로 본다(분).
#:
#: 이력의 시각은 판단 주기(5분)가 아니라 **관측 자료의 시간 칸**이다 — 한 시간
#: 동안의 판단 열두 건이 같은 시각으로 적히고, 이어지는 두 줄의 차이는 0분
#: 아니면 60분이다. 60분 이하로 잡으면 정각이 바뀔 때마다 '꺼졌다 켜졌다'로
#: 읽혀 밤새 이어진 명령이 시간마다 한 번씩 세어진다.
OUTAGE_MINUTES = 90


class _CommandCounter:
    """새로 내린 장치 제어명령을 센다."""

    def __init__(self):
        self.counts: Counter = Counter()
        self._previous: set[str] = set()
        self._last: datetime.datetime | None = None

    def add(self, record: dict) -> None:
        moment = _parse(record.get("timestamp"))
        if moment is not None:
            if (self._last is not None
                    and moment - self._last > datetime.timedelta(minutes=OUTAGE_MINUTES)):
                self._previous = set()
            self._last = moment
        current = {
            _label(a) for a in record.get("executed", [])
            if a.get("device") not in NON_CONTROL_DEVICES
        }
        for name in current - self._previous:
            self.counts[name] += 1
        self._previous = current


def new_commands(records: Iterable[dict]) -> Counter:
    """새로 내린 장치 제어명령을 센다 ``{"장치 명령": 횟수}``.

    제어기는 5분마다 판단하므로 밤새 이어진 '야간 피복 전개'는 이력에 백 번
    넘게 적힌다. 그것은 명령 한 번이다. 직전 주기에 없던 명령이 나타난
    때만 한 번으로 센다. 알림은 넣지 않는다 — 기계를 움직인 것이 아니다.

    기록이 :data:`OUTAGE_MINUTES` 넘게 끊겼다가 이어지면 제어기가 꺼졌다
    켜진 것이므로 직전 상태를 잊는다. 그러지 않으면 일주일 전 마지막 줄의
    명령이 오늘의 같은 명령과 '이어진 것'으로 세어진다.
    """
    counter = _CommandCounter()
    for record in _ordered(records):
        counter.add(record)
    return counter.counts


def monthly_summary(records: Iterable[dict], year: int, month: int) -> dict:
    """월간 리포트 화면(M7)이 쓰는 집계.

    ``records`` 는 그 달의 판단 기록이다(:meth:`Journal.iter_range`). 한 번만
    훑으며 센다 — 한 달치(8천 줄 넘음)를 목록으로 쥐고 있지 않는다.
    """
    builder, commands = _CaseBuilder(), _CommandCounter()
    daily: dict[str, dict] = {}
    rejected_reasons: Counter = Counter()
    responses: set[tuple] = set()
    advisory_records = executed_entries = upper_rejected = total = 0
    for record in _ordered(records):
        total += 1
        builder.add(record)
        commands.add(record)
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

    cases = builder.finish()
    by_risk: dict[str, dict] = {}
    for case in cases:
        entry = by_risk.setdefault(case["risk"], {
            "risk": case["risk"], "riskName": case["riskName"],
            "cases": 0, "warningCases": 0, "minutes": 0,
        })
        entry["cases"] += 1
        entry["warningCases"] += int(case["peakLevel"] >= 2)
        entry["minutes"] += case["durationMinutes"]

    return {
        "month": f"{year:04d}-{month:02d}",
        "records": total,
        "daysWithData": len(daily),
        "caseTotal": len(cases),
        "byRisk": sorted(by_risk.values(), key=lambda e: -e["cases"]),
        "cases": cases,
        # 새로 내린 장치 제어명령 — 연속 실행은 1회, 알림 제외
        "controlCommands": sum(commands.counts.values()),
        "controlCommandTarget": CONTROL_COMMAND_TARGET,
        "commandsByDevice": [
            {"command": name, "count": count}
            for name, count in commands.counts.most_common()
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

def _csv_lines(header: list[str], rows: Iterable[list]) -> Iterator[str]:
    """CSV 를 한 줄씩 낸다. 첫 줄 앞에 엑셀이 한글을 읽도록 BOM 을 붙인다.

    한 줄씩 내보내는 이유 — 일 년치 판단 원자료는 수십 MB 다. 통째로 한
    문자열로 만들면 화면 서버가 메모리 상한을 넘는다.
    """
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\r\n")

    def line(row: list) -> str:
        writer.writerow(row)
        text = buffer.getvalue()
        buffer.seek(0)
        buffer.truncate()
        return text

    yield "\ufeff" + line(header)
    for row in rows:
        yield line(["" if v is None else _safe_cell(v) for v in row])


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
    return "".join(cases_csv_lines(cases))


def cases_csv_lines(cases: list[dict]) -> Iterator[str]:
    """위험 사례 목록."""
    header = ["사례번호", "위험유형", "시작", "종료", "지속(분)", "최고등급", "판단 건수",
              "평균 신뢰도", "최저 신뢰도", "첫 예상시점", "실행 조치", "권고 조치",
              "거부 조치", "농가 승인", "농가 거부"]
    return _csv_lines(header, (
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


def judgements_csv(records: Iterable[dict], label=str) -> str:
    return "".join(judgements_csv_lines(records, label))


def judgements_csv_lines(records: Iterable[dict], label=str) -> Iterator[str]:
    """판단 원자료 — 판단 한 건(위험유형 하나)이 한 줄.

    위험이 없던 주기도 한 줄로 남긴다(위험유형 칸이 빈다). '그 시각에
    제어기가 돌고 있었고 정상이라고 판단했다'는 것도 자료이기 때문이다.
    """
    header = (["시각", "지점", "모델 버전", "운전모드", "위험유형", "등급", "신뢰도",
               "예상시점", "판단근거 1", "판단근거 2", "판단근거 3"]
              + [name for _, name in INPUT_COLUMNS]
              + ["실행 조치", "거부 조치", "농가 응답"])

    def rows():
        for record in _ordered(records):
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

    return _csv_lines(header, rows())


def control_csv(records: Iterable[dict]) -> str:
    return "".join(control_csv_lines(records))


def control_csv_lines(records: Iterable[dict]) -> Iterator[str]:
    """제어 이력 — 조치 하나가 한 줄(화면 M3 과 같은 내용)."""
    header = ["시각", "계층", "장치", "명령", "결과", "사유", "위험유형"]

    def rows():
        for record in _ordered(records):
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
                kinds = " + ".join(RISK_LABELS_KO.get(k, k)
                                   for k in _kinds(action.get("risk_type")))
                yield [record.get("timestamp"), f"L{action.get('layer', '')}",
                       action.get("device"), action.get("command"), result, reason, kinds]

    return _csv_lines(header, rows())
