"""initial schema — sprint-0 2.5절 테이블 서브셋 + hypertable + RLS.

생성: organizations, sites, meters, readings, harvest_logs, kpi_config.
- readings 는 TimescaleDB hypertable 로 전환 시도(확장 없으면 일반 테이블로 폴백).
- org 스코프 RLS 정책(sites/meters/readings/harvest_logs). Postgres 에서만 적용.
downgrade 는 모든 객체를 역순 제거한다.

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-07-02
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0001_initial_schema"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# org 스코프 RLS 를 적용할 테이블(비정규화 org_id 컬럼 보유).
_RLS_TABLES = ("sites", "meters", "readings", "harvest_logs")


def _is_postgres() -> bool:
    return op.get_bind().dialect.name in ("postgresql", "postgres")


def upgrade() -> None:
    json_type = sa.JSON().with_variant(JSONB(), "postgresql")

    op.create_table(
        "organizations",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("plan", sa.String(32), nullable=False, server_default="START"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    op.create_table(
        "sites",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "org_id",
            sa.String(64),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("region", sa.String(128), nullable=True),
        sa.Column("ras_type", sa.String(64), nullable=True),
    )
    op.create_index("ix_sites_org_id", "sites", ["org_id"])

    op.create_table(
        "meters",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "site_id",
            sa.String(64),
            sa.ForeignKey("sites.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "org_id",
            sa.String(64),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("type", sa.String(32), nullable=False),
        sa.Column("unit", sa.String(32), nullable=False, server_default="kWh_interval"),
        sa.Column(
            "sub_meter_of",
            sa.String(64),
            sa.ForeignKey("meters.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("is_aeration", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_meters_site_id", "meters", ["site_id"])
    op.create_index("ix_meters_org_id", "meters", ["org_id"])

    op.create_table(
        "readings",
        sa.Column("time", sa.DateTime(timezone=True), primary_key=True, nullable=False),
        sa.Column(
            "meter_id",
            sa.String(64),
            sa.ForeignKey("meters.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "org_id",
            sa.String(64),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("quality_flag", sa.String(16), nullable=False, server_default="ok"),
    )
    op.create_index("ix_readings_org_id", "readings", ["org_id"])

    op.create_table(
        "harvest_logs",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("batch_id", sa.String(64), nullable=True),
        sa.Column(
            "site_id",
            sa.String(64),
            sa.ForeignKey("sites.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "org_id",
            sa.String(64),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("biomass_kg", sa.Float(), nullable=False),
        sa.Column("count", sa.Integer(), nullable=True),
    )
    op.create_index("ix_harvest_logs_site_id", "harvest_logs", ["site_id"])
    op.create_index("ix_harvest_logs_org_id", "harvest_logs", ["org_id"])

    op.create_table(
        "kpi_config",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("version", sa.String(32), nullable=False, unique=True),
        sa.Column("params_json", json_type, nullable=False),
        sa.Column("effective_from", sa.DateTime(timezone=True), nullable=False),
    )

    # --- TimescaleDB hypertable 전환(확장 없으면 일반 테이블로 폴백) ---
    if _is_postgres():
        op.execute(
            """
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
                    PERFORM create_hypertable('readings', 'time',
                                              if_not_exists => TRUE,
                                              migrate_data => TRUE);
                END IF;
            END
            $$;
            """
        )
        _apply_rls()


def _apply_rls() -> None:
    """org 스코프 RLS 정책 적용(Postgres 전용).

    각 테이블에 RLS 를 켜고, org_id = current_setting('app.current_org_id') 정책을 건다.
    app.current_org_id 미설정 시 current_setting(..., true)=NULL → 어떤 행도 매칭 안 됨(안전).
    """
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

    op.drop_table("kpi_config")
    op.drop_index("ix_harvest_logs_org_id", table_name="harvest_logs")
    op.drop_index("ix_harvest_logs_site_id", table_name="harvest_logs")
    op.drop_table("harvest_logs")
    op.drop_index("ix_readings_org_id", table_name="readings")
    op.drop_table("readings")
    op.drop_index("ix_meters_org_id", table_name="meters")
    op.drop_index("ix_meters_site_id", table_name="meters")
    op.drop_table("meters")
    op.drop_index("ix_sites_org_id", table_name="sites")
    op.drop_table("sites")
    op.drop_table("organizations")
