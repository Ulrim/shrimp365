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

import atexit
import configparser
import json
import logging
import math
import os
import re
import shutil
import sys
import tempfile
import time
import types
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import advice          # noqa: E402
import buffer          # noqa: E402
import anomaly         # noqa: E402
import history         # noqa: E402
import field_env       # noqa: E402
import wireless        # noqa: E402
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
import webui          # noqa: E402

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


_TMPS: list[str] = []


def tmpdir() -> Path:
    """시험용 임시 디렉토리. **끝에 치운다** — 자체점검은 현장 장비에서 몇 번이고
    다시 돌리는 파일이고, 치우지 않으면 /tmp 에 디렉토리가 쌓인다."""
    d = tempfile.mkdtemp(prefix="shrimp365-verify-")
    _TMPS.append(d)
    return Path(d)


@atexit.register
def _clean_tmps() -> None:
    # atexit 로 둔다 — 실패로 sys.exit(1) 할 때도 치워야 한다.
    for d in _TMPS:
        shutil.rmtree(d, ignore_errors=True)


def store(points: list[tuple[int, dict]]) -> list[dict]:
    """시험 데이터를 실제 이력 DB 에 넣었다 다시 읽는다 — 저장 경로까지 함께 본다."""
    h = history.History(str(tmpdir() / "history.db"))
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

print("\n⑥-a 운전 모드 — 기존 설치가 조용히 바뀌지 않는가")
# 모드는 상호 배타고, 적혀 있지 않으면 기존 설치다. 수집기 1.10 의 이름(shrimp|agriculture)을
# 그대로 쓰고 이 모듈이 먼저 쓰던 이름은 읽을 때 맞춘다. 양액 플래그로 추론하지 않는다 —
# 양식장 화면에서 양액 관리만 켠 장비의 화면 이름·색이 바뀌면 안 된다.
check("모드 미기재 → 양식장", modes.resolve(None, True), "shrimp")
check("빈 값도 같게 본다", modes.resolve("", True), "shrimp")
check("알 수 없는 값은 양식장", modes.resolve("farm", True), "shrimp")
check("적혀 있으면 그대로 쓴다",
      [modes.resolve(m, False) for m in modes.MODES], list(modes.MODES))
check("옛 이름(aquaculture·smartfarm)은 같은 뜻으로 읽는다",
      (modes.resolve("aquaculture", False), modes.resolve("smartfarm", False)),
      ("shrimp", "agriculture"))
check("대소문자·공백은 흘려 읽는다", modes.resolve("  MRV ", False), "mrv")
# 추론으로 MRV 가 되는 길은 없다 — 수질을 보던 장비의 기본 화면이 어느 날 전력
# 입력 단말로 바뀌면 안 된다.
check("추론으로는 MRV 가 되지 않는다",
      [modes.resolve(d, n) == "mrv" for d in (None, "", "farm") for n in (True, False)],
      [False] * 6)
check("양액 안내는 MRV 단말에서만 끈다",
      [modes.shows_nutrient(m) for m in modes.MODES], [True, True, False])
check("전력 입력은 MRV 에만",
      [modes.shows_power(m) for m in modes.MODES], [False, False, True])
check("운전 권고는 MRV 에서만 끈다 (스마트팜은 advice.py 가 비운다)",
      [modes.shows_advice(m) for m in modes.MODES], [True, True, False])
check("기본 화면이 수질인 모드", [modes.water_first(m) for m in modes.MODES],
      [True, True, False])


print("\n⑥-b 장비 시계 가드 — 틀린 시각의 전력은 기준선을 조용히 오염시킨다")
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


# ── 이하 ⑧⑨⑩ 은 "코드가 서로 어긋나지 않는가" 를 본다. 판정과 달리 센서도
#    데이터도 필요 없고, 한 번 어긋나면 현장에서 조용히 터지는 종류다.

print("\n⑧ 꾸러미 목록 — 수집기가 쓰는 모듈이 장비에 실제로 들어가는가")
# modes.py 가 release.PAYLOAD 와 install.sh 의 MODULES 에서 빠져 있어, 현장 장비의
# 모드가 양식장으로 굳고 「MRV 연결」 메뉴가 아예 뜨지 않은 일이 있었다. 선택
# import 는 빠진 모듈을 조용히 None 으로 만들기 때문에 장비는 오류 하나 내지 않는다.
# 그래서 사람의 기억이 아니라 여기서 대조한다.
_SRC = Path(__file__).resolve().parent
_RELEASE, _INSTALL = _SRC / "release.py", _SRC / "install.sh"


def repo_modules() -> set[str]:
    """저장소 안의 모듈 이름(확장자 없이)."""
    return {p.stem for p in _SRC.glob("*.py")}


def imported_repo_modules(path: Path, known: set[str]) -> set[str]:
    """그 파일이 import 하는 **저장소 안** 모듈. 선택 import 도 함께 센다."""
    import ast
    found: set[str] = set()
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            for alias in node.names:
                found.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            found.add(node.module.split(".")[0])
    return {name for name in found if name in known}


def payload_names() -> list[str]:
    """release.py 의 PAYLOAD. import 하지 않고 소스에서 읽는다 — release.py 는
    cryptography 를 요구하고 그 꾸러미는 장비에 없다."""
    import ast
    tree = ast.parse(_RELEASE.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id == "PAYLOAD" for t in node.targets):
            return [e.value for e in node.value.elts          # type: ignore[attr-defined]
                    if isinstance(e, ast.Constant) and isinstance(e.value, str)]
    return []


def modules_names() -> list[str]:
    """install.sh 의 MODULES=( … )."""
    import re
    text = _INSTALL.read_text(encoding="utf-8")
    m = re.search(r"^MODULES=\(([^)]*)\)", text, re.MULTILINE)
    return m.group(1).split() if m else []


if not (_RELEASE.exists() and _INSTALL.exists()):
    # 장비(/opt/shrimp365)에는 배포 도구가 없다. 거기서는 볼 것이 없으므로 건너뛴다.
    print("  건너뜀  release.py·install.sh 가 없는 설치본입니다(장비에서는 정상)")
else:
    known = repo_modules()
    needed = (imported_repo_modules(_SRC / "shrimp365_sensor.py", known)
              | imported_repo_modules(_SRC / "verify.py", known))
    # 투야 블루투스 등록 도구는 전용 파이썬(bleak·tinytuya)이 필요해 setup-tuya-ble.sh 가
    # 따로 설치한다(release.SETUP_PAYLOAD). 수집기는 import 하지 않고 자체점검만 불러 본다.
    needed -= {"tuya_ble_setup"}
    payload, modules = set(payload_names()), set(modules_names())
    check("수집기·자체점검이 쓰는 모듈이 전부 release.py 의 PAYLOAD 에 있다",
          sorted(f"{n}.py" for n in needed if f"{n}.py" not in payload), [])
    check("수집기·자체점검이 쓰는 모듈이 전부 install.sh 의 MODULES 에 있다",
          sorted(f"{n}.py" for n in needed if f"{n}.py" not in modules), [])
    # 두 목록이 어긋나면 새로 설치한 장비와 업데이트한 장비가 서로 다른 파일
    # 집합으로 돈다 — 재현되지 않는 버그의 온상이다.
    check("PAYLOAD 와 MODULES 가 같은 모듈 집합이다", sorted(payload ^ modules), [])
    check("modes.py 가 꾸러미에 있다 (없으면 MRV 모드를 고를 수 없다)",
          ("modes.py" in payload, "modes.py" in modules), (True, True))


print("\n⑨ 전력 입력 가드 — 시계가 밀린 뒤 처음 쓰는 계측기도 막히는가")
# mrv_clock_ok 는 연도만 본다. RTC 없는 파이는 1970년이 아니라 timesyncd 가 저장해
# 둔 며칠~몇 주 전 시각으로 올라오는 쪽이 흔하고, 그 값은 연도 검사를 통과한다.
# 계측기별 가드는 그 계측기를 한 번이라도 쓴 뒤에만 들으므로 전역 최대 전송 시각을
# 함께 본다.
_lasts = sensor.MrvLastReadings(str(tmpdir() / "mrv-last.json"))
check("보낸 적이 없으면 막지 않는다", sensor.mrv_clock_regressed(_lasts, "2026-05-01T00:00:00+00:00"), False)
_lasts.put("mtr_blower", "2026-05-01T00:00:00+00:00", 128450.6)
check("같은 시각은 통과", sensor.mrv_clock_regressed(_lasts, "2026-05-01T00:00:00+00:00"), False)
check("30초 되돌아간 것은 통과(NTP 보정 여유)",
      sensor.mrv_clock_regressed(_lasts, "2026-04-30T23:59:30+00:00"), False)
check("2분 되돌아가면 거부", sensor.mrv_clock_regressed(_lasts, "2026-04-30T23:58:00+00:00"), True)
# **다른** 계측기로 보내도 막혀야 한다 — 이것이 계측기별 가드가 못 잡던 구멍이다.
check("한 달 밀린 시계는 처음 쓰는 계측기에서도 거부",
      sensor.mrv_clock_regressed(_lasts, "2026-04-01T09:00:00+00:00"), True)
check("전역 최대 시각은 계측기와 무관하다", _lasts.max_ts(), "2026-05-01T00:00:00+00:00")
# max_ts 를 적지 않던 옛 파일에서도 가드가 들어야 한다.
_old = tmpdir() / "mrv-last.json"
_old.write_text('{"meters": {"m1": {"value": 10.0, "ts": "2026-05-01T00:00:00+00:00",'
                ' "last_ts": "2026-05-01T00:00:00+00:00"}}}', encoding="utf-8")
check("max_ts 가 없는 옛 파일은 계측기 시각에서 끌어낸다",
      sensor.MrvLastReadings(_old).max_ts(), "2026-05-01T00:00:00+00:00")

# 서버가 200 으로 "전부 거부" 를 알려 온 응답을 성공으로 읽지 않는가.
# (app/api/mrv/ingest/readings/route.ts — 응답은 항상 200 이고 결과는 본문에 있다)
check("보낸 건수만큼 받아들여졌는지로 판정한다",
      [sensor._mrv_taken({"accepted": 2, "deduped": 0}),
       sensor._mrv_taken({"accepted": 0, "deduped": 1}),
       sensor._mrv_taken({"accepted": 0, "deduped": 0})], [2, 1, 0])
check("거부 사유 첫 줄을 화면에 넘긴다",
      sensor._mrv_rejected({"rejected": [{"index": 0, "reason": "out of scope"}]}),
      (1, "out of scope"))


print("\n⑩ 설정 파일 쓰기 — 끝 개행이 없는 파일에 키를 잃지 않는가")
# [mrv] 가 마지막 구간이고 파일이 개행으로 끝나지 않으면, 적으려는 키가 마지막 줄에
# 그대로 이어 붙어 **키가 사라지고 원래 값까지 깨진다**(함수는 True 를 돌려주므로
# 화면은 "연결 완료" 를 적는다).
_cfgdir = tmpdir()


def _written(name: str, text: str, writer) -> configparser.ConfigParser:
    path = _cfgdir / name
    path.write_text(text, encoding="utf-8")
    ok = writer(path)
    if not ok:
        fails.append(f"{name}: 설정 파일을 쓰지 못했습니다")
    parsed = configparser.ConfigParser()
    parsed.read_string(path.read_text(encoding="utf-8"))
    return parsed


