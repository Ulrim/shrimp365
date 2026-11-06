"""API Key 인증 — ingestion 게이트웨이용(phase-1 3.3절).

- `X-API-Key` 헤더 원문 → 단방향 해시(sha256) → `api_keys.key_hash` 대조.
  원문은 어디에도 저장하지 않는다(모델 주석/Rule 7). 조회는 해시 비교로만 수행한다.
- 매칭된 api_key 의 (org_id, site_id) 가 tenancy 의 **진실**이다. 바디/토픽의
  gateway_id·meter_id·site_id 는 신뢰하지 않는다(스푸핑 방지).
- 무효(부재/미일치)/revoked → 401.

결정론: sha256 은 순수 함수 → 시드가 같은 원문에서 항상 같은 해시를 생성한다.
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterator
from dataclasses import dataclass

from fastapi import Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal, set_org_context
from app.models.api_key import ApiKey


def hash_api_key(raw_key: str) -> str:
    """원문 키 → sha256 hex(64자). 단방향·결정론. 원문 저장 금지 규약의 핵심."""
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class IngestContext:
    """API Key 로 확정된 ingestion 요청 컨텍스트(요청 스코프에 주입).

    session 은 org_id 컨텍스트(RLS)가 바인딩된 상태로 제공된다. tenancy 는
    key 스코프(org_id, site_id)가 진실이며 바디/토픽 값은 신뢰하지 않는다.
    """

    session: Session
    org_id: str
    site_id: str
    api_key_id: str


def get_ingest_context(
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> Iterator[IngestContext]:
    """X-API-Key 검증 → IngestContext(세션 포함). 무효/revoked → 401.

    JWT 경로(get_db)와 달리 org_id 는 토큰이 아니라 매칭된 api_key 에서 온다.
    키 조회는 org 컨텍스트가 없는 상태에서 수행한 뒤(전 org 대상 해시 조회),
    확정된 org_id 로 RLS 컨텍스트를 바인딩한다.

    ★ 이 순서(조회 → set_org_context)가 Postgres 에서 성립하는 근거는 마이그레이션 0013 의
    `api_keys_select_open` 정책(ADR 0007 1절)이다. `api_keys` 는 RLS 대상 테이블이며
    (0002 `_RLS_TABLES`), 0013 이전의 `FOR ALL` 정책 하에서는 이 조회가 **0행**이 되어
    수집 API 가 전건 401 이었다(ADR 0007 D2 실측). SELECT 만 개방되고 쓰기는 여전히 org
    스코프이므로, 이 세션으로 쓰기를 하기 전 set_org_context 호출은 필수다(아래에서 수행).
    """
    if not x_api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing api key",
            headers={"WWW-Authenticate": "ApiKey"},
        )
    session = SessionLocal()
    try:
        key_hash = hash_api_key(x_api_key)
        api_key = session.execute(
            select(ApiKey).where(ApiKey.key_hash == key_hash)
        ).scalar_one_or_none()
        if api_key is None or api_key.revoked:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="invalid or revoked api key",
                headers={"WWW-Authenticate": "ApiKey"},
            )
        # 확정 org_id 로 RLS 컨텍스트 바인딩(2번째 계층). sqlite 는 no-op.
        set_org_context(session, api_key.org_id)
        yield IngestContext(
            session=session,
            org_id=api_key.org_id,
            site_id=api_key.site_id,
            api_key_id=api_key.id,
        )
    finally:
        session.close()
