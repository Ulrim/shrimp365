"""audit_logs — 제어/설정 변경 감사 로그(Rule 9 계약 보강).

phase-1 4절 표에는 없으나 baseline lock·수기입력이 감사 기록을 요구한다(Rule 9).
- org_id 비정규화 + org 스코프 RLS 정책(0002 패턴 재사용, Postgres 전용).
- append-only(수정하지 않는다).
sqlite(테스트/로컬 폴백)는 RLS 미지원이라 정책 생성을 생략하고 서비스 레이어가 격리를 보장.
downgrade 는 모든 객체를 역순 제거한다.

Revision ID: 0003_audit_logs
Revises: 0002_phase1_schema
Create Date: 2026-07-03
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0003_audit_logs"
down_revision: Union[str, None] = "0002_phase1_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_RLS_TABLES = ("audit_logs",)


def _is_postgres() -> bool:
    return op.get_bind().dialect.name in ("postgresql", "postgres")


def upgrade() -> None:
    json_type = sa.JSON().with_variant(JSONB(), "postgresql")

    op.create_table(
        "audit_logs",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "org_id",
            sa.String(64),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("actor_id", sa.String(64), nullable=False),
        sa.Column("entity", sa.String(64), nullable=False),
        sa.Column("entity_id", sa.String(64), nullable=False),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("diff_json", json_type, nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "ts",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_audit_logs_org_id", "audit_logs", ["org_id"])
    op.create_index(
        "ix_audit_logs_entity", "audit_logs", ["entity", "entity_id"]
    )

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

    op.drop_index("ix_audit_logs_entity", table_name="audit_logs")
    op.drop_index("ix_audit_logs_org_id", table_name="audit_logs")
    op.drop_table("audit_logs")
