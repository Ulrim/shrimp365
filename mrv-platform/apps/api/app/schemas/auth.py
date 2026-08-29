"""auth 스키마 — GET /auth/me(QA phase-2 조건부승인 갭1, 하드닝).

FE 가 로그인 직후(토큰 만료 전이라도) 현재 plan 을 조회할 수 있게 하는 read-only 엔드포인트.
토큰에 plan claim 을 굽지 않는 이유는 auth_me 모듈 docstring 참고.
"""

from __future__ import annotations

from pydantic import BaseModel


class AuthMeResponse(BaseModel):
    """GET /auth/me 응답. 자기 org 정보만 반환하므로 3중 방어 불필요(org_id 자체가 신뢰 소스)."""

    org_id: str
    role: str
    user_id: str
    plan: str
