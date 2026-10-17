"""지그비 환경 센서(온습도·토양수분)의 최신값을 장비 화면용으로 읽는다.

지그비 센서는 이 프로그램이 직접 받지 않는다. 같은 파이에서 도는 노지 수집기
(openfield/scripts/zigbee_bridge.py)가 Zigbee2MQTT 메시지를 받아 날짜별 CSV 로
쌓고, 여기서는 그 파일의 끝만 읽어 센서마다 가장 최근 값을 고른다.

    ts,zone,sensor_id,variable,value,unit,quality
    2026-10-17T14:31:05,treatment,CN-T1,rh,78.0,%,ok

이렇게 나눈 이유:
  · 장치 이름 → 변수 매핑(지상 10cm 면 초관부 온도, 2m 면 기온)은 devices.yaml
    한 곳에서 정한다. 장비가 따로 매핑을 가지면 둘이 어긋난다.
  · 장비에 MQTT 패키지를 더 깔지 않는다. 수집기가 죽어도 수질 측정은 그대로다.

화면은 여러 센서를 하나로 합쳐 보여 준다(평균). 센서가 몇 대인지와 가장 오래된
값이 몇 분 전인지 같이 돌려주므로, 하나가 끊겨도 화면에서 알아챌 수 있다.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
from pathlib import Path

FILE_PATTERN = "zigbee_%Y%m%d.csv"   # zigbee_bridge.py 와 같아야 한다
TAIL_BYTES = 256 * 1024              # 파일 끝에서 이만큼만 읽는다. 5분 간격 10대면 하루치보다 많다

# 화면 칸 → 받아 쓸 변수(앞의 것이 있으면 그것을 쓴다).
# 기온(2m)이 있으면 기온을, 없으면 초관부 온도(지상 10cm)를 보여 준다.
SLOTS: list[tuple[str, tuple[str, ...]]] = [
    ("air_temp", ("t_air", "canopy_temp")),
    ("rh", ("rh",)),
    ("soil_moisture", ("soil_moisture",)),
    ("soil_temp", ("soil_temp",)),
]


def _tail_rows(path: Path) -> list[dict]:
    try:
        with path.open("rb") as fh:
            fh.seek(0, 2)
            size = fh.tell()
            fh.seek(max(0, size - TAIL_BYTES))
            raw = fh.read().decode("utf-8", errors="replace")
    except OSError:
        return []
    lines = raw.splitlines()
    if size > TAIL_BYTES and lines:
        lines = lines[1:]                          # 잘린 첫 줄은 버린다
    if lines and lines[0].startswith("ts,"):
        lines = lines[1:]
    reader = csv.DictReader(
        io.StringIO("\n".join(lines)),
        fieldnames=["ts", "zone", "sensor_id", "variable", "value", "unit", "quality"])
    return list(reader)


def read_latest(data_dir: str | Path, zone: str = "", stale_minutes: float = 30,
                now: dt.datetime | None = None) -> dict:
    """칸마다 {"value", "var", "sensors", "age_min"} 를 돌려준다. 값이 없는 칸은 빠진다.

    stale_minutes 보다 오래된 값은 쓰지 않는다 — 배터리가 다 된 센서의 마지막
    값이 몇 시간째 화면에 남아 있으면 지금 값으로 오해한다.
    """
    now = now or dt.datetime.now()
    base = Path(data_dir)
    # 자정 직후에는 오늘 파일이 비어 있을 수 있어 어제 파일도 본다.
    rows: list[dict] = []
    for day in (now - dt.timedelta(days=1), now):
        rows.extend(_tail_rows(base / day.strftime(FILE_PATTERN)))

    cutoff = now - dt.timedelta(minutes=stale_minutes)
    latest: dict[tuple[str, str], tuple[dt.datetime, float]] = {}
    for r in rows:
        if (r.get("quality") or "ok") != "ok":
            continue
        if zone and r.get("zone") != zone:
            continue
        try:
            ts = dt.datetime.fromisoformat((r.get("ts") or "").strip())
            value = float(r.get("value") or "")
        except ValueError:
            continue
        if ts.tzinfo is not None:
            ts = ts.astimezone().replace(tzinfo=None)
        if ts < cutoff or ts > now + dt.timedelta(minutes=5):
            continue
        key = (r.get("variable") or "", r.get("sensor_id") or "")
        if key not in latest or ts >= latest[key][0]:
            latest[key] = (ts, value)

    out: dict[str, dict] = {}
    for slot, candidates in SLOTS:
        for var in candidates:
            hits = [(ts, v) for (name, _sid), (ts, v) in latest.items() if name == var]
            if not hits:
                continue
            oldest = min(ts for ts, _ in hits)
            out[slot] = {
                "value": round(sum(v for _, v in hits) / len(hits), 1),
                "var": var,
                "sensors": len(hits),
                "age_min": max(0, int((now - oldest).total_seconds() // 60)),
            }
            break
    return out
