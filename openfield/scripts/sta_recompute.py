"""STA 시험용 — 데이터별 결과 로그만으로 최종값을 다시 계산해 대조한다.

사용 예::

    python scripts/sta_recompute.py --dir sta_ai노지

읽는 파일은 결과 묶음 안의 로그뿐이다. **모델·원천자료·시험셋을 읽지 않는다.**

    02_시점별_결과.csv            시험셋의 한 시각 × 판정 항목 1개가 한 줄
    02_사례별_결과.csv            위험사례 1건이 한 줄
    03_최종결과.json              대조할 최종값
    06_판단시간_회차별.csv        (있으면) 판단시간 회차별 기록
    06_판단시간_회차별.요약.json  (있으면) 대조할 판단시간 요약값

파이썬 표준 라이브러리만 쓴다(sklearn·numpy·pandas 없음). 계산식은 아래 주석과 같다.

계산식 (판정 항목마다 따로 계산)
--------------------------------
혼동행렬  C[i][j] = 정답_평가단위 = i 이고 예측_평가단위 = j 인 줄 수
          (평가단위 3등급: i, j ∈ {0 정상, 1 주의, 2 경계} / 2등급: {0 정상, 1 위험})

등급 k 마다
    TP_k = C[k][k]
    FP_k = Σ_{i≠k} C[i][k]        (k 가 아닌데 k 라고 예측)
    FN_k = Σ_{j≠k} C[k][j]        (k 인데 다르게 예측)
    정밀도_k = TP_k / (TP_k + FP_k)
    재현율_k = TP_k / (TP_k + FN_k)
    F1_k     = 2·TP_k / (2·TP_k + FP_k + FN_k)
    (분모가 0 이면 그 값은 0 으로 둔다)

① 종합점수(판정 조치단위 Macro F1) = (Σ_k F1_k) / 등급 수

② 놓침 방지율(사례 단위)
    위험사례ID 가 같은 줄을 한 사례로 묶는다.
    그 사례의 줄 가운데 예측등급 >= 1 이 한 번이라도 있으면 「탐지」.
    놓침 방지율 = 탐지한 사례 수 / 사례 수

③ (참고) 시간 단위 재현율
    = (정답등급 >= 1 이고 예측등급 >= 1 인 줄 수) / (정답등급 >= 1 인 줄 수)

판단시간 (회차별 CSV 가 있을 때)
    평균 = Σ 회차별 값 / 회차 수,  중앙값, p95(선형 보간), 최대

종료 코드: 0 모두 일치 / 1 하나라도 불일치 / 2 파일이 없거나 형식이 다름.
"""

from __future__ import annotations

import argparse
import bisect
import csv
import datetime
import json
import math
import sys
from pathlib import Path

#: 실수 비교 허용오차. 같은 정수 건수에서 계산한 값이므로 덧셈 순서 차이만 남는다.
TOLERANCE = 1e-9
TS_FORMAT = "%Y-%m-%d %H:%M"

STAGE_COLUMNS = ["피처 생성(ms)", "모델 추론(ms)", "판단근거(ms)", "조치 결정(ms)",
                 "이력 기록(ms)", "끝에서 끝까지(ms)"]


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--dir", required=True, help="결과 묶음 디렉터리 (sta_evaluate.py 의 --out)")
    p.add_argument("--timing-csv", default=None,
                   help="판단시간 회차별 CSV. 기본: <dir>/06_판단시간_회차별.csv (있으면 함께 검증)")
    return p.parse_args(argv)


