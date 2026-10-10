"""테넌시 서비스 — sprint-0 2.3절 3중 방어의 3번째 계층(서비스 재검증).

RLS(2번째 계층)를 신뢰하되 방어적으로 한 번 더: site_id 가 요청 org_id 에 속하는지
명시적으로 재검증한다. 불일치/부재 처리 규칙:
- site 자체가 없으면 → 404.
- site 는 있으나 타 org 소속이면 → 403(존재 사실은 노출, 접근만 거부).
  ※ RLS 가 켜진 Postgres 에서는 타 org site 가 애초에 조회되지 않아 404 가 되며,
    RLS 미지원(sqlite)에서는 이 레이어가 org 불일치를 잡아 403 을 반환한다.
    두 경우 모두 "누수 0" 을 만족(테넌시 누수 테스트 게이트, Rule 4).
"""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.batch import Batch
from app.models.control_action import ControlAction
from app.models.meter import Meter
from app.models.recipe import Recipe, RecipeVersion
from app.models.site import Site
from app.models.tank import Tank


def resolve_site_for_org(session: Session, site_id: str, org_id: str) -> Site:
    """site_id 를 org 스코프에서 해석. 없으면 404, 타 org 면 403.

    RLS 활성(Postgres) 세션에서는 org 밖 site 가 조회 자체에서 걸러져 404 로 귀결된다.
    RLS 비활성(sqlite) 세션을 대비해 org_id 를 명시적으로 비교한다(이중 방어).
    """
    site = session.execute(
        select(Site).where(Site.id == site_id)
    ).scalar_one_or_none()

    if site is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"site not found: {site_id}",
        )
    if site.org_id != org_id:
        # 타 org 리소스 접근 시도 — 명시적 거부(격리).
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="site does not belong to your organization",
        )
    return site


def resolve_batch_for_site(
    session: Session, batch_id: str, site_id: str, org_id: str
) -> Batch:
    """batch_id 가 요청 org·site 스코프에 속하는지 재검증(수기입력 3중 방어).

    - batch 부재 → 404.
    - 타 org 소속 → 403(격리; RLS-on 이면 애초에 조회 안 됨 → 404).
    - 다른 site 의 batch → 404(현재 site 소속이 아님).
    """
    batch = session.execute(
        select(Batch).where(Batch.id == batch_id)
    ).scalar_one_or_none()

    if batch is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"batch not found: {batch_id}",
        )
    if batch.org_id != org_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="batch does not belong to your organization",
        )
    tank = session.execute(
        select(Tank).where(Tank.id == batch.tank_id)
    ).scalar_one_or_none()
    if tank is None or tank.site_id != site_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="batch does not belong to this site",
        )
    return batch


def resolve_meter_for_site(
    session: Session, meter_id: str, site_id: str, org_id: str
) -> Meter:
    """meter_id 가 요청 org·site 스코프에 속하는지 재검증(phase-2 4.1절 readings 조회).

    - meter 부재 → 404.
    - 타 org 소속 → 403(격리; RLS-on 이면 애초에 조회 안 됨 → 404).
    - 같은 org 이나 다른 site 소속 → 404(현재 site 소속이 아님).
    """
    meter = session.execute(
        select(Meter).where(Meter.id == meter_id)
    ).scalar_one_or_none()

    if meter is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"meter not found: {meter_id}",
        )
    if meter.org_id != org_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="meter does not belong to your organization",
        )
    if meter.site_id != site_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="meter does not belong to this site",
        )
    return meter


def resolve_tank_for_site(
    session: Session, tank_id: str, site_id: str, org_id: str
) -> Tank:
    """tank_id 가 요청 org·site 스코프에 속하는지 재검증(phase-2 4.1절 readings 조회).

    - tank 부재 → 404.
    - 타 org 소속 → 403(격리).
    - 같은 org 이나 다른 site 소속 → 404.
    """
    tank = session.execute(
        select(Tank).where(Tank.id == tank_id)
    ).scalar_one_or_none()

    if tank is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"tank not found: {tank_id}",
        )
    if tank.org_id != org_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="tank does not belong to your organization",
        )
    if tank.site_id != site_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="tank does not belong to this site",
        )
    return tank


