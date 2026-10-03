"""emission_factors + mrv_reports — Phase 3 슬라이스 M(★MRV 리포트, phase-3.md 1절).

- emission_factors: org 전역 설정(org_id 없음, RLS 비대상 — kpi_config 와 동일 패턴, 1.1절).
  append-only(수정/삭제 엔드포인트 없음). version 은 unique(리포트가 고정 참조).
- mrv_reports: site_id/org_id 비정규화 + org 스코프 RLS(0005 alerts 패턴 재사용, 1.2절).
  append-only(물리적 불변 트리거는 두지 않는다 — 1.2절 근거: 최종 산출물이라 연쇄 오염
  리스크가 baseline 보다 낮음).

Revision ID: 0009_mrv_reports
Revises: 0008_users_supabase_auth
Create Date: 2026-07-07
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0009_mrv_reports"
down_revision: Union[str, None] = "0008_users_supabase_auth"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# org 스코프 RLS 를 적용할 신규 테이블. emission_factors 는 org 전역(kpi_config 와 동형)이라
# 대상에서 제외한다(1.1절).
_RLS_TABLES = ("mrv_reports",)


def _is_postgres() -> bool:
    return op.get_bind().dialect.name in ("postgresql", "postgres")


def upgrade() -> None:
    json_type = sa.JSON().with_variant(JSONB(), "postgresql")

    # --- emission_factors (org 전역, RLS 비대상; 1.1절) ---
    op.create_table(
        "emission_factors",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("factor_tco2e_per_mwh", sa.Float(), nullable=False),
        sa.Column("source", sa.String(255), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("version", sa.String(32), nullable=False, unique=True),
        sa.Column("effective_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            nullable=False, server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_emission_factors_effective_from", "emission_factors", ["effective_from"]
    )

    # --- mrv_reports (site_id/org_id 비정규화 + RLS; 1.2절) ---
    op.create_table(
        "mrv_reports",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "site_id", sa.String(64),
            sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column(
            "org_id", sa.String(64),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column(
            "baseline_id", sa.String(64),
            sa.ForeignKey("baselines.id", ondelete="RESTRICT"), nullable=False,
        ),
        sa.Column("period_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("period_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "emission_factor_id", sa.String(64),
            sa.ForeignKey("emission_factors.id", ondelete="RESTRICT"), nullable=False,
        ),
        sa.Column(
            "after_kpi_snapshot_id", sa.String(64),
            sa.ForeignKey("kpi_snapshots.id", ondelete="RESTRICT"), nullable=False,
        ),
        sa.Column("before_json", json_type, nullable=False),
        sa.Column("after_json", json_type, nullable=False),
        sa.Column("reduction_tco2e", sa.Float(), nullable=True),
        sa.Column("formula_text", sa.Text(), nullable=False),
        sa.Column("boundary_json", json_type, nullable=False),
        sa.Column("pdf_path", sa.String(512), nullable=True),
        sa.Column("generated_by", sa.String(64), nullable=False),
        sa.Column(
            "generated_at", sa.DateTime(timezone=True),
            nullable=False, server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_mrv_reports_site_id", "mrv_reports", ["site_id"])
    op.create_index("ix_mrv_reports_org_id", "mrv_reports", ["org_id"])

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

    op.drop_index("ix_mrv_reports_org_id", table_name="mrv_reports")
    op.drop_index("ix_mrv_reports_site_id", table_name="mrv_reports")
    op.drop_table("mrv_reports")

    op.drop_index("ix_emission_factors_effective_from", table_name="emission_factors")
    op.drop_table("emission_factors")