_mrv = _written(
    "mrv.ini",
    "[server]\ndevice_key = DK\n\n[mrv]\nbuffer_path = /x/y.db",   # 끝 개행 없음
    lambda p: sensor.save_mrv_api_key(p, "KEY123", "site_1"))
check("[mrv] api_key 가 남는다", _mrv.get("mrv", "api_key", fallback=None), "KEY123")
check("[mrv] site_id 가 남는다", _mrv.get("mrv", "site_id", fallback=None), "site_1")
check("앞 줄(buffer_path)이 깨지지 않는다",
      _mrv.get("mrv", "buffer_path", fallback=None), "/x/y.db")

_nut = _written(
    "nutrient.ini",
    "[device]\nmode = smartfarm\n\n[nutrient]\ntarget_ec = 1.8",    # 끝 개행 없음
    lambda p: sensor.save_nutrient(p, {"enabled": True}))
check("[nutrient] enabled 가 남는다", _nut.get("nutrient", "enabled", fallback=None), "true")
check("앞 줄(target_ec)이 깨지지 않는다",
      _nut.get("nutrient", "target_ec", fallback=None), "1.8")

# 전력 보관함과 수질 보관함이 같은 파일이면 수질 전송이 영구히 막힌다.
check("같은 경로를 같다고 본다",
      sensor._same_path("/var/lib/shrimp365/queue.db", "/var/lib/shrimp365/./queue.db"), True)
check("다른 경로는 다르다고 본다",
      sensor._same_path("/var/lib/shrimp365/queue.db", "/var/lib/shrimp365/mrv-power.db"), False)

print("\n⑪ 설정 파일 판정 — 한 글자가 장비를 재시작 고리에 넣지 않는가")
# 세 가지가 여기서 막힌다. 셋 다 "저장했습니다" 를 적으면서 다음 부팅을 깨뜨린다.
#   · 구간 머리글에 꼬리 주석이 붙으면([mrv]   ; 탄소 MRV) 저장 코드가 구간을 못 찾고
#     파일 끝에 [mrv] 를 하나 더 만들어 붙인다 → 다음 부팅의 load_config 가
#     DuplicateSectionError 로 터지고, 서비스가 Restart=always / RestartSec=15 이므로
#     장비가 15초마다 재시작하는 고리에 들어간다(수질 수집·전송까지 멈춘다).
#   · 항목 이름을 startswith 로 보면 visible_meters_note 같은 사람이 적은 줄이
#     통째로 사라진다.
#   · 값에 섞인 `%` 는 기본 BasicInterpolation 이 치환 문법으로 보고 **꺼낼 때** 터진다.
# 판정은 _cfg_section / _cfg_key 한 곳에만 있어야 한다. 이 칸이 그 약속을 지킨다.

check("꼬리 주석이 붙은 머리글도 구간으로 본다",
      [sensor._cfg_section("[mrv]   ; 탄소 MRV"), sensor._cfg_section("[MRV] # 메모"),
       sensor._cfg_section("  [sensors]  ")], ["mrv", "mrv", "sensors"])
check("주석·항목 줄은 머리글이 아니다",
      [sensor._cfg_section("; [mrv] 아래는 탄소 MRV"), sensor._cfg_section("api_key = k"),
       sensor._cfg_section("")], [None, None, None])
check("항목 이름은 정확히 본다",
      [sensor._cfg_key("visible_meters = a, b"),
       sensor._cfg_key("visible_meters_note = 매일 읽는 것"),
       sensor._cfg_key("  API_KEY  =  k  ")],
      ["visible_meters", "visible_meters_note", "api_key"])
check("주석·머리글·값 없는 줄은 항목이 아니다",
      [sensor._cfg_key("; api_key = k"), sensor._cfg_key("# x = y"),
       sensor._cfg_key("[mrv]"), sensor._cfg_key("api_key")], [None, None, None, None])

# **configparser 와 같은 구간 집합을 보는가.** 두 판정이 어긋나는 것이 위 사고의 뿌리다.
_SECT_SAMPLE = ("; 머리말\n[server]\nendpoint = x\n\n[mrv]   ; 탄소 MRV\n"
                "api_key = k\n[webui] # 화면\nport = 8080\n")
_cp = configparser.ConfigParser(interpolation=None)
_cp.read_string(_SECT_SAMPLE)
check("configparser 와 같은 구간을 본다",
      [sensor._cfg_section(ln) for ln in _SECT_SAMPLE.splitlines()
       if sensor._cfg_section(ln) is not None],
      _cp.sections())

# 꼬리 주석이 붙은 [mrv] 에 저장 → **[mrv] 가 두 번 생기지 않고**, 다시 읽힌다.
for _name, _writer, _key, _want in (
        ("visible-tail.ini", lambda q: sensor.save_mrv_visible_meters(q, ["m_total"]),
         "visible_meters", "m_total"),
        ("apikey-tail.ini", lambda q: sensor.save_mrv_api_key(q, "KEY9", "site_9"),
         "api_key", "KEY9")):
    _path = _cfgdir / _name
    _path.write_text("[server]\ndevice_key = DK\n\n[mrv]   ; 탄소 MRV\n"
                     "buffer_path = /x/y.db\n", encoding="utf-8")
    _ok = _writer(_path)
    _text = _path.read_text(encoding="utf-8")
    check(f"{_name}: 꼬리 주석이 붙은 [mrv] 를 두 번 만들지 않는다",
          (_ok, _text.count("[mrv]")), (True, 1))
    # 다음 부팅과 **같은 길**로 읽는다. 중복 구간이면 여기서 DuplicateSectionError 다.
    try:
        _re = sensor.load_config(_path)
        check(f"{_name}: 다음 부팅이 이 파일을 읽을 수 있다",
              (_re.get("mrv", _key, fallback=None), _re.get("mrv", "buffer_path", fallback=None)),
              (_want, "/x/y.db"))
    except configparser.Error as exc:
        check(f"{_name}: 다음 부팅이 이 파일을 읽을 수 있다", f"{type(exc).__name__}", "예외 없음")

# 사람이 적어 둔 옆 항목을 덮지 않는가(startswith 로 보면 통째로 사라진다).
_note = _cfgdir / "note.ini"
_note.write_text("[mrv]\nvisible_meters = m_old\nvisible_meters_note = 매일 읽는 것\n"
                 "api_key = K\napi_key_note = 2026-10 발급\n", encoding="utf-8")
sensor.save_mrv_visible_meters(_note, ["m_total"])
sensor.save_mrv_api_key(_note, "K2", "S2")
_noted = sensor.load_config(_note)
check("옆 항목(visible_meters_note)을 덮지 않는다",
      _noted.get("mrv", "visible_meters_note", fallback=None), "매일 읽는 것")
check("옆 항목(api_key_note)을 덮지 않는다",
      _noted.get("mrv", "api_key_note", fallback=None), "2026-10 발급")
check("고치려던 항목은 바뀌었다",
      (_noted.get("mrv", "visible_meters", fallback=None),
       _noted.get("mrv", "api_key", fallback=None)), ("m_total", "K2"))

# 값에 섞인 `%` 한 글자. load_config 가 interpolation=None 으로 읽지 않으면
# 여기서 InterpolationSyntaxError 가 나고, 그 자리가 main() 본문이라 재시작 고리가 된다.
_pct = _cfgdir / "percent.ini"
_pct.write_text("[mrv]\nvisible_meters = m%20total\napi_key = a%b%c\n", encoding="utf-8")
try:
    _pcfg = sensor.load_config(_pct)
    check("값에 섞인 `%` 를 읽고도 터지지 않는다",
          (_pcfg.get("mrv", "visible_meters"), _pcfg.get("mrv", "api_key")),
          ("m%20total", "a%b%c"))
except configparser.Error as exc:
    check("값에 섞인 `%` 를 읽고도 터지지 않는다", type(exc).__name__, "예외 없음")


print("\n⑫ 장비 화면 — 「이 장비가 읽을 계측기」 고르기 화면이 막다른 길이 아닌가")
# 화면 쪽 판단은 webui.PAGE 안의 자바스크립트다. 돌려 볼 수 없으므로 **구조**를 본다.
# 되돌아가기 쉬운 한 줄이 기능 전체를 막았던 자리들이다:
#   · 저장된 목록을 통째로 들고 있으면(r.visible.slice()) 서버 목록에서 사라진 id 를
#     끌 토글이 없는데 저장은 그 id 까지 보내고, 서버가 목록 밖 id 를 거부해
#     **무엇을 눌러도 저장이 100% 실패한다.** 고치는 길은 root 로 설정 파일을
#     손보는 것뿐인데, 경고문은 바로 그 화면에서 다시 고르라고 지시한다.
#   · 거르개가 무력화된 상태에서 [전체 보기] 를 두면 눌러도 아무 일이 없다.
_PAGE = webui.PAGE


def _i18n_langs(key: str) -> list[str]:
    """PAGE 안 I18N 표에서 그 키가 가진 언어들. 자바스크립트 리터럴이라 글자로 읽는다.
    번역이 한 언어만 빠져도 그 언어 작업자에게는 키 이름이 그대로 뜬다."""
    m = re.search(r"^  " + re.escape(key) + r":\{(.*)$", _PAGE, re.MULTILINE)
    return re.findall(r'([a-z]{2}):"', m.group(1)) if m else []

check("고른 목록을 지금 목록으로 거른다(mrvVisKeep)",
      ("function mrvVisKeep(" in _PAGE,
       "mrvVisSel = mrvVisKeep(" in _PAGE), (True, True))
check("저장된 목록을 통째로 들고 있지 않다",
      ("r.visible.slice()" in _PAGE, "mrv_visible || []).slice()" in _PAGE), (False, False))
check("개수는 유령 id 를 세지 않는다(mrvVisPicked)",
      ("function mrvVisPicked(" in _PAGE, "mrvVisPicked(d)" in _PAGE), (True, True))
# 버튼과 안내문 **둘 다** 이 판정을 봐야 한다. 하나만 바꿔 두면 거르개가 무력화된
# 화면에 눌러도 아무 일이 없는 [전체 보기] 가 남는다 — 그래서 자리 수를 함께 센다.
check("[전체 보기] 와 안내문이 실제로 거르는 중일 때만 뜬다(pwrFiltering)",
      ("function pwrFiltering(" in _PAGE, _PAGE.count("      (pwrFiltering()"),
       "(pwrVis.length" in _PAGE), (True, 2, False))
check("저장 실패 사유를 번역한다(errText)",
      ("function errText(" in _PAGE, 'errText(r, "save_fail")' in _PAGE), (True, True))
check("24대 상한 번역이 4언어로 있다",
      sorted(_i18n_langs("pw_err_vis_max")), ["en", "id", "ko", "vi"])

# 수집기가 돌려주는 사유(code)마다 4언어 번역이 있는가. **code 없이 한국어 원문만
# 보내면** 화면은 그것을 그대로 찍고, 베트남어·인도네시아어 작업자는 왜 실패했는지
# 읽을 수 없다(거르개 저장 실패가 한국어로만 뜨던 자리다). 새 사유를 넣는 사람이
# 번역을 빠뜨리면 여기서 걸린다.
_CODES = sorted(set(re.findall(r'"code":\s*"([a-z_]+)"',
                               (_SRC / "shrimp365_sensor.py").read_text(encoding="utf-8"))))
