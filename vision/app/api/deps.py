"""Shared FastAPI dependencies (service-key auth, DB session re-export).

원본에는 여기에 JWT → users 조회 → 사용자 객체 반환이 있었다. 통합판에는
자체 사용자 표가 없다. 이 서비스를 부르는 쪽은 언제나 shrimp365 의 서버
라우트이고, "누가 요청했는가"와 "그 사람이 이 수조를 볼 권한이 있는가"는
거기서 Supabase 세션으로 이미 판정한다. 여기서는 **호출자가 shrimp365 가
맞는지**만 확인한다.

이 구조는 shrimp365 의 API 라우트를 반드시 거치게 만든다. 서비스를 외부에
직접 노출하면 안 되는 이유이기도 하다 — 서비스 키를 가진 쪽은 모든 수조를
볼 수 있다.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import service_key_valid
from app.database import get_session

SessionDep = Annotated[AsyncSession, Depends(get_session)]


async def require_service_key(
    x_vision_key: Annotated[str | None, Header(alias="X-Vision-Key")] = None,
) -> None:
    if not service_key_valid(x_vision_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효한 X-Vision-Key 헤더가 필요합니다.",
        )
