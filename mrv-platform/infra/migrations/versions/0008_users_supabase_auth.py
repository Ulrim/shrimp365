"""users.supabase_user_id — Phase 3 슬라이스 O(Supabase Auth 통합).

`docs/design/phase-3-auth.md` 1절 / `docs/adr/0005-supabase-auth-integration.md` 3절 계약:
  - `users.supabase_user_id`(nullable): Supabase auth.users.id(UUID) 매핑.
    NULL = "초대는 됐으나 아직 첫 로그인 전"(users 행 자체가 초대 레코드를 겸함).
  - 부분 유니크 인덱스(Postgres 전용, 0002 의 `ux_baselines_one_locked` 패턴과 동일하게
    NULL 은 제외 — 동일 supabase_user_id 가 두 행에 연계되는 것을 물리적으로 방지).
    SQLite(테스트/로컬 폴백)는 부분 유니크 인덱스를 이 마이그레이션에서는 만들지 않는다
    (0002 관례 동일 — 격리/유일성은 서비스 레이어 `_lazy_link` 가드가 담당).
  - `email` 전역 인덱스 신규 추가(기존에는 (org_id, email) 복합 유니크뿐이었음 —
    lazy-link 의 "이메일로 미연계 행 탐색" 조회 성능, ADR 0005 3절).
  - `password_hash` 컬럼은 추가하지 않는다(ADR 0005 결정 3 — 비밀번호는 Supabase 전담).

Revision ID: 0008_users_supabase_auth
Revises: 0007_recipe_versions_org_id
Create Date: 2026-07-07
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0008_users_supabase_auth"
down_revision: Union[str, None] = "0007_recipe_versions_org_id"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_SUPABASE_UID_UX = "ux_users_supabase_user_id"


def _is_postgres() -> bool:
    return op.get_bind().dialect.name in ("postgresql", "postgres")


def upgrade() -> None:
    op.add_column(
        "users", sa.Column("supabase_user_id", sa.String(64), nullable=True)
    )
    op.create_index("ix_users_email", "users", ["email"])

    if _is_postgres():
        op.execute(
            f"CREATE UNIQUE INDEX {_SUPABASE_UID_UX} ON users (supabase_user_id) "
            f"WHERE supabase_user_id IS NOT NULL"
        )


def downgrade() -> None:
    if _is_postgres():
        op.execute(f"DROP INDEX IF EXISTS {_SUPABASE_UID_UX}")

    op.drop_index("ix_users_email", table_name="users")
    op.drop_column("users", "supabase_user_id")
