#!/usr/bin/env python3
"""판정 자체점검 — 장비가 내리는 판단이 설계대로인지 확인한다.

    python3 raspberry-pi/verify.py

센서도 인터넷도 필요 없다. 시험 데이터를 만들어 이력 DB 에 넣고,
이력 → 이상탐지 → 운전 권고의 전 구간을 돌려 결과를 눈으로 확인한다.

왜 두는가
  · 판정 숫자(limits.py)가 **웹 알림 기준과 같은지**를 경계값으로 확인한다.
    수조 옆 화면은 주황인데 웹은 조용한 일이 실제로 있었다(수온 26~27 ℃).
  · 이상탐지가 **잡아야 할 것과 잡지 말아야 할 것**을 둘 다 확인한다.
    해 질 녘마다 경보가 뜨는 쪽이 아무것도 안 뜨는 쪽보다 나쁘다.
  · 성능검증 기록지에 붙일 근거가 된다 — 돌린 결과를 그대로 옮기면 된다.

웹 구현(lib/thresholds.ts 의 detectTrendAnomalies)과의 대조는 이 파일이 하지
않는다. 그쪽은 Node 가 있어야 하므로 개발 PC 에서 따로 맞춰 본다.
"""

from __future__ import annotations

import math
import os
import sys
import tempfile
import time
import types
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import advice          # noqa: E402
import anomaly         # noqa: E402
import history         # noqa: E402
import limits          # noqa: E402
import modes           # noqa: E402

# 수집기 본체에서 **장비 시계 가드**를 가져온다. 판정 숫자와 같은 이유로 여기서
# 다시 적지 않는다 — 두 곳에 적으면 한쪽만 고쳐진다.
# pyserial 은 개발 PC 에 없을 수 있다. 이 파일은 MODBUS 를 쓰지 않는 함수만 보므로
# 자리만 채워 둔다(라즈베리파이에서는 실제 모듈이 이미 올라와 있어 아무 일도 없다).
if "serial" not in sys.modules:
    _stub = types.ModuleType("serial")
    _stub.SerialException = type("SerialException", (OSError,), {})
    sys.modules["serial"] = _stub
import shrimp365_sensor as sensor   # noqa: E402

fails: list[str] = []


def check(label: str, got, want) -> None:
    ok = got == want
    print(f"  {'OK  ' if ok else 'FAIL'} {label}" + ("" if ok else f"\n        받음 {got!r} / 기대 {want!r}"))
    if not ok:
        fails.append(label)


def store(points: list[tuple[int, dict]]) -> list[dict]:
    """시험 데이터를 실제 이력 DB 에 넣었다 다시 읽는다 — 저장 경로까지 함께 본다."""
    h = history.History(os.path.join(tempfile.mkdtemp(), "history.db"))
    if not h.available:
        fails.append("이력 DB 를 열지 못했습니다")
        return []
    for ts, values in points:
        h.record(values, ts)
    rows = h.recent(96)
    h.close()
    return rows


# 하루 주기 판정은 **지역 시간의 날짜 경계**로 가른다. 시험 데이터도 그 경계에
# 맞춰야 마지막 날이 토막 나지 않는다.
MIDNIGHT = int(time.mktime(time.struct_time(time.localtime()[:3] + (0, 0, 0, 0, 0, -1))))
NOW = MIDNIGHT + 18 * 3600          # 오늘 18시 — 새벽 최저값이 이미 지난 시각


print("\n① 판정 밴드 — 서버(lib/thresholds.ts 의 WQ_THRESHOLDS)와 같은 경계인가")
for field, value, want in [
    ("temperature", 26.0, ""), ("temperature", 24.9, "warn"), ("temperature", 22.0, "warn"),
    ("temperature", 21.9, "crit"), ("temperature", 32.0, ""), ("temperature", 32.1, "warn"),
    ("ph", 7.5, ""), ("ph", 7.4, "warn"), ("ph", 6.9, "crit"),
    ("do_level", 5.0, ""), ("do_level", 4.9, "warn"), ("do_level", 3.9, "crit"),
    ("do_level", 25.0, ""),          # 용존산소에 상한은 없다
    ("salinity", 15.0, ""), ("salinity", 14.9, "warn"), ("salinity", 9.9, "crit"),
]:
    check(f"{field} {value} → {want or '정상'}", limits.level(field, value), want)


print("\n② 이상탐지 — 잡지 말아야 할 것")
quiet = [(NOW - (240 - i) * 360, {
    "do_level": round(6.4 + math.sin(((NOW - (240 - i) * 360) % 86400) / 86400 * 2 * math.pi) * 2.2, 2),
}) for i in range(240)]
check("하루 주기대로 오르내린 용존산소는 조용하다", anomaly.detect(store(quiet)), [])

slow = [(NOW - (300 - i) * 60, {"do_level": round(7.2 - (i / 300) * 1.6, 2)}) for i in range(300)]
check("다섯 시간에 걸친 완만한 하락도 조용하다", anomaly.detect(store(slow)), [])

short = [(NOW - 120, {"do_level": 6.0}), (NOW, {"do_level": 3.0})]
check("표본이 네 개 미만이면 판정하지 않는다", anomaly.detect(store(short)), [])


print("\n③ 이상탐지 — 잡아야 할 것")
drop = [(NOW - (125 - i) * 60, {"do_level": 6.4}) for i in range(120)] + [(NOW, {"do_level": 4.9})]
got = anomaly.detect(store(drop))
check("30분 사이 1.5 급락은 surge", [(a["parameter"], a["kind"], a["direction"]) for a in got],
      [("do_level", "surge", "down")])

