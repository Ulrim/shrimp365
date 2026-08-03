"""인터넷이 끊긴 동안 측정값을 라즈베리파이에 모아 두는 저장소.

회선이 죽어도 센서는 계속 돌아간다. 그동안의 값을 버리면 나중에 그래프에
구멍이 남고, 정작 사고가 났던 시간대의 기록이 사라진다. 그래서 전송에 실패한
값(그리고 아직 계정에 연결하지 않은 동안의 값)을 여기에 쌓아 두었다가,
연결이 돌아오면 **끊겼던 시점부터 순서대로** 다시 올린다.

SQLite 를 쓰는 이유
  · 파이썬에 기본 내장이라 설치할 것이 없다.
  · 전원이 갑자기 나가도 파일이 깨지지 않는다(정전이 잦은 현장을 고려).
  · 오래된 것부터 꺼내고 지우는 일이 단순하다.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
from pathlib import Path

log = logging.getLogger("shrimp365.buffer")

# 5분 간격이면 하루 288건. 20,000건이면 약 70일치다.
# 그보다 오래 끊겨 있었다면 가장 오래된 것부터 버린다.
DEFAULT_MAX_ROWS = 20_000


class Buffer:
    """전송하지 못한 측정값 큐. 스레드 하나에서만 쓰지만 잠금을 둔다."""

    def __init__(self, path: str | Path, max_rows: int = DEFAULT_MAX_ROWS):
        self.path = Path(path)
        self.max_rows = max_rows
        self._lock = threading.Lock()
        self._conn: sqlite3.Connection | None = None

        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            # 수집 루프와 재전송이 같은 연결을 쓰므로 스레드 확인을 끈다.
            self._conn = sqlite3.connect(str(self.path), check_same_thread=False)
            # 정전 대비 — 쓰기 순서를 보장한다.
            self._conn.execute("pragma journal_mode=WAL")
            self._conn.execute("pragma synchronous=FULL")
            self._conn.execute(
                """create table if not exists readings (
                     id integer primary key autoincrement,
                     recorded_at text not null,
                     payload text not null
                   )"""
            )
            self._conn.commit()
            os.chmod(self.path, 0o600)
        except (sqlite3.Error, OSError) as exc:
            # 저장소를 못 열어도 수집·전송은 계속되어야 한다. 버퍼만 포기한다.
            log.error("오프라인 저장소를 열지 못했습니다(%s). 버퍼 없이 계속합니다.", exc)
            self._conn = None

    @property
    def available(self) -> bool:
        return self._conn is not None

    def append(self, payload: dict, recorded_at: str) -> None:
        if self._conn is None:
            return
        with self._lock:
            try:
                self._conn.execute(
                    "insert into readings (recorded_at, payload) values (?, ?)",
                    (recorded_at, json.dumps(payload, ensure_ascii=False)),
                )
                self._conn.commit()
                self._prune_locked()
            except sqlite3.Error as exc:
                log.warning("오프라인 저장 실패: %s", exc)

    def pending(self) -> int:
        if self._conn is None:
            return 0
        with self._lock:
            try:
                row = self._conn.execute("select count(*) from readings").fetchone()
                return int(row[0]) if row else 0
            except sqlite3.Error:
                return 0

    def take(self, limit: int) -> list[tuple[int, str, dict]]:
        """오래된 것부터 꺼낸다. 끊겼던 시점부터 순서대로 올리기 위함."""
        if self._conn is None:
            return []
        with self._lock:
            try:
                rows = self._conn.execute(
                    "select id, recorded_at, payload from readings order by id limit ?",
                    (limit,),
                ).fetchall()
            except sqlite3.Error as exc:
                log.warning("오프라인 저장소 읽기 실패: %s", exc)
                return []

        out: list[tuple[int, str, dict]] = []
        for row_id, recorded_at, payload in rows:
            try:
                out.append((row_id, recorded_at, json.loads(payload)))
            except ValueError:
                # 깨진 행은 버린다. 하나 때문에 전체가 막히면 안 된다.
                self.drop([row_id])
        return out

    def drop(self, ids: list[int]) -> None:
        if self._conn is None or not ids:
            return
        with self._lock:
            try:
                self._conn.executemany("delete from readings where id = ?", [(i,) for i in ids])
                self._conn.commit()
            except sqlite3.Error as exc:
                log.warning("오프라인 저장소 삭제 실패: %s", exc)

    def _prune_locked(self) -> None:
        """상한을 넘으면 가장 오래된 것부터 버린다.
        디스크가 가득 차 파이 자체가 멈추는 편이 더 나쁘다."""
        try:
            row = self._conn.execute("select count(*) from readings").fetchone()  # type: ignore[union-attr]
            count = int(row[0]) if row else 0
            if count <= self.max_rows:
                return
            excess = count - self.max_rows
            self._conn.execute(  # type: ignore[union-attr]
                "delete from readings where id in (select id from readings order by id limit ?)",
                (excess,),
            )
            self._conn.commit()  # type: ignore[union-attr]
            log.warning("오프라인 저장 상한 초과 — 가장 오래된 %d건을 버렸습니다.", excess)
        except sqlite3.Error as exc:
            log.warning("오프라인 저장소 정리 실패: %s", exc)

    def close(self) -> None:
        if self._conn is None:
            return
        with self._lock:
            try:
                self._conn.close()
            except sqlite3.Error:
                pass
            self._conn = None
