"""control_actions — Phase 3 P2 슬라이스(승인형 제어 콘솔, phase-3.md 3절).

★ 승인 게이트 물리적 강제(사용자 명시 요구 — "절대 우회하지 않는 구조", 3.1절):
  CHECK (status != 'applied' OR approved_at IS NOT NULL)
  CHECK (status != 'approved' OR approved_by IS NOT NULL)
두 CHECK 는 Postgres/SQLite 양쪽이 네이티브로 지원하므로(baseline 의 BEFORE UPDATE 트리거와
달리) 방언 분기 없이 항상 생성한다 — 애플리케이션 버그·수동 SQL 우회 시도까지 물리적으로
차단한다(ADR 0002 동형 철학).

site_id/org_id 비정규화 + org 스코프 RLS(Postgres 전용, 0009 mrv_reports 패턴 재사용).

Revision ID: 0012_control_actions
Revises: 0011_meters_onboarding_columns
Create Date: 2026-07-17
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0012_control_actions"
down_revision: Union[str, None] = "0011_meters_onboarding_columns"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_RLS_TABLES = ("control_actions",)


def _is_postgres() -> bool:
    return op.get_bind().dialect.name in ("postgresql", "postgres")


def upgrade() -> None:
    json_type = sa.JSON().with_variant(JSONB(), "postgresql")

    op.create_table(
        "control_actions",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "tank_id", sa.String(64),
            sa.ForeignKey("tanks.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column(
            "recipe_version_id", sa.String(64),
            sa.ForeignKey("recipe_versions.id", ondelete="RESTRICT"), nullable=False,
        ),
        sa.Column(
            "site_id", sa.String(64),
            sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column(
            "org_id", sa.String(64),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("recommended_json", json_type, nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("approved_by", sa.String(64), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("result_json", json_type, nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            nullable=False, server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'rejected', 'applied')",
            name="ck_control_actions_status",
        ),
        # ★ 승인 게이트(3.1절) — 애플리케이션 버그/수동 SQL 우회까지 DB 가 물리적으로 차단.
        sa.CheckConstraint(
            "status != 'applied' OR approved_at IS NOT NULL",
            name="ck_control_actions_applied_requires_approved_at",
        ),
        sa.CheckConstraint(
            "status != 'approved' OR approved_by IS NOT NULL",
            name="ck_control_actions_approved_requires_approved_by",
        ),
    )
    op.create_index("ix_control_actions_tank_id", "control_actions", ["tank_id"])
    op.create_index(
        "ix_control_actions_recipe_version_id", "control_actions", ["recipe_version_id"]
    )
    op.create_index("ix_control_actions_site_id", "control_actions", ["site_id"])
    op.create_index("ix_control_actions_org_id", "control_actions", ["org_id"])
    op.create_index("ix_control_actions_status", "control_actions", ["status"])

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

    op.drop_index("ix_control_actions_status", table_name="control_actions")
    op.drop_index("ix_control_actions_org_id", table_name="control_actions")
    op.drop_index("ix_control_actions_site_id", table_name="control_actions")
    op.drop_index("ix_control_actions_recipe_version_id", table_name="control_actions")
    op.drop_index("ix_control_actions_tank_id", table_name="control_actions")
    op.drop_table("control_actions")