check("수집기가 돌려주는 사유를 4언어로 적어 두었다",
      [c for c in _CODES if sorted(_i18n_langs("pw_err_" + c)) != ["en", "id", "ko", "vi"]],
      [])

# 「사라진 계측기」 판정. main() 안에 두면 자체점검이 손댈 수 없어 되돌려도 울지 않는다.
_ITEMS = [{"id": "m_total"}]
check("받은 적이 없으면 사라졌다고 말하지 않는다",
      sensor.mrv_missing_for_screen(False, [], ["m_total", "m_gone"]), [])
check("받았는데 0건이면 고른 것이 전부 사라진 것이다",
      sensor.mrv_missing_for_screen(True, [], ["m_total"]), ["m_total"])
check("받은 목록에 없는 것만 집어낸다",
      sensor.mrv_missing_for_screen(True, _ITEMS, ["m_total", "m_gone"]), ["m_gone"])


print("\n⑬ 전력 자료유형 — 실측과 계산값이 DB 에서 구분되는가")
# 사용자가 준 MRV 계산표의 전력은 계량기가 잰 값이 아니라 명판 정격으로 낸 값이었다
# (전력실측여부 = false). 그 구분이 없으면 심사에서 "이 기준선의 전력이 실측인가" 에
# 답할 수 없다. 이 단말은 계량기 옆 창구이므로 metered 를 **스스로 선언한다** —
# 서버가 "장비에서 왔으니 실측이겠지" 하고 가정하게 두지 않는다.
check("서버와 같은 세 값만 안다", sensor.MRV_BASES, ("metered", "calculated", "estimated"))
check("이 단말의 기본값은 실측", sensor.MRV_BASIS_DEFAULT, "metered")

# 설정 파일 읽기. **적지 않은 기존 설정 파일도 실측이 된다** — 이 단말의 성격이
# 바뀐 적이 없으므로, 업데이트가 옛 장비의 자료유형을 미기재로 떨어뜨리면 안 된다.
check("적지 않으면 실측", sensor.mrv_parse_basis(""), "metered")
check("공백만 있어도 실측", sensor.mrv_parse_basis("   "), "metered")
check("None 도 실측", sensor.mrv_parse_basis(None), "metered")
check("적어 둔 값을 읽는다", sensor.mrv_parse_basis("calculated"), "calculated")
check("어림값도 읽는다", sensor.mrv_parse_basis("estimated"), "estimated")
check("대소문자·공백은 흘려 읽는다", sensor.mrv_parse_basis("  Calculated "), "calculated")
# 꼬리 주석·따옴표는 mrv_parse_visible 과 같은 이유로 뗀다 — config.example.ini 가
# 손 편집을 권하므로 이 모양이 현실적으로 들어온다. 떼지 않으면 값이 전부 모르는
# 값으로 떨어져, 계산값으로 설정한 현장이 조용히 실측으로 기록된다.
check("꼬리 주석(;)을 떼고 읽는다",
      sensor.mrv_parse_basis("calculated  ; 명판 정격으로 계산"), "calculated")
check("꼬리 주석(#)을 떼고 읽는다", sensor.mrv_parse_basis("estimated # 메모"), "estimated")
check("따옴표를 떼고 읽는다", sensor.mrv_parse_basis('"calculated"'), "calculated")
# 모르는 값에서 입을 닫지 않는 이유: 오타 하나로 그 현장의 증빙 입력이 끊기는 것이,
# 이 단말의 실제 성격(실측)으로 적는 것보다 나쁘다. 대신 로그에 남는다.
check("모르는 값은 기본값으로 내려온다", sensor.mrv_parse_basis("metered_ish"), "metered")
check("서버의 출처(source) 값을 자료유형으로 쓰지 않는다",
      sensor.mrv_parse_basis("manual"), "metered")

# 옛 보관분(이 칸이 없는 payload)의 재전송. 그 건들도 작업자가 계량기를 읽어 넣은
# 값이므로, 비워 둔 채 올려 서버에 '미기재(null)' 로 남기지 않는다.
_old_row = {"source": "manual", "readings": [
    {"meter_id": "m1", "ts": "2026-10-20T00:00:00+00:00", "value": 1000.0,
     "reading_kind": "cumulative_kwh"},
    {"meter_id": "m1", "ts": "2026-10-20T01:00:00+00:00", "value": 1010.0,
     "reading_kind": "cumulative_kwh"}]}
check("칸이 없는 옛 보관분을 채워 보낸다",
      [r.get("measurement_basis") for r in sensor.mrv_fill_basis(_old_row)["readings"]],
      ["metered", "metered"])
check("채우면서 다른 칸을 잃지 않는다",
      sorted(sensor.mrv_fill_basis(_old_row)["readings"][0]),
      ["measurement_basis", "meter_id", "reading_kind", "ts", "value"])
check("payload 의 source 를 건드리지 않는다",
      sensor.mrv_fill_basis(_old_row)["source"], "manual")
check("원본 payload 를 고쳐 쓰지 않는다(보관함 행은 그대로)",
      "measurement_basis" in _old_row["readings"][0], False)
# **이미 적혀 있는 행은 덮지 않는다** — 그 행이 선언한 것이 그 행의 진실이다.
# 덮으면 계산값으로 쌓아 둔 보관분이 회선 복구와 함께 실측으로 바뀐다.
check("이미 적힌 자료유형은 덮지 않는다",
      sensor.mrv_fill_basis(
          {"readings": [{"measurement_basis": "calculated"}]}, "metered"
      )["readings"][0]["measurement_basis"], "calculated")
check("모르는 값이 적힌 행은 고쳐 쓴다",
      sensor.mrv_fill_basis(
          {"readings": [{"measurement_basis": "guessed"}]}, "estimated"
      )["readings"][0]["measurement_basis"], "estimated")
check("채울 값이 모르는 값이면 기본값으로 적는다",
      sensor.mrv_fill_basis({"readings": [{}]}, "nonsense"
                            )["readings"][0]["measurement_basis"], "metered")
# 모양이 깨진 행에서 터지지 않아야 한다. 재전송 고리 안에서 예외가 나면 큐가 그 행에
# 영원히 막히고, 뒤에 쌓인 지침이 전부 올라가지 못한다(mrv_flush 는 그 행을 치운다).
check("readings 가 없는 payload 도 그대로 돌려준다",
      sensor.mrv_fill_basis({"source": "manual"}), {"source": "manual"})
check("readings 가 목록이 아니어도 터지지 않는다",
      sensor.mrv_fill_basis({"readings": "x"}), {"readings": "x"})
check("dict 가 아닌 행은 손대지 않는다",
      sensor.mrv_fill_basis({"readings": [None, 3]})["readings"], [None, 3])
check("payload 가 dict 가 아니어도 터지지 않는다", sensor.mrv_fill_basis(None), None)

# 화면이 자료유형을 4언어로 적는가. 한 언어가 빠지면 그 언어로 쓰는 현장에서만
# "지금 넣는 값이 무엇으로 기록되는가" 가 사라진다 — 한국어로 보는 쪽은 모른다.
check("세 자료유형을 4언어로 적어 두었다",
      [b for b in sensor.MRV_BASES
       if sorted(_i18n_langs("pw_basis_" + b)) != ["en", "id", "ko", "vi"]], [])
check("짧은 이름도 4언어로 적어 두었다",
      [b for b in sensor.MRV_BASES
       if sorted(_i18n_langs("pw_basis_" + b + "_s")) != ["en", "id", "ko", "vi"]], [])
check("자료유형 딱지도 4언어", sorted(_i18n_langs("pw_basis")), ["en", "id", "ko", "vi"])


print("\n⑭ 환경·기상 센서 — 수집기 CSV 에서 화면·서버 값 고르기")
import datetime as _dt  # noqa: E402
zdir = Path(tempfile.mkdtemp(prefix="field-env-"))
znow = _dt.datetime(2026, 10, 17, 0, 10)
HEAD = "ts,zone,sensor_id,variable,value,unit,quality\n"
(zdir / "zigbee_20261016.csv").write_text(
    HEAD + "2026-10-16T23:58:00,treatment,CN-T1,rh,80.0,%,ok\n", encoding="utf-8")
(zdir / "zigbee_20261017.csv").write_text(
    HEAD +
    "2026-10-17T00:05:00,treatment,CN-T1,canopy_temp,11.0,degC,ok\n"
    "2026-10-17T00:08:00,treatment,CN-T2,canopy_temp,12.0,degC,ok\n"
    "2026-10-17T00:09:00,treatment,CN-T1,rh,84.0,%,ok\n"
    "2026-10-17T00:09:00,treatment,CN-T2,rh,150.0,%,range\n"
    "2026-10-17T00:09:00,control,SOIL-C1,soil_moisture,40.0,%,ok\n"
    "2026-10-16T22:00:00,treatment,SOIL-T1,soil_moisture,10.0,%,ok\n", encoding="utf-8")
(zdir / "rtl433_20261016.csv").write_text(
    HEAD + "2026-10-16T23:50:00,mast,WS90-01,rain,5.0,mm,ok\n", encoding="utf-8")
(zdir / "rtl433_20261017.csv").write_text(
    HEAD +
    "2026-10-17T00:01:00,mast,WS90-01,rain,0.4,mm,ok\n"
    "2026-10-17T00:06:00,mast,WS90-01,rain,0.2,mm,ok\n"
    "2026-10-17T00:09:00,mast,WS90-01,wind_speed,3.2,m/s,ok\n"
    "2026-10-17T00:09:00,mast,WS90-01,wind_gust_window,6.8,m/s,ok\n"
    "2026-10-17T00:09:00,mast,WS90-01,wind_dir,350,deg,ok\n"
    "2026-10-17T00:09:00,mast,WS90-02,wind_dir,10,deg,ok\n", encoding="utf-8")
# 에코윗 게이트웨이 수집기도 다른 수집기처럼 현지 시각으로 적는다(openfield ecowitt.py 가
# dateutc 를 바꿔 적는다). 그 파일도 같이 읽는지 본다.
(zdir / "ecowitt_20261017.csv").write_text(
    HEAD + "2026-10-17T00:08:00,mast,GW-01,pressure_hpa,1012.4,hPa,ok\n", encoding="utf-8")

fe = field_env.FieldEnv(zdir)
env = fe.read(now=znow)
check("센서 둘의 초관부 온도를 평균한다", (env["air_temp"]["value"], env["air_temp"]["sensors"]), (11.5, 2))
check("기온이 없으면 초관부 온도라고 밝힌다", env["air_temp"]["var"], "canopy_temp")
check("같은 센서는 가장 최근 값 · 범위 밖 값은 뺀다", env["humidity"]["value"], 84.0)
check("30분 넘은 값은 쓰지 않는다", env["soil_moisture"]["value"], 40.0)
check("가장 오래된 값의 나이를 알린다", env["air_temp"]["age_min"], 5)
check("오늘 강수는 오늘 것만 더한다(어제 5mm 제외)", env["rain_day"]["value"], 0.6)
check("돌풍은 3초값이 없으면 28초 창 최댓값", (env["wind_gust"]["value"], env["wind_gust"]["var"]),
      (6.8, "wind_gust_window"))
