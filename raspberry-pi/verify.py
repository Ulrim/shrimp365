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
import field_env       # noqa: E402
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
    "2026-10-18T08:00:00,facility,LIGHT-01,light_power,900,W,ok\n"
    "2026-10-18T08:59:00,facility,VALVE-01,valve_state,1,bool,ok\n"
    "2026-10-18T08:59:00,facility,VALVE-01,irrigation_flow,12,L/min,ok\n", encoding="utf-8")
pe = field_env.FieldEnv(pdir, zone="treatment")
circ = {c["id"]: c for c in pe.read_power({"aux-01": "heater"}, now=pnow)}
check("밸브는 회로가 아니다(전력·전류·전력량이 없다)", "VALVE-01" in circ, False)
check("구간을 골라도 분전반 회로는 모두 보인다", sorted(circ), ["AUX-01", "LIGHT-01", "MAIN-01", "PUMP-01"])
check("변수 끝말로 상태·전력·전류·전압을 읽는다",
      (circ["PUMP-01"]["state"], circ["PUMP-01"]["power"], circ["PUMP-01"]["current"], circ["PUMP-01"]["voltage"]),
      (1, 1480, 7.9, 221))
check("오늘 전력량은 구간값을 더한다", circ["PUMP-01"]["energy_today"], 0.65)
check("화면에서 고른 종류가 짐작보다 먼저(대소문자 무관)", (circ["AUX-01"]["type"], circ["PUMP-01"]["type"]),
      ("heater", "irrigation_pump"))
check("차단기 온도 71℃ 주의 · 82℃ 위험", (circ["PUMP-01"]["level"], circ["AUX-01"]["level"]), ("warn", "crit"))
check("30분 넘은 전력은 지금 값으로 보이지 않는다", circ["LIGHT-01"]["power"], None)
summ = field_env.power_summary(list(circ.values()))
check("인입 계측이 있으면 그것이 전체", (summ["total_w"], summ["partial"], summ["level"]), (2350, False, "crit"))
summ2 = field_env.power_summary([c for c in circ.values() if c["type"] != "main"])
check("인입이 없으면 분기 합(부분값으로 표시)", (summ2["total_w"], summ2["partial"]), (1480, True))
sent = {c["id"] for c in field_env.payload_power(list(circ.values()))}
check("서버로는 지금 값이 있는 회로만", sent, {"AUX-01", "MAIN-01", "PUMP-01"})
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

print()
if fails:
    print(f"실패 {len(fails)}건:")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print("모두 통과")
