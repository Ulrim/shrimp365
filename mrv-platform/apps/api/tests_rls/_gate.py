"""RLS 스위트 수집 게이트(ADR 0007 4절) — 단일 진실 공급원.

두 가지를 한곳에서 관리한다.
1) `RLS_TEST_DATABASE_URL` 부재 시 **모듈 수준 skip**. `pytest.skip(allow_module_level=True)`
   는 conftest 안에서 호출하면 수집 에러가 되므로(테스트 모듈에서만 유효) 이 헬퍼를 각
   테스트 모듈 최상단에서 호출한다 → 무설정 로컬/CI 에서 `skipped` 로 조용히 넘어간다.
2) `app` 임포트 **이전에** 환경변수를 세팅(`app.db.session` 이 임포트 시점에 engine 을 만든다).

"조용한 통과 위장" 방지는 게이트가 아니라 `conftest._assert_environment_is_valid()` 가 맡는다
(비 Postgres·superuser·미마이그레이션 → skip 이 아니라 **fail**).
"""

from __future__ import annotations

import os

import pytest

RLS_TEST_DATABASE_URL = os.getenv("RLS_TEST_DATABASE_URL")

# 스위트가 합성 JWT 를 서명할 때 쓰는 비밀(운영 값 아님 — 테스트 전용 상수).
SUPABASE_JWT_SECRET = "rls-suite-supabase-secret"

_SKIP_REASON = (
    "RLS_TEST_DATABASE_URL 미설정 — Postgres 전용 RLS 스위트를 건너뛴다 "
    "(실행: make test-rls, ADR 0007 4절)"
)


def bind_environment() -> None:
    """`app` 임포트 이전에 DATABASE_URL/AUTH_MODE 를 세팅(conftest 최상단에서 호출).

    URL 이 없으면 아무것도 하지 않는다 — 어차피 모든 테스트 모듈이 skip 된다.
    """
    if not RLS_TEST_DATABASE_URL:
        return
    os.environ["DATABASE_URL"] = RLS_TEST_DATABASE_URL
    # 운영과 동일 조건(ADR 0005): supabase 인증 경로를 켠 상태로 검증한다.
    os.environ["AUTH_MODE"] = "supabase"
    os.environ["SUPABASE_JWT_SECRET"] = SUPABASE_JWT_SECRET


def require_rls_database() -> None:
    """테스트 모듈 최상단에서 호출 — URL 이 없으면 모듈 전체를 skip 한다."""
    if not RLS_TEST_DATABASE_URL:
        pytest.skip(_SKIP_REASON, allow_module_level=True)
