"""환경·기상 센서(지그비 온습도·토양수분, 기상센서)의 최신값을 읽는다.

센서는 이 프로그램이 직접 받지 않는다. 같은 파이에서 도는 노지 수집기
(openfield/scripts/)가 받아 날짜별 CSV 로 쌓고, 여기서는 그 파일을 읽어
칸마다 가장 최근 값을 고른다. 세 수집기의 형식이 같다::

    zigbee_YYYYMMDD.csv    zigbee_bridge.py     온습도·토양수분·지온 (Zigbee2MQTT)
    rtl433_YYYYMMDD.csv    rtl433_bridge.py     기상센서 WS90 (433MHz 동글)
    ecowitt_YYYYMMDD.csv   ecowitt_receiver.py  기상센서 WS90 (에코윗 게이트웨이)

    ts,zone,sensor_id,variable,value,unit,quality
    2026-10-17T14:31:05,treatment,CN-T1,rh,78.0,%,ok

이렇게 나눈 이유:
  · 장치 이름 → 변수 매핑(지상 10cm 면 초관부 온도, 2m 면 기온)은 devices.yaml
    한 곳에서 정한다. 장비가 따로 매핑을 가지면 둘이 어긋난다.
  · 장비에 MQTT·SDR 패키지를 더 깔지 않는다. 수집기가 죽어도 수질 측정은 그대로다.

**파일을 매번 처음부터 읽지 않는다.** 기상센서는 8초마다 열 줄 남짓을 쓰므로
하루치가 수 MB 가 된다. 파일마다 어디까지 읽었는지 기억해 두고 새 줄만 읽는다.
그래서 모듈 함수가 아니라 객체(FieldEnv)를 하나 만들어 계속 쓴다.

칸의 이름은 서버 수신 칸(app/api/sensors/data ENV_FIELDS)과 같다. 화면·서버·웹이
같은 이름을 본다.
"""

from __future__ import annotations

import datetime as dt
import math
from pathlib import Path

#: 수집기 파일 이름 앞부분. 뒤에 _YYYYMMDD.csv 가 붙는다.
SOURCES = ("zigbee", "rtl433", "ecowitt")
#: 기상 마스트 — 구간(zone)을 골라도 기상센서는 함께 본다(두 구간 공통 기준이라).
ZONE_MAST = "mast"

#: 칸 → 받아 쓸 변수(앞의 것이 있으면 그것을 쓴다).
SLOTS: list[tuple[str, tuple[str, ...]]] = [
    # 기온(2m)이 있으면 기온을, 없으면 초관부 온도(지상 10cm)를 쓴다.
    ("air_temp", ("t_air", "canopy_temp")),
    ("humidity", ("rh",)),
    ("soil_moisture", ("soil_moisture",)),
    ("soil_temp", ("soil_temp",)),
    ("wind_speed", ("wind_speed",)),
    # 참 3초 순간최대가 있으면 그것, 없으면 WS90 의 28초 창 최댓값.
    ("wind_gust", ("wind_gust_3s", "wind_gust_window")),
    ("wind_dir", ("wind_dir",)),
    ("rain_rate", ("rain_rate",)),
    ("solar", ("solar",)),
    ("uv_index", ("uv_index",)),
    ("pressure", ("pressure_hpa",)),
]
#: 오늘 강수량(mm) — 수집기가 적산값을 구간 증가분(rain)으로 바꿔 적으므로 오늘 것을 더한다.
RAIN_VAR = "rain"
RAIN_SLOT = "rain_day"

#: 칸별 소수 자리. 서버로 보낼 때도 이 자리로 자른다.
DIGITS = {"air_temp": 1, "humidity": 1, "soil_moisture": 1, "soil_temp": 1,
          "wind_speed": 1, "wind_gust": 1, "wind_dir": 0, "rain_rate": 1,
          "rain_day": 1, "solar": 0, "uv_index": 1, "pressure": 1}

#: 기상센서가 있는지 — 화면이 기상 칸을 띄울지 정할 때 쓴다.
WEATHER_SLOTS = frozenset({"wind_speed", "wind_gust", "wind_dir", "rain_rate",
                           "rain_day", "solar", "uv_index", "pressure"})

_WANTED = {v for _, vs in SLOTS for v in vs} | {RAIN_VAR}