check("풍향 350°·10° 의 평균은 0°(180° 가 아니다)", env["wind_dir"]["value"] % 360, 0)
check("에코윗 게이트웨이 파일도 읽는다(기압)", (env["pressure"]["value"], env["pressure"]["age_min"]), (1012.4, 2))
check("센서별 값: 이름순·나이와 함께", env["air_temp"]["each"],
      [{"id": "CN-T1", "value": 11.0, "age_min": 5}, {"id": "CN-T2", "value": 12.0, "age_min": 2}])
check("센서별 값: 끊긴 센서는 값 없이 남긴다(평균에서 빠진 것을 찾게)", env["soil_moisture"]["each"],
      [{"id": "SOIL-C1", "value": 40.0, "age_min": 1}, {"id": "SOIL-T1", "value": None, "age_min": 130}])
_eh = history.History(os.path.join(tempfile.mkdtemp(), "env.db"))
_t = int(time.time()) - 3600
_e1 = {"air_temp": {"each": [{"id": "TH-01", "value": 20.0}, {"id": "TH-02", "value": 22.0},
                             {"id": "TH-03", "value": None}]}}
check("센서별 이력: 끊긴 센서(None)는 남기지 않는다", _eh.record_env(_e1, ts=_t), True)
check("센서별 이력: 5분 안에 다시 오면 건너뛴다", _eh.record_env(_e1, ts=_t + 60), False)
_eh.record_env({"air_temp": {"each": [{"id": "TH-01", "value": 21.0}, {"id": "TH-02", "value": 23.0}]}}, ts=_t + 600)
_es = _eh.env_series("air_temp", 6)
check("센서별 그래프: 센서마다 선, 평균선, 최저·최고",
      ([x["id"] for x in _es["sensors"]], [len(x["points"]) for x in _es["sensors"]],
       [p[1] for p in _es["avg"]], _es["min"], _es["max"], _es["count"]),
      (["TH-01", "TH-02"], [2, 2], [21.0, 22.0], 20.0, 23.0, 4))
check("센서별 그래프: 모르는 칸은 빈 값", _eh.env_series("ph", 6)["count"], 0)
check("서버로는 2대 이상 살아 있는 칸만, 끊긴 센서는 빼고",
      field_env.payload_each(env), {"air_temp": [{"id": "CN-T1", "v": 11.0}, {"id": "CN-T2", "v": 12.0}]})
with (zdir / "zigbee_20261017.csv").open("a", encoding="utf-8") as fh:
    fh.write("2026-10-17T00:10:00,treatment,CN-T1,rh,86.0,%,ok\n2026-10-17T00:10:00,treat")
env = fe.read(now=znow)
check("새로 붙은 줄만 이어 읽는다", env["humidity"]["value"], 86.0)
check("덜 쓰인 마지막 줄은 다음에 읽는다", fe._offset[zdir / "zigbee_20261017.csv"][1] <
      (zdir / "zigbee_20261017.csv").stat().st_size, True)
# 수집기가 파일을 새로 만들어 같은 줄을 다시 쓰면(재시작·잘라내기) 처음부터 다시 읽는다.
# 이미 더한 비를 또 더하면 안 된다.
_rtl = zdir / "rtl433_20261017.csv"
_body = _rtl.read_text(encoding="utf-8")
_rtl.write_text("", encoding="utf-8")        # 잘라냄(logrotate copytruncate 와 같다)
fe.read(now=znow)
_rtl.write_text(_body, encoding="utf-8")     # 수집기가 같은 줄을 다시 씀
check("파일을 다시 읽어도 오늘 강수를 두 번 세지 않는다", fe.read(now=znow)["rain_day"]["value"], 0.6)
# 같은 WS90 을 rtl433 과 에코윗 게이트웨이 둘로 받아도(같은 센서 이름) 비는 두 배가 되지 않는다.
with (zdir / "ecowitt_20261017.csv").open("a", encoding="utf-8") as fh:
    fh.write("2026-10-17T00:01:00,mast,WS90-01,rain,0.4,mm,ok\n2026-10-17T00:06:00,mast,WS90-01,rain,0.2,mm,ok\n")
check("두 수집기가 같은 비를 적어도 한 번만 센다", fe.read(now=znow)["rain_day"]["value"], 0.6)
z = field_env.FieldEnv(zdir, zone="treatment").read(now=znow)
check("구간을 고르면 그 구간만 · 기상(mast)은 함께", ("soil_moisture" in z, "wind_speed" in z), (False, True))
check("파일이 없으면 빈 값(오류 아님)", field_env.FieldEnv(zdir / "없음").read(now=znow), {})
# 기상센서가 2m 기온을 재면 기온 칸은 그것, 지그비 초관부 센서는 '초관부 온도' 칸으로 따로 센다.
with (zdir / "rtl433_20261017.csv").open("a", encoding="utf-8") as fh:
    fh.write("2026-10-17T00:09:00,mast,WS90-01,t_air,13.0,degC,ok\n")
_ce = fe.read(now=znow)
check("2m 기온과 초관부 온도가 둘 다 있으면 칸을 나눈다",
      (_ce["air_temp"]["var"], _ce["air_temp"]["sensors"], _ce["canopy_temp"]["value"], _ce["canopy_temp"]["sensors"]),
      ("t_air", 1, 11.5, 2))
with (zdir / "rtl433_20261017.csv").open("a", encoding="utf-8") as fh:
    fh.write("2026-10-17T00:09:00,mast,WS90-01,illuminance,50670,lux,ok\n")
_se = fe.read(now=znow)["solar"]
check("WS90 조도(lux)는 일사량(W/m²)으로 어림한다(÷126.7)", (round(_se["value"]), _se["var"]), (400, "illuminance"))
check("서버로는 칸 이름 그대로 값만", field_env.payload_values({"air_temp": {"value": 23.4}}), {"air_temp": 23.4})
print("\n⑮ 전력 회로 — Zigbee 계측 차단기·클램프 전력계")
pdir = Path(tempfile.mkdtemp(prefix="power-"))
pnow = _dt.datetime(2026, 10, 18, 9, 0)
(pdir / "zigbee_20261018.csv").write_text(
    HEAD +
    "2026-10-18T08:58:00,facility,PUMP-01,circuit_state,1,bool,ok\n"
    "2026-10-18T08:58:00,facility,PUMP-01,pump_power,1480,W,ok\n"
    "2026-10-18T08:58:00,facility,PUMP-01,pump_current,7.9,A,ok\n"
    "2026-10-18T08:58:00,facility,PUMP-01,line_voltage,221,V,ok\n"
    "2026-10-18T08:58:00,facility,PUMP-01,device_temp,71,degC,ok\n"
    "2026-10-18T07:00:00,facility,PUMP-01,pump_energy,0.40,kWh,ok\n"
    "2026-10-18T08:58:00,facility,PUMP-01,pump_energy,0.25,kWh,ok\n"
    "2026-10-18T08:59:00,facility,AUX-01,aux_circuit_state,0,bool,ok\n"
    "2026-10-18T08:59:00,facility,AUX-01,aux_power,0,W,ok\n"
    "2026-10-18T08:59:00,facility,AUX-01,device_temp,82,degC,ok\n"
    "2026-10-18T08:59:00,facility,MAIN-01,main_power,2350,W,ok\n"
    "2026-10-18T07:30:00,facility,LIGHT-01,light_power,900,W,ok\n"
    "2026-10-18T08:20:00,facility,IDLE-01,idle_state,0,bool,ok\n"
    "2026-10-18T08:59:00,facility,VALVE-01,valve_state,1,bool,ok\n"
    "2026-10-18T08:59:00,facility,VALVE-01,irrigation_flow,12,L/min,ok\n", encoding="utf-8")
pe = field_env.FieldEnv(pdir, zone="treatment")
circ = {c["id"]: c for c in pe.read_power({"aux-01": "heater"}, now=pnow)}
check("밸브는 회로가 아니다(전력·전류·전력량이 없다)", "VALVE-01" in circ, False)
check("구간을 골라도 분전반 회로는 모두 보인다", sorted(circ), ["AUX-01", "IDLE-01", "LIGHT-01", "MAIN-01", "PUMP-01"])
check("변수 끝말로 상태·전력·전류·전압을 읽는다",
      (circ["PUMP-01"]["state"], circ["PUMP-01"]["power"], circ["PUMP-01"]["current"], circ["PUMP-01"]["voltage"]),
      (1, 1480, 7.9, 221))
check("오늘 전력량은 구간값을 더한다", circ["PUMP-01"]["energy_today"], 0.65)
check("화면에서 고른 종류가 짐작보다 먼저(대소문자 무관)", (circ["AUX-01"]["type"], circ["PUMP-01"]["type"]),
      ("heater", "irrigation_pump"))
check("차단기 온도 71℃ 주의 · 82℃ 위험", (circ["PUMP-01"]["level"], circ["AUX-01"]["level"]), ("warn", "crit"))
check("75분 넘은 전력은 지금 값으로 보이지 않는다", circ["LIGHT-01"]["power"], None)
check("부하 없이 상태만 보내는 차단기도 회로다(40분 전 값도 유효)", (circ["IDLE-01"]["state"], circ["IDLE-01"]["power"]), (0, None))
_iv = {v["id"]: v for v in field_env.read_irrigation(pe, now=pnow, expected=["VALVE-02"])}
check("관수 밸브: 열림·유량, 등록만 한 밸브는 수신 대기",
      (_iv["VALVE-01"]["state"], _iv["VALVE-01"]["flow"], _iv["VALVE-02"]["age_min"]), (1, 12.0, None))
check("밸브는 전력 회로 목록에 섞이지 않는다", "VALVE-01" in circ, False)
_idir = Path(tempfile.mkdtemp())
(_idir / f"zigbee_{pnow:%Y%m%d}.csv").write_text(
    "ts,zone,sensor_id,variable,value,unit,quality\n"
    "2026-10-18T06:00:00,facility,VALVE-01,valve_state,1,bool,ok\n"
    "2026-10-18T06:00:00,facility,VALVE-01,irrigation_flow,15,L/min,ok\n"
    "2026-10-18T06:10:00,facility,VALVE-01,irrigation_volume,150,L,ok\n"
    "2026-10-18T06:20:00,facility,VALVE-01,irrigation_volume,140,L,ok\n"
    "2026-10-18T06:20:00,facility,VALVE-01,valve_state,0,bool,ok\n"
    "2026-10-18T06:20:00,facility,VALVE-01,irrigation_flow,0,L/min,ok\n", encoding="utf-8")
_ie = field_env.FieldEnv(_idir, zone="treatment")
_v = field_env.read_irrigation(_ie, now=_dt.datetime(2026, 10, 18, 7, 0))[0]
check("닫힌 밸브: 유량 0 · 오늘 사용량은 구간을 더한다(구간과 무관)", (_v["state"], _v["flow"], _v["volume_today"]), (0, 0.0, 290.0))
check("서버로 보낼 밸브 값", field_env.payload_irrigation([_v]), [{"id": "VALVE-01", "state": 0, "flow": 0.0, "volume_today": 290.0}])
check("수신 대기 밸브는 보내지 않는다",
      field_env.payload_irrigation([{"id": "V", "state": None, "flow": None, "volume_today": None, "age_min": None}]), [])
