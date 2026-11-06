"""추천(운전 레시피) API — phase-2 슬라이스 K(docs/design/phase-2.md 2.3/2.4절).

GET  /sites/{site_id}/recommendations   : read-only 라이브 계산 + recipe_versions 영속화.
POST /recipes/{id}/versions             : 수동 버전 추가(require_writer).

★ Rule 1: `compute_recommendation`(culiver_kpi.recommend, data-kpi-engineer 소관)을
`recommendation_service.compute_site_recommendations` 를 통해 호출만 한다. 이 라우터는
권한/테넌시/직렬화만 담당한다.

권한(2.4절): 양쪽 엔드포인트 모두 PRO/ENTERPRISE 만 접근(`require_plan`). GET 은 계약이
viewer 차단을 명시하지 않으므로 plan 게이팅만 적용한다(비교(3.2절)와 달리 viewer 읽기
허용 — architect 계약 재확인 결과). POST 는 상태 변경(`require_writer`)이므로 viewer 는
role 게이트에서 이미 403.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.deps import AuthContext, get_db, require_plan, require_writer
from app.models.recipe import RecipeVersion
from app.schemas.recommendations import (
    RecipeVersionCreate,
    RecipeVersionResponse,
    RecommendationItem,
    RecommendationsResponse,
)
from app.services.audit import record_audit
from app.services.recommendation_service import compute_site_recommendations
from app.services.tenancy import resolve_recipe_for_org, resolve_site_for_org

router = APIRouter(tags=["recommendations"])

_PRO_PLUS = ("PRO", "ENTERPRISE")


@router.get(
    "/sites/{site_id}/recommendations",
    response_model=RecommendationsResponse,
    summary="급이·산소·순환 추천 3종 조회(PRO 이상, phase-2.md 2.3절, read-only 라이브 계산).",
)
def get_site_recommendations(
    site_id: str,
    auth: AuthContext = Depends(require_plan(*_PRO_PLUS)),
    session: Session = Depends(get_db),
) -> RecommendationsResponse:
    resolve_site_for_org(session, site_id, auth.org_id)

    generated_at = datetime.now(UTC)
    items_data = compute_site_recommendations(session, site_id, auth.org_id, auth.user_id)
    session.commit()

    items = [
        RecommendationItem(
            type=item.type,
            recipe_id=item.recipe_id,
            current_version=item.current_version,
            params=item.params,
            rationale=item.rationale,
            source_refs=item.source_refs,
            config_version=item.config_version,
            generated_at=generated_at,
        )
        for item in items_data
    ]

    return RecommendationsResponse(site_id=site_id, items=items, status="recommend_only")


@router.post(
    "/recipes/{recipe_id}/versions",
    response_model=RecipeVersionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="레시피 수동 버전 추가(require_writer + PRO 이상, phase-2.md 2.3절 하단).",
)
def create_recipe_version(
    recipe_id: str,
    payload: RecipeVersionCreate,
    auth: AuthContext = Depends(require_writer),
    _plan_auth: AuthContext = Depends(require_plan(*_PRO_PLUS)),
    session: Session = Depends(get_db),
) -> RecipeVersionResponse:
    recipe = resolve_recipe_for_org(session, recipe_id, auth.org_id)

    before_version = recipe.current_version
    new_version = before_version + 1
    row = RecipeVersion(
        id=f"recipever-{uuid4().hex}",
        recipe_id=recipe.id,
        org_id=recipe.org_id,  # 항상 부모 recipe 와 동일(갭2 하드닝, RLS 앵커).
        version=new_version,
        params_json=payload.params,
        rationale=payload.rationale,
        created_by=auth.user_id,
    )
    session.add(row)
    recipe.current_version = new_version
    session.flush()

    record_audit(
        session,
        org_id=auth.org_id,
        actor_id=auth.user_id,
        entity="recipes",
        entity_id=recipe.id,
        action="add_version",
        diff={
            "before": {"current_version": before_version},
            "after": {
                "current_version": new_version,
                "params": payload.params,
                "rationale": payload.rationale,
            },
        },
    )
    session.commit()
    session.refresh(row)

    return RecipeVersionResponse(
        id=row.id,
        recipe_id=row.recipe_id,
        version=row.version,
        params=row.params_json,
        rationale=row.rationale,
        created_by=row.created_by,
        created_at=row.created_at,
    )
