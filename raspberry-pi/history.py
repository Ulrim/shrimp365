"""장비 화면에서 그래프를 그리기 위한 측정 이력.

재전송 큐(buffer.py)와는 목적이 다르다.
  · 큐는 "아직 못 올린 값"이라 올리고 나면 지운다.
  · 이력은 "화면에 그릴 값"이라 올렸든 아니든 계속 남는다.

인터넷이 끊겨도 그래프는 보여야 하므로 파이 안에 따로 쌓는다.
1분 간격이면 일주일치가 약 10,000건이라 용량은 거의 들지 않는다.
"""

from __future__ import annotations

import logging
import os
import sqlite3
import threading
import time
from pathlib import Path

log = logging.getLogger("shrimp365.history")

# 화면에서 최대 일주일까지 보므로 여유를 두고 8일치만 남긴다.
DEFAULT_RETENTION_DAYS = 8

# 그래프에 찍을 점의 개수. 800px 화면에서 이보다 촘촘하면 어차피 뭉개진다.
# 일주일치 10,000건을 그대로 그리면 라즈베리파이에서 눈에 띄게 버벅인다.
MAX_POINTS = 160

FIELDS = ("temperature", "ph", "do_level", "salinity")

# 환경 센서 한 대 한 대의 값(field_env.FieldEnv.read 의 each). 기온·습도·토양 센서가 여러 대인
# 농장에서 칸을 누르면 센서별 그래프를 그린다. 수집기가 보통 5분마다 적으므로 그 간격으로만 남긴다
# — 센서 20대 × 8일이어도 5만 줄 안쪽이다.
ENV_SLOTS = ("air_temp", "humidity", "soil_moisture", "soil_temp", "wind_speed", "rain_day")
ENV_EVERY_S = 300


