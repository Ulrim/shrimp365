"""meters.tank_id — 수조별 계측기 그룹핑 (phase-2 4.1절 readings 조회 보강).

`GET /sites/{id}/readings?tank_id=&type=` (slice I)가 tank 단위로 계측기를 묶어
조회할 수 있어야 하므로 `meters`에 nullable `tank_id` 컬럼을 추가한다. NULL 허용
(수조 미소속 계측기, 예: 사이트 전체 전력 메인 계측기). 기존 시드 데이터는 영향 없음
(NULL로 유지).

SQLite는 컬럼 추가 시 인라인 FK 제약(ALTER ADD CONSTRAINT)을 지원하지 않으므로
(0002의 harvest_logs.batch_id FK 선례와 동일 패턴), 컬럼 자체는 양쪽 dialect에서
추가하되 명명된 FK 제약은 **Postgres 전용**으로 별도 추가한다. sqlite는 ORM
`create_all`(테스트) 기준으로 FK가 반영되며, 애플리케이션 레벨에서 tank_id 정합성은
서비스 계층이 검증한다(RLS와 동일하게 이중 방어 원칙).

Revision ID: 0004_meters_tank_id
Revises: 0003_audit_logs
Create Date: 2026-07-07
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004_meters_tank_id"
down_revision: Union[str, None] = "0003_audit_logs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_METERS_TANK_FK = "fk_meters_tank_id"


def _is_postgres() -> bool:
    return op.get_bind().dialect.name in ("postgresql", "postgres")


def upgrade() -> None:
    op.add_column("meters", sa.Column("tank_id", sa.String(64), nullable=True))
    op.create_index("ix_meters_tank_id", "meters", ["tank_id"])

    if _is_postgres():
        op.create_foreign_key(
            _METERS_TANK_FK, "meters", "tanks", ["tank_id"], ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    if _is_postgres():
        op.drop_constraint(_METERS_TANK_FK, "meters", type_="foreignkey")

    op.drop_index("ix_meters_tank_id", table_name="meters")
    op.drop_column("meters", "tank_id")
