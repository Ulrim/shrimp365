"""recipes/recipe_versions — phase-2 슬라이스 K(docs/design/phase-2.md 2.1절).

- recipes: site당 type(feed|oxygen|circulation)별 최대 1행(유니크 (site_id, type)).
  org_id 비정규화 RLS(0003/0005 패턴 재사용, Postgres 전용).
- recipe_versions: append-only(잠금 개념 없음, 매 추천 산출마다 새 버전 정상).
  org_id 컬럼 없음(2.1절 표 그대로) — recipe_id FK 를 통해서만 org 스코프 연결되므로
  RLS 는 recipes 에만 건다(애플리케이션 계층이 recipe 소유권을 먼저 검증, Rule 4).

Revision ID: 0006_recipes
Revises: 0005_alerts
Create Date: 2026-07-07
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0006_recipes"
down_revision: Union[str, None] = "0005_alerts"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_RLS_TABLES = ("recipes",)


def _is_postgres() -> bool:
    return op.get_bind().dialect.name in ("postgresql", "postgres")


def upgrade() -> None:
    json_type = sa.JSON().with_variant(JSONB(), "postgresql")

    op.create_table(
        "recipes",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "site_id", sa.String(64),
            sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column(
            "org_id", sa.String(64),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("type", sa.String(32), nullable=False),
        sa.Column("current_version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            nullable=False, server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "type IN ('feed', 'oxygen', 'circulation')", name="ck_recipes_type"
        ),
        sa.UniqueConstraint("site_id", "type", name="uq_recipes_site_id_type"),
    )
    op.create_index("ix_recipes_site_id", "recipes", ["site_id"])
    op.create_index("ix_recipes_org_id", "recipes", ["org_id"])

    op.create_table(
        "recipe_versions",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "recipe_id", sa.String(64),
            sa.ForeignKey("recipes.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("params_json", json_type, nullable=False),
        sa.Column("rationale", sa.Text(), nullable=False),
        sa.Column("created_by", sa.String(64), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            nullable=False, server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "recipe_id", "version", name="uq_recipe_versions_recipe_version"
        ),
    )
    op.create_index("ix_recipe_versions_recipe_id", "recipe_versions", ["recipe_id"])

    if _is_postgres():
        for table in _RLS_TABLES:
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
            op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
            op.execute(
                f"""
                CREATE POLICY org_isolation_{table} ON {table}
                USING (org_id = current_setting('app.current_org_id', true))
                WITH CHECK (org_id = current_setting('app.current_org_id', true))
                """
            )


def downgrade() -> None:
    if _is_postgres():
        for table in _RLS_TABLES:
            op.execute(f"DROP POLICY IF EXISTS org_isolation_{table} ON {table}")
            op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")

    op.drop_index("ix_recipe_versions_recipe_id", table_name="recipe_versions")
    op.drop_table("recipe_versions")

    op.drop_index("ix_recipes_org_id", table_name="recipes")
    op.drop_index("ix_recipes_site_id", table_name="recipes")
    op.drop_table("recipes")