def read_csv(path: Path) -> list[dict]:
    with open(path, encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def parse_ts(text: str) -> datetime.datetime:
    return datetime.datetime.strptime(text, TS_FORMAT)


# --------------------------------------------------------------------------- 지표 계산

def confusion_matrix(rows: list[dict], size: int) -> list[list[int]]:
    """C[i][j] = 정답_평가단위 i, 예측_평가단위 j 인 줄 수."""
    matrix = [[0] * size for _ in range(size)]
    for row in rows:
        matrix[int(row["정답_평가단위"])][int(row["예측_평가단위"])] += 1
    return matrix


def per_class(matrix: list[list[int]]) -> list[dict]:
    """등급별 정밀도·재현율·F1."""
    size = len(matrix)
    out = []
    for k in range(size):
        tp = matrix[k][k]
        fp = sum(matrix[i][k] for i in range(size) if i != k)
        fn = sum(matrix[k][j] for j in range(size) if j != k)
        out.append({
            "TP": tp, "FP": fp, "FN": fn,
            "정밀도": tp / (tp + fp) if tp + fp else 0.0,
            "재현율": tp / (tp + fn) if tp + fn else 0.0,
            "F1": 2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else 0.0,
        })
    return out


def macro_f1(classes: list[dict]) -> float:
    """Macro F1 = 등급별 F1 의 단순 평균."""
    return sum(c["F1"] for c in classes) / len(classes)


def hourly_recall(rows: list[dict]) -> tuple[int, int, float | None]:
    """(위험 표본 수, 그중 위험으로 예측한 수, 시간 단위 재현율)."""
    risk = [r for r in rows if int(r["정답등급(0·1·2)"]) >= 1]
    hit = sum(1 for r in risk if int(r["예측등급(0·1·2)"]) >= 1)
    return len(risk), hit, (hit / len(risk) if risk else None)


def build_cases(rows: list[dict], horizon: int) -> list[dict]:
    """시점별 줄을 위험사례ID 로 묶어 사례별 결과를 다시 만든다.

    * 탐지            사례의 줄 가운데 예측등급 >= 1 이 한 번이라도 있는가
    * 시작 전 탐지    사례 시작 직전 `시계` 시간 안, 같은 지점의 줄에 예측등급 >= 1 이 있는가.
                      그 구간의 줄이 로그(시험셋)에 하나도 없으면 빈칸(평가 제외)
    * 사전알림(분)    사례 안에서 정답등급 >= 1 인 첫 시각(기준시각)에서, 그 앞 6시간
                      (기준시각 포함) 안에 예측등급 >= 1 인 가장 이른 시각을 뺀 값. 없으면 빈칸
    """
    pred_at: dict[tuple[str, datetime.datetime], int] = {}
    alerts: list[datetime.datetime] = []
    groups: dict[str, list[tuple[datetime.datetime, dict]]] = {}
    for row in rows:
        ts = parse_ts(row["시각"])
        pred = int(row["예측등급(0·1·2)"])
        pred_at.setdefault((row["관측지점"], ts), pred)
        if pred >= 1:
            alerts.append(ts)
        if row["위험사례ID"]:
            groups.setdefault(row["위험사례ID"], []).append((ts, row))
    alerts.sort()

    cases = []
    for case_id, members in groups.items():
        members.sort(key=lambda pair: pair[0])
        start, end = members[0][0], members[-1][0]
        station = members[0][1]["관측지점"]
        hits = [ts for ts, row in members if int(row["예측등급(0·1·2)"]) >= 1]

        before = [pred_at.get((station, start - datetime.timedelta(hours=k)))
                  for k in range(1, horizon + 1)]
        before = [v for v in before if v is not None]
        pre = (1 if max(before) >= 1 else 0) if before else None

        lead = None
        onset = [ts for ts, row in members if int(row["정답등급(0·1·2)"]) >= 1]
        if onset:
            base = min(onset)
            lo = bisect.bisect_left(alerts, base - datetime.timedelta(hours=6))
            hi = bisect.bisect_right(alerts, base)
            if hi > lo:
                lead = (base - alerts[lo]).total_seconds() / 60.0
        cases.append({
            "사례ID": case_id, "관측지점": station,
            "시작시각": start.strftime(TS_FORMAT), "종료시각": end.strftime(TS_FORMAT),
            "지속(h)": len(members), "탐지(0/1)": 1 if hits else 0,
            "첫 탐지 시각": min(hits).strftime(TS_FORMAT) if hits else "",
            "사전알림(분)": lead, "시작 전 탐지(0/1)": pre,
        })
    cases.sort(key=lambda c: (c["시작시각"], c["사례ID"]))
    return cases


# --------------------------------------------------------------------------- 대조

class Report:
    """비교 결과를 모아 화면과 `04_재계산_결과.txt` 에 같은 내용으로 낸다."""

    def __init__(self) -> None:
        self.lines: list[str] = []
        self.checked = 0
        self.mismatches: list[str] = []

    def say(self, text: str = "") -> None:
        self.lines.append(text)
        print(text)

    def check(self, label: str, recomputed, recorded, *, tol: float = TOLERANCE) -> bool:
        self.checked += 1
        if isinstance(recomputed, float) or isinstance(recorded, float):
            same = (recomputed is not None and recorded is not None
                    and math.isclose(recomputed, recorded, rel_tol=tol, abs_tol=tol))
        else:
            same = recomputed == recorded
        if not same:
            self.mismatches.append(f"{label}: 재계산 {recomputed!r} / 기록 {recorded!r}")
        return same


def fmt(value) -> str:
    if value is None:
        return "-"
    return f"{value:.6f}" if isinstance(value, float) else str(value)


def verdict(value: float | None, target: float) -> str:
    return "적합" if value is not None and value >= target else "부적합"


def recompute_items(directory: Path, final: dict, report: Report) -> None:
    points = read_csv(directory / "02_시점별_결과.csv")
    logged_cases = read_csv(directory / "02_사례별_결과.csv")
    report.say(f"읽은 로그: 02_시점별_결과.csv {len(points):,}줄 / 02_사례별_결과.csv {len(logged_cases):,}줄")

    by_item: dict[str, list[dict]] = {}
    for row in points:
        by_item.setdefault(row["판정항목"], []).append(row)
    cases_by_item: dict[str, list[dict]] = {}
    for row in logged_cases:
        cases_by_item.setdefault(row["판정항목"], []).append(row)

    f1_target = float(final["기준"]["종합점수"]["기준값"])
    miss_target = float(final["기준"]["놓침 방지율"]["기준값"])
    miss_unit = final["기준"]["놓침 방지율"]["셈법"]
    recorded = {s["판정항목"]: s for s in final["항목별"]}
    report.check("판정 항목 목록", sorted(by_item), sorted(recorded))

    report.say("")
    report.say(f"기준: 종합점수 >= {f1_target} / 놓침 방지율({miss_unit}) >= {miss_target}")
    report.say("")
    header = (f"{'판정항목':<14}{'지표':<22}{'재계산':>12}{'최종결과(JSON)':>16}  결과")
    report.say(header)
    report.say("-" * 78)

    summary = {"항목 수": 0, "종합점수 적합": 0, "놓침 적합": 0, "사례 적합": 0, "시간 적합": 0}
    for tag, rows in by_item.items():
        rec = recorded.get(tag)
        if rec is None:
            continue
        unit = rows[0]["평가단위"]
        horizon = int(rows[0]["시계(h)"])
        size = 2 if unit.startswith("2등급") else 3

        # 로그 자체의 앞뒤가 맞는지 — 평가단위 값과 일치 열
        for row in rows:
            true, pred = int(row["정답등급(0·1·2)"]), int(row["예측등급(0·1·2)"])
            want_true = min(true, 1) if size == 2 else true
            want_pred = min(pred, 1) if size == 2 else pred
            if (int(row["정답_평가단위"]), int(row["예측_평가단위"])) != (want_true, want_pred) or \
                    int(row["일치(0/1)"]) != int(want_true == want_pred):
                report.check(f"{tag} {row['시각']} {row['관측지점']} 평가단위·일치 열", "불일치", "일치")
                break

        matrix = confusion_matrix(rows, size)
        classes = per_class(matrix)
        f1 = macro_f1(classes)
        n_risk, _, recall = hourly_recall(rows)
        cases = build_cases(rows, horizon)
        detected = sum(c["탐지(0/1)"] for c in cases)
        case_rate = detected / len(cases) if cases else None
        pre_cases = [c for c in cases if c["시작 전 탐지(0/1)"] is not None]
        pre_hit = sum(c["시작 전 탐지(0/1)"] for c in pre_cases)
        leads = [c["사전알림(분)"] for c in cases if c["사전알림(분)"] is not None]

        # 사례별 CSV 와 한 줄씩 대조 — 시점별 로그에서 다시 만든 것과 같아야 한다
        logged = sorted(cases_by_item.get(tag, []), key=lambda c: (c["시작시각"], c["사례ID"]))
        same_cases = len(logged) == len(cases)
        if same_cases:
            for mine, theirs in zip(cases, logged):
                for key in ("사례ID", "관측지점", "시작시각", "종료시각", "첫 탐지 시각"):
                    same_cases &= mine[key] == theirs[key]
                same_cases &= mine["지속(h)"] == int(theirs["지속(h)"])
                same_cases &= mine["탐지(0/1)"] == int(theirs["탐지(0/1)"])
                their_pre = None if theirs["시작 전 탐지(0/1)"] == "" else int(theirs["시작 전 탐지(0/1)"])
                same_cases &= mine["시작 전 탐지(0/1)"] == their_pre
                their_lead = None if theirs["사전알림(분)"] == "" else float(theirs["사전알림(분)"])
                same_cases &= (mine["사전알림(분)"] is None) == (their_lead is None) and (
                    their_lead is None or math.isclose(mine["사전알림(분)"], their_lead, abs_tol=1e-6))
                if not same_cases:
                    break

        miss_value = case_rate if miss_unit == "사례 단위" else recall
        table = [
            ("표본 수", len(rows), rec["표본 수"]),
            ("위험 표본 수", n_risk, rec["위험 표본 수"]),
            ("혼동행렬", matrix, rec["혼동행렬(행 정답·열 예측)"]),
            ("① 판정 조치단위F1", f1, rec["판정 조치단위F1"]),
            ("사례 수", len(cases), rec["사례 수"]),
            ("탐지 사례 수", detected, rec["탐지 사례 수"]),
            ("② 사례 단위 놓침 방지율", case_rate, rec["사례 단위 놓침 방지율"]),
            ("③ 시간 단위 재현율(참고)", recall, rec["시간 단위 재현율(참고)"]),
            ("시작 전 평가 사례 수(참고)", len(pre_cases), rec["시작 전 평가 사례 수(참고)"]),
            ("시작 전 탐지 사례 수(참고)", pre_hit, rec["시작 전 탐지 사례 수(참고)"]),
            ("평균 사전알림(분)(참고)", math.fsum(leads) / len(leads) if leads else None,
             rec["평균 사전알림(분)(참고)"]),
            ("사례별 CSV 한 줄씩 대조", "같음" if same_cases else "다름", "같음"),
            ("판정: 종합점수", verdict(f1, f1_target), rec["판정"]["종합점수"]),
            ("판정: 놓침 방지율", verdict(miss_value, miss_target), rec["판정"]["놓침 방지율"]),
        ]
        for label, mine, theirs in table:
            if isinstance(mine, float) and isinstance(theirs, int):
                theirs = float(theirs)
            same = report.check(f"{tag} {label}", mine, theirs,
                                tol=1e-6 if label.startswith("평균 사전알림") else TOLERANCE)
            if label == "혼동행렬":
                report.say(f"{tag:<14}{label:<22}{'':>12}{'':>16}  {'일치' if same else '불일치'}")
                names = ["정상", "위험"] if size == 2 else ["정상", "주의", "경계"]
                for i, line in enumerate(matrix):
                    report.say(f"{'':<14}  정답 {names[i]} → 예측 {'/'.join(names)} : "
                               + " / ".join(f"{v:,}" for v in line))
                for k, c in enumerate(classes):
                    report.say(f"{'':<14}  {names[k]}: 정밀도 {c['정밀도']:.6f} 재현율 {c['재현율']:.6f} "
                               f"F1 {c['F1']:.6f} (TP {c['TP']:,} FP {c['FP']:,} FN {c['FN']:,})")
            else:
                report.say(f"{tag:<14}{label:<22}{fmt(mine):>12}{fmt(theirs):>16}  "
                           f"{'일치' if same else '불일치'}")
        report.say("-" * 78)

        summary["항목 수"] += 1
        summary["종합점수 적합"] += verdict(f1, f1_target) == "적합"
        summary["놓침 적합"] += verdict(miss_value, miss_target) == "적합"
        summary["사례 적합"] += verdict(case_rate, miss_target) == "적합"
        summary["시간 적합"] += verdict(recall, miss_target) == "적합"

    total = final["종합"]
    report.say("")
    for label, mine, theirs in (
        ("항목 수", summary["항목 수"], total["항목 수"]),
        ("종합점수 적합 항목 수", summary["종합점수 적합"], total["종합점수 적합 항목 수"]),
        ("놓침 방지율 적합 항목 수", summary["놓침 적합"], total["놓침 방지율 적합 항목 수"]),
        ("사례 단위 0.85 이상 항목 수", summary["사례 적합"], total["사례 단위 0.85 이상 항목 수"]),
        ("시간 단위 0.85 이상 항목 수(참고)", summary["시간 적합"], total["시간 단위 0.85 이상 항목 수(참고)"]),
    ):
        same = report.check(f"종합 {label}", mine, theirs)
        report.say(f"{'종합':<14}{label:<22}{fmt(mine):>12}{fmt(theirs):>16}  {'일치' if same else '불일치'}")


def percentile(values: list[float], q: float) -> float:
    """선형 보간 백분위수(numpy 기본 방식). 위치 = (n-1)·q/100."""
    ordered = sorted(values)
    position = (len(ordered) - 1) * q / 100.0
    lower = math.floor(position)
    upper = min(lower + 1, len(ordered) - 1)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def recompute_timing(csv_path: Path, report: Report) -> None:
    summary_path = csv_path.with_suffix(".요약.json")
    rows = read_csv(csv_path)
    recorded = json.loads(summary_path.read_text(encoding="utf-8"))
    report.say("")
    report.say(f"판단시간 — {csv_path.name} {len(rows):,}회 / 대조 {summary_path.name}")
    report.say(f"{'단계':<14}{'지표':<22}{'재계산':>12}{'요약(JSON)':>16}  결과")
    report.say("-" * 78)
    report.check("판단시간 회차 수", len(rows), recorded["반복 횟수"])
    report.check("판단시간 회차 번호", [int(r["회차"]) for r in rows], list(range(1, len(rows) + 1)))
    for column in STAGE_COLUMNS:
        values = [float(r[column]) for r in rows]
        mine = {
            "평균(ms)": math.fsum(values) / len(values),
            "중앙값(ms)": percentile(values, 50),
            "p95(ms)": percentile(values, 95),
            "최대(ms)": max(values),
        }
        for key, value in mine.items():
            theirs = float(recorded["단계별"][column][key])
            same = report.check(f"판단시간 {column} {key}", value, theirs)
            report.say(f"{column:<14}{key:<22}{value:>12.4f}{theirs:>16.4f}  {'일치' if same else '불일치'}")
    mean_ms = math.fsum(float(r["끝에서 끝까지(ms)"]) for r in rows) / len(rows)
    target_ms = float(recorded["기준"]["평균(초) 이내"]) * 1000.0
    mine = "적합" if mean_ms <= target_ms else "부적합"
    same = report.check("판단시간 판정", mine, recorded["판정"])
    report.say(f"{'판정':<14}{'끝에서 끝까지 평균':<22}{mean_ms:>10.4f}ms{'<= ' + format(target_ms, ',.0f') + 'ms':>16}  "
               f"{mine} ({'일치' if same else '불일치'})")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")
    directory = Path(args.dir)
    report = Report()
    report.say("AI 노지 — 로그만으로 다시 계산한 결과와 최종결과 대조")
    report.say(f"실행 시각: {datetime.datetime.now().astimezone():%Y-%m-%d %H:%M:%S %z}")
    report.say(f"대상: {directory}")
    try:
        final = json.loads((directory / "03_최종결과.json").read_text(encoding="utf-8"))
        recompute_items(directory, final, report)
        timing = Path(args.timing_csv) if args.timing_csv else directory / "06_판단시간_회차별.csv"
        if timing.exists():
            recompute_timing(timing, report)
        elif args.timing_csv:
            raise FileNotFoundError(timing)
        else:
            report.say("")
            report.say("판단시간 회차별 CSV 없음 — 판단시간은 검증하지 않았다")
    except (OSError, KeyError, ValueError) as exc:
        report.say(f"[오류] 로그를 읽지 못했습니다: {type(exc).__name__}: {exc}")
        code = 2
    else:
        report.say("")
        if report.mismatches:
            report.say(f"[불일치] {report.checked}개 값 가운데 {len(report.mismatches)}개가 다릅니다")
            for line in report.mismatches:
                report.say(f"  {line}")
            code = 1
        else:
            report.say(f"[일치] {report.checked}개 값이 모두 최종결과와 같습니다")
            code = 0
    report.say(f"종료 코드 {code}")
    if directory.is_dir():
        (directory / "04_재계산_결과.txt").write_text("\n".join(report.lines) + "\n", encoding="utf-8")
        with open(directory / "05_실행로그.txt", "a", encoding="utf-8", newline="\n") as log:
            log.write("\n$ python scripts/sta_recompute.py "
                      + " ".join(argv if argv is not None else sys.argv[1:]) + "\n")
            log.write("\n".join(report.lines) + "\n")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