class FieldEnv:
    """수집기 CSV 를 이어 읽으며 칸마다 최신값을 들고 있는다."""

    def __init__(self, data_dir: str | Path, zone: str = "", stale_minutes: float = 30) -> None:
        self.dir = Path(data_dir)
        self.zone = zone.strip()
        self.stale = dt.timedelta(minutes=stale_minutes)
        self._offset: dict[Path, tuple[int, int]] = {}      # 파일 → (inode, 읽은 바이트)
        self._latest: dict[tuple[str, str], tuple[dt.datetime, float]] = {}
        self._rain: dict[tuple[dt.date, str], tuple[dt.datetime, float]] = {}

    # ── 읽기 ────────────────────────────────────────────────────────────────
    def _feed(self, path: Path) -> None:
        try:
            st = path.stat()
        except OSError:
            return
        inode, done = self._offset.get(path, (st.st_ino, 0))
        if inode != st.st_ino or st.st_size < done:          # 갈아 끼웠거나 줄었다 → 처음부터
            done = 0
        if st.st_size == done:
            self._offset[path] = (st.st_ino, done)
            return
        try:
            with path.open("rb") as fh:
                fh.seek(done)
                chunk = fh.read()
        except OSError:
            return
        # 수집기가 쓰는 도중이면 마지막 줄이 덜 쓰였을 수 있다. 줄바꿈까지만 쓰고
        # 나머지는 다음에 다시 읽는다.
        end = chunk.rfind(b"\n")
        if end < 0:
            return
        self._offset[path] = (st.st_ino, done + end + 1)
        for line in chunk[:end].decode("utf-8", errors="replace").splitlines():
            self._row(line)

    def _row(self, line: str) -> None:
        parts = line.split(",")
        if len(parts) < 7 or parts[0] == "ts":
            return
        ts_s, zone, sid, var, val_s, _unit, quality = parts[:7]
        if var not in _WANTED or (quality or "ok").strip() != "ok":
            return
        if self.zone and zone not in (self.zone, ZONE_MAST):
            return
        try:
            ts = dt.datetime.fromisoformat(ts_s.strip())
            value = float(val_s)
        except ValueError:
            return
        if not math.isfinite(value):
            return
        if ts.tzinfo is not None:
            ts = ts.astimezone().replace(tzinfo=None)
        if var == RAIN_VAR:
            key = (ts.date(), sid)
            last, total = self._rain.get(key, (ts, 0.0))
            self._rain[key] = (max(last, ts), total + value)
            return
        key = (var, sid)
        if key not in self._latest or ts >= self._latest[key][0]:
            self._latest[key] = (ts, value)

    def read(self, now: dt.datetime | None = None) -> dict:
        """칸마다 {"value", "var", "sensors", "age_min"} 를 돌려준다. 값이 없는 칸은 빠진다.

        stale_minutes 보다 오래된 값은 쓰지 않는다 — 배터리가 다 된 센서의 마지막
        값이 몇 시간째 화면·서버에 남아 있으면 지금 값으로 오해한다.
        """
        now = now or dt.datetime.now()
        # 자정 직후에는 오늘 파일이 비어 있을 수 있어 어제 파일도 본다.
        for day in (now - dt.timedelta(days=1), now):
            for src in SOURCES:
                self._feed(self.dir / f"{src}_{day:%Y%m%d}.csv")
        # 이틀 넘은 파일의 읽은 자리는 잊는다(장비가 몇 달 켜져 있어도 늘지 않게).
        keep = {f"{d:%Y%m%d}" for d in (now - dt.timedelta(days=1), now)}
        self._offset = {p: o for p, o in self._offset.items() if p.stem[-8:] in keep}
        self._rain = {k: v for k, v in self._rain.items() if k[0] == now.date()}

        lo, hi = now - self.stale, now + dt.timedelta(minutes=5)
        fresh = {k: v for k, v in self._latest.items() if lo <= v[0] <= hi}
        self._latest = {k: v for k, v in self._latest.items() if v[0] >= now - dt.timedelta(days=1)}

        out: dict[str, dict] = {}
        for slot, candidates in SLOTS:
            for var in candidates:
                hits = [(ts, v) for (name, _sid), (ts, v) in fresh.items() if name == var]
                if not hits:
                    continue
                if slot == "wind_dir":
                    # 방위는 각도라 산술평균이 틀린다(350° 와 10° 의 평균은 0° 다).
                    x = sum(math.cos(math.radians(v)) for _, v in hits)
                    y = sum(math.sin(math.radians(v)) for _, v in hits)
                    value = math.degrees(math.atan2(y, x)) % 360
                else:
                    value = sum(v for _, v in hits) / len(hits)
                out[slot] = _slot(slot, value, var, hits, now)
                break
        rain = [(ts, total) for (day, _sid), (ts, total) in self._rain.items()
                if day == now.date() and lo <= ts <= hi]
        if rain:
            out[RAIN_SLOT] = _slot(RAIN_SLOT, sum(t for _, t in rain) / len(rain), RAIN_VAR, rain, now)
        return out


def _slot(slot: str, value: float, var: str, hits: list, now: dt.datetime) -> dict:
    oldest = min(ts for ts, _ in hits)
    return {
        "value": round(value, DIGITS[slot]),
        "var": var,
        "sensors": len(hits),
        "age_min": max(0, int((now - oldest).total_seconds() // 60)),
    }


def payload_values(env: dict) -> dict:
    """서버로 보낼 값만 뽑는다 — {"air_temp": 23.4, ...}. 칸 이름이 곧 서버 칸 이름이다."""
    return {k: e["value"] for k, e in (env or {}).items() if isinstance(e.get("value"), (int, float))}