_ex = {c["id"]: c for c in pe.read_power({}, now=pnow, expected=["NEW-01", "PUMP-01", "../x"])}
check("등록했지만 아직 안 보낸 차단기는 수신 대기로 남긴다",
      ("NEW-01" in _ex, _ex["NEW-01"]["age_min"], "../x" in _ex, _ex["PUMP-01"]["power"]), (True, None, False, 1480))
check("수신 대기 회로는 서버로 보내지 않는다", "NEW-01" in {c["id"] for c in field_env.payload_power(list(_ex.values()))}, False)
summ = field_env.power_summary(list(circ.values()))
check("인입 계측이 있으면 그것이 전체", (summ["total_w"], summ["partial"], summ["level"]), (2350, False, "crit"))
summ2 = field_env.power_summary([c for c in circ.values() if c["type"] != "main"])
check("인입이 없으면 분기 합(부분값으로 표시)", (summ2["total_w"], summ2["partial"]), (1480, True))
sent = {c["id"] for c in field_env.payload_power(list(circ.values()))}
check("서버로는 지금 값이 있는 회로만", sent, {"AUX-01", "IDLE-01", "MAIN-01", "PUMP-01"})
_cfg = pdir / "config.ini"
_cfg.write_text("[server]\nendpoint = x\n\n[power_circuits]\n; 주석\nPUMP-010 = other\n\n[history]\nenabled = true\n",
                encoding="utf-8")
field_env.save_power_type(_cfg, "pump-01", "aerator")
field_env.save_power_type(_cfg, "PUMP-010", "heater")
_txt = _cfg.read_text(encoding="utf-8")
check("회로 종류 저장: 정확한 이름만 바꾸고 주석·다른 구간은 그대로",
      ("PUMP-01 = aerator" in _txt, "PUMP-010 = heater" in _txt, "; 주석" in _txt, "[history]" in _txt,
       _txt.index("PUMP-01 = aerator") < _txt.index("[history]")),
      (True, True, True, True, True))
_cfg.write_text("[power_circuits]\nHEAT-01: other\n", encoding="utf-8")
field_env.save_power_type(_cfg, "HEAT-01", "heater")
_txt = _cfg.read_text(encoding="utf-8")
check("손으로 ':' 로 적은 키도 같은 키로 바꾼다(중복 키 → 기동 실패 방지)",
      (_txt.count("HEAT-01"), "HEAT-01 = heater" in _txt, (pdir / "config.ini.tmp").exists()), (1, True, False))
check("서버가 버릴 회로 이름(따옴표·공백)은 장비도 쓰지 않는다",
      [bool(field_env.CIRCUIT_ID_RE.match(x)) for x in ("PUMP-01", 'A"B', "A B", "x" * 33)],
      [True, False, False, False])

check("스마트팜(양액 기준)에서는 새우 운전 권고를 내지 않는다",
      advice.recommend({"temperature": 21.6, "ph": 6.12, "do_level": 7.3}, nutrient_mode=True), [])


print("\n⑯ 무선 센서 — 화면에서 찾기·등록·빼기")
_here = Path(__file__).resolve().parent
_wdir = Path(tempfile.mkdtemp(prefix="wireless-"))
_dev = _wdir / "devices.yaml"
# 장비에는 /opt/shrimp365/field/devices.template.yaml 로, 저장소에는 raspberry-pi/field/ 에 있다.
_tpl = next((p for p in (_here / "field" / "devices.template.yaml", Path("/opt/shrimp365/field/devices.template.yaml"))
             if p.exists()), None)
_dev.write_text(_tpl.read_text(encoding="utf-8") if _tpl else "kinds:\n\ndevices:\n\nrf:\n  Fineoffset-WS90:\n    zone: mast\n",
                encoding="utf-8")
check("새 장비 목록은 비어 있다", wireless.read_registered(_dev), {})
check("이름 규칙: 구간 글자 + 번호(초관부·토양), 두 자리 번호(그 밖)",
      (wireless.suggest_id("canopy", "treatment", set()), wireless.suggest_id("soil", "control", {"SOIL-C1"}),
       wireless.suggest_id("breaker-pump", "facility", {"PUMP-01"}), wireless.suggest_id("air", "mast", set())),
      ("CN-T1", "SOIL-C2", "PUMP-02", "AIR-01"))
wireless.add_device(_dev, "cn-t1", "canopy", "treatment", "CN-T1", "이랑 동쪽")
wireless.add_device(_dev, "air-01", "air", "mast", "AIR-01")
_reg = wireless.read_registered(_dev)
check("등록하면 devices: 칸에 한 줄씩(순서대로)", list(_reg), ["cn-t1", "air-01"])
check("2m 기온은 온습도 종류에 temperature→t_air 를 덮는다", _reg["air-01"].get("map"), "{temperature: t_air}")
_txt = _dev.read_text(encoding="utf-8")
check("다른 칸(kinds·rf)은 그대로", ("kinds:" in _txt, "rf:" in _txt, "Fineoffset-WS90" in _txt,
      _txt.index("cn-t1:") < _txt.index("rf:")), (True, True, True, True))
check("빼면 그 줄만 지운다", (wireless.remove_device(_dev, "cn-t1"), list(wireless.read_registered(_dev))),
      (True, ["air-01"]))
_ofdf_src = _here.parent / "openfield" / "configs" / "devices.yaml"     # 저장소에서만 있다
if _ofdf_src.exists():
    _ofdf = _wdir / "ofdf.yaml"
    _ofdf.write_text(_ofdf_src.read_text(encoding="utf-8"), encoding="utf-8")
    _n0 = len(wireless.read_registered(_ofdf))
    wireless.add_device(_ofdf, "soil-c3", "soil", "control", "SOIL-C3")
    _r = wireless.read_registered(_ofdf)
    check("손으로 쓴 기존 설정(주석 예시 포함)에도 마지막 장치 뒤에 붙는다",
          (len(_r) - _n0, list(_r)[-1], _r["soil-c3"]["zone"]), (1, "soil-c3", "control"))
_bad = 'a: b #c {x} [y] "q" *r @s |t\n줄 깊이 10cm'
wireless.add_device(_dev, "soil-c1", "soil", "control", "SOIL-C1", _bad)
check("메모의 YAML 특수문자는 지워 파일이 깨지지 않는다",
      (wireless.read_registered(_dev)["soil-c1"]["note"], all(c not in wireless.clean_note(_bad) for c in ':#{}[]"*@|\n')),
      ("a b c x y q r s t 줄 깊이 10cm", True))
_rf_dev = _wdir / "rf.yaml"
_rf_dev.write_text(_tpl.read_text(encoding="utf-8") if _tpl else
                   "devices:\n\nrf:\n  Fineoffset-WS90:\n    zone: mast\n    sensor_id: WS90-01\n", encoding="utf-8")
check("433MHz 기본 칸(여러 줄 형식)을 읽는다", wireless.read_rf(_rf_dev).get("Fineoffset-WS90", {}).get("sensor_id"), "WS90-01")
_W = wireless.Wireless(_rf_dev, _wdir / "data")
_a = _W.register_rf("Fineoffset-WS90", "12345", "weather", "mast")
_b = _W.register_rf("Fineoffset-WH51", "0a3f21", "soil", "control")
_c = _W.register_rf("Fineoffset-WH31", "7", "canopy", "treatment")
_rf = wireless.read_rf(_rf_dev)
check("WS90 을 id 로 등록하면 모델 칸을 걷고 이름(WS90-01)을 이어받는다",
      (_a.get("sensor_id"), "Fineoffset-WS90" in _rf, "Fineoffset-WS90/12345" in _rf), ("WS90-01", False, True))
check("433MHz 이름 규칙·지상 10cm 온습도는 초관부 온도로", (_b.get("sensor_id"), _c.get("sensor_id"),
      _rf.get("Fineoffset-WH31/7", {}).get("map")), ("SOIL-C1", "CN-T1", "{temperature_C: canopy_temp}"))
check("같은 센서를 두 번 등록하지 않는다", _W.register_rf("Fineoffset-WH51", "0a3f21", "soil", "control")["ok"], False)
check("이상한 모델·id 는 받지 않는다", (_W.register_rf("x: y", "1", "soil", "control")["ok"],
      _W.register_rf("Fineoffset-WH51", "1}#", "soil", "control")["ok"]), (False, False))
check("433MHz 빼기", (_W.remove_rf("Fineoffset-WH51/0a3f21")["ok"], "Fineoffset-WH51/0a3f21" in wireless.read_rf(_rf_dev)),
      (True, False))
check("모델로 433MHz 종류 짐작", [wireless.guess_rf_kind(m) for m in
      ("Fineoffset-WS90", "Fineoffset-WH51", "Fineoffset-WH31", "Fineoffset-WH35", "Fineoffset-WH40", "Toyota-TPMS")],
      ["weather", "soil", "air", "leaf", "rain", ""])
check("찾은 센서의 종류 짐작", (
      wireless.guess_kind("Temperature & humidity sensor", [{"property": "temperature"}, {"property": "humidity"}]),
      wireless.guess_kind("Soil sensor", [{"property": "soil_moisture"}]),
      wireless.guess_kind("Smart circuit breaker", [{"type": "switch", "features": [{"property": "state"}]},
                                                   {"property": "power"}, {"property": "current"}]),
      wireless.guess_kind("Water leak sensor", [{"property": "water_leak"}])),
      ("canopy", "soil", "breaker-aux", "leak"))
check("MQTT 길이 부호화(1·2바이트 경계)", (wireless._varint(0), wireless._varint(127), wireless._varint(128), wireless._varint(16383)),
      (b"\x00", b"\x7f", b"\x80\x01", b"\xff\x7f"))
_cfg2 = _wdir / "config.ini"
_cfg2.write_text("[environment]\n; 주석\nenabled = false\nenabled_extra = 1\n\n[power]\ndir = /x\n", encoding="utf-8")
_ssv = wireless.save_section_value
if _ssv:
    _ssv(_cfg2, "environment", "enabled", "true")
    _ssv(_cfg2, "power", "enabled", "true")
    _ssv(_cfg2, "wireless", "devices", "/d.yaml")
    _c = _cfg2.read_text(encoding="utf-8")
    check("설정 한 줄 바꾸기: 정확한 키만, 없으면 끼우고, 구간이 없으면 만든다",
          ("enabled = true" in _c, "enabled_extra = 1" in _c, "; 주석" in _c,
           _c.index("[power]") < _c.index("enabled = true", _c.index("[power]")), "[wireless]" in _c),
          (True, True, True, True, True))


# 에코윗 — 기본 설정(주석 예시와 channels: {})에 게이트웨이·채널을 더하고 뺀다.
_eco_dev = _wdir / "eco.yaml"
_eco_dev.write_text(_tpl.read_text(encoding="utf-8") if _tpl else
                    "devices:\n\nrf:\n  Fineoffset-WS90:\n    zone: mast\n    sensor_id: WS90-01\n\n"
                    "ecowitt:\n  # gateway:\n  channels: {}\n", encoding="utf-8")
