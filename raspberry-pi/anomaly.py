"""경량 이상탐지 — 임계값을 넘지 않아도 "평소와 다르다"를 장비가 스스로 찾는다.

임계값 판정만으로는 늦다. 용존산소가 7.0 에서 5.2 로 떨어지는 동안은 어느 기준도
넘지 않아 화면이 조용하지만, 그 기울기가 그대로면 두 시간 뒤 폐사 구간이다.
그래서 **값 하나**가 아니라 **값의 움직임**을 본다.

세 가지를 본다.

  급변(surge)      짧은 간격 안에서 크게 튀었다 — 환수 사고, 전극 이탈, 정전
  연속 악화(drift) 한 방향으로 계속 간다 — 유기물 축적, 폭기 효율 저하
  범위 이탈(deviation) 이 수조의 평소 분포에서 벗어났다 — 원인 미상의 변화

**웹(lib/thresholds.ts 의 detectTrendAnomalies)과 같은 판정이다.** 기준이 두 벌이면
장비와 웹이 서로 다른 말을 하게 되므로, 상수와 분기를 그쪽에 맞춰 옮겼다. 한쪽을
고치면 다른 쪽도 같이 고쳐야 한다.

문장은 여기서 만들지 않는다. 장비 화면이 4개 국어를 쓰므로 판정 결과만 구조로
돌려주고, 번역은 화면(webui.py 의 I18N)이 맡는다.
"""

from __future__ import annotations

import math
import time

# 판정에 필요한 최소 측정 횟수. 2~3개로는 추세라고 부를 수 없다.
TREND_MIN_SAMPLES = 4

# 두 기록이 이보다 벌어져 있으면 그 사이 변화를 "급변"이라 부를 수 없다.
# 하루 주기의 2시간치 변화(수온 ~1℃, DO ~0.8, pH ~0.14)는 어느 surge 값보다 작아
# 이 상한이 곧 주기성 오탐의 방어선이 된다.
SURGE_MAX_GAP_H = 2
# 최근 몇 시간까지 되짚어 급변을 찾을지. 마지막 한 점만 보면 새벽에 벌어졌다
# 회복된 사고를 아침에 놓친다.
SURGE_SCAN_H = 6
# 축적성 항목의 연속 악화를 볼 최대 구간.
DRIFT_WINDOW_H = 12
# 이보다 짧은 구간의 연속은 노이즈로 본다.
DRIFT_MIN_SPAN_H = 2
# 주기성 항목의 날짜별 극값을 볼 최소 일수.
DAILY_MIN_DAYS = 3
# 평소 범위(평균·표준편차)를 논하려면 표본이 이만큼 있어야 한다.
DEVIATION_MIN_SAMPLES = 12
# 표준편차 몇 배를 벗어나야 "평소와 다르다"고 볼지.
DEVIATION_SIGMA = 3

# 항목별 판정 기준.
#   worsening  어느 방향이 나빠지는 쪽인가
#   surge      "짧은 시간에 이만큼 튀면 비정상" 인 폭
#   digits     화면 표시 자릿수
#   diurnal    하루 주기가 큰 항목인가 — 판정 방식이 갈린다
RULES: dict[str, dict] = {
    "temperature": {"worsening": "both", "surge": 2.0, "digits": 1, "diurnal": True},
    "ph":          {"worsening": "both", "surge": 0.4, "digits": 2, "diurnal": True},
    "do_level":    {"worsening": "down", "surge": 1.2, "digits": 2, "diurnal": True},
    "salinity":    {"worsening": "both", "surge": 3.0, "digits": 1, "diurnal": False},
    # 아래는 센서를 증설하면 그대로 적용된다. 값이 들어오지 않으면 건너뛴다.
    "turbidity":   {"worsening": "up",   "surge": 6.0, "digits": 1, "diurnal": False},
    "ammonia":     {"worsening": "up",   "surge": 0.25, "digits": 2, "diurnal": False},
    "nitrite":     {"worsening": "up",   "surge": 0.10, "digits": 2, "diurnal": False},
}

