"""온보딩 진행 상태 API — phase-3.md 7.3절.

`GET /sites/{site_id}/onboarding-status`: 별도 상태 테이블 없이 매 요청 시 기존 데이터에서
파생 계산한다(과설계 금지 — 상태 동기화 버그 리스크 자체를 없앤다).

판정 로직(신규 산식 아님, 단순 존재 여부 조회):
  - install_kit    : 해당 site 로 발급된 api_keys 존재.
  - sensor_mapping  : 해당 site 에 등록된 meters 존재.
  - baseline_locked : 해당 site 의 locked baseline 존재.
  - plan_active     : organizations.plan != 'START'.
current_step = 4단계 중 아직 done=False 인 첫 단계(순서: install_kit → sensor_mapping →
  baseline_locked → plan_active). 전부 완료면 None.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import AuthContext, get_auth_context, get_db
from app.models.api_key import ApiKey
from app.models.baseline import Baseline
from app.models.meter import Meter
from app.models.organization import Organization
from app.schemas.onboarding import (
    OnboardingStatusResponse,
    OnboardingSteps,
    OnboardingStepStatus,
)
from app.services.tenancy import resolve_site_for_org

router = APIRouter(tags=["onboarding"])


@router.get(
    "/sites/{site_id}/onboarding-status",
    response_model=OnboardingStatusResponse,
    summary="온보딩 진행 상태(파생 조회, 신규 상태 테이블 불필요, 7.3절).",
)
def get_onboarding_status(
    site_id: str,
    auth: AuthContext = Depends(get_auth_context),
    session: Session = Depends(get_db),
) -> OnboardingStatusResponse:
    resolve_site_for_org(session, site_id, auth.org_id)

    api_key_count = session.execute(
        select(ApiKey.id).where(ApiKey.site_id == site_id)
    ).first()
    meter_count = session.execute(
        select(Meter.id).where(Meter.site_id == site_id)
    ).all()
    locked_baseline = session.execute(
        select(Baseline.id)
        .where(Baseline.site_id == site_id)
        .where(Baseline.status == "locked")
    ).first()
    org = session.execute(
        select(Organization).where(Organization.id == auth.org_id)
    ).scalar_one_or_none()
    plan = org.plan if org is not None else "START"

    meters_n = len(meter_count)

    steps = OnboardingSteps(
        install_kit=OnboardingStepStatus(
            done=api_key_count is not None,
            detail=(
                "api_keys 1개 이상 발급됨"
                if api_key_count is not None
                else "발급된 api_keys 없음"
            ),
        ),
        sensor_mapping=OnboardingStepStatus(
            done=meters_n > 0,
            detail=(
                f"meters {meters_n}개 등록됨" if meters_n > 0 else "등록된 meters 없음"
            ),
        ),
        baseline_locked=OnboardingStepStatus(
            done=locked_baseline is not None,
            detail=(
                "잠긴 baseline 있음" if locked_baseline is not None else "잠긴 baseline 없음"
            ),
        ),
        plan_active=OnboardingStepStatus(
            done=plan != "START",
            detail=f"현재 플랜: {plan}" + ("(무료/평가)" if plan == "START" else ""),
        ),
    )

    current_step = None
    for name in ("install_kit", "sensor_mapping", "baseline_locked", "plan_active"):
        if not getattr(steps, name).done:
            current_step = name
            break

    return OnboardingStatusResponse(steps=steps, current_step=current_step)
