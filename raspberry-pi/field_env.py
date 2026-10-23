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

칸의 이름은 서버 수신 칸(lib/env-params.ts ENV_PARAMS → app/api/sensors/data)과 같다. 화면·서버·웹이
같은 이름을 본다.
"""

from __future__ import annotations

import datetime as dt
import math
import os
import re
from pathlib import Path

import limits

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

# ── 전력 회로 (Zigbee 계측 차단기·클램프 전력계) ──────────────────────────────
# 회로는 센서(sensor_id) 하나다. 변수 이름은 devices.yaml 매핑이 장치마다 정해
# (circuit_state·pump_power, aux_circuit_state·motor_current, circ_state·circ_power …)
# 끝말로 뜻을 읽는다. 전력·전류·전력량 중 하나라도 보내는 센서만 회로로 본다 —
# 밸브(valve_state)·누수 센서가 회로로 섞이지 않는다.

#: 부하 종류 — 화면·서버·웹(lib/power-params.ts)이 같은 이름을 쓴다.
#: 설계서 docs/plans/farm365-main-panel.md 4-1 카탈로그와 같다.
POWER_TYPES = ("main", "aerator", "circulation_pump", "irrigation_pump", "heater",
               "ventilation", "cooling", "lighting", "uv", "dosing", "feeder", "other")
#: 처음 보는 회로의 종류를 센서 이름 앞부분으로 짐작한다. 틀리면 화면에서 바꾼다.
_TYPE_GUESS = (("MAIN", "main"), ("PUMP", "irrigation_pump"), ("CIRC", "circulation_pump"),
               ("AUX", "ventilation"), ("UV", "uv"), ("LIGHT", "lighting"),
               ("AIR", "aerator"), ("HEAT", "heater"))


#: 회로(센서) 이름 규칙 — 서버 lib/power.ts ID_RE 와 같다. 어긋난 이름은 서버가 버리므로
#: 장비도 화면·업로드에서 뺀다(화면 HTML 에 그대로 들어가도 안전한 글자만 남는다).
CIRCUIT_ID_RE = re.compile(r"^[A-Za-z0-9_.-]{1,32}$")


def guess_type(sensor_id: str) -> str:
    sid = sensor_id.upper()
    for prefix, kind in _TYPE_GUESS:
        if sid.startswith(prefix):
            return kind
    return "other"


def _power_field(var: str) -> str | None:
    if var == "line_voltage":
        return "voltage"
    if var == "device_temp":
        return "temp"
    for suffix, field in (("_state", "state"), ("_current", "current"),
                          ("_power", "power"), ("_energy", "energy")):
        if var.endswith(suffix):
            return field
    return None


def breaker_level(temp: float | None) -> str:
    """차단기 본체 온도 → "" · "warn" · "crit". 기준은 limits.BREAKER_TEMP 한 곳."""
    if temp is None:
        return ""
    if temp >= limits.BREAKER_TEMP["crit"]:
        return "crit"
    if temp >= limits.BREAKER_TEMP["warn"]:
        return "warn"
    return ""


class FieldEnv:
    """수집기 CSV 를 이어 읽으며 칸마다 최신값을 들고 있는다."""

    def __init__(self, data_dir: str | Path, zone: str = "", stale_minutes: float = 30) -> None:
        self.dir = Path(data_dir)
        self.zone = zone.strip()
        self.stale = dt.timedelta(minutes=stale_minutes)
        self._offset: dict[Path, tuple[int, int]] = {}      # 파일 → (inode, 읽은 바이트)
        self._latest: dict[tuple[str, str], tuple[dt.datetime, float]] = {}
        # 강수 누계는 (파일, 날짜, 센서) 마다 따로 센다. 파일을 처음부터 다시 읽게 되면
        # (수집기가 파일을 새로 만들었거나 잘랐을 때) 그 파일 몫만 지우고 다시 더한다 —
        # 안 그러면 이미 더한 비를 한 번 더 더한다. 같은 WS90 을 rtl433·에코윗 둘로 받아도
        # 파일이 달라 따로 쌓이고, 읽을 때 평균을 내므로 두 배가 되지 않는다.
        self._rain: dict[tuple[str, dt.date, str], tuple[dt.datetime, float]] = {}
        # 전력 회로 — (센서, 뜻) → (시각, 값). 전력량은 강수와 같은 방식으로 오늘 것을 더한다.
        self._pw: dict[tuple[str, str], tuple[dt.datetime, float]] = {}
        self._energy: dict[tuple[str, dt.date, str], tuple[dt.datetime, float]] = {}

    # ── 읽기 ────────────────────────────────────────────────────────────────
    def _feed(self, path: Path) -> None:
        try:
            st = path.stat()
        except OSError:
            return
        inode, done = self._offset.get(path, (st.st_ino, 0))
        if inode != st.st_ino or st.st_size < done:          # 갈아 끼웠거나 줄었다 → 처음부터
            done = 0
            self._rain = {k: v for k, v in self._rain.items() if k[0] != path.name}
            self._energy = {k: v for k, v in self._energy.items() if k[0] != path.name}
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
            self._row(line, path.name)

    def _row(self, line: str, src: str = "") -> None:
        parts = line.split(",")
        if len(parts) < 7 or parts[0] == "ts":
            return
        ts_s, zone, sid, var, val_s, _unit, quality = parts[:7]
        pfield = _power_field(var)
        if (var not in _WANTED and pfield is None) or (quality or "ok").strip() != "ok":
            return
        # 전력 회로는 구간(zone)과 무관하다 — 분전반은 농장에 하나다.
        if pfield is None and self.zone and zone not in (self.zone, ZONE_MAST):
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
        if pfield is not None:
            if pfield == "energy":
                ekey = (src, ts.date(), sid)
                last, total = self._energy.get(ekey, (ts, 0.0))
                self._energy[ekey] = (max(last, ts), total + value)
                return
            pkey = (sid, pfield)
            if pkey not in self._pw or ts >= self._pw[pkey][0]:
                self._pw[pkey] = (ts, value)
            return
        if var == RAIN_VAR:
            rkey = (src, ts.date(), sid)
            last, total = self._rain.get(rkey, (ts, 0.0))
            self._rain[rkey] = (max(last, ts), total + value)
            return
        key = (var, sid)
        if key not in self._latest or ts >= self._latest[key][0]:
            self._latest[key] = (ts, value)

    def _feed_all(self, now: dt.datetime) -> None:
        # 자정 직후에는 오늘 파일이 비어 있을 수 있어 어제 파일도 본다.
        for day in (now - dt.timedelta(days=1), now):
            for src in SOURCES:
                self._feed(self.dir / f"{src}_{day:%Y%m%d}.csv")
        # 이틀 넘은 파일의 읽은 자리는 잊는다(장비가 몇 달 켜져 있어도 늘지 않게).
        keep = {f"{d:%Y%m%d}" for d in (now - dt.timedelta(days=1), now)}
        self._offset = {p: o for p, o in self._offset.items() if p.stem[-8:] in keep}
        self._rain = {k: v for k, v in self._rain.items() if k[1] == now.date()}
        self._energy = {k: v for k, v in self._energy.items() if k[1] == now.date()}
        day_ago = now - dt.timedelta(days=1)
        self._pw = {k: v for k, v in self._pw.items() if v[0] >= day_ago}

    def read(self, now: dt.datetime | None = None) -> dict:
        """칸마다 {"value", "var", "sensors", "age_min", "each"} 를 돌려준다. 값이 없는 칸은 빠진다.

        value 는 지금 값이 있는 센서의 평균이다. each 는 센서 하나하나 —
        [{"id", "value", "age_min"}], 이름순. 24시간 안에 값을 보냈지만 지금은 끊긴 센서도
        value=None 으로 남긴다(평균에서 빠진 센서가 어느 것인지 화면에서 찾게).

        stale_minutes 보다 오래된 값은 쓰지 않는다 — 배터리가 다 된 센서의 마지막
        값이 몇 시간째 화면·서버에 남아 있으면 지금 값으로 오해한다.
        """
        now = now or dt.datetime.now()
        self._feed_all(now)

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
                each = [(sid, ts, v if lo <= ts <= hi else None)
                        for (name, sid), (ts, v) in self._latest.items() if name == var]
                out[slot] = _slot(slot, value, var, hits, now, each)
                break
        today = {k: v for k, v in self._rain.items() if k[1] == now.date()}
        rain = [(ts, total) for (ts, total) in today.values() if lo <= ts <= hi]
        if rain:
            # 같은 WS90 을 두 수집기가 받으면 파일이 둘이다 — 센서마다 평균 한 줄로.
            per: dict[str, list[tuple[dt.datetime, float]]] = {}
            for (_src, _day, sid), tv in today.items():
                per.setdefault(sid, []).append(tv)
            each = []
            for sid, tvs in per.items():
                ts = max(t for t, _ in tvs)
                v = sum(x for _, x in tvs) / len(tvs)
                each.append((sid, ts, v if lo <= ts <= hi else None))
            out[RAIN_SLOT] = _slot(RAIN_SLOT, sum(t for _, t in rain) / len(rain), RAIN_VAR, rain, now, each)
        return out

    def read_power(self, types: dict[str, str] | None = None,
                   now: dt.datetime | None = None) -> list[dict]:
        """전력 회로 목록. 회로마다
        {"id", "type", "state", "power", "current", "voltage", "energy_today", "temp", "level", "age_min"}.

        types 는 화면에서 고른 종류(센서 이름 → 종류). 없으면 이름 앞부분으로 짐작한다.
        stale_minutes 보다 오래된 값은 None 이다 — 끊긴 회로의 마지막 전력을 지금 값으로
        보이면 안 된다. 오늘 전력량은 끊겨도 남긴다(그때까지 쓴 양은 사실이다).
        24시간 넘게 아무 값도 없는 회로는 목록에서 빠진다.
        """
        now = now or dt.datetime.now()
        self._feed_all(now)
        types = {k.upper(): v for k, v in (types or {}).items()}
        lo, hi = now - self.stale, now + dt.timedelta(minutes=5)

        energy: dict[str, list[float]] = {}
        energy_ts: dict[str, dt.datetime] = {}
        for (_src, day, sid), (ts, total) in self._energy.items():
            if day == now.date():
                energy.setdefault(sid, []).append(total)
                energy_ts[sid] = max(energy_ts.get(sid, ts), ts)

        by_sid: dict[str, dict[str, tuple[dt.datetime, float]]] = {}
        for (sid, field), tv in self._pw.items():
            by_sid.setdefault(sid, {})[field] = tv
        for sid in energy:
            by_sid.setdefault(sid, {})

        out: list[dict] = []
        for sid, fields in sorted(by_sid.items()):
            # 회로인가 — 전력·전류·전력량 중 하나는 있어야 한다.
            if not ({"power", "current"} & fields.keys()) and sid not in energy:
                continue
            if not CIRCUIT_ID_RE.match(sid):
                continue
            stamps = [ts for ts, _ in fields.values()] + ([energy_ts[sid]] if sid in energy_ts else [])
            newest = max(stamps)

            def fresh(field: str):
                tv = fields.get(field)
                return tv[1] if tv and lo <= tv[0] <= hi else None

            state = fresh("state")
            temp = fresh("temp")
            kind = types.get(sid.upper())
            if kind not in POWER_TYPES:
                kind = guess_type(sid)
            # 같은 회로를 두 수집기 파일이 적었다면(드묾) 평균 — 강수와 같은 규칙.
            e = energy.get(sid)
            out.append({
                "id": sid,
                "type": kind,
                "state": None if state is None else (1 if state >= 0.5 else 0),
                "power": _r(fresh("power"), 0),
                "current": _r(fresh("current"), 2),
                "voltage": _r(fresh("voltage"), 0),
                "energy_today": round(sum(e) / len(e), 3) if e else None,
                "temp": _r(temp, 1),
                "level": breaker_level(temp),
                "age_min": max(0, int((now - newest).total_seconds() // 60)),
            })
        return out


def _r(v: float | None, digits: int):
    return None if v is None else round(v, digits)


def power_summary(circuits: list[dict]) -> dict:
    """화면 머리 칩용 — 전체 전력(W)과 가장 급한 과열 단계.

    인입(main) 계측이 살아 있으면 그 값이 전체다. 없으면 분기 회로의 합이다
    (계측 안 되는 회로가 빠지므로 '적어도 이만큼'이다 — partial 로 알린다).
    """
    main = [c for c in circuits if c["type"] == "main" and c["power"] is not None]
    branch = [c for c in circuits if c["type"] != "main" and c["power"] is not None]
    if main:
        total, partial = sum(c["power"] for c in main), False
    elif branch:
        total, partial = sum(c["power"] for c in branch), True
    else:
        total, partial = None, False
    rank = {"": 0, "warn": 1, "crit": 2}
    worst = max((c["level"] for c in circuits), key=lambda x: rank[x], default="")
    return {"total_w": None if total is None else round(total), "partial": partial, "level": worst}


def payload_power(circuits: list[dict]) -> list[dict]:
    """서버로 보낼 회로 값 — 지금 값(state·power·current·voltage·temp)이 하나라도 있는 회로만."""
    keys = ("state", "power", "current", "voltage", "temp")
    out = []
    for c in circuits:
        if all(c[k] is None for k in keys):
            continue
        out.append({k: c[k] for k in ("id", "type", *keys, "energy_today")})
    return out


def _age(now: dt.datetime, ts: dt.datetime) -> int:
    return max(0, int((now - ts).total_seconds() // 60))


def _slot(slot: str, value: float, var: str, hits: list, now: dt.datetime,
          each: list[tuple[str, dt.datetime, float | None]]) -> dict:
    oldest = min(ts for ts, _ in hits)
    return {
        "value": round(value, DIGITS[slot]),
        "var": var,
        "sensors": len(hits),
        "age_min": _age(now, oldest),
        "each": [{"id": sid, "value": None if v is None else round(v, DIGITS[slot]), "age_min": _age(now, ts)}
                 for sid, ts, v in sorted(each)],
    }


#: 서버로 센서별 값을 올릴 칸 — 웹 "환경·기상" 카드에서 칸을 누르면 펼쳐지는 것과 같다.
#: 풍향·돌풍·강우강도는 웹에서 따로 칸이 아니라(다른 칸에 접힌다) 보내지 않는다.
EACH_SLOTS = ("air_temp", "humidity", "soil_moisture", "soil_temp", "wind_speed", "rain_day")
EACH_MAX = 16


def payload_each(env: dict) -> dict:
    """서버로 보낼 센서별 지금 값 — {"air_temp": [{"id": "TH-01", "v": 23.1}, ...], ...}.

    끊긴 센서(value=None)는 보내지 않는다 — 서버는 지금 값만 저장한다.
    서버 규칙(lib/env-params.ts parseEnvEach)과 같이 이름이 CIRCUIT_ID_RE 에 맞는 센서만, 칸마다 EACH_MAX 대까지.
    """
    out: dict[str, list[dict]] = {}
    for k in EACH_SLOTS:
        rows = [{"id": e["id"].upper(), "v": e["value"]} for e in ((env or {}).get(k) or {}).get("each", [])
                if e["value"] is not None and CIRCUIT_ID_RE.match(e["id"])]
        if len(rows) >= 2:           # 한 대뿐이면 평균이 곧 그 센서다 — 따로 보낼 것이 없다
            out[k] = rows[:EACH_MAX]
    return out


def payload_values(env: dict) -> dict:
    """서버로 보낼 값만 뽑는다 — {"air_temp": 23.4, ...}. 칸 이름이 곧 서버 칸 이름이다."""
    return {k: e["value"] for k, e in (env or {}).items() if isinstance(e.get("value"), (int, float))}


def save_power_type(config_path: Path, sensor_id: str, kind: str) -> bool:
    """[power_circuits] 구간에 "센서이름 = 종류" 를 적는다. 주석과 다른 구간은 그대로 둔다.

    키는 정확히 같은 이름만 바꾼다(앞부분이 같은 PUMP-01·PUMP-010 을 섞지 않게).
    """
    try:
        lines = config_path.read_text(encoding="utf-8").splitlines(keepends=True)
    except OSError:
        return False
    target = sensor_id.upper()
    in_sec, sec_end, done = False, None, False
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            if in_sec and sec_end is None:
                sec_end = i
            in_sec = stripped.lower() == "[power_circuits]"
            continue
        if in_sec and ("=" in stripped or ":" in stripped) and not stripped.startswith((";", "#")):
            # configparser 는 "=" 와 ":" 를 둘 다 구분자로 읽는다 — 손으로 ":" 를 쓴 줄도 같은 키다.
            if re.split(r"[=:]", stripped, maxsplit=1)[0].strip().upper() == target:
                lines[i] = f"{target} = {kind}\n"
                done = True
    if not done:
        new = f"{target} = {kind}\n"
        if sec_end is not None:
            lines.insert(sec_end, new)
        elif in_sec:
            if lines and not lines[-1].endswith("\n"):
                lines[-1] += "\n"
            lines.append(new)
        else:
            if lines and not lines[-1].endswith("\n"):
                lines[-1] += "\n"
            lines.extend(["\n[power_circuits]\n", new])
    try:
        # 임시 파일에 쓰고 바꿔 끼운다 — 쓰는 도중 전원이 나가도 설정 파일이 반쪽이 되지 않게.
        tmp = config_path.with_name(config_path.name + ".tmp")
        tmp.write_text("".join(lines), encoding="utf-8")
        os.chmod(tmp, 0o600)
        os.replace(tmp, config_path)
        return True
    except OSError:
        return False
