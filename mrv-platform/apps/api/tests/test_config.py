"""app.config.Settings 가드 회귀 테스트 — Phase 3 슬라이스 O(ADR 0005 5절).

`environment=production` + `auth_mode=test-local` 조합은 설정 로드 시점(`Settings()` 생성)에
`ValueError` 로 즉시 실패해야 한다(운영에 test-local 경로가 노출되는 것을 물리적으로 차단,
ADR 0002 와 동형의 강제 패턴). `get_settings()` 싱글턴 캐시를 건드리지 않고 `Settings` 를
직접 생성해 검증한다(다른 테스트의 전역 설정에 영향을 주지 않기 위함).
"""

from __future__ import annotations

import pytest

from app.config import Settings


def test_production_requires_supabase_auth_mode():
    with pytest.raises(ValueError, match="AUTH_MODE=supabase"):
        Settings(environment="production", auth_mode="test-local")


def test_production_with_supabase_auth_mode_and_secret_is_ok():
    settings = Settings(
        environment="production",
        auth_mode="supabase",
        supabase_jwt_secret="prod-secret",
    )
    assert settings.environment == "production"
    assert settings.auth_mode == "supabase"


def test_supabase_auth_mode_requires_jwt_secret():
    with pytest.raises(ValueError, match="SUPABASE_JWT_SECRET"):
        Settings(environment="development", auth_mode="supabase", supabase_jwt_secret="")


def test_development_test_local_default_is_ok():
    """기존/기본 조합(개발+test-local)은 계속 허용되어야 한다(회귀 방지)."""
    settings = Settings(environment="development", auth_mode="test-local")
    assert settings.auth_mode == "test-local"


def test_invalid_auth_mode_value_rejected():
    with pytest.raises(ValueError):
        Settings(auth_mode="something-else")  # type: ignore[arg-type]
