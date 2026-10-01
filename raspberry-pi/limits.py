"""판정 기준값 — 장비 안에서 이 표 하나만 본다.

장비 화면(webui.py 의 색), 설비 운전 권고(advice.py), 그리고 서버가 알림을 만드는
기준(lib/thresholds.ts 의 WQ_THRESHOLDS)이 **같은 숫자**여야 한다. 셋이 어긋나면
수조 옆 화면은 주황인데 웹은 조용하거나, 그 반대가 된다 — 실제로 수온이 그랬다
(장비 정상 28~32 ℃ / 서버 정상 25~32 ℃ 라 26~27 ℃ 구간이 서로 달랐다).

그래서 숫자를 파이썬 쪽 한 곳에 모으고, 화면 JS 는 이 표를 주입받아 쓴다.
웹과 맞추는 일은 아직 사람이 한다 — 바꿀 때 lib/thresholds.ts 도 같이 고칠 것.

밴드 읽는 법 (서버의 warning/danger 와 1:1 로 대응한다):
    ok   이 안이면 정상          = 서버의 warning 밴드 경계
    warn 이 안이면 주의          = 서버의 danger 밴드 경계
    둘 다 벗어나면 위험
    None 은 "그쪽 끝은 보지 않는다" — 용존산소에 상한이 없는 것이 그 예다.
"""

from __future__ import annotations

# 흰다리새우 해수 양식 기준.
BANDS: dict[str, dict[str, list]] = {
    "temperature": {"ok": [25, 32],    "warn": [22, 35]},
    "ph":          {"ok": [7.5, 8.5],  "warn": [7.0, 9.0]},
    "do_level":    {"ok": [5.0, None], "warn": [4.0, None]},
    "salinity":    {"ok": [15, 35],    "warn": [10, 40]},
    # 센서를 증설하면 그대로 적용된다.
    "turbidity":   {"ok": [None, 20],  "warn": [None, 30]},
    "ammonia":     {"ok": [None, 0.5], "warn": [None, 1.0]},
    "nitrite":     {"ok": [None, 0.2], "warn": [None, 0.5]},
}

# 수경재배(엽채류) 양액 기준. 근권 냉방으로 일부러 낮게 유지하므로 새우 기준을
# 그대로 대면 정상 운전이 매번 "수온 주의" 가 된다.
NUTRIENT_BANDS: dict[str, dict[str, list]] = {
    "temperature": {"ok": [16, 26],    "warn": [12, 30]},
    "ph":          {"ok": [5.5, 6.5],  "warn": [5.0, 7.0]},
    "do_level":    {"ok": [4.0, None], "warn": [2.0, None]},
}


def level(field: str, value: float, nutrient: bool = False) -> str:
    """"" (정상) · "warn" (주의) · "crit" (위험). 화면 JS 의 level() 과 같은 판정이다."""
    table = NUTRIENT_BANDS if nutrient else BANDS
    band = table.get(field) or (BANDS.get(field) if nutrient else None)
    if not band:
        return ""
    def inside(pair: list) -> bool:
        lo, hi = pair
        if lo is not None and value < lo:
            return False
        if hi is not None and value > hi:
            return False
        return True
    if inside(band["ok"]):
        return ""
    return "warn" if inside(band["warn"]) else "crit"
