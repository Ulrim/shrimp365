"""감사 로그 뷰어 API — phase-3.md 5절.

`audit_logs` 는 Phase 1 부터 baseline lock/수기입력/알림 ack 등에서 쌓이고 있다(Rule 9).
신규 테이블 없이 조회 API 만 추가한다. 읽기 전용이므로 `require_writer` 를 걸지 않는다
(누가 무엇을 했는지 투명하게 보는 것 자체가 목적, viewer 도 허용).
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.deps import AuthContext, get_db, require_plan
from app.models.audit_log import AuditLog
from app.schemas.audit_log import AuditLogEntry, AuditLogListResponse

router = APIRouter(tags=["audit-logs"])

_ENTERPRISE = ("ENTERPRISE",)


@router.get(
    "/audit-logs",
    response_model=AuditLogListResponse,
    summary="감사 로그 조회(ENTERPRISE, 읽기전용이므로 viewer 도 허용, 5절).",
)
def list_audit_logs(
    entity: str | None = Query(None, description="화이트리스트 검증 없이 문자열 매칭"),
    action: str | None = Query(None),
    from_: datetime | None = Query(None, alias="from"),
    to: datetime | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_plan(*_ENTERPRISE)),
    session: Session = Depends(get_db),
) -> AuditLogListResponse:
    # auth.org_id 스코프(기존 RLS 그대로 적용) 필터.
    query = select(AuditLog).where(AuditLog.org_id == auth.org_id)
    if entity is not None:
        query = query.where(AuditLog.entity == entity)
    if action is not None:
        query = query.where(AuditLog.action == action)
    if from_ is not None:
        query = query.where(AuditLog.ts >= from_)
    if to is not None:
        query = query.where(AuditLog.ts <= to)

    total = session.execute(
        select(func.count()).select_from(query.subquery())
    ).scalar_one()

    rows = session.execute(
        query.order_by(AuditLog.ts.desc()).limit(limit).offset(offset)
    ).scalars().all()

    items = [
        AuditLogEntry(
            id=r.id,
            entity=r.entity,
            entity_id=r.entity_id,
            action=r.action,
            actor_id=r.actor_id,
            diff=r.diff_json,
            ts=r.ts,
        )
        for r in rows
    ]
    return AuditLogListResponse(items=items, total=total)
