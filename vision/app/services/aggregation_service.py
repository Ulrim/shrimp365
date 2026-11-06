"""구간 집계(시간 버킷) 조회.

원본은 TimescaleDB 연속집계(count_1min/1hour/1day)를 먼저 시도하고 실패하면
이식 가능한 GROUP BY 로 되돌아갔다. Supabase 에는 timescaledb 확장이 없으므로
그 분기를 걷어내고 한 갈래만 남긴다 — 쓰이지 않는 경로를 남겨 두면 나중에
읽는 사람이 어느 쪽이 실제로 도는지 알 수 없다.

집계는 epoch 를 버킷 크기로 내림해 묶는다. 같은 계산을 Supabase 쪽에서는
vision_count_history() 함수가 하고, 화면(Next.js)은 그 함수를 직접 부른다.
여기 있는 구현은 이 서비스의 API 를 쓰는 쪽(과 테스트)을 위한 것이다.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

INTERVAL_SECONDS = {"1m": 60, "5m": 300, "1h": 3600, "1d": 86400}


def _to_uuid(value: Any) -> uuid.UUID:
    return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))


def _epoch_to_dt(epoch: float) -> datetime:
    return datetime.fromtimestamp(int(epoch), tz=UTC)


def _sqlite_dt(dt: datetime) -> str:
    """Format a datetime the way SQLAlchemy's SQLite DateTime stores it."""
    if dt.tzinfo is not None:
        dt = dt.astimezone(UTC).replace(tzinfo=None)
    return dt.strftime("%Y-%m-%d %H:%M:%S.%f")


class AggregationService:
    async def history(
        self,
        session: AsyncSession,
        camera_id: uuid.UUID,
        start: datetime,
        end: datetime,
        interval: str,
    ) -> list[dict[str, Any]]:
        if interval not in INTERVAL_SECONDS:
            raise ValueError(f"unsupported interval: {interval}")
        secs = INTERVAL_SECONDS[interval]
        dialect = session.get_bind().dialect.name

        if dialect == "postgresql":
            bucket_expr = "floor(extract(epoch FROM time) / :secs) * :secs"
        else:  # sqlite (tests)
            bucket_expr = "(CAST(strftime('%s', time) AS INTEGER) / :secs) * :secs"

        sql = text(
            f"""
            SELECT {bucket_expr} AS bucket_epoch, camera_id, tank_id, farm_id,
                   AVG(count) AS avg_count, MAX(count) AS max_count,
                   MIN(count) AS min_count, COUNT(*) AS sample_count
            FROM count_records
            WHERE camera_id = :camera_id AND time >= :start AND time < :end
            GROUP BY bucket_epoch, camera_id, tank_id, farm_id
            ORDER BY bucket_epoch
            """  # noqa: S608 - bucket_expr from fixed map
        )
        params: dict[str, Any] = {
            "secs": secs,
            "start": start,
            "end": end,
            "camera_id": camera_id,
        }
        if dialect != "postgresql":
            # SQLite: UUIDs are stored as 32-char hex strings and datetimes as
            # naive-UTC "YYYY-MM-DD HH:MM:SS.ffffff" strings — bind to match.
            params["camera_id"] = camera_id.hex
            params["start"] = _sqlite_dt(start)
            params["end"] = _sqlite_dt(end)

        rows = await session.execute(sql, params)
        return [
            {
                "bucket": _epoch_to_dt(row.bucket_epoch),
                "camera_id": _to_uuid(row.camera_id),
                "tank_id": _to_uuid(row.tank_id),
                "farm_id": _to_uuid(row.farm_id),
                "avg_count": int(round(row.avg_count)),
                "max_count": int(row.max_count),
                "min_count": int(row.min_count),
                "sample_count": int(row.sample_count),
            }
            for row in rows
        ]


aggregation_service = AggregationService()