_WE = wireless.Wireless(_eco_dev, _wdir / "data", port=1)
check("새 장비에는 에코윗 등록이 없다", wireless.read_eco(_eco_dev), {"gateway": None, "channels": {}, "passkey": ""})
_g = _WE.register_eco("gateway", "weather", "mast", "A1B2C3D4E5F60718")
_s = _WE.register_eco("soil1", "soil", "control", "a1b2c3d4e5f60718")
_t = _WE.register_eco("th2", "canopy", "treatment", "A1B2C3D4E5F60718")
_e = wireless.read_eco(_eco_dev)
check("게이트웨이는 433MHz WS90 칸을 걷고 이름을 이어받는다",
      (_g.get("sensor_id"), _e["passkey"], any(k.startswith("Fineoffset-WS90") for k in wireless.read_rf(_eco_dev))),
      ("WS90-01", "A1B2C3D4E5F60718", False))
check("채널 이름: 토양 SOIL-C1, 초관부 온습도 CN-T1 + 지상 10cm 매핑",
      (_s.get("sensor_id"), _t.get("sensor_id"), _e["channels"].get("th2", {}).get("map")),
      ("SOIL-C1", "CN-T1", "{t_air: canopy_temp}"))
check("온습도계는 종류를 골라야, 같은 채널은 한 번만, 기상센서는 한 길로만",
      (_WE.register_eco("th3", "", "control", "A1B2C3D4E5F60718")["ok"],
       _WE.register_eco("soil1", "soil", "control", "A1B2C3D4E5F60718")["ok"],
       _WE.register_eco("bad9", "soil", "control", "A1B2C3D4E5F60718")["ok"],
       _WE.register_rf("Fineoffset-WS90", "1", "weather", "mast")["ok"],
       _WE.register_rf("Fineoffset-WS90", "1", "rain", "mast")["ok"]), (False, False, False, False, False))
check("다른 게이트웨이(열쇠)는 등록하지 않는다, 열쇠 없이도 안 된다",
      (_WE.register_eco("soil2", "soil", "control", "FFEE0011FFEE0011")["ok"],
       _WE.register_eco("soil2", "soil", "control", "")["ok"]), (False, False))
try:
    sys.path.insert(0, str(_here.parent / "openfield" / "src"))
    from ofdf.data.ecowitt import load_channels
    _lg, _lc = load_channels(_eco_dev)
    check("수신기가 등록 결과를 그대로 읽는다", (_lg.sensor_id, sorted(_lc), _lc["th2"].map),
          ("WS90-01", ["soil1", "th2"], {"t_air": "canopy_temp"}))
except ImportError:
    print("  (건너뜀) ofdf 가 없어 수신기 읽기 확인은 하지 않았다")
check("에코윗 빼기", (_WE.remove_eco("th2")["ok"], _WE.remove_eco("gateway")["ok"], wireless.read_eco(_eco_dev)["gateway"],
      sorted(wireless.read_eco(_eco_dev)["channels"])), (True, True, None, ["soil1"]))
_WE.remove_eco("soil1")
check("다 빼면 열쇠도 지워 다른 게이트웨이를 고를 수 있다", wireless.read_eco(_eco_dev)["passkey"], "")
_bare = _wdir / "bare.yaml"
_bare.write_text("devices:\nrs485:\n  enabled: false", encoding="utf-8")
_WB = wireless.Wireless(_bare, _wdir / "data", port=1)
_r = _WB.register_eco("soil1", "soil", "control", "01234567")
check("ecowitt: 칸이 없는 파일에도 더하고, 숫자만인 열쇠도 글자로 남는다",
      (_r["ok"], wireless.read_eco(_bare)["passkey"], "rs485:" in _bare.read_text(encoding="utf-8")), (True, "01234567", True))
try:
    import yaml as _yaml
    check("  (YAML 로 읽어도 같다)", str(_yaml.safe_load(_bare.read_text(encoding="utf-8"))["ecowitt"]["passkey"]), "01234567")
except ImportError:
    pass

print("\n⑰ 투야 블루투스 토양센서 — 등록 칸, 화면 상태, 수집 파일")
try:
    import yaml as _yaml  # noqa: F811 — tuya_ble_setup 이 쓴다
    import tuya_ble_setup as _tbs
except ImportError:
    _tbs = None
if _tbs:
    _bdir = Path(tempfile.mkdtemp(prefix="ble-"))
    _bdev = _bdir / "devices.yaml"
    _bdev.write_text(_bare.read_text(encoding="utf-8"), encoding="utf-8")
    _tbs.write_entries(_bdev, {"bf01": {"sensor_id": "SOIL-T1", "zone": "treatment", "name": "토양 1",
                                        "uuid": "tuyaab12", "local_key": "a'b\"c#d:e", "mac": "DC:23:4D:00:11:22"}})
    check("등록 칸을 더해도 다른 칸(에코윗)은 그대로", (wireless.read_eco(_bdev)["passkey"],
          _tbs.read_entries(_bdev)["bf01"]["local_key"]), ("01234567", "a'b\"c#d:e"))
    check("화면용 읽기는 열쇠를 내보내지 않는다", wireless.read_tuya_ble(_bdev),
          {"bf01": {"sensor_id": "SOIL-T1", "zone": "treatment", "name": "토양 1", "mac": "DC:23:4D:00:11:22"}})
    _WBL = wireless.Wireless(_bdev, _bdir / "data", port=1)
    check("블루투스 센서 이름도 '쓰는 이름' 에 든다", "SOIL-T1" in _WBL._taken({}, {}), True)
    (_bdir / "data" / "capture").mkdir(parents=True)
    (_bdir / "data" / "capture" / "tuyable_heard.json").write_text(
        json.dumps({"sensors": [{"sensor_id": "SOIL-T1", "error": "광고가 안 들립니다", "rssi": -71}]}), encoding="utf-8")
    _bs = _WBL._ble_snapshot(lambda sid: {"age_min": None, "battery": None, "lqi": None})
    check("화면 상태: 마지막 오류·신호", (_bs[0]["sensor_id"], _bs[0]["error"], _bs[0]["rssi"]), ("SOIL-T1", "광고가 안 들립니다", -71))
    _WBL.register_eco("soil2", "soil", "control", "01234567")
    check("에코윗을 화면에서 더해도 블루투스 칸은 남는다", list(_tbs.read_entries(_bdev)), ["bf01"])
    _tbs.write_entries(_bdev, {})
    check("모두 빼면 칸이 없어진다", "tuya_ble" in _bdev.read_text(encoding="utf-8"), False)
    # 화면에서 투야 클라우드로 가져와 등록 — 가짜 tinytuya 를 쓰는 파이썬으로 등록 도구를 부른다.
    _fk = _bdir / "fake"
    _fk.mkdir()
    (_fk / "tinytuya.py").write_text(
        "class Cloud:\n"
        "    def __init__(self, apiRegion, apiKey, apiSecret, apiDeviceID=None):\n"
        "        self.r = apiRegion; self.error = None\n"
        "    def getdevices(self, verbose=False):\n"
        "        if self.r != 'us': return {'Error': 'x'}\n"
        "        return [{'id': 'bf222', 'name': 'soil', 'key': 'Kk1', 'uuid': 'tuya22', 'category': 'zwjcy'},\n"
        "                {'id': 'bf333', 'name': 'plug', 'key': 'x', 'uuid': 'u3', 'ip': '1.2.3.4'}]\n",
        encoding="utf-8")
    _wrap = _bdir / "py"
    # 캐시(.pyc)를 쓰지 않는다 — 아래에서 가짜 클라우드를 같은 크기로 1초 안에 고쳐 쓰므로.
    _wrap.write_text(f"#!/bin/sh\nPYTHONDONTWRITEBYTECODE=1 PYTHONPATH={_fk} exec {sys.executable} \"$@\"\n",
                     encoding="utf-8")
    _wrap.chmod(0o755)
    _WBL.ble_py, _WBL.tuya_cred = _wrap, _bdir / "cred.json"
    _WBL.ble_ready_flag = _bdir / ".ready"
    check("블루투스 준비 표시가 없으면 준비 안 됨(꾸러미 설치 실패 장비)", _WBL.ble_ready(), False)
    _WBL.ble_ready_flag.write_text("2")
    check("열쇠 형식이 틀리면 묻지도 않는다", _WBL.ble_fetch("a b", "c")["ok"], False)
    _r = _WBL.ble_fetch("abcdefgh12", "secretsecret99")
    check("투야에서 가져오기: 블루투스 기기만 · 지역은 us", (_r.get("ok"), _r.get("count"), _r.get("region")), (True, 1, "us"))
    check("열쇠는 권한 600 으로 저장", oct(_WBL.tuya_cred.stat().st_mode & 0o777), "0o600")
    check("화면에는 열쇠를 내보내지 않는다", _WBL._ble_new(), [{"id": "bf222", "name": "soil", "category": "zwjcy"}])
    _r = _WBL.ble_add("bf222", "control")
    # 대조구 토양 이름은 에코윗 칸(SOIL-C1·C2)이 이미 쓰고 있다 — 겹치지 않게 다음 번호.
    check("화면에서 등록 → 쓰지 않은 다음 이름(SOIL-C3)", (_r.get("ok"), _r.get("sensor_id")), (True, "SOIL-C3"))
    check("등록하면 새 목록에서 빠진다", _WBL._ble_new(), [])
    check("저장한 열쇠로 다시 가져오기 · 열쇠가 같으면 바꾸지 않는다", (_WBL.ble_fetch()["ok"], _WBL.ble_fetch()["updated"]), (True, []))
    # 앱에서 다시 붙여 열쇠가 바뀌면, 가져오기만 해도 이름·구간은 두고 열쇠를 새로 적는다.
    (_fk / "tinytuya.py").write_text((_fk / "tinytuya.py").read_text(encoding="utf-8").replace("'Kk1'", "'Kk2'"), encoding="utf-8")
    _r = _WBL.ble_fetch()
    check("다시 붙인 센서: 가져오기만 하면 열쇠가 바뀐다",
          (_r["updated"], _tbs.read_entries(_bdev)["bf222"]["local_key"], _tbs.read_entries(_bdev)["bf222"]["sensor_id"]),
          (["SOIL-C3"], "Kk2", "SOIL-C3"))
    check("화면에서 빼기", (_WBL.ble_remove("SOIL-C3")["ok"], "bf222" in wireless.read_tuya_ble(_bdev)), (True, False))
    check("열쇠 지우기", (_WBL.ble_forget()["ok"], _WBL.tuya_cred.exists()), (True, False))
_tdir = Path(tempfile.mkdtemp(prefix="tuyable-"))
(_tdir / "tuyable_20261017.csv").write_text(
    HEAD + "2026-10-17T00:08:00,treatment,SOIL-T1,soil_moisture,31.0,%,ok\n"
    "2026-10-17T00:08:00,treatment,SOIL-T1,soil_temp,18.7,degC,ok\n"
    "2026-10-17T00:08:00,treatment,SOIL-T1,battery_pct,90,%,ok\n", encoding="utf-8")
_te = field_env.FieldEnv(_tdir).read(now=znow)
check("블루투스 수집 파일(tuyable_)도 토양수분·지온으로 읽는다",
      (_te["soil_moisture"]["value"], _te["soil_temp"]["value"]), (31.0, 18.7))


print("\n⑱ 전력 회로 켜고 끄기 — 수동·시간 예약·반복 간격·안전")
import power_control as pc  # noqa: E402
check("인입 회로는 규칙을 걸 수 없다", pc.clean_rule({"mode": "manual"}, "main")[0], None)
check("산소공급기도 예약·자동 끄기를 걸 수 있다",
      pc.clean_rule({"mode": "cycle", "auto_off_min": 30, "cycle": {"on_min": 5, "off_min": 5}}, "aerator")[0]["mode"], "cycle")
