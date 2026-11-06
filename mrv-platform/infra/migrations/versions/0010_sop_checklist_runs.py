"""sop_checklist_runs — Phase 3 P1 슬라이스(SOP 라이브러리, phase-3.md 2.2절).

SOP 문서 콘텐츠(제목/본문/체크리스트 정의)는 정적 파일(`apps/api/app/content/sop`)로
관리하며 DB 테이블을 두지 않는다(2.1절). 이 마이그레이션은 "누가 언제 무엇을 점검했는가"
증빙만 최소로 영속화하는 `sop_checklist_runs` 테이블을 추가한다.

- site_id/org_id 비정규화 + org 스코프 RLS(0009 mrv_reports 패턴 재사용).
- sop_id 는 정적 콘텐츠 id 에 대한 느슨한 참조(FK 아님).
- append-only(수정/삭제 엔드포인트 없음 — downgrade 는 테이블 전체 제거).

Revision ID: 0010_sop_checklist_runs
Revises: 0009_mrv_reports
Create Date: 2026-07-07
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0010_sop_checklist_runs"
down_revision: Union[str, None] = "0009_mrv_reports"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_RLS_TABLES = ("sop_checklist_runs",)


def _is_postgres() -> bool:
    return op.get_bind().dialect.name in ("postgresql", "postgres")


def upgrade() -> None:
    json_type = sa.JSON().with_variant(JSONB(), "postgresql")

    op.create_table(
        "sop_checklist_runs",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "site_id", sa.String(64),
            sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column(
            "org_id", sa.String(64),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("sop_id", sa.String(64), nullable=False),
        sa.Column("items_json", json_type, nullable=False),
        sa.Column("performed_by", sa.String(64), nullable=False),
        sa.Column(
            "performed_at", sa.DateTime(timezone=True),
            nullable=False, server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_sop_checklist_runs_site_id", "sop_checklist_runs", ["site_id"])
    op.create_index("ix_sop_checklist_runs_org_id", "sop_checklist_runs", ["org_id"])
    op.create_index("ix_sop_checklist_runs_sop_id", "sop_checklist_runs", ["sop_id"])

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

    op.drop_index("ix_sop_checklist_runs_sop_id", table_name="sop_checklist_runs")
    op.drop_index("ix_sop_checklist_runs_org_id", table_name="sop_checklist_runs")
    op.drop_index("ix_sop_checklist_runs_site_id", table_name="sop_checklist_runs")
    op.drop_table("sop_checklist_runs")
