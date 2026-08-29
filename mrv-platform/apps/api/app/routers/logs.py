"""수기 입력(급이/폐사) 엔드포인트 — MASTER 화면4 백엔드(FE 입력 폼).

POST /sites/{site_id}/feed-logs      : feed_logs 삽입(FCR 분자).
POST /sites/{site_id}/mortality-logs : mortality_logs 삽입(폐사율 분자).
권한: owner/operator(viewer 403). 3중 테넌시 방어 + audit_logs 기록(Rule 9).
"""

from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.deps import AuthContext, get_db, require_writer
from app.models.feed_log import FeedLog
from app.models.mortality_log import MortalityLog
from app.schemas.logs import (
    FeedLogCreate,
    FeedLogResponse,
    MortalityLogCreate,
    MortalityLogResponse,
)
from app.services.audit import record_audit
from app.services.tenancy import resolve_batch_for_site, resolve_site_for_org

router = APIRouter(tags=["logs"])


@router.post(
    "/sites/{site_id}/feed-logs",
    response_model=FeedLogResponse,
    status_code=status.HTTP_201_CREATED,
    summary="급이 기록 수기 입력(FCR 분자). owner/operator 만. audit 기록.",
)
def create_feed_log(
    site_id: str,
    payload: FeedLogCreate,
    auth: AuthContext = Depends(require_writer),
    session: Session = Depends(get_db),
) -> FeedLogResponse:
    """feed_logs 1행 삽입. batch 는 site/org 소속이어야 한다(3중 방어)."""
    resolve_site_for_org(session, site_id, auth.org_id)
    batch = resolve_batch_for_site(session, payload.batch_id, site_id, auth.org_id)

    feed = FeedLog(
        id=f"feed-{uuid4().hex}",
        batch_id=batch.id,
        org_id=auth.org_id,
        ts=payload.ts,
        feed_kg=payload.feed_kg,
        source=payload.source or "manual",
        quality_flag="ok",
    )
    session.add(feed)
    session.flush()

    record_audit(
        session,
        org_id=auth.org_id,
        actor_id=auth.user_id,
        entity="feed_logs",
        entity_id=feed.id,
        action="create",
        diff={
            "before": None,
            "after": {
                "batch_id": feed.batch_id,
                "ts": payload.ts.isoformat(),
                "feed_kg": feed.feed_kg,
                "source": feed.source,
            },
        },
    )
    session.commit()

    return FeedLogResponse(
        id=feed.id,
        batch_id=feed.batch_id,
        org_id=feed.org_id,
        ts=payload.ts,
        feed_kg=feed.feed_kg,
        source=feed.source,
        quality_flag=feed.quality_flag,
    )


@router.post(
    "/sites/{site_id}/mortality-logs",
    response_model=MortalityLogResponse,
    status_code=status.HTTP_201_CREATED,
    summary="폐사 기록 수기 입력(폐사율 분자). owner/operator 만. audit 기록.",
)
def create_mortality_log(
    site_id: str,
    payload: MortalityLogCreate,
    auth: AuthContext = Depends(require_writer),
    session: Session = Depends(get_db),
) -> MortalityLogResponse:
    """mortality_logs 1행 삽입. batch 는 site/org 소속이어야 한다(3중 방어)."""
    resolve_site_for_org(session, site_id, auth.org_id)
    batch = resolve_batch_for_site(session, payload.batch_id, site_id, auth.org_id)

    mort = MortalityLog(
        id=f"mort-{uuid4().hex}",
        batch_id=batch.id,
        org_id=auth.org_id,
        ts=payload.ts,
        dead_count=payload.dead_count,
        cause_note=payload.cause_note,
    )
    session.add(mort)
    session.flush()

    record_audit(
        session,
        org_id=auth.org_id,
        actor_id=auth.user_id,
        entity="mortality_logs",
        entity_id=mort.id,
        action="create",
        diff={
            "before": None,
            "after": {
                "batch_id": mort.batch_id,
                "ts": payload.ts.isoformat(),
                "dead_count": mort.dead_count,
                "cause_note": mort.cause_note,
            },
        },
    )
    session.commit()

    return MortalityLogResponse(
        id=mort.id,
        batch_id=mort.batch_id,
        org_id=mort.org_id,
        ts=payload.ts,
        dead_count=mort.dead_count,
        cause_note=mort.cause_note,
    )
