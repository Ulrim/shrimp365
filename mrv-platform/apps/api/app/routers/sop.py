"""SOP 라이브러리 API — phase-3.md 2절(화면8, PRO).

GET  /sop                                          : 목록(id/title/category/summary), PRO+.
GET  /sop/{id}                                     : 상세(body_markdown+checklist_items), PRO+.
                                                      파일 읽기 실패/없음 → 404.
POST /sites/{site_id}/sop/{sop_id}/checklist-runs  : 실행 기록 생성(require_writer, append-only).
GET  /sites/{site_id}/sop/checklist-runs           : 실행 기록 조회(?sop_id=&from=&to=, PRO+).
"""

from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.deps import AuthContext, get_db, require_plan, require_writer
from app.models.sop_checklist_run import SopChecklistRun
from app.schemas.sop import (
    ChecklistRunCreateRequest,
    ChecklistRunItemResponse,
    ChecklistRunListResponse,
    ChecklistRunResponse,
    SopDetailResponse,
    SopListResponse,
    SopSummaryResponse,
)
from app.services.audit import record_audit
from app.services.sop_content import get_sop_detail, list_sop_summaries, sop_exists
from app.services.tenancy import resolve_site_for_org

router = APIRouter(tags=["sop"])

_PRO_PLUS = ("PRO", "ENTERPRISE")


@router.get(
    "/sop",
    response_model=SopListResponse,
    summary="SOP 목록(화면8 4종 카테고리, PRO+).",
)
def list_sop(
    _auth: AuthContext = Depends(require_plan(*_PRO_PLUS)),
) -> SopListResponse:
    return SopListResponse(
        items=[
            SopSummaryResponse(
                id=s.id, title=s.title, category=s.category, summary=s.summary
            )
            for s in list_sop_summaries()
        ]
    )


@router.get(
    "/sop/{sop_id}",
    response_model=SopDetailResponse,
    summary="SOP 상세(본문 마크다운+체크리스트 정의, PRO+). 없으면 404.",
)
def get_sop(
    sop_id: str,
    _auth: AuthContext = Depends(require_plan(*_PRO_PLUS)),
) -> SopDetailResponse:
    detail = get_sop_detail(sop_id)
    if detail is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"sop not found: {sop_id}"
        )
    return SopDetailResponse(
        id=detail.id,
        title=detail.title,
        category=detail.category,
        body_markdown=detail.body_markdown,
        checklist_items=[
            {"id": item.id, "label": item.label} for item in detail.checklist_items
        ],
    )


def _row_to_response(row: SopChecklistRun) -> ChecklistRunResponse:
    return ChecklistRunResponse(
        id=row.id,
        site_id=row.site_id,
        org_id=row.org_id,
        sop_id=row.sop_id,
        items=[ChecklistRunItemResponse(**item) for item in row.items_json],
        performed_by=row.performed_by,
        performed_at=row.performed_at,
    )


@router.post(
    "/sites/{site_id}/sop/{sop_id}/checklist-runs",
    response_model=ChecklistRunResponse,
    status_code=status.HTTP_201_CREATED,
    summary="SOP 체크리스트 실행 기록 생성(append-only, 증빙, 2.2절).",
)
def create_checklist_run(
    site_id: str,
    sop_id: str,
    payload: ChecklistRunCreateRequest,
    auth: AuthContext = Depends(require_writer),
    session: Session = Depends(get_db),
) -> ChecklistRunResponse:
    """3중 방어(site) → sop_id 존재 확인(콘텐츠는 DB 밖이므로 느슨한 참조 검증) → 삽입 → audit."""
    resolve_site_for_org(session, site_id, auth.org_id)
    if not sop_exists(sop_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"sop not found: {sop_id}"
        )

    items_json = [item.model_dump() for item in payload.items]
    run_id = f"scr-{uuid4().hex}"
    run = SopChecklistRun(
        id=run_id,
        site_id=site_id,
        org_id=auth.org_id,
        sop_id=sop_id,
        items_json=items_json,
        performed_by=auth.user_id,
    )
    session.add(run)
    session.flush()

    record_audit(
        session,
        org_id=auth.org_id,
        actor_id=auth.user_id,
        entity="sop_checklist_runs",
        entity_id=run_id,
        action="create",
        diff={"before": None, "after": {"sop_id": sop_id, "items": items_json}},
    )
    session.commit()

    return _row_to_response(run)


@router.get(
    "/sites/{site_id}/sop/checklist-runs",
    response_model=ChecklistRunListResponse,
    summary="SOP 체크리스트 실행 이력 조회(?sop_id=&from=&to=, PRO+, 2.2절).",
)
def list_checklist_runs(
    site_id: str,
    sop_id: str | None = Query(None),
    from_: datetime | None = Query(None, alias="from"),
    to: datetime | None = Query(None),
    auth: AuthContext = Depends(require_plan(*_PRO_PLUS)),
    session: Session = Depends(get_db),
) -> ChecklistRunListResponse:
    resolve_site_for_org(session, site_id, auth.org_id)

    stmt = select(SopChecklistRun).where(SopChecklistRun.site_id == site_id)
    if sop_id is not None:
        stmt = stmt.where(SopChecklistRun.sop_id == sop_id)
    if from_ is not None:
        stmt = stmt.where(SopChecklistRun.performed_at >= from_)
    if to is not None:
        stmt = stmt.where(SopChecklistRun.performed_at <= to)

    total = session.execute(
        select(func.count()).select_from(stmt.subquery())
    ).scalar_one()
    rows = session.execute(
        stmt.order_by(SopChecklistRun.performed_at.desc())
    ).scalars().all()

    return ChecklistRunListResponse(items=[_row_to_response(r) for r in rows], total=total)
