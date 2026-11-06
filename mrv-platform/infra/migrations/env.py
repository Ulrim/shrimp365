"""Alembic env — app.models 의 metadata 를 target 으로 사용.

DB URL 은 app.config(Settings)에서 로드(.env). apps/api 와 packages/kpi 를
sys.path 에 추가해 ORM 모델/KPI 패키지를 import 할 수 있게 한다.
"""

from __future__ import annotations

import os
import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

# --- 경로 설정: infra/ 기준 상대경로로 apps/api, packages/kpi 를 sys.path 에 추가 ---
_HERE = Path(__file__).resolve()
_REPO_ROOT = _HERE.parents[2]  # infra/migrations/env.py → repo root
sys.path.insert(0, str(_REPO_ROOT / "apps" / "api"))
sys.path.insert(0, str(_REPO_ROOT / "packages" / "kpi"))

from app.config import get_settings  # noqa: E402
from app.models import Base  # noqa: E402  (모든 모델을 metadata 에 등록)

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _database_url() -> str:
    # 환경변수 우선(DATABASE_URL) → Settings 폴백.
    return os.getenv("DATABASE_URL") or get_settings().database_url


def run_migrations_offline() -> None:
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    section = config.get_section(config.config_ini_section) or {}
    section["sqlalchemy.url"] = _database_url()
    connectable = engine_from_config(
        section,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
