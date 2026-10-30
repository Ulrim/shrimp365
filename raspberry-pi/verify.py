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

import json
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
import field_env       # noqa: E402
import wireless        # noqa: E402
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

print("\n⑧ 환경·기상 센서 — 수집기 CSV 에서 화면·서버 값 고르기")
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
print("\n⑨ 전력 회로 — Zigbee 계측 차단기·클램프 전력계")
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


print("\n⑩ 무선 센서 — 화면에서 찾기·등록·빼기")
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

print("\n⑪ 투야 블루투스 토양센서 — 등록 칸, 화면 상태, 수집 파일")
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


print("\n⑫ 전력 회로 켜고 끄기 — 수동·시간 예약·반복 간격·안전")
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

print("\n⑬ 웹에서 켜고 끄기 — 서버 명령함(power_remote.py)")
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

print()
if fails:
    print(f"실패 {len(fails)}건:")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print("모두 통과")
