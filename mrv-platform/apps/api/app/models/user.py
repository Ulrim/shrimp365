"""users — 실 사용자(멀티테넌시 org 스코프).

phase-1 4절: id, org_id, email, role[owner|operator|viewer].
- org_id 비정규화(RLS 를 조인 없이 적용; 스프린트 0 관례).
- role 은 baseline lock 등 권한 게이트의 근거. locked_by 가 참조.
- email 은 org 내 유니크(같은 사람이 여러 org 소속 가능 → 전역 유니크 아님).

Phase 3 슬라이스 O(Supabase Auth, ADR 0005/docs/design/phase-3-auth.md 1절):
- supabase_user_id(nullable): Supabase auth.users.id(UUID) 매핑. NULL="초대는 됐으나 아직
  첫 로그인 전"(초대 레코드를 이 행 자체가 겸함 — 별도 invitations 테이블 없음).
- password_hash 컬럼은 추가하지 않는다(비밀번호는 Supabase auth.users 가 전담, ADR 0005 3절).
- ★ 정정(ADR 0007 1절): users 는 **RLS 대상 테이블이다**(마이그레이션 0002 `_RLS_TABLES`
  첫 항목, ENABLE/FORCE ROW LEVEL SECURITY). "RLS 비대상"이라는 이전 서술은 사실과 달랐다.
  org_id 를 아직 모르는 로그인 직후 조회가 가능한 이유는 마이그레이션 0013 의 명령 분할
  정책 `users_select_open`(FOR SELECT USING (true))이며, 쓰기(INSERT/UPDATE/DELETE)는
  `users_insert_org`/`_update_org`/`_delete_org` 로 org 스코프가 그대로 물리 강제된다.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        # 같은 이메일이 여러 org 에 존재 가능 → (org_id, email) 복합 유니크.
        UniqueConstraint("org_id", "email", name="ux_users_org_email"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    # 테넌트 격리 앵커(RLS 강제 컬럼).
    org_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    # 권한 등급: 'owner' | 'operator' | 'viewer'. baseline lock 은 owner/operator 만.
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="viewer")
    # Supabase auth.users.id(UUID) 매핑. NULL = 초대되었으나 아직 첫 로그인(lazy-link) 전.
    # 전역 유니크(부분 인덱스, NULL 제외 — 마이그레이션 0008)이나 ORM 레벨 제약은 걸지 않는다
    # (SQLite 폴백에서도 동일 컬럼 정의만 공유하도록 마이그레이션에서 인덱스로 강제).
    supabase_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