def resolve_tank_for_org(session: Session, tank_id: str, org_id: str) -> Tank:
    """tank_id 가 요청 org 스코프에 속하는지 재검증(site_id 사전 지정 없이, phase-3.md 3.2절).

    `POST /control-actions` 요청 바디는 `tank_id` 만 받고 `site_id` 는 tank 에서 파생하므로
    (3.1절), `resolve_tank_for_site` 와 달리 site_id 사전 조건이 없는 얕은 org 검증 버전이다.

    - tank 부재 → 404.
    - 타 org 소속 → 403(격리; RLS-on Postgres 는 애초에 조회 안 됨 → 404 로 귀결).
    """
    tank = session.execute(
        select(Tank).where(Tank.id == tank_id)
    ).scalar_one_or_none()

    if tank is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"tank not found: {tank_id}",
        )
    if tank.org_id != org_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="tank does not belong to your organization",
        )
    return tank


def resolve_recipe_version_for_org(
    session: Session, recipe_version_id: str, org_id: str
) -> RecipeVersion:
    """recipe_version_id 가 요청 org 스코프에 속하는지 재검증(phase-3.md 3.2절 control-actions).

    `recipe_versions.org_id`(0007 마이그레이션, 갭2 하드닝)로 직접 비교한다.

    - recipe_version 부재 → 404.
    - 타 org 소속 → 403(격리; RLS-on Postgres 는 애초에 조회 안 됨 → 404 로 귀결).
    """
    recipe_version = session.execute(
        select(RecipeVersion).where(RecipeVersion.id == recipe_version_id)
    ).scalar_one_or_none()

    if recipe_version is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"recipe version not found: {recipe_version_id}",
        )
    if recipe_version.org_id != org_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="recipe version does not belong to your organization",
        )
    return recipe_version


def resolve_recipe_for_org(session: Session, recipe_id: str, org_id: str) -> Recipe:
    """recipe_id 가 요청 org 스코프에 속하는지 재검증(phase-2.md 2.3절 POST /recipes/{id}/versions).

    recipe_versions 는 org_id 컬럼이 없어(2.1절 표) recipe 를 통해서만 간접 스코프가 연결된다
    — 반드시 이 헬퍼로 recipe 소유권을 먼저 검증한 뒤 recipe_versions 를 다뤄야 한다.

    - recipe 부재 → 404.
    - 타 org 소속 → 403(격리; RLS-on Postgres 는 애초에 조회 안 됨 → 404 로 귀결).
    """
    recipe = session.execute(
        select(Recipe).where(Recipe.id == recipe_id)
    ).scalar_one_or_none()

    if recipe is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"recipe not found: {recipe_id}",
        )
    if recipe.org_id != org_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="recipe does not belong to your organization",
        )
    return recipe


def resolve_control_action_for_org(
    session: Session, control_action_id: str, org_id: str
) -> ControlAction:
    """control_action_id 가 요청 org 스코프에 속하는지 재검증(phase-3.md 3.2절).

    approve/reject/apply/GET 단건 조회의 3중 방어 3번째 계층. `control_actions.org_id`
    (3.1절 비정규화)로 직접 비교한다.

    - 부재 → 404.
    - 타 org 소속 → 403(격리; RLS-on Postgres 는 애초에 조회 안 됨 → 404 로 귀결).
    """
    ca = session.execute(
        select(ControlAction).where(ControlAction.id == control_action_id)
    ).scalar_one_or_none()

    if ca is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"control action not found: {control_action_id}",
        )
    if ca.org_id != org_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="control action does not belong to your organization",
        )
    return ca
