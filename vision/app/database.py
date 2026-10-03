"""Async SQLAlchemy engine / session factory + startup checks.

Models declare against `Base`; request handlers depend on `get_session`.
Background services (stream processors) open their own sessions via
`SessionLocal`.

The engine is created lazily from `settings.database_url` so tests can point
DATABASE_URL at a temporary SQLite file before importing the app.

**스키마는 이 서비스가 만들지 않는다.** shrimp365 의
`supabase/migrations/vision_monitoring.sql` 이 원본이고, 사람이 Supabase SQL
Editor 에서 실행한다. 원본(ShrimpVision 단독)에서는 여기서 create_all 과
TimescaleDB 하이퍼테이블 설정을 했지만, 통합판에서 그렇게 두면 두 곳이 서로
다른 스키마를 주장하게 된다. 대신 뜰 때 필요한 표가 있는지 확인만 하고,
없으면 무엇을 실행해야 하는지 로그로 알린다.
"""
from __future__ import annotations

import logging
import sys
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from app.config import (
    config_problems,
    explain_config_problems,
    local_database_url,
    settings,
)

logger = logging.getLogger(__name__)

# 이 서비스가 반드시 있어야 도는 표. 앞의 셋은 vision_monitoring.sql 이,
# 뒤의 셋은 shrimp365 본체 스키마가 만든다.
REQUIRED_TABLES = (
    "vision_cameras",
    "count_records",
    "vision_alert_configs",
    "tanks",
    "farms",
    "alerts",
)


#: 설정 파일 자리. 로그에서 바로 집어 고칠 수 있도록 메시지에 넣는다.
ENV_PATH = "/etc/shrimp365-vision/env"


def _make_engine():
    # 엔진은 import 시점에 만들어진다. 설정이 비어 있으면 여기서
    # sqlalchemy 가 "Could not parse SQLAlchemy URL" 을 던지고 서비스가
    # 죽는데, 현장에서 그 문구로는 무엇을 해야 할지 알 수 없다.
    # install.sh 가 만드는 env 는 세 줄이 비어 있으므로 **첫 기동은 반드시**
    # 여기에 걸린다 — 그때 할 일이 보여야 한다.
    problems = config_problems()
    if problems:
        print(explain_config_problems(problems, ENV_PATH), file=sys.stderr, flush=True)
        raise SystemExit(1)

    url = local_database_url()
    kwargs: dict = {"echo": settings.debug}
    if url.startswith("sqlite"):
        # 로컬 파일은 디렉터리가 있어야 열린다. systemd 의 StateDirectory 가
        # 만들어 주지만, 손으로 실행해 볼 때도 되어야 한다.
        path = url.split("///", 1)[-1]
        if path and path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        # NullPool keeps connections loop-agnostic (pytest spins up a fresh
        # event loop per test); SQLite connections are cheap to reopen.
        kwargs["poolclass"] = NullPool
        # SQLite 는 파일 하나를 쓰기 잠금으로 막는다. 테스트에서는 스트림
        # 처리기가 개체수를 쓰는 동안 다른 테스트가 같은 파일을 읽어, 기계가
        # 바쁘면 기본 대기(5초)로는 모자라 "database is locked" 가 난다.
        # 운영은 Postgres 라 해당 없다 — 이 값은 테스트 안정성만을 위한 것이다.
        kwargs["connect_args"] = {"timeout": 10}
    else:
        kwargs["pool_pre_ping"] = True
    return create_async_engine(url, **kwargs)


engine = _make_engine()
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    """Declarative base for all ORM models (see app/models/)."""


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session


def utcnow() -> datetime:
    """Timezone-aware UTC now (stored in TIMESTAMPTZ / SQLite ISO columns)."""
    return datetime.now(UTC)


def ensure_utc(dt: datetime | None) -> datetime | None:
    """Attach UTC tzinfo to naive datetimes (SQLite returns naive UTC)."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt


async def init_db() -> None:
    """Prepare the database for this process.

    · SQLite(테스트): 매핑에서 표를 만든다. 테스트는 빈 파일에서 시작한다.
    · Postgres(운영): 아무것도 만들지 않고 필요한 표가 있는지만 확인한다.
      빠진 표가 있으면 경고를 남기되 기동은 막지 않는다 — /health 는 떠 있어야
      배포 도구가 원인을 볼 수 있고, 카메라를 아직 등록하지 않은 상태와
      마이그레이션을 실행하지 않은 상태를 로그로 구분할 수 있어야 한다.
    """
    from app import models  # noqa: F401  (register mappers)

    if engine.dialect.name != "postgresql":
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        return

    async with engine.connect() as conn:
        rows = await conn.execute(
            text(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_name = ANY(:names)"
            ),
            {"names": list(REQUIRED_TABLES)},
        )
        present = {r[0] for r in rows}

    missing = [t for t in REQUIRED_TABLES if t not in present]
    if missing:
        logger.error(
            "필요한 표가 없습니다: %s — shrimp365 저장소의 "
            "supabase/migrations/vision_monitoring.sql 을 Supabase SQL Editor 에서 "
            "실행하세요.",
            ", ".join(missing),
        )
    else:
        logger.info("Schema check passed (%d tables)", len(REQUIRED_TABLES))