check("산소량 연동: 끄는 기준이 켜는 기준보다 높아야", pc.clean_rule({"mode": "do", "do": {"on_below": 5, "off_above": 5}}, "aerator")[0], None)
check("시각 형식 검사", pc.clean_rule({"mode": "timer", "timers": [{"on": "6:00", "off": "07:00"}]}, "irrigation_pump")[0], None)
_tr, _ = pc.clean_rule({"mode": "timer", "timers": [{"on": "22:00", "off": "02:00", "days": [4]}]}, "heater")
_D = _dt.datetime
check("자정을 넘는 예약: 금 23시 켜짐 · 토 01시 켜짐 · 토 03시 꺼짐 · 목 23시 꺼짐",
      [pc.scheduled(_tr, x) for x in (_D(2026, 10, 23, 23), _D(2026, 10, 24, 1), _D(2026, 10, 24, 3), _D(2026, 10, 22, 23))],
      [True, True, False, False])
_cr, _ = pc.clean_rule({"mode": "cycle", "cycle": {"on_min": 15, "off_min": 45, "from": "06:00", "to": "18:00"}},
                       "irrigation_pump")
check("반복 간격: 06:05 켜짐 · 06:20 꺼짐 · 07:10 켜짐 · 19:00 꺼짐",
      [pc.scheduled(_cr, _D(2026, 10, 24, h, m)) for h, m in ((6, 5), (6, 20), (7, 10), (19, 0))],
      [True, False, True, False])

_now = {"t": _D(2026, 10, 24, 5, 50)}
_sent: list = []
_pcf = Path(tempfile.mkdtemp()) / "pc.json"
_P = pc.PowerControl(_pcf, send=lambda n, on: _sent.append((n, on)), clock=lambda: _now["t"],
                     names=lambda: {"PUMP-01": "pump-01", "MAIN-01": "main-01", "AIR-01": "air-01"})
_P.observe([{"id": "PUMP-01", "type": "irrigation_pump", "state": 0, "level": ""},
            {"id": "MAIN-01", "type": "main", "state": 1, "level": ""},
            {"id": "AIR-01", "type": "aerator", "state": 1, "level": ""}])
_r = _P.set_rule("PUMP-01", {"mode": "timer", "timers": [{"on": "06:00", "off": "06:30"}]})
check("예약 저장 · 아직 시간 전이면 끄기 명령 한 번", (_r["ok"], _sent), (True, [("pump-01", False)]))
_P.observe([{"id": "PUMP-01", "type": "irrigation_pump", "state": 0, "level": ""}])
_now["t"] = _D(2026, 10, 24, 6, 0)
_P.tick(); _P.tick()
check("06:00 에 켜기를 한 번만 보낸다", _sent[1:], [("pump-01", True)])
_P.observe([{"id": "PUMP-01", "type": "irrigation_pump", "state": 1, "level": ""}])
_r = _P.manual("PUMP-01", False)
check("손으로 끄면 예약보다 앞선다", (_r["ok"], _sent[-1]), (True, ("pump-01", False)))
_P.observe([{"id": "PUMP-01", "type": "irrigation_pump", "state": 0, "level": ""}])
_now["t"] = _D(2026, 10, 24, 6, 10)
_P.tick()
check("손 조작은 예약이 바뀔 때까지 유지", len(_sent), 3)
_now["t"] = _D(2026, 10, 24, 6, 30)
_P.tick()
check("예약이 끄기로 바뀌면 손 조작이 풀린다", ("PUMP-01" in _P.over, len(_sent)), (False, 3))
_now["t"] = _D(2026, 10, 24, 7, 0)
_r = _P.manual("PUMP-01", True, 20)
_P.observe([{"id": "PUMP-01", "type": "irrigation_pump", "state": 1, "level": ""}])
_now["t"] = _D(2026, 10, 24, 7, 21)
_P.tick()
check("20분만 켜기: 시간이 지나면 끈다", (_sent[-2:], "PUMP-01" in _P.over), ([("pump-01", True), ("pump-01", False)], False))
check("인입 회로는 켜고 끌 수 없다", _P.manual("MAIN-01", False)["ok"], False)
check("산소공급기도 시간 지정 켜기가 된다", _P.manual("AIR-01", True, 10)["ok"], True)
_P.clear_override("AIR-01")
_P.observe([{"id": "PUMP-01", "type": "irrigation_pump", "state": 0, "level": "crit"}])
check("과열 중에는 켜지 않는다", _P.manual("PUMP-01", True)["ok"], False)
check("등록 안 된 차단기", _P.manual("PUMP-09", True)["ok"], False)
_P2 = pc.PowerControl(_pcf, clock=lambda: _now["t"])
check("규칙은 파일에 남아 다시 켜도 그대로", _P2.rules["PUMP-01"]["timers"][0]["on"], "06:00")
_n = len(_sent)
_P.observe([{"id": "PUMP-01", "type": "irrigation_pump", "state": 0, "level": ""}])
_now["t"] = _D(2026, 10, 25, 6, 1)
_P.tick()
_P.last["PUMP-01"]["at"] -= 100
_P.tick()
check("차단기가 따라오지 않으면 다시 보낸다", _sent[_n:], [("pump-01", True), ("pump-01", True)])
_now["t"] = _D(2000, 1, 1, 6, 1)
check("시계가 틀리면 예약을 멈춘다", _P.desired("PUMP-01", _now["t"]), None)

# 산소량 연동 · 산소 부족 강제 켜기
_now["t"] = _D(2026, 10, 26, 12, 0)
_Q = pc.PowerControl(Path(tempfile.mkdtemp()) / "pc.json", send=lambda n, on: None, clock=lambda: _now["t"],
                     names=lambda: {"AIR-01": "air-01", "AIR-02": "air-02"})
_Q.observe([{"id": "AIR-01", "type": "aerator", "state": 0, "level": ""},
            {"id": "AIR-02", "type": "aerator", "state": 0, "level": ""}])
_Q.set_rule("AIR-01", {"mode": "do", "do": {"on_below": 5.0, "off_above": 6.0, "min_on_min": 0}})
_seq = []
for _v in (6.5, 5.5, 4.9, 5.5, 6.1, 5.5):
    _Q.observe_do(_v)
    _seq.append(_Q.desired("AIR-01", _now["t"]))
check("산소량 연동: 4.9 에서 켜고 6.1 까지 유지, 사이 구간은 그대로", _seq, [False, False, True, True, False, False])
_Q.set_rule("AIR-01", {"mode": "do", "do": {"on_below": 5.0, "off_above": 6.0, "min_on_min": 10}})
_Q.observe_do(4.0); _Q.desired("AIR-01", _now["t"])
_Q.observe_do(7.0)
check("산소량 연동: 켜면 최소 가동 시간은 끄지 않는다", _Q.desired("AIR-01", _now["t"]), True)
_Q.do_at -= 700
check("산소값이 10분 넘게 없으면 켠다", _Q.desired("AIR-01", _now["t"]), True)
check("새 산소공급기 규칙에는 산소 부족 강제 켜기(4.0)가 기본", _Q.snapshot()["circuits"]["AIR-02"]["rule"].get("do_guard_below"), 4.0)
_Q.set_rule("AIR-02", {"mode": "timer", "do_guard_below": 4.0, "timers": [{"on": "06:00", "off": "07:00"}]})
_Q.observe_do(6.0)
_g = [_Q.desired("AIR-02", _now["t"])]
_Q.manual("AIR-02", False)
_Q.observe_do(3.8); _g.append(_Q.desired("AIR-02", _now["t"]))
_Q.observe_do(4.5); _g.append(_Q.desired("AIR-02", _now["t"]))
_Q.observe_do(5.1); _g.append(_Q.desired("AIR-02", _now["t"]))
check("강제 켜기: 예약 밖·손으로 꺼도 3.8 이면 켜고, 5.0 넘게 회복하면 풀린다", _g, [False, True, True, False])
_Q.do_at -= 700
check("산소값을 모르면 강제 켜기는 관여하지 않는다", _Q.desired("AIR-02", _now["t"]), False)

# 리뷰에서 찾은 것들
_sent2: list = []
_R = pc.PowerControl(Path(tempfile.mkdtemp()) / "pc.json", clock=lambda: _now["t"],
                     names=lambda: {"AIR-01": "air-01"})
_R._send_fn = lambda n, on: (_sent2.append((n, on)), _sent2.append(("lock_free", _R._lock.acquire(blocking=False)))
                             and _R._lock.release())
_now["t"] = _D(2026, 10, 26, 12, 0)
_R.observe([{"id": "AIR-01", "type": "aerator", "state": 0, "level": ""}])
_R.manual("AIR-01", False)
_R.observe([{"id": "AIR-01", "type": "aerator", "state": 0, "level": ""}])
_R.observe_do(3.0)
_R.tick()
_R.observe([{"id": "AIR-01", "type": "aerator", "state": 1, "level": ""}])
_R.tick()
check("강제 켜기 → 차단기가 따름", _R.last["AIR-01"].get("ok"), True)
_R.observe([{"id": "AIR-01", "type": "aerator", "state": 0, "level": ""}])   # 정전·트립으로 꺼짐
_R.observe_do(3.0)
_R.tick()
check("산소 부족 중 꺼지면 다시 켠다(손으로 바꾼 것과 다르게)", [x for x in _sent2 if x[0] == "air-01"][-1], ("air-01", True))
check("MQTT 전송은 잠금 밖에서", all(ok for k, ok in _sent2 if k == "lock_free"), True)
_R.set_interval(900)
_R.do_at -= 700
check("측정 간격 15분이면 11분 지난 산소값도 아직 유효", _R._do_now(), 3.0)
_bad = Path(tempfile.mkdtemp()) / "pc.json"
_bad.write_text(json.dumps({"rules": {}, "override": {"A-1": {"on": True, "until": "엉망"}, "B-1": {"x": 1},
                                                     "C-1": {"on": False, "until": None, "sched": None}}}), encoding="utf-8")
check("망가진 손 조작 기록은 들이지 않는다", sorted(pc.PowerControl(_bad).over), ["C-1"])
_S = pc.PowerControl(Path(tempfile.mkdtemp()) / "pc.json", clock=lambda: _now["t"], names=lambda: {"PUMP-01": "p"})
_S.observe([{"id": "PUMP-01", "type": "irrigation_pump", "state": 0, "level": ""}])
_S.set_rule("PUMP-01", {"mode": "timer", "timers": [{"on": "06:00", "off": "07:00"}]})
_now["t"] = _D(2000, 1, 1, 6, 30)
_S.manual("PUMP-01", False)
check("시계가 틀릴 때 한 손 조작은 예약 기준이 비어 있다", _S.over["PUMP-01"]["sched"], None)
_now["t"] = _D(2026, 10, 27, 6, 30)
_S.desired("PUMP-01", _now["t"])
_now["t"] = _D(2026, 10, 27, 7, 1)
check("시계가 맞으면 기준을 채워 다음 예약 전환에 풀린다", (_S.desired("PUMP-01", _now["t"]), "PUMP-01" in _S.over), (False, False))

