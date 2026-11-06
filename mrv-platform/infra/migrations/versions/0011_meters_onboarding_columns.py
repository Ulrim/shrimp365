"""meters.label / meters.certification_info — Phase 3 P1 슬라이스(온보딩 마법사, phase-3.md 7.2절).

온보딩 "설치키트→센서매핑" 단계에 필요한 `POST /sites/{id}/meters` 는 요청 바디에
`label`(사람이 읽는 계측기 이름)을 포함하지만 기존 `meters` 테이블에는 해당 컬럼이 없었다
(갭 보강). 동시에 MASTER 9장 규제훅(IoT/무선기기 KCC, 전기안전 KC 인증정보) "자리만"
마련하는 `certification_info`(선택, 자유 JSON) 컬럼도 함께 추가한다.

둘 다 nullable — 기존 시드 데이터는 영향 없음(NULL 로 유지).

Revision ID: 0011_meters_onboarding_columns
Revises: 0010_sop_checklist_runs
Create Date: 2026-07-07
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0011_meters_onboarding_columns"
down_revision: Union[str, None] = "0010_sop_checklist_runs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    json_type = sa.JSON().with_variant(JSONB(), "postgresql")

    op.add_column("meters", sa.Column("label", sa.String(255), nullable=True))
    op.add_column("meters", sa.Column("certification_info", json_type, nullable=True))


def downgrade() -> None:
    op.drop_column("meters", "certification_info")
    op.drop_column("meters", "label")
