"""0007 마이그레이션 — recipe_versions.org_id backfill/RLS 검증(QA phase-2 갭2 하드닝).

이 테스트는 conftest 의 앱 테스트 DB(app.db.session.engine, import 시점에 고정된 엔진)와
완전히 분리된 임시 SQLite 파일에 대해 Alembic 마이그레이션을 직접(0006→0007→downgrade)
실행한다. `DATABASE_URL` 환경변수는 alembic env.py 가 마이그레이션 실행 시점에만 읽으므로
(app 엔진은 이미 임포트 시 바인딩되어 있어) 테스트 종료 후 원복하면 다른 테스트에 영향이
없다.

검증 범위:
  - 0006 상태(org_id 없음)로 recipe/recipe_version 시드 삽입 → 0007 업그레이드 시
    backfill 이 정확한 org_id(부모 recipe 의 org_id)를 채운다.
  - 여러 org 의 recipe/recipe_version 이 섞여 있어도 각각 올바른 org_id 로 backfill.
  - downgrade(0007→0006) 로 org_id 컬럼이 제거되는 라운드트립이 에러 없이 동작.
  - RLS 는 SQLite 가 지원하지 않으므로(design 문서 규약과 동일) 여기서는 서비스 레벨
    (모델 컬럼 NOT NULL + FK)까지만 확인한다 — Postgres RLS 정책 SQL 자체는 마이그레이션
    소스(0007 upgrade)에 포함되어 있고 `_is_postgres()` 가드로 Postgres 배포 시에만 실행된다.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config

_REPO_ROOT = Path(__file__).resolve().parents[3]
_INFRA_DIR = _REPO_ROOT / "infra"
_ALEMBIC_INI = _INFRA_DIR / "alembic.ini"
_MIGRATIONS_DIR = _INFRA_DIR / "migrations"


def _alembic_config(db_url: str) -> Config:
    cfg = Config(str(_ALEMBIC_INI))
    # cwd 의존을 없애기 위해 script_location 을 절대경로로 강제.
    cfg.set_main_option("script_location", str(_MIGRATIONS_DIR))
    cfg.set_main_option("sqlalchemy.url", db_url)
    return cfg


@pytest.fixture
def migration_db(tmp_path):
    """conftest 의 앱 테스트 DB 와 완전히 분리된 임시 SQLite 파일 + 원복 보장."""
    db_file = tmp_path / "migration_test.db"
    db_url = f"sqlite+pysqlite:///{db_file}"

    original_env = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = db_url
    try:
        yield db_url
    finally:
        if original_env is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = original_env


def _seed_pre_0007_data(engine: sa.Engine) -> None:
    """0006 스키마(recipe_versions.org_id 없음) 상태에서 org1/org2 recipe+version 시드."""
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                "INSERT INTO organizations (id, name, plan) VALUES "
                "('org-mig-1', '테스트법인1', 'START'), "
                "('org-mig-2', '테스트법인2', 'START')"
            )
        )
        conn.execute(
            sa.text(
                "INSERT INTO sites (id, org_id, name) VALUES "
                "('site-mig-1', 'org-mig-1', 'site1'), "
                "('site-mig-2', 'org-mig-2', 'site2')"
            )
        )
        conn.execute(
            sa.text(
                "INSERT INTO recipes (id, site_id, org_id, type, current_version) VALUES "
                "('recipe-mig-1', 'site-mig-1', 'org-mig-1', 'feed', 1), "
                "('recipe-mig-2', 'site-mig-2', 'org-mig-2', 'feed', 1)"
            )
        )
        conn.execute(
            sa.text(
                "INSERT INTO recipe_versions "
                "(id, recipe_id, version, params_json, rationale, created_by) VALUES "
                "('rv-mig-1', 'recipe-mig-1', 1, '{}', 'r1', 'u1'), "
                "('rv-mig-2', 'recipe-mig-2', 1, '{}', 'r2', 'u2')"
            )
        )


def test_backfill_assigns_correct_org_id_per_parent_recipe(migration_db):
    """0006→0007 업그레이드: recipe_versions.org_id 가 부모 recipe.org_id 와 정확히 일치."""
    cfg = _alembic_config(migration_db)
    command.upgrade(cfg, "0006_recipes")

    engine = sa.create_engine(migration_db)
    _seed_pre_0007_data(engine)
    engine.dispose()

    command.upgrade(cfg, "0007_recipe_versions_org_id")

    engine = sa.create_engine(migration_db)
    with engine.connect() as conn:
        rows = conn.execute(
            sa.text("SELECT id, recipe_id, org_id FROM recipe_versions ORDER BY id")
        ).fetchall()
    engine.dispose()

    by_id = {r.id: r for r in rows}
    assert by_id["rv-mig-1"].org_id == "org-mig-1"
    assert by_id["rv-mig-2"].org_id == "org-mig-2"
    # 교차 오염 없음(각 버전이 자기 recipe 의 org 만 가짐).
    assert by_id["rv-mig-1"].org_id != by_id["rv-mig-2"].org_id


def test_org_id_not_null_after_upgrade(migration_db):
    """backfill 후 NOT NULL 제약이 걸려 org_id 없는 삽입은 실패한다."""
    cfg = _alembic_config(migration_db)
    command.upgrade(cfg, "head")

    engine = sa.create_engine(migration_db)
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                "INSERT INTO organizations (id, name, plan) VALUES ('org-mig-3', 'x', 'START')"
            )
        )
        conn.execute(
            sa.text(
                "INSERT INTO sites (id, org_id, name) VALUES ('site-mig-3', 'org-mig-3', 's')"
            )
        )
        conn.execute(
            sa.text(
                "INSERT INTO recipes (id, site_id, org_id, type, current_version) VALUES "
                "('recipe-mig-3', 'site-mig-3', 'org-mig-3', 'feed', 0)"
            )
        )
    with pytest.raises(sa.exc.IntegrityError):
        with engine.begin() as conn:
            conn.execute(
                sa.text(
                    "INSERT INTO recipe_versions "
                    "(id, recipe_id, version, params_json, rationale, created_by) VALUES "
                    "('rv-mig-nonull', 'recipe-mig-3', 1, '{}', 'r', 'u')"
                )
            )
    engine.dispose()


def test_upgrade_downgrade_roundtrip(migration_db):
    """head→0006 downgrade 가 에러 없이 동작하고 org_id 컬럼이 제거된다(라운드트립)."""
    cfg = _alembic_config(migration_db)
    command.upgrade(cfg, "0006_recipes")

    engine = sa.create_engine(migration_db)
    _seed_pre_0007_data(engine)
    engine.dispose()

    command.upgrade(cfg, "head")
    command.downgrade(cfg, "0006_recipes")

    engine = sa.create_engine(migration_db)
    inspector = sa.inspect(engine)
    columns = {c["name"] for c in inspector.get_columns("recipe_versions")}
    engine.dispose()
    assert "org_id" not in columns

    # 재-업그레이드도 문제없이 동작(라운드트립 완전성).
    command.upgrade(cfg, "head")
    engine = sa.create_engine(migration_db)
    inspector = sa.inspect(engine)
    columns = {c["name"] for c in inspector.get_columns("recipe_versions")}
    engine.dispose()
    assert "org_id" in columns