daily = []
for d in range(4):
    for m in range(0, 1440, 10):
        ts = MIDNIGHT - (3 - d) * 86400 + m * 60
        if ts > NOW:
            break
        daily.append((ts, {"do_level": round((7.4 - d * 0.5)
                                             + abs(math.sin((m / 60 - 5) / 24 * math.pi)) * 1.8, 2)}))
got = anomaly.detect(store(daily))
check("일별 최저가 나흘 연속 내려가면 drift", [(a["parameter"], a["kind"], a.get("days")) for a in got],
      [("do_level", "drift", 4)])

dev = [(NOW - (30 - i) * 10800, {"salinity": 20.0 + (i % 3) * 0.05}) for i in range(30)]
dev.append((NOW, {"salinity": 21.6}))
got = anomaly.detect(store(dev))
check("평소 분포를 3σ 벗어나면 deviation", [(a["parameter"], a["kind"]) for a in got],
      [("salinity", "deviation")])


print("\n④ 설비 운전 권고")
codes = lambda *a, **k: [(x["level"], x["code"]) for x in advice.recommend(*a, **k)]
check("용존산소 3.1 → 즉시 가동", codes({"do_level": 3.1}), [("danger", "do_critical")])
check("용존산소 4.6 → 폭기 증대", codes({"do_level": 4.6}), [("warn", "do_low")])
check("용존산소 6.4 → 권고 없음", codes({"do_level": 6.4}), [])
check("기준 안인데 내려가는 중 → 준비 안내",
      codes({"do_level": 5.8}, [{"parameter": "do_level", "kind": "surge", "direction": "down"}]),
      [("warn", "do_falling")])
check("수온 33 · pH 9.2 → 둘 다 즉시", codes({"temperature": 33.0, "ph": 9.2}),
      [("danger", "ph_critical"), ("danger", "temp_high")])
check("수경재배 모드에서는 비운다", codes({"do_level": 3.1}, [], None, True), [])

surplus = [{"t": NOW - i * 60, "do_level": 8.6, "do_saturation": 118.0} for i in range(90)]
check("한 시간 넘게 산소가 남으면 전력 절감 안내",
      codes({"do_level": 8.6, "do_saturation": 118.0}, [], surplus), [("save", "do_surplus")])
check("잠깐 높은 것만으로는 폭기를 줄이라고 하지 않는다",
      codes({"do_level": 8.6}, [], [{"t": NOW - i * 60, "do_level": 8.6} for i in range(5)]), [])


print("\n⑤ 운전 모드 — 기존 설치가 조용히 바뀌지 않는가")
# 모드는 상호 배타고, 적혀 있지 않으면 기존 설치다. 그 장비들은 [nutrient] enabled
# 로 수경재배 여부를 말해 왔으므로 그것으로 추론한다 — 마이그레이션 없이 동작이
# 바뀌면 현장이 깨진다.
check("모드 미기재 + 양액 켬 → 스마트팜", modes.resolve(None, True), "smartfarm")
check("모드 미기재 + 양액 끔 → 양식장", modes.resolve(None, False), "aquaculture")
check("빈 값도 같게 본다", modes.resolve("", True), "smartfarm")
check("알 수 없는 값은 추론으로 떨어진다", modes.resolve("farm", True), "smartfarm")
check("적혀 있으면 그대로 쓴다",
      [modes.resolve(m, False) for m in modes.MODES], list(modes.MODES))
check("대소문자·공백은 흘려 읽는다", modes.resolve("  MRV ", False), "mrv")
# 추론으로 MRV 가 되는 길은 없다 — 수질을 보던 장비의 기본 화면이 어느 날 전력
# 입력 단말로 바뀌면 안 된다.
check("추론으로는 MRV 가 되지 않는다",
      [modes.resolve(d, n) == "mrv" for d in (None, "", "farm") for n in (True, False)],
      [False] * 6)
check("양액 안내는 스마트팜에만",
      [modes.shows_nutrient(m) for m in modes.MODES], [False, True, False])
check("전력 입력은 MRV 에만",
      [modes.shows_power(m) for m in modes.MODES], [False, False, True])
check("운전 권고는 MRV 에서만 끈다 (스마트팜은 advice.py 가 비운다)",
      [modes.shows_advice(m) for m in modes.MODES], [True, True, False])
check("기본 화면이 수질인 모드", [modes.water_first(m) for m in modes.MODES],
      [True, True, False])


print("\n⑥ 장비 시계 가드 — 틀린 시각의 전력은 기준선을 조용히 오염시킨다")
# RTC 가 없어 정전 뒤 오프라인 재부팅이면 시계가 틀어진다. 그 시각이 박힌 전력은
# 거부되지도 않고 저장돼, 몇 달 뒤 리포트에서야 드러난다.
for year, want in ((1970, False), (2024, False), (2025, True), (2026, True)):
    check(f"{year}년 → {'전송' if want else '거부'}",
          sensor.mrv_clock_ok(datetime(year, 6, 1, tzinfo=timezone.utc)), want)
check("지금 시각은 통과", sensor.mrv_clock_ok(), True)
check("판정 경계는 한 곳에만 있다", sensor.MRV_CLOCK_MIN_YEAR, 2025)


print("\n⑦ 전 구간 — 이력 DB → 이상탐지 → 운전 권고")
rows = store(drop)
last = {k: v for k, v in rows[-1].items() if k != "t"}
check("급락한 수조에 권고가 선다", codes(last, anomaly.detect(rows), rows), [("warn", "do_low")])

print()
if fails:
    print(f"실패 {len(fails)}건:")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print("모두 통과")
