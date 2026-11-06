"""ADR 0007 5절(D5) 기동 가드 단위테스트 — 앱 DB 역할의 RLS 우회 차단.

이 스위트는 **실제 Postgres 없이** 돌아야 한다(`make test` = SQLite). 따라서 engine 을
최소 스텁으로 대체해 `assert_non_superuser_db_role` 의 분기만 검증한다.
RLS 가 실제로 작동하는지는 별도 Postgres 스위트(`make test-rls`)의 몫이다.
"""

from __future__ import annotations

import logging
from contextlib import contextmanager

import pytest

from app.config import InsecureDatabaseRoleError, assert_non_superuser_db_role


class _Row:
    def __init__(self, rolsuper: bool, rolbypassrls: bool) -> None:
        self.rolsuper = rolsuper
        self.rolbypassrls = rolbypassrls


class _Result:
    def __init__(self, row: _Row | None) -> None:
        self._row = row

    def first(self) -> _Row | None:
        return self._row


class _Conn:
    def __init__(self, row: _Row | None) -> None:
        self._row = row
        self.executed: list[str] = []

    def execute(self, statement, *_args, **_kwargs) -> _Result:
        self.executed.append(str(statement))
        return _Result(self._row)


class _Dialect:
    def __init__(self, name: str) -> None:
        self.name = name


class _FakeEngine:
    """`engine.dialect.name` + `engine.connect()` 만 흉내내는 스텁."""

    def __init__(
        self,
        *,
        dialect: str = "postgresql",
        row: _Row | None = None,
        raise_on_connect: Exception | None = None,
    ) -> None:
        self.dialect = _Dialect(dialect)
        self._row = row
        self._raise = raise_on_connect
        self.connect_calls = 0

    @contextmanager
    def connect(self):
        self.connect_calls += 1
        if self._raise is not None:
            raise self._raise
        yield _Conn(self._row)


# --- superuser / BYPASSRLS 역할 -----------------------------------------------------


@pytest.mark.parametrize(
    ("rolsuper", "rolbypassrls"),
    [(True, False), (False, True), (True, True)],
)
def test_production_rejects_rls_bypassing_role(rolsuper: bool, rolbypassrls: bool) -> None:
    """production + superuser/BYPASSRLS → 기동 실패(RLS 가 0의 보호가 되는 상태)."""
    engine = _FakeEngine(row=_Row(rolsuper, rolbypassrls))
    with pytest.raises(InsecureDatabaseRoleError) as exc_info:
        assert_non_superuser_db_role(engine, "production")
    message = str(exc_info.value)
    assert "NOSUPERUSER NOBYPASSRLS" in message
    assert "ADR 0007" in message


@pytest.mark.parametrize(
    ("rolsuper", "rolbypassrls"),
    [(True, False), (False, True), (True, True)],
)
def test_development_allows_rls_bypassing_role_with_warning(
    caplog: pytest.LogCaptureFixture, rolsuper: bool, rolbypassrls: bool
) -> None:
    """개발 환경은 통과시키되 경고를 남긴다(현재 로컬 스택은 superuser 로 도는 것이 정상)."""
    engine = _FakeEngine(row=_Row(rolsuper, rolbypassrls))
    with caplog.at_level(logging.WARNING, logger="culiver.api"):
        assert_non_superuser_db_role(engine, "development")
    assert any("RLS 를 우회한다" in record.getMessage() for record in caplog.records)


# --- 정상 역할 ----------------------------------------------------------------------


@pytest.mark.parametrize("environment", ["production", "development", "staging"])
def test_non_superuser_role_passes_in_every_environment(
    caplog: pytest.LogCaptureFixture, environment: str
) -> None:
    """NOSUPERUSER · NOBYPASSRLS 역할이면 어떤 환경에서도 통과하고 경고도 없다."""
    engine = _FakeEngine(row=_Row(False, False))
    with caplog.at_level(logging.WARNING, logger="culiver.api"):
        assert_non_superuser_db_role(engine, environment)
    assert caplog.records == []


# --- 비 Postgres(SQLite) -------------------------------------------------------------


def test_sqlite_is_noop_and_never_connects() -> None:
    """SQLite 는 RLS 개념이 없다 → 조회 자체를 하지 않는다(테스트/개발 폴백 무해)."""
    engine = _FakeEngine(dialect="sqlite", row=_Row(True, True))
    assert_non_superuser_db_role(engine, "production")
    assert engine.connect_calls == 0


# --- 확인 불가(fail closed) ----------------------------------------------------------


def test_production_fails_closed_when_role_cannot_be_verified() -> None:
    """DB 조회 실패를 production 에서 통과로 처리하면 가드가 우회 가능해진다 → 실패시킨다."""
    engine = _FakeEngine(raise_on_connect=OSError("connection refused"))
    with pytest.raises(InsecureDatabaseRoleError) as exc_info:
        assert_non_superuser_db_role(engine, "production")
    assert "fail closed" in str(exc_info.value)


def test_development_continues_when_role_cannot_be_verified(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """개발 환경에서는 DB 가 안 떠 있어도 앱 기동을 막지 않는다(경고만)."""
    engine = _FakeEngine(raise_on_connect=OSError("connection refused"))
    with caplog.at_level(logging.WARNING, logger="culiver.api"):
        assert_non_superuser_db_role(engine, "development")
    assert any("확인하지 못했다" in record.getMessage() for record in caplog.records)


def test_missing_pg_roles_row_is_rejected_in_production() -> None:
    """current_user 가 pg_roles 에 없으면 역할 속성을 단정할 수 없다 → production 실패."""
    engine = _FakeEngine(row=None)
    with pytest.raises(InsecureDatabaseRoleError):
        assert_non_superuser_db_role(engine, "production")


def test_missing_pg_roles_row_is_warned_in_development(
    caplog: pytest.LogCaptureFixture,
) -> None:
    engine = _FakeEngine(row=None)
    with caplog.at_level(logging.WARNING, logger="culiver.api"):
        assert_non_superuser_db_role(engine, "development")
    assert any("pg_roles" in record.getMessage() for record in caplog.records)


# --- lifespan 배선 확인 --------------------------------------------------------------


def test_lifespan_invokes_role_guard(monkeypatch: pytest.MonkeyPatch) -> None:
    """가드가 실제로 앱 시작 훅에 배선되어 있는지 고정(배선 누락 회귀 방지)."""
    import anyio

    from app import main as main_module

    calls: list[tuple[object, str]] = []

    def _spy(engine, environment: str) -> None:
        calls.append((engine, environment))

    monkeypatch.setattr(main_module, "assert_non_superuser_db_role", _spy)

    async def _run() -> None:
        async with main_module._lifespan(main_module.app):
            pass

    anyio.run(_run)

    assert len(calls) == 1
    assert calls[0][0] is main_module.engine
    assert calls[0][1] == main_module.settings.environment