H = 3600.0  # 시간 → 초


def _worsening(delta: float, direction: str) -> bool:
    """이 움직임이 악화 방향인가."""
    if delta == 0:
        return False
    if direction == "both":
        return True
    return delta > 0 if direction == "up" else delta < 0


def _daily_extremes(points: list[tuple[float, float]], up: bool) -> list[tuple[float, float]]:
    """하루 경계로 묶어 날짜별 극값을 뽑는다. up 이면 최댓값, 아니면 최솟값."""
    by_day: dict[tuple[int, int, int], tuple[float, float]] = {}
    for ts, value in points:
        lt = time.localtime(ts)
        key = (lt.tm_year, lt.tm_mon, lt.tm_mday)
        cur = by_day.get(key)
        if cur is None or (value > cur[1] if up else value < cur[1]):
            by_day[key] = (ts, value)
    return sorted(by_day.values())


def _run_start(points: list[tuple[float, float]], sign: int, max_span_s: float) -> int:
    """끝에서 거슬러 올라가며 연속으로 같은 방향인 구간의 시작 인덱스."""
    last = len(points) - 1
    i = last
    while i > 0:
        d = points[i][1] - points[i - 1][1]
        if d == 0 or (1 if d > 0 else -1) != sign:
            break
        if points[last][0] - points[i - 1][0] > max_span_s:
            break
        i -= 1
    return i


def _series(rows: list[dict], field: str) -> list[tuple[float, float]]:
    """한 항목의 (시각, 값) 목록. 0 은 "안 쟀다"로 본다 — 웹과 같은 관례다."""
    out = []
    for r in rows:
        v = r.get(field)
        if not isinstance(v, (int, float)) or v == 0:
            continue
        ts = r.get("t")
        if not isinstance(ts, (int, float)):
            continue
        out.append((float(ts), float(v)))
    out.sort()
    return out


