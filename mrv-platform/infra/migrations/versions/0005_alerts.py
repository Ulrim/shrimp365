"""alerts 테이블 + sites.alert_enabled_types — phase-2 슬라이스 H(1.1/1.7절).

- alerts: append-only + status 전이(open→ack)만 허용(1.1절). type/severity/status CHECK.
  org_id 비정규화 RLS(0003 audit_logs 패턴 재사용, Postgres 전용).
- sites.alert_enabled_types: 알림 구독 on/off 스위치(JSON, 기본값 3종 전부 true, 1.7절).

Revision ID: 0005_alerts
Revises: 0004_meters_tank_id
Create Date: 2026-07-07
"""
from __future__ import annotations

import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0005_alerts"
down_revision: Union[str, None] = "0004_meters_tank_id"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_RLS_TABLES = ("alerts",)
_DEFAULT_ALERT_ENABLED_TYPES = {"do_low": True, "mortality_spike": True, "kpi_red": True}


def _is_postgres() -> bool:
    return op.get_bind().dialect.name in ("postgresql", "postgres")


def upgrade() -> None:
    json_type = sa.JSON().with_variant(JSONB(), "postgresql")

    op.create_table(
        "alerts",
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
        sa.Column("severity", sa.String(16), nullable=False),
        sa.Column("payload_json", json_type, nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="open"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            nullable=False, server_default=sa.func.now(),
        ),
        sa.Column("acked_by", sa.String(64), nullable=True),
        sa.Column("acked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "type IN ('do_low', 'mortality_spike', 'kpi_red')", name="ck_alerts_type"
        ),
        sa.CheckConstraint(
            "severity IN ('info', 'warning', 'critical')", name="ck_alerts_severity"
        ),
        sa.CheckConstraint("status IN ('open', 'ack')", name="ck_alerts_status"),
    )
    op.create_index("ix_alerts_site_id", "alerts", ["site_id"])
    op.create_index("ix_alerts_org_id", "alerts", ["org_id"])
    # 중복 억제(1.5절: 같은 (site_id, type)에 open 이미 있으면 재삽입 금지) 조회 가속.
    op.create_index("ix_alerts_site_id_type_status", "alerts", ["site_id", "type", "status"])

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

    # sites.alert_enabled_types(1.7절). 기존 행은 server_default 로 즉시 채워진다.
    default_json = json.dumps(_DEFAULT_ALERT_ENABLED_TYPES)
    op.add_column(
        "sites",
        sa.Column(
            "alert_enabled_types", json_type, nullable=False, server_default=default_json
        ),
    )


def downgrade() -> None:
    op.drop_column("sites", "alert_enabled_types")

    if _is_postgres():
        for table in _RLS_TABLES:
            op.execute(f"DROP POLICY IF EXISTS org_isolation_{table} ON {table}")
            op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")

    op.drop_index("ix_alerts_site_id_type_status", table_name="alerts")
    op.drop_index("ix_alerts_org_id", table_name="alerts")
    op.drop_index("ix_alerts_site_id", table_name="alerts")
    op.drop_table("alerts")
