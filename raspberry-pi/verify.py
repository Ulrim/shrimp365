#!/usr/bin/env python3
"""판정 자체점검 — 장비가 내리는 판단이 설계대로인지 확인한다.

    python3 raspberry-pi/verify.py

    python3 raspberry-pi/verify.py --full     # 72시간치 실적재까지

센서도 인터넷도 필요 없다. 시험 데이터를 만들어 이력 DB 에 넣고,
이력 → 이상탐지 → 운전 권고의 전 구간을 돌려 결과를 눈으로 확인한다.
재전송 큐는 정량목표 「72시간 저장」을 떠받치는 자리라 따로 한 절을 둔다.

왜 두는가
  · 판정 숫자(limits.py)가 **웹 알림 기준과 같은지**를 경계값으로 확인한다.
    수조 옆 화면은 주황인데 웹은 조용한 일이 실제로 있었다(수온 26~27 ℃).
  · 이상탐지가 **잡아야 할 것과 잡지 말아야 할 것**을 둘 다 확인한다.
    해 질 녘마다 경보가 뜨는 쪽이 아무것도 안 뜨는 쪽보다 나쁘다.
  · **회선이 끊긴 동안 값을 잃지 않는지**를 확인한다. 72시간 목표는 보관량이
    아니라 "끊겼다 돌아와도 순서대로 다 올라가는가" 이고, 그건 눈으로 볼 수 없다.
  · 성능검증 기록지에 붙일 근거가 된다 — 돌린 결과를 그대로 옮기면 된다.

웹 구현(lib/thresholds.ts 의 detectTrendAnomalies)과의 대조는 이 파일이 하지
않는다. 그쪽은 Node 가 있어야 하므로 개발 PC 에서 따로 맞춰 본다.
"""

from __future__ import annotations

import logging
import math
import os
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import advice          # noqa: E402
import buffer          # noqa: E402
import anomaly         # noqa: E402
import history         # noqa: E402
import limits          # noqa: E402

# --full 이면 72시간치(4,320건)를 실제로 적재한다. 기본값이 아닌 이유는 파이의
# SD카드에서 append 하나가 커밋 하나라, 4,320건이 수십 초로 늘어나기 때문이다.
# 점검 자리에서 35항목을 빠르게 보여 줄 때는 기본으로, 72시간 적재를 직접
# 보여야 할 때는 --full 로 돌린다.
FULL = "--full" in sys.argv

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


print("\n⑤ 서버로 보내는 추세 요약")
check("급락 하나 → 한 줄",
      anomaly.payload_field([{"parameter": "do_level", "kind": "surge", "type": "danger",
                              "value": 3.1037, "digits": 2}]),
      "do_level:surge:danger:3.1")
check("심한 것부터 세 개까지만",
      anomaly.payload_field([{"parameter": f, "kind": "surge", "type": "warning",
                              "value": 1.0, "digits": 1} for f in
                             ("do_level", "ph", "temperature", "salinity")]).count(",") + 1,
      3)
check("판정이 없으면 빈 문자열", anomaly.payload_field([]), "")
# 서버(lib/thresholds.ts 의 parseTrendAlerts)가 이 형식을 읽는다. 형식이 틀어지면
# 장비는 멀쩡히 보내는데 알림만 조용히 사라지므로, 모양을 여기서 묶어 둔다.
check("형식은 항목:종류:등급:값",
      len(anomaly.payload_field([{"parameter": "ph", "kind": "drift", "type": "warning",
                                  "value": 7.4, "digits": 2}]).split(":")), 4)

print("\n⑥ 재전송 큐 — 회선이 끊긴 동안 값을 잃지 않는가")
#
# 정량목표 「데이터 저장 72시간 이상」이 기대는 것은 보관 **용량**이 아니라,
# 끊겼다 돌아왔을 때 **그 사이 값이 순서대로 다 올라가는가** 다. 용량은 상수를
# 보면 되지만 나머지는 돌려 봐야 안다.

QDIR = tempfile.mkdtemp()


