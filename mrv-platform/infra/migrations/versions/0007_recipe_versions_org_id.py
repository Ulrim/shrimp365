"""recipe_versions.org_id — QA phase-2 조건부승인 갭2 하드닝.

배경: `recipe_versions` 는 0006 에서 org_id 컬럼 없이 만들어졌다(recipe_id FK 를 통해서만
간접 스코프 연결, app/services/tenancy.resolve_recipe_for_org 가 recipe 소유권을 먼저
검증). 현재 recipe_versions 를 id 로 직접 조회하는 엔드포인트가 없어 실제 누수 경로는
없지만, 향후 그런 엔드포인트가 생기면 RLS 부재가 실제 누수로 이어질 구조적 취약점이다.

이 마이그레이션은 그 방어선을 미리 추가한다:
  1) org_id 컬럼 추가(nullable 허용 상태로 시작 — 기존 행 backfill 위해).
  2) 기존 행 backfill: `recipe_versions.org_id = recipes.org_id`(recipe_id 로 조인).
     Postgres/SQLite 공통 문법(상관 서브쿼리 UPDATE)을 사용한다.
  3) NOT NULL 제약 추가(backfill 후에만 안전).
  4) RLS 정책(Postgres 전용, 0005/0006 과 동일 패턴).

Revision ID: 0007_recipe_versions_org_id
Revises: 0006_recipes
Create Date: 2026-07-07
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007_recipe_versions_org_id"
down_revision: Union[str, None] = "0006_recipes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_FK_NAME = "fk_recipe_versions_org_id"
_POLICY_NAME = "org_isolation_recipe_versions"


def _is_postgres() -> bool:
    return op.get_bind().dialect.name in ("postgresql", "postgres")


def upgrade() -> None:
    # 1) nullable 컬럼 추가(기존 행 backfill 을 위해 처음에는 NULL 허용).
    op.add_column(
        "recipe_versions", sa.Column("org_id", sa.String(64), nullable=True)
    )

    # 2) backfill: 부모 recipes.org_id 를 recipe_id 로 조인해 채운다.
    #    Postgres/SQLite 양쪽에서 동작하는 상관 서브쿼리 UPDATE 문법.
    op.execute(
        """
        UPDATE recipe_versions
        SET org_id = (
            SELECT recipes.org_id
            FROM recipes
            WHERE recipes.id = recipe_versions.recipe_id
        )
        """
    )

    # 3) backfill 이후에만 NOT NULL 로 전환(batch 모드 — SQLite 는 테이블 재생성,
    #    Postgres 는 일반 ALTER COLUMN 으로 처리되어 두 dialect 모두 안전).
    with op.batch_alter_table("recipe_versions") as batch_op:
        batch_op.alter_column(
            "org_id", existing_type=sa.String(64), nullable=False
        )

    op.create_index("ix_recipe_versions_org_id", "recipe_versions", ["org_id"])

    if _is_postgres():
        op.create_foreign_key(
            _FK_NAME, "recipe_versions", "organizations", ["org_id"], ["id"],
            ondelete="CASCADE",
        )
        op.execute("ALTER TABLE recipe_versions ENABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE recipe_versions FORCE ROW LEVEL SECURITY")
        op.execute(
            f"""
            CREATE POLICY {_POLICY_NAME} ON recipe_versions
            USING (org_id = current_setting('app.current_org_id', true))
            WITH CHECK (org_id = current_setting('app.current_org_id', true))
            """
        )


def downgrade() -> None:
    if _is_postgres():
        op.execute(f"DROP POLICY IF EXISTS {_POLICY_NAME} ON recipe_versions")
        op.execute("ALTER TABLE recipe_versions DISABLE ROW LEVEL SECURITY")
        op.drop_constraint(_FK_NAME, "recipe_versions", type_="foreignkey")

    op.drop_index("ix_recipe_versions_org_id", table_name="recipe_versions")

    with op.batch_alter_table("recipe_versions") as batch_op:
        batch_op.drop_column("org_id")
