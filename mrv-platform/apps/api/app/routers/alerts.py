"""alerts API — phase-2 슬라이스 H(docs/design/phase-2.md 1.6/1.7절).

GET   /sites/{site_id}/alerts                : 알림 목록(status 필터).
POST  /alerts/{id}/ack                        : ack(idempotent, require_writer).
GET   /sites/{site_id}/alert-subscriptions    : 구독 스위치 현재 상태 조회(보강 — FE 새로고침 대응).
PATCH /sites/{site_id}/alert-subscriptions    : 구독 스위치 갱신(require_writer).

3중 방어(baseline.py/readings.py 관례 재사용): 인증(deps) → RLS(get_db) →
서비스 재검증(tenancy.resolve_site_for_org / 이 파일의 _resolve_alert_for_org).
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import AuthContext, get_auth_context, get_db, require_writer
from app.models.alert import Alert
from app.models.site import DEFAULT_ALERT_ENABLED_TYPES
from app.schemas.alerts import (
    AlertItem,
    AlertListResponse,
    AlertSubscriptionResponse,
    AlertSubscriptionUpdate,
)
from app.services.audit import record_audit
from app.services.tenancy import resolve_site_for_org

router = APIRouter(tags=["alerts"])

_VALID_STATUS_FILTERS = ("open", "ack", "all")


def _to_item(alert: Alert) -> AlertItem:
    return AlertItem(
        id=alert.id,
        type=alert.type,
        severity=alert.severity,
        payload=alert.payload_json or {},
        status=alert.status,
        created_at=alert.created_at,
        acked_by=alert.acked_by,
        acked_at=alert.acked_at,
    )


def _resolve_alert_for_org(session: Session, alert_id: str, org_id: str) -> Alert:
    """alert_id 가 요청 org 스코프에 속하는지 재검증(3중 방어). 없거나 타 org → 404.

    site/tank 와 달리 alert 는 '존재는 하되 접근 거부(403)'를 노출할 필요가 없다
    (알림 자체가 site 내부 운영 정보이므로 타 org 에는 존재 사실도 숨긴다 — 1.6절 에러표
    '404: site/alert 없음 또는 타 org').
    """
    alert = session.execute(
        select(Alert).where(Alert.id == alert_id)
    ).scalar_one_or_none()
    if alert is None or alert.org_id != org_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"alert not found: {alert_id}",
        )
    return alert


@router.get(
    "/sites/{site_id}/alerts",
    response_model=AlertListResponse,
    summary="알림 목록 조회(status 필터, phase-2.md 1.6절).",
)
def list_site_alerts(
    site_id: str,
    status_filter: str = Query(default="open", alias="status"),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
    session: Session = Depends(get_db),
) -> AlertListResponse:
    if status_filter not in _VALID_STATUS_FILTERS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"status must be one of {_VALID_STATUS_FILTERS}",
        )
    resolve_site_for_org(session, site_id, auth.org_id)

    stmt = select(Alert).where(Alert.site_id == site_id)
    if status_filter != "all":
        stmt = stmt.where(Alert.status == status_filter)

    total = len(session.execute(stmt).scalars().all())
    rows = session.execute(
        stmt.order_by(Alert.created_at.desc()).limit(limit).offset(offset)
    ).scalars().all()

    return AlertListResponse(
        site_id=site_id,
        org_id=auth.org_id,
        items=[_to_item(a) for a in rows],
        total=total,
    )


@router.post(
    "/alerts/{alert_id}/ack",
    response_model=AlertItem,
    summary="알림 확인 처리(idempotent, require_writer, phase-2.md 1.6절).",
)
def ack_alert(
    alert_id: str,
    auth: AuthContext = Depends(require_writer),
    session: Session = Depends(get_db),
) -> AlertItem:
    alert = _resolve_alert_for_org(session, alert_id, auth.org_id)

    if alert.status == "ack":
        # idempotent: 재클릭 안전(에러 아님, 변경 없이 200).
        return _to_item(alert)

    before = {"status": alert.status}
    alert.status = "ack"
    alert.acked_by = auth.user_id
    alert.acked_at = datetime.now(UTC)
    session.flush()

    record_audit(
        session,
        org_id=auth.org_id,
        actor_id=auth.user_id,
        entity="alerts",
        entity_id=alert.id,
        action="ack",
        diff={"before": before, "after": {"status": "ack"}},
    )
    session.commit()
    session.refresh(alert)
    return _to_item(alert)


@router.get(
    "/sites/{site_id}/alert-subscriptions",
    response_model=AlertSubscriptionResponse,
    summary="알림 구독 on/off 스위치 현재 상태 조회(1.7절 보강 — 새로고침 시 실제 저장값 로드용).",
)
def get_alert_subscriptions(
    site_id: str,
    auth: AuthContext = Depends(get_auth_context),
    session: Session = Depends(get_db),
) -> AlertSubscriptionResponse:
    site = resolve_site_for_org(session, site_id, auth.org_id)
    enabled = dict(site.alert_enabled_types or DEFAULT_ALERT_ENABLED_TYPES)
    return AlertSubscriptionResponse(site_id=site_id, alert_enabled_types=enabled)


@router.patch(
    "/sites/{site_id}/alert-subscriptions",
    response_model=AlertSubscriptionResponse,
    summary="알림 구독 on/off 스위치 갱신(require_writer, phase-2.md 1.7절).",
)
def update_alert_subscriptions(
    site_id: str,
    payload: AlertSubscriptionUpdate,
    auth: AuthContext = Depends(require_writer),
    session: Session = Depends(get_db),
) -> AlertSubscriptionResponse:
    site = resolve_site_for_org(session, site_id, auth.org_id)

    before = dict(site.alert_enabled_types or DEFAULT_ALERT_ENABLED_TYPES)
    updated = dict(before)
    changes = payload.model_dump(exclude_none=True)
    updated.update(changes)

    site.alert_enabled_types = updated
    session.flush()

    record_audit(
        session,
        org_id=auth.org_id,
        actor_id=auth.user_id,
        entity="sites",
        entity_id=site_id,
        action="update_alert_subscriptions",
        diff={"before": before, "after": updated},
    )
    session.commit()

    return AlertSubscriptionResponse(site_id=site_id, alert_enabled_types=updated)