def detect(rows: list[dict]) -> list[dict]:
    """측정 이력에서 이상징후를 뽑는다.

    rows 는 {"t": 유닉스초, "do_level": 6.4, ...} 들의 목록이고 순서는 상관없다.
    항목마다 최대 하나만 돌려준다 — 같은 항목에 여러 줄이 뜨면 현장에서 무엇부터
    봐야 할지 알 수 없다.

    돌려주는 것(문장이 아니라 구조):
        parameter  항목 키 (do_level 등)
        kind       surge | drift | deviation
        type       danger | warning
        value      지금 값
        reference  비교 기준값 (급변=이전 값, 연속 악화=구간 시작값, 이탈=평균)
        digits     표시 자릿수
        그리고 종류별로 gap_minutes · span_hours · days · direction
    """
    if len(rows) < TREND_MIN_SAMPLES:
        return []

    found: list[dict] = []

    for field, rule in RULES.items():
        pts = _series(rows, field)
        if len(pts) < TREND_MIN_SAMPLES:
            continue

        surge = rule["surge"]
        digits = rule["digits"]
        last_t, last_v = pts[-1]

        # ① 급변 — 짧은 간격 안에서 크게 튀었다. 최근 구간을 되짚어 가장 심한 것을 쓴다.
        worst = None
        for i in range(len(pts) - 1, 0, -1):
            if last_t - pts[i][0] > SURGE_SCAN_H * H:
                break
            gap = pts[i][0] - pts[i - 1][0]
            if gap > SURGE_MAX_GAP_H * H:
                continue                       # 벌어진 간격은 급변이라 못 부른다
            delta = pts[i][1] - pts[i - 1][1]
            if not _worsening(delta, rule["worsening"]) or abs(delta) < surge:
                continue
            if worst is None or abs(delta) > abs(worst[2]):
                worst = (pts[i - 1], pts[i], delta)
        if worst is not None:
            frm, to, delta = worst
            found.append({
                "parameter": field, "kind": "surge",
                "type": "danger" if abs(delta) >= surge * 2 else "warning",
                "value": to[1], "reference": frm[1], "digits": digits,
                "direction": "up" if delta > 0 else "down",
                "gap_minutes": max(1, round((last_t - frm[0]) / 60)),
            })
            continue

        if rule["diurnal"]:
            # ② 주기성 항목 — 날짜별 극값이 며칠에 걸쳐 나빠지는가.
            #    하루 주기 자체는 날짜마다 같은 극값을 만들므로 이 판정에 걸리지 않는다.
            dirs = ["up", "down"] if rule["worsening"] == "both" else [rule["worsening"]]
            for direction in dirs:
                days = _daily_extremes(pts, direction == "up")
                if len(days) < DAILY_MIN_DAYS:
                    continue
                sign = 1 if direction == "up" else -1
                start_idx = _run_start(days, sign, float("inf"))
                span_days = len(days) - start_idx
                if span_days < DAILY_MIN_DAYS:
                    continue
                start, end = days[start_idx], days[-1]
                total = abs(end[1] - start[1])
                if total < surge:
                    continue
                found.append({
                    "parameter": field, "kind": "drift",
                    "type": "danger" if total >= surge * 2 else "warning",
                    "value": end[1], "reference": start[1], "digits": digits,
                    "direction": direction, "days": span_days,
                })
                break
            continue

        # ③ 축적성 항목 — 구간 안 연속 악화
        step = last_v - pts[-2][1]
        sign = 0 if step == 0 else (1 if step > 0 else -1)
        if sign != 0 and _worsening(step, rule["worsening"]):
            i0 = _run_start(pts, sign, DRIFT_WINDOW_H * H)
            start_t, start_v = pts[i0]
            span_h = (last_t - start_t) / H
            total = abs(last_v - start_v)
            if len(pts) - 1 - i0 >= 3 and span_h >= DRIFT_MIN_SPAN_H and total >= surge:
                found.append({
                    "parameter": field, "kind": "drift",
                    "type": "danger" if total >= surge * 2 else "warning",
                    "value": last_v, "reference": start_v, "digits": digits,
                    "direction": "up" if sign > 0 else "down",
                    "span_hours": max(1, round(span_h)),
                })
                continue

        # ④ 평소 범위 이탈 — 이 수조의 자기 기준에서 벗어났다.
        #    표본 표준편차(÷(N-1))를 쓰고 3σ 로 잡는다. 모집단 식(÷N)에 2.5σ 는
        #    표본이 적을 때 정상 데이터까지 이탈로 찍는다.
        if len(pts) >= DEVIATION_MIN_SAMPLES:
            baseline = [v for _, v in pts[:-1]]
            mean = sum(baseline) / len(baseline)
            variance = sum((v - mean) ** 2 for v in baseline) / (len(baseline) - 1)
            sd = math.sqrt(variance)
            gap = last_v - mean
            # sd 가 0 에 가까우면(늘 같은 값) 아주 작은 변화도 무한대 배수가 된다.
            # 판정 폭의 1/4 을 최소 유의미 변화로 두고 그보다 작으면 넘어간다.
            if (sd > 0 and abs(gap) >= surge / 4 and abs(gap) / sd >= DEVIATION_SIGMA
                    and _worsening(gap, rule["worsening"])):
                found.append({
                    "parameter": field, "kind": "deviation", "type": "warning",
                    "value": last_v, "reference": mean, "digits": digits,
                    "direction": "up" if gap > 0 else "down",
                })

    # 위험을 먼저, 그다음 급변 → 연속 악화 → 범위 이탈 순으로 읽히게 한다.
    kind_order = {"surge": 0, "drift": 1, "deviation": 2}
    found.sort(key=lambda a: (0 if a["type"] == "danger" else 1, kind_order[a["kind"]]))
    return found
