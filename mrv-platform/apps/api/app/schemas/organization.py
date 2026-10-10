"""조직 구성원 초대 스키마 — Phase 3 슬라이스 O(Supabase Auth 통합, ADR 0005 4절).

`POST /organizations/{org_id}/users`: `supabase_user_id=NULL` 상태로 `users` 행을 생성해
"초대장" 역할을 겸하게 한다(별도 invitations 테이블 없음 — 과설계 금지).
role 값은 Literal 로 제약해 그 외 값은 pydantic 이 422 로 자동 처리한다.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

UserRole = Literal["owner", "operator", "viewer"]

# email-validator 신규 의존성을 피하기 위해 EmailStr 대신 최소 형식만 검증(과설계 금지).
# 엄밀한 이메일 검증은 실제 Supabase 계정 생성(오프라인 절차, ADR 0005 4절)에서 이뤄진다.
_EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"

# Supabase auth.users.id 는 UUID v4 문자열이다. 형식 검증만 하고(실존 검증은 불가 —
# 백엔드는 Supabase Admin API 를 호출하지 않는다, ADR 0006 1절) 나머지는 owner 책임이다.
_SUPABASE_UID_PATTERN = (
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


class UserInviteRequest(BaseModel):
    """POST /organizations/{org_id}/users 요청 바디."""

    email: str = Field(..., pattern=_EMAIL_PATTERN, max_length=320)
    role: UserRole
    # ADR 0006 3절: 카카오처럼 JWT 에 email 클레임이 없는 계정을 위한 "선연계(pre-linked)" 초대.
    # 지정 시 users 행을 이 UID 로 채운 채 생성 → 첫 로그인이 `_lazy_link` 를 아예 타지 않는다.
    # None(기본) 이면 기존 이메일 기반 lazy-link 초대와 완전히 동일하게 동작한다(하위호환).
    supabase_user_id: str | None = Field(default=None, pattern=_SUPABASE_UID_PATTERN)


class UserInviteResponse(BaseModel):
    """201 응답. `linked` = `supabase_user_id IS NOT NULL` 여부(선연계 초대면 True)."""

    id: str
    org_id: str
    email: str
    role: UserRole
    linked: bool


# --- Phase 3 P1(온보딩 마법사 7.4절): 유료 전환(plan 변경) ---

OrgPlan = Literal["START", "PRO", "ENTERPRISE"]


class PlanUpdateRequest(BaseModel):
    """PATCH /organizations/{org_id}/plan 요청 바디. plan 값 외는 그 외 422(pydantic 자동)."""

    plan: OrgPlan


class PlanUpdateResponse(BaseModel):
    id: str
    plan: OrgPlan