def queue(name: str, **kw) -> buffer.Buffer:
    q = buffer.Buffer(os.path.join(QDIR, name), **kw)
    assert q.available, "재전송 큐를 열지 못했습니다"
    return q


def stamp(i: int) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S+0900", time.localtime(1770000000 + i * 60))


# 보관 상한이 72시간을 넘는가 — 1분 주기 기준. 상수만 보면 되는 항목이다.
MINUTES_72H = 72 * 60
check(f"보관 상한 {buffer.DEFAULT_MAX_ROWS:,}건 ≥ 72시간치 {MINUTES_72H:,}건(1분 주기)",
      buffer.DEFAULT_MAX_ROWS >= MINUTES_72H, True)

q = queue("basic.db")
for i in range(50):
    q.append({"temperature": 28.0 + i / 100, "순서": i}, stamp(i))
check("넣은 만큼 쌓인다", q.pending(), 50)

took = q.take(10)
check("오래된 것부터 꺼낸다", [r[2]["순서"] for r in took], list(range(10)))
check("기록 시각이 함께 나온다", took[0][1], stamp(0))
check("값이 그대로 돌아온다(실수·한글 키)", took[3][2], {"temperature": 28.03, "순서": 3})

q.drop([r[0] for r in took])
check("올린 만큼 줄어든다", q.pending(), 40)
check("다음은 그 뒤부터 이어진다", q.take(3)[0][2]["순서"], 10)
q.close()

# 정전·재부팅 — 파일에 남아 있어야 한다. 메모리에만 있으면 그 사이 값이 사라진다.
q = queue("basic.db")
check("재시작해도 남아 있다", q.pending(), 40)
check("재시작 뒤에도 순서가 유지된다", q.take(1)[0][2]["순서"], 10)
q.close()

# 상한을 넘으면 **오래된 것부터** 버린다. 최신 것을 버리면 사고 직전 기록이 날아간다.
#
# 이 구간에서 버리는 것은 **일부러 시킨 것**이라 큐가 내는 경고를 잠깐 막는다.
# 안 막으면 기록지에 "상한 초과" 경고가 다섯 줄 섞여, 진짜 경고와 구분되지 않는다.
logging.getLogger("shrimp365.buffer").setLevel(logging.ERROR)
q = queue("cap.db", max_rows=10)
for i in range(15):
    q.append({"순서": i}, stamp(i))
check("상한을 넘으면 상한만큼만 남는다", q.pending(), 10)
check("버리는 쪽은 오래된 것", [r[2]["순서"] for r in q.take(10)], list(range(5, 15)))
q.close()
logging.getLogger("shrimp365.buffer").setLevel(logging.NOTSET)

# 깨진 행 하나가 전체를 막으면, 그 뒤 72시간치가 영영 못 올라간다.
q = queue("broken.db")
for i in range(3):
    q.append({"순서": i}, stamp(i))
q._conn.execute("insert into readings (recorded_at, payload) values (?, ?)",  # noqa: SLF001
                (stamp(3), "{깨진 JSON"))
q._conn.commit()  # noqa: SLF001
for i in range(4, 6):
    q.append({"순서": i}, stamp(i))
check("깨진 행은 버리고 나머지는 통과시킨다", [r[2]["순서"] for r in q.take(10)], [0, 1, 2, 4, 5])
check("버린 뒤에는 큐에서도 사라진다", q.pending(), 5)
q.close()

if FULL:
    # 72시간치를 실제로 넣고 전량·순서를 본다. 파이에서는 수십 초 걸린다.
    q = queue("full.db")
    t0 = time.monotonic()
    for i in range(MINUTES_72H):
        q.append({"순서": i}, stamp(i))
    took = time.monotonic() - t0
    check(f"72시간치 {MINUTES_72H:,}건 전량 보존 ({took:.1f}초)", q.pending(), MINUTES_72H)
    check("72시간치의 맨 앞이 가장 오래된 것", q.take(1)[0][2]["순서"], 0)
    q.close()
else:
    print("  ....  72시간치 실적재는 건너뜀 — 보이시려면 --full 로 다시 돌리세요")

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
