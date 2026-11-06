"""auth API — GET /auth/me(QA phase-2 조건부승인 갭1 하드닝).

배경: JWT 는 org_id/role/user_id 만 담고 organizations.plan 은 매 요청마다
`require_plan` 이 DB 조회로 확인한다(app/deps.py). FE 가 PRO 전용 메뉴를 로그인 직후
사전에 숨기려면 plan 을 알 방법이 필요하다.

토큰에 plan claim 을 추가하는 대신 별도 조회 엔드포인트를 신설한 이유:
  1) 스프린트 0/2 는 아직 실제 로그인(재발급) 플로우가 없어 토큰이 테스트 헬퍼(_make_token)로만
     발급된다 — claim 추가는 토큰 재발급 경로 전체를 새로 설계해야 하는 범위 밖 작업.
  2) 더 견고한 패턴이기도 하다: plan 이 토큰 만료 전에 바뀌어도(예: 다운그레이드) 즉시 반영된다.
     토큰에 plan 을 굽으면 재로그인 전까지 stale plan 이 노출될 위험이 있다.

권한: 인증만 요구(get_auth_context). 자기 org 정보 조회이므로 org_id 자체가 신뢰 소스이며
3중 방어(RLS/서비스 재검증)가 불필요하다 — 타 org 리소스에 접근하지 않는다.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import AuthContext, get_auth_context, get_db
from app.models.organization import Organization
from app.schemas.auth import AuthMeResponse

router = APIRouter(tags=["auth"])


@router.get(
    "/auth/me",
    response_model=AuthMeResponse,
    summary="현재 인증 컨텍스트 + 구독 플랜 조회(FE 의 PRO 메뉴 사전 노출/숨김 판단용).",
)
def get_me(
    auth: AuthContext = Depends(get_auth_context),
    session: Session = Depends(get_db),
) -> AuthMeResponse:
    org = session.execute(
        select(Organization).where(Organization.id == auth.org_id)
    ).scalar_one_or_none()
    # require_plan 과 동일 방어적 폴백: 조직 행이 없으면(이론상 발생 불가) 'START' 취급.
    plan = org.plan if org is not None else "START"
    return AuthMeResponse(
        org_id=auth.org_id, role=auth.role, user_id=auth.user_id, plan=plan,
    )
