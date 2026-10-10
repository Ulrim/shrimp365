"""조직 구성원 초대 + 플랜 변경 API.

POST  /organizations/{org_id}/users : Phase 3 슬라이스 O(Supabase Auth 통합, ADR 0005 4절).
  `supabase_user_id=NULL` 상태로 users 행 생성(=초대장). 권한: owner 단독(`require_owner`
  — `require_writer` 는 operator 까지 통과시켜 계약보다 관대하므로 재사용하지 않는다).
  실제 Supabase 계정 생성(이메일 발송)은 이 엔드포인트 범위 밖(컬리버 운영진의 오프라인
  절차, ADR 0005 4절).
  FED-1(ADR 0006 3절): 선택 필드 `supabase_user_id` 를 주면 그 UID 로 **선연계(pre-linked)**
  행을 만든다 — 카카오처럼 JWT 에 email 클레임이 없는 계정도 첫 로그인이 `_lazy_link` 를
  타지 않고 통과한다. 미지정 시 동작은 기존과 100% 동일(하위호환).

PATCH /organizations/{org_id}/plan  : Phase 3 P1(온보딩 마법사 7.4절). 유료 전환(plan 값
  반영)만 담당 — 실제 결제 게이트웨이 연동은 범위 밖(컬리버 운영진/owner가 결제 확인 후
  수동 호출하는 것을 전제). owner 단독, audit_logs(action='plan_change').
"""

from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.deps import AuthContext, get_db, require_owner
from app.models.organization import Organization
from app.models.user import User
from app.schemas.organization import (
    PlanUpdateRequest,
    PlanUpdateResponse,
    UserInviteRequest,
    UserInviteResponse,
)
from app.services.audit import record_audit

router = APIRouter(tags=["organizations"])


@router.post(
    "/organizations/{org_id}/users",
    response_model=UserInviteResponse,
    status_code=status.HTTP_201_CREATED,
    summary=(
        "조직 구성원 초대(owner 전용). users 행을 supabase_user_id=NULL 로 생성(=초대장). "
        "supabase_user_id 를 지정하면 선연계(pre-linked) 초대 — email 클레임 없는 "
        "카카오 계정용(ADR 0006 3절)."
    ),
)
def invite_user(
    org_id: str,
    payload: UserInviteRequest,
    auth: AuthContext = Depends(require_owner),
    session: Session = Depends(get_db),
) -> UserInviteResponse:
    """3중 테넌시 방어(경로 org_id==auth.org_id, 아니면 404) → 유니크 위반 409 → 삽입 → audit."""
    # 3중 방어(3번째 계층): 경로의 org_id 가 인증된 org_id 와 다르면 타 org 리소스 시도로
    # 취급해 404(존재 자체를 노출하지 않는다 — `phase-3-auth.md` 4절 계약).
    if org_id != auth.org_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="organization not found",
        )

    # ADR 0006 3절(선연계 초대): supabase_user_id 가 오면 그 UID 로 이미 연계된 행이 있는지
    # 먼저 조회한다. 부분 유니크 인덱스(ux_users_supabase_user_id)가 최종 방어선이지만,
    # 선조회로 "이메일 중복 409"와 "UID 중복 409"의 메시지를 분리해 운영자가 원인을 알게 한다.
    # (ADR 0007 1-3절 갱신: 마이그레이션 0013 의 `users_select_open` 이후 이 선조회는
    #  **전 org 를 본다**. 따라서 타 org 에 이미 연계된 UID 도 여기서 잡혀 의도한 문구
    #  "this supabase account is already linked to a user" 409 가 나간다 — 이전처럼 부분
    #  유니크 인덱스의 IntegrityError 로 흘러 이메일 중복 문구가 나가는 열화가 사라졌다.
    #  행 내용은 반환하지 않고 "존재 여부"만 409 로 변환하므로 테넌트 누수가 아니다.)
    if payload.supabase_user_id is not None:
        already_linked = session.execute(
            select(User).where(User.supabase_user_id == payload.supabase_user_id)
        ).scalars().first()
        if already_linked is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="this supabase account is already linked to a user",
            )

    user_id = f"user-{uuid4().hex}"
    user_row = User(
        id=user_id,
        org_id=org_id,
        email=payload.email,
        role=payload.role,
        supabase_user_id=payload.supabase_user_id,
    )
    session.add(user_row)

    try:
        session.flush()
    except IntegrityError:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="a user with this email already exists in this organization",
        ) from None

    linked = payload.supabase_user_id is not None
    # action 은 'invite' 그대로 둔다(신규 action 값을 만들지 않는다 — 감사 로그 소비자의 기존
    # 필터가 깨지지 않도록. 선연계 여부 구분은 diff.after.linked/supabase_user_id 로 충분하다).
    record_audit(
        session,
        org_id=org_id,
        actor_id=auth.user_id,
        entity="users",
        entity_id=user_id,
        action="invite",
        diff={
            "before": None,
            "after": {
                "email": payload.email,
                "role": payload.role,
                "linked": linked,
                "supabase_user_id": payload.supabase_user_id,
            },
        },
    )
    session.commit()

    return UserInviteResponse(
        id=user_id, org_id=org_id, email=payload.email, role=payload.role, linked=linked,
    )


@router.patch(
    "/organizations/{org_id}/plan",
    response_model=PlanUpdateResponse,
    summary="유료 전환(plan 변경). owner 전용, 결제 연동은 범위 밖(7.4절).",
)
def update_organization_plan(
    org_id: str,
    payload: PlanUpdateRequest,
    auth: AuthContext = Depends(require_owner),
    session: Session = Depends(get_db),
) -> PlanUpdateResponse:
    """3중 테넌시 방어(경로 org_id==auth.org_id, 아니면 404) → plan 갱신 → audit(action='plan_change')."""
    if org_id != auth.org_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="organization not found",
        )

    org = session.execute(
        select(Organization).where(Organization.id == org_id)
    ).scalar_one_or_none()
    if org is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="organization not found",
        )

    before_plan = org.plan
    org.plan = payload.plan
    session.flush()

    record_audit(
        session,
        org_id=org_id,
        actor_id=auth.user_id,
        entity="organizations",
        entity_id=org_id,
        action="plan_change",
        diff={"before": {"plan": before_plan}, "after": {"plan": payload.plan}},
    )
    session.commit()

    return PlanUpdateResponse(id=org_id, plan=org.plan)
