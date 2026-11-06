"""POST /ingest/readings — 게이트웨이 수집(HTTP, API Key). phase-1 3.3절 주력 계약.

인증: X-API-Key → api_keys → (org_id, site_id) 스코프 확정(바디 tenancy 불신).
처리: 스코프 검증 → 정규화(ADR 0001) → 멱등 저장 → {accepted, deduped, rejected}.
멱등: (meter_id, ts) = readings PK. 재전송 중복은 deduped 로 흡수(at-least-once 안전).

주: ingestion 은 데이터 평면(고빈도) 쓰기다. audit_logs(Rule 9)는 제어/설정 변경 대상이며
계측값 수집은 감사 대상이 아니다 → audit 미기록.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, status

from app.schemas.ingest import IngestRequest, IngestResponse, RejectedItem
from app.services.api_key_auth import IngestContext, get_ingest_context
from app.services.ingestion import RawReading, process_batch

router = APIRouter(tags=["ingest"])


@router.post(
    "/ingest/readings",
    response_model=IngestResponse,
    status_code=status.HTTP_200_OK,
    summary=(
        "게이트웨이 계측 수집(X-API-Key). 정규화(ADR 0001)+멱등 저장. "
        "스코프 밖 meter 는 부분 거부(rejected[])."
    ),
)
def ingest_readings(
    payload: IngestRequest,
    ctx: IngestContext = Depends(get_ingest_context),
) -> IngestResponse:
    """수집 배치를 정규화·멱등 저장. 응답 200 {accepted, deduped, rejected}."""
    raws = [
        RawReading(
            index=i,
            meter_id=r.meter_id,
            ts=r.ts,
            value=r.value,
            reading_kind=r.reading_kind,
            seq=r.seq,
        )
        for i, r in enumerate(payload.readings)
    ]
    result = process_batch(
        ctx.session,
        org_id=ctx.org_id,
        site_id=ctx.site_id,
        raws=raws,
    )
    ctx.session.commit()
    return IngestResponse(
        accepted=result.accepted,
        deduped=result.deduped,
        rejected=[RejectedItem(index=i, reason=reason) for i, reason in result.rejected],
    )
