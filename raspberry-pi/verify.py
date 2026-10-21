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

import atexit
import configparser
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
import webui          # noqa: E402

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


print()
if fails:
    print(f"실패 {len(fails)}건:")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print("모두 통과")