print("\n⑲ 웹에서 켜고 끄기 — 서버 명령함(power_remote.py)")
import power_remote as prm   # noqa: E402
_now["t"] = _D(2026, 10, 27, 12, 0)
_sent3: list = []
_W = pc.PowerControl(Path(tempfile.mkdtemp()) / "pc.json", clock=lambda: _now["t"],
                     names=lambda: {"PUMP-01": "p1", "AIR-01": "a1"}, send=lambda n, on: _sent3.append((n, on)))
_W.observe([{"id": "PUMP-01", "type": "irrigation_pump", "state": 0, "level": ""},
            {"id": "AIR-01", "type": "aerator", "state": 1, "level": ""},
            {"id": "MAIN", "type": "main", "state": 1, "level": ""}])
_calls: list = []
_replies: list = []


def _fake(url, key, payload):
    _calls.append(payload)
    return _replies.pop(0) if _replies else (200, {"commands": []})


_RP = prm.RemotePower(_W, lambda: "https://x/api/sensors/power", lambda: "k", _fake)
_replies.append((200, {"commands": [
    {"id": "c1", "circuit": "PUMP-01", "action": "set", "on": True, "minutes": 30},
    {"id": "c2", "circuit": "MAIN", "action": "set", "on": False},
    {"id": "c3", "circuit": "PUMP-01", "action": "rule", "rule": {"mode": "timer", "timers": [{"on": "06:00", "off": "06:00"}]}},
    {"id": "c4", "circuit": "../x", "action": "set", "on": True},
]}))
_wait = _RP.once()
check("처음 물을 때 제어 상태를 싣는다", "control" in _calls[0] and "PUMP-01" in _calls[0]["control"]["circuits"], True)
check("웹 명령 실행 → 차단기에 켜기", ("p1", True) in _sent3, True)
check("웹 명령에도 안전 규칙: 인입 금지·규칙 검사·이름 검사",
      [(r["id"], r["ok"]) for r in _RP.results], [("c1", True), ("c2", False), ("c3", False), ("c4", False)])
check("명령을 실행하면 결과를 바로 알린다", _wait, 1.0)
_RP.once()
check("결과를 보낸 뒤 비운다", (_calls[1]["results"][0]["id"], _RP.results), ("c1", []))
check("시간 지정 켜기가 손 조작으로 남는다", bool(_W.over["PUMP-01"]["until"]), True)
_RP.once()
check("상태가 그대로면 1분 안에는 다시 싣지 않는다", "control" in _calls[2], False)
_replies.append((0, {}))
_RP.results.append({"id": "c9", "ok": True, "error": ""})
_RP.once()
check("인터넷이 끊기면 결과를 들고 있다가 다음에", [r["id"] for r in _RP.results], ["c9"])
_replies.append((404, {}))
check("옛 서버(경로 없음)면 5분 뒤 다시", _RP.once(), prm.IDLE_S)
_replies.append((200, {"commands": [], "disabled": True}))
check("서버에 표가 없으면 5분 뒤 다시", _RP.once(), prm.IDLE_S)
check("기기 키가 없으면 묻지 않는다", prm.RemotePower(_W, lambda: "", lambda: "", _fake).once(), prm.IDLE_S)
_W.observe([{"id": "AIR-01", "type": "aerator", "state": 1, "level": ""}])
_W.observe_do(3.0)
_n = len(_calls)
_replies.append((200, {"commands": [{"id": "d1", "circuit": "AIR-01", "action": "set", "on": False}]}))
_RP.once()
check("웹에서 산소공급기를 꺼도 산소가 낮으면 장비가 다시 켠다", _W.desired("AIR-01", _now["t"]), True)

print("\n⑭ 에디션 — 기본(Shrimp365) 화면은 그대로, AMP AquaPilot 은 페이지만 갈아 끼운다")
import ast as _ast                     # noqa: E402
import configparser as _cp             # noqa: E402
import re as _re                       # noqa: E402
import socket as _socket               # noqa: E402
import urllib.error as _uerr           # noqa: E402
import urllib.request as _ureq         # noqa: E402
import display                         # noqa: E402
import updater                         # noqa: E402
import webui                           # noqa: E402
import webui_amp                       # noqa: E402


def _brand(text: str) -> dict:
    c = _cp.ConfigParser()
    c.read_string(text)
    return webui_amp.read_brand(c)


check("[brand] 가 없으면 기본 에디션", (_brand("[server]\nendpoint = x\n")["edition"], _brand("")["name"]),
      ("shrimp365", "Shrimp365"))
check("edition = amp → AMP판, 이름은 webui_amp.PRODUCT_NAME",
      (_brand("[brand]\nedition = AMP \n")["edition"], _brand("[brand]\nedition = amp\n")["name"]),
      ("amp", webui_amp.PRODUCT_NAME))
check("모르는 값이면 기본 에디션", _brand("[brand]\nedition = amp2\n")["edition"], "shrimp365")
check("[brand] 키는 앞뒤 공백을 걷고, 비어 있으면 빈 값(화면이 그 줄을 숨긴다)",
      (_brand("[brand]\nedition = amp\nsupport_phone =  1588-0000 \n")["support_phone"],
       _brand("[brand]\nedition = amp\n")["app_name"]), ("1588-0000", ""))
check("값에 % 가 있어도 설정 읽기가 죽지 않는다", _brand("[brand]\nedition = amp\napp_name = 100%\n")["app_name"], "100%")
check("문자 LCD 첫 줄 — 기본은 예전 그대로, AMP판은 제품명",
      (display.compose({}, 16, 2, 0), display.compose({}, 16, 2, 0, brand=webui_amp.PRODUCT_NAME)[0].strip()),
      (["Shrimp365".center(16), "No sensor data"], webui_amp.PRODUCT_NAME))
_base = webui_amp._base_i18n()
check("webui.py 의 번역(하단줄·운전 권고·센서 진단)을 그대로 꺼내 쓴다",
      all(k + ":" in _base for k in ("st_send_fail", "st_sent", "adv_do_critical", "adv_do_falling", "sen_probe", "v_ok")), True)
check("AMP 페이지에 외부 리소스(CDN·웹폰트·외부 주소)가 없다",
      _re.findall(r"(?:https?:)?//[A-Za-z0-9.-]+\.[A-Za-z]{2,}", webui_amp.PAGE), [])
_rel = Path(__file__).resolve().parent / "release.py"
if _rel.exists():   # 개발 PC 에만 있다(장비 꾸러미에는 없음)
    _payload = next(_ast.literal_eval(n.value) for n in _ast.parse(_rel.read_text(encoding="utf-8")).body
                    if isinstance(n, _ast.Assign) and getattr(n.targets[0], "id", "") == "PAYLOAD")
    check("업데이트 꾸러미에 webui_amp.py 가 들어가고 업데이터가 받는 이름이다",
          ("webui_amp.py" in _payload, updater.allowed_name("webui_amp.py")), (True, True))


def _port() -> int:
    so = _socket.socket()
    so.bind(("127.0.0.1", 0))
    n = so.getsockname()[1]
    so.close()
    return n


def _get(port: int, path: str, body=None) -> tuple[int, bytes]:
    req = _ureq.Request(f"http://127.0.0.1:{port}{path}", data=None if body is None else json.dumps(body).encode(),
                        method="GET" if body is None else "POST", headers={"Content-Type": "application/json"})
    try:
        with _ureq.urlopen(req, timeout=5) as r:
            return r.status, r.read()
    except _uerr.HTTPError as e:
        return e.code, e.read()


_called: list = []
_cb = dict(
    on_pair_start=lambda: _called.append("pair"), on_pair_cancel=lambda: None, on_unlink=lambda: None,
    get_sensors=lambda: {"sensors": [], "interval": 60}, get_lang=lambda: "vi", on_set_lang=lambda l: True,
    get_mode=lambda: {"mode": "agriculture"}, on_set_mode=lambda m: _called.append("mode") or {"ok": True},
    get_nutrient=lambda: {"enabled": True}, on_power_control=lambda b: _called.append("power") or {"ok": True},
    get_wireless=lambda: {}, on_wireless=lambda a, b: _called.append("wireless") or {"ok": True},
)
logging.getLogger("shrimp365.webui").setLevel(logging.ERROR)

# 기본 에디션 — 페이지가 예전 계산(PAGE + 판정 밴드 + 언어 + 모드)과 바이트 단위로 같은가
_st = webui.State()
_pb = _port()
_srv = webui.serve(_st, _pb, language="ko", mode="shrimp")
_code, _html = _get(_pb, "/")
_want = (webui.PAGE.replace("__BANDS__", json.dumps(limits.BANDS)).replace("__NUT_BANDS__", json.dumps(limits.NUTRIENT_BANDS))
         .replace("__LANG__", "ko").replace("__MODE__", "shrimp")).encode()
check("기본 에디션 화면은 예전과 한 글자도 다르지 않다", (_code, _html == _want), (200, True))
_srv.shutdown()
_srv.server_close()

# AMP판 — 같은 엔드포인트·State, 페이지만 다르다. 안 쓰는 콜백(모드·양액·무선·전력 제어)은 404.
_st = webui.State()
_st.update(version="9.9.9", values={"do_level": 5.6})
_pa = _port()
_srv = webui_amp.serve(_st, _pa, brand={"support_phone": "</script>__LANG__", "app_name": "", "pair_url": ""}, **_cb)
check("AMP판 serve 가 뜬다", _srv is not None, True)
_code, _html = _get(_pa, "/")
_page = _html.decode()
check("AMP 페이지 — 창 제목은 제품명, 자리표시가 남지 않는다",
      (_code, f"<title>{webui_amp.PRODUCT_NAME}</title>" in _page, _re.findall(r"__[A-Z_]+__", _page)), (200, True, []))
check("AMP 페이지 — 저장된 화면 언어(get_lang)로 뜬다", '<html lang="vi"' in _page, True)
check("설정값에 </script> 가 들어 있어도 스크립트가 깨지지 않는다", _page.count("</script>"), 1)
check("Shrimp365 표기는 기기 정보의 'Powered by' 한 곳뿐(화면 문구)",
      _page.replace(_base, "").count("Shrimp365"), 1)
check("AMP판 /api/state 는 같은 State 를 준다", json.loads(_get(_pa, "/api/state")[1])["values"], {"do_level": 5.6})
check("AMP판도 같은 엔드포인트로 센서 설정을 읽는다", json.loads(_get(_pa, "/api/sensors")[1])["interval"], 60)
_get(_pa, "/api/pair/start", {})
check("기기 연결 시작이 수집기 콜백에 닿는다", "pair" in _called, True)
check("양식장 고정 — 모드·양액·무선 센서·전력 켜고 끄기 엔드포인트는 열지 않는다",
      [_get(_pa, "/api/mode")[0], _get(_pa, "/api/nutrient")[0], _get(_pa, "/api/mode", {"mode": "agriculture"})[0],
       _get(_pa, "/api/power/control", {"id": "AIR-01"})[0], _get(_pa, "/api/wireless/permit", {})[0]],
      [404, 404, 404, 404, 404])
check("막힌 콜백은 한 번도 불리지 않았다", [c for c in _called if c != "pair"], [])
_srv.shutdown()
_srv.server_close()

print()
if fails:
    print(f"실패 {len(fails)}건:")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print("모두 통과")