class History:
    """측정 이력. 수집 루프와 화면 요청이 함께 쓰므로 잠금을 둔다."""

    def __init__(self, path: str | Path, retention_days: int = DEFAULT_RETENTION_DAYS):
        self.path = Path(path)
        self.retention_days = retention_days
        self._lock = threading.Lock()
        self._conn: sqlite3.Connection | None = None
        self._last_prune = 0.0
        self._last_env = 0

        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self._conn = sqlite3.connect(str(self.path), check_same_thread=False)
            self._conn.execute("pragma journal_mode=WAL")
            self._conn.execute(
                """create table if not exists samples (
                     ts integer primary key,
                     temperature real,
                     ph real,
                     do_level real,
                     salinity real
                   )"""
            )
            self._conn.execute(
                """create table if not exists env_samples (
                     ts integer not null,
                     slot text not null,
                     sid text not null,
                     value real not null,
                     primary key (slot, ts, sid)
                   )"""
            )
            self._conn.commit()
            os.chmod(self.path, 0o600)
        except (sqlite3.Error, OSError) as exc:
            # 이력을 못 써도 측정·전송은 계속되어야 한다. 그래프만 포기한다.
            log.error("이력 저장소를 열지 못했습니다(%s). 그래프 없이 계속합니다.", exc)
            self._conn = None

    @property
    def available(self) -> bool:
        return self._conn is not None

    def record(self, values: dict[str, float], ts: int | None = None) -> None:
        if self._conn is None:
            return
        ts = int(ts if ts is not None else time.time())
        with self._lock:
            try:
                # 같은 초에 두 번 기록되면 나중 것으로 덮어쓴다(재시작 직후 등).
                self._conn.execute(
                    """insert into samples (ts, temperature, ph, do_level, salinity)
                       values (?, ?, ?, ?, ?)
                       on conflict(ts) do update set
                         temperature=excluded.temperature, ph=excluded.ph,
                         do_level=excluded.do_level, salinity=excluded.salinity""",
                    (ts, *(values.get(f) for f in FIELDS)),
                )
                self._conn.commit()
            except sqlite3.Error as exc:
                log.warning("이력 저장 실패: %s", exc)

        # 매번 정리하면 낭비다. 한 시간에 한 번이면 충분하다.
        if time.time() - self._last_prune > 3600:
            self._prune()

    def record_env(self, env: dict | None, ts: int | None = None) -> bool:
        """센서별 지금 값을 남긴다(ENV_EVERY_S 마다 한 번). 남겼으면 True."""
        if self._conn is None or not env:
            return False
        ts = int(ts if ts is not None else time.time())
        if ts - self._last_env < ENV_EVERY_S:
            return False
        rows = [(ts, slot, e["id"], float(e["value"]))
                for slot in ENV_SLOTS
                for e in ((env.get(slot) or {}).get("each") or [])
                if isinstance(e.get("value"), (int, float))]
        if not rows:
            return False
        with self._lock:
            try:
                self._conn.executemany(
                    "insert or replace into env_samples (ts, slot, sid, value) values (?, ?, ?, ?)", rows)
                self._conn.commit()
            except sqlite3.Error as exc:
                log.warning("환경 이력 저장 실패: %s", exc)
                return False
        self._last_env = ts
        return True

    def env_series(self, slot: str, hours: int) -> dict:
        """칸 하나의 센서별 그래프 — {"sensors": [{"id", "points": [[t, 평균], ...]}], "avg": [[t, 평균]],
        "min", "max", "count"}. 구간을 MAX_POINTS 칸으로 나누어 센서마다 평균을 낸다.
        avg 는 같은 칸(시각)에 값이 있는 센서들의 평균 — 화면 칸의 평균과 같은 뜻이다."""
        empty = {"sensors": [], "avg": [], "min": None, "max": None, "count": 0}
        if self._conn is None or slot not in ENV_SLOTS:
            return empty
        now = int(time.time())
        since = now - hours * 3600
        with self._lock:
            try:
                rows = self._conn.execute(
                    "select ts, sid, value from env_samples where slot = ? and ts >= ? order by ts",
                    (slot, since),
                ).fetchall()
            except sqlite3.Error as exc:
                log.warning("환경 이력 조회 실패: %s", exc)
                return empty
        if not rows:
            return empty
        bucket_seconds = max(1, (hours * 3600) // MAX_POINTS)
        per: dict[str, dict[int, list[float]]] = {}
        for ts, sid, value in rows:
            per.setdefault(sid, {}).setdefault((ts - since) // bucket_seconds, []).append(float(value))
        sensors = []
        by_bucket: dict[int, list[float]] = {}
        for sid in sorted(per):
            pts = []
            for index in sorted(per[sid]):
                vals = per[sid][index]
                v = round(sum(vals) / len(vals), 3)
                pts.append([since + index * bucket_seconds, v])
                by_bucket.setdefault(index, []).append(v)
            sensors.append({"id": sid, "points": pts})
        avg = [[since + i * bucket_seconds, round(sum(v) / len(v), 3)] for i, v in sorted(by_bucket.items())]
        values = [float(v) for _, _, v in rows]
        return {"sensors": sensors, "avg": avg, "min": round(min(values), 3),
                "max": round(max(values), 3), "count": len(values)}

    def recent(self, hours: int) -> list[dict]:
        """지정 구간의 **원본** 측정점. 이상탐지(anomaly.py)가 쓴다.

        series() 를 쓰지 않는 이유는 그쪽이 그래프용으로 칸마다 평균을 내기 때문이다.
        평균을 내면 급변이 뭉개져, 정작 찾아야 할 "짧고 깊게 떨어진 구간" 이
        평평해진다. 판정에는 잰 값 그대로가 필요하다.
        """
        if self._conn is None:
            return []
        since = int(time.time()) - hours * 3600
        with self._lock:
            try:
                rows = self._conn.execute(
                    f"select ts, {', '.join(FIELDS)} from samples "
                    "where ts >= ? order by ts",
                    (since,),
                ).fetchall()
            except sqlite3.Error as exc:
                log.warning("이력 조회 실패: %s", exc)
                return []

        out = []
        for row in rows:
            point: dict = {"t": row[0]}
            for name, value in zip(FIELDS, row[1:]):
                if value is not None:
                    point[name] = float(value)
            out.append(point)
        return out

    def series(self, field: str, hours: int) -> dict:
        """지정 구간의 값을 그래프용으로 줄여서 돌려준다.

        구간을 MAX_POINTS 개의 칸으로 나누고 칸마다 평균·최저·최고를 낸다.
        평균만 그리면 짧게 스친 위험값이 사라지므로 최저·최고도 함께 준다.
        """
        empty = {"points": [], "min": None, "max": None, "avg": None, "count": 0}
        if self._conn is None or field not in FIELDS:
            return empty

        now = int(time.time())
        since = now - hours * 3600

        with self._lock:
            try:
                rows = self._conn.execute(
                    f"select ts, {field} from samples "
                    f"where ts >= ? and {field} is not null order by ts",
                    (since,),
                ).fetchall()
            except sqlite3.Error as exc:
                log.warning("이력 조회 실패: %s", exc)
                return empty

        if not rows:
            return empty

        bucket_seconds = max(1, (hours * 3600) // MAX_POINTS)
        buckets: dict[int, list[float]] = {}
        for ts, value in rows:
            buckets.setdefault((ts - since) // bucket_seconds, []).append(float(value))

        points = []
        for index in sorted(buckets):
            vals = buckets[index]
            points.append([
                since + index * bucket_seconds,      # 칸의 시작 시각
                round(sum(vals) / len(vals), 3),     # 평균
                round(min(vals), 3),
                round(max(vals), 3),
            ])

        all_values = [float(v) for _, v in rows]
        return {
            "points": points,
            "min": round(min(all_values), 3),
            "max": round(max(all_values), 3),
            "avg": round(sum(all_values) / len(all_values), 3),
            "count": len(all_values),
        }

    def _prune(self) -> None:
        if self._conn is None:
            return
        cutoff = int(time.time()) - self.retention_days * 86400
        with self._lock:
            try:
                self._conn.execute("delete from samples where ts < ?", (cutoff,))
                self._conn.execute("delete from env_samples where ts < ?", (cutoff,))
                self._conn.commit()
                self._last_prune = time.time()
            except sqlite3.Error as exc:
                log.warning("이력 정리 실패: %s", exc)

    def close(self) -> None:
        if self._conn is None:
            return
        with self._lock:
            try:
                self._conn.close()
            except sqlite3.Error:
                pass
            self._conn = None
