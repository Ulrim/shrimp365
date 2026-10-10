"""Postgres 전용 RLS 동작 검증 스위트의 픽스처(ADR 0007 4절 / C8).

왜 `tests/` 가 아니라 형제 디렉터리인가:
- `pyproject.toml` 의 `testpaths = ["tests"]` 덕분에 `make test-api` 는 이 디렉터리를 수집하지
  않는다(기존 263건 회귀 0 보장).
- `tests/conftest.py` 는 상단에서 `DATABASE_URL` 을 SQLite 로 강제 세팅한다. 하위 디렉터리였다면
  그 conftest 가 먼저 로드되어 RLS 검증이 불가능해진다 → 반드시 형제 디렉터리여야 한다.

게이트(ADR 0007 4절):
- `RLS_TEST_DATABASE_URL` 부재 → 각 테스트 모듈이 `_gate.require_rls_database()` 로 모듈 수준
  skip(무설정 로컬/CI 에서 조용한 no-op). conftest 에서 `pytest.skip(allow_module_level=True)`
  를 부르면 pytest 가 **수집 에러**로 처리하므로 게이트를 `_gate.py` 로 분리했다.
- 접속 역할이 `rolsuper` 또는 `rolbypassrls` → **skip 이 아니라 fail**. superuser 로 돌리면
  RLS 가 전면 우회되어 전부 초록불이 되는 D5 함정을 테스트가 스스로 막는다.
- 대상 DB 가 Postgres 가 아니거나 `alembic upgrade head` 가 안 됐으면 fail
  (게이트를 빠뜨린 테스트가 SQLite 위에서 조용히 통과하는 것을 막는다).
"""

from __future__ import annotations

import contextlib
import hashlib
from datetime import UTC, datetime

import pytest

# --- 게이트 1: app 임포트 이전에 DATABASE_URL/AUTH_MODE 세팅(tests/conftest.py 패턴 차용) ---
# app.db.session 이 임포트 시점에 engine 을 만들기 때문에 순서가 중요하다.
# `RLS_TEST_DATABASE_URL` 부재 시의 skip 은 각 테스트 모듈이 `_gate.require_rls_database()`
# 로 수행한다(conftest 안의 module-level skip 은 pytest 가 수집 에러로 처리한다).
from tests_rls._gate import bind_environment  # noqa: E402

bind_environment()

from sqlalchemy import text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.db.session import SessionLocal, engine  # noqa: E402
from app.services.api_key_auth import hash_api_key  # noqa: E402

# --- 결정론 시드 상수(멱등 재실행 가능) ---------------------------------------------
ORG_A = "org-RLS-A"
ORG_B = "org-RLS-B"
SITE_A = "site-RLS-A"
SITE_B = "site-RLS-B"
TANK_A = "tank-RLS-A"
TANK_B = "tank-RLS-B"
USER_A_LINKED = "user-RLS-A-linked"
USER_A_INVITED = "user-RLS-A-invited"
# lazy-link e2e(test 10) 전용 미연계 초대 행 — USER_A_INVITED 를 소비하면 test 2 가 깨지므로
# 별도로 둔다(테스트 간 순서 독립성).
USER_A_LOGIN = "user-RLS-A-login"
USER_B_LINKED = "user-RLS-B-linked"
UID_A_LINKED = "11111111-1111-4111-8111-111111111111"
UID_A_INVITED = "22222222-2222-4222-8222-222222222222"
UID_A_LOGIN = "44444444-4444-4444-8444-444444444444"
UID_B_LINKED = "33333333-3333-4333-8333-333333333333"
EMAIL_A_LINKED = "linked-a@rls.example"
EMAIL_A_INVITED = "invited-a@rls.example"
EMAIL_A_LOGIN = "login-a@rls.example"
EMAIL_B_LINKED = "linked-b@rls.example"
API_KEY_A_RAW = "rls-suite-raw-key-org-a"
API_KEY_A_ID = "apikey-RLS-A"
API_KEY_B_RAW = "rls-suite-raw-key-org-b"
API_KEY_B_ID = "apikey-RLS-B"
DO_METER_A = "meter-RLS-A-do"
DO_METER_B = "meter-RLS-B-do"
POWER_METER_A = "meter-RLS-A-power"
# 배치 평가 기준시각(결정론 — Rule 6: 산식 입력이 아닌 배치 메타데이터).
EVALUATED_AT = datetime(2026, 8, 1, 12, 0, tzinfo=UTC)
DO_SAMPLE_TIME = datetime(2026, 8, 1, 11, 0, tzinfo=UTC)
# alerting.do_low_mg_l 기본값 3.0 미만 → do_low 트리거(임계값 자체는 packages/kpi 소관).
DO_SAMPLE_VALUE = 1.2

_ORG_IDS = (ORG_A, ORG_B)


def api_key_hash(raw: str) -> str:
    """sha256 hex — `app.services.api_key_auth.hash_api_key` 와 동일해야 한다(교차 확인)."""
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    assert digest == hash_api_key(raw)
    return digest


# --- 게이트 2/3: 역할 권한 · 스키마 적용 여부 ----------------------------------------
def _assert_environment_is_valid() -> None:
    with engine.connect() as conn:
        if conn.dialect.name not in ("postgresql", "postgres"):
            pytest.fail(
                f"RLS_TEST_DATABASE_URL 이 Postgres 가 아니다: {conn.dialect.name!r}. "
                "RLS 는 Postgres 전용 검증이다(ADR 0007 4절)."
            )
        row = conn.execute(
            text(
                "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user"
            )
        ).one()
        if row.rolsuper or row.rolbypassrls:
            # skip 이 아니라 fail — superuser 로 돌리면 RLS 가 전면 우회되어 전부 통과한다(D5).
            pytest.fail(
                "RLS 스위트는 비 superuser · 비 BYPASSRLS 역할로만 유효하다 "
                f"(current_user: rolsuper={row.rolsuper}, rolbypassrls={row.rolbypassrls}). "
                "ADR 0007 5절: 앱 역할은 NOSUPERUSER NOBYPASSRLS 여야 한다."
            )
        version = conn.execute(
            text(
                "SELECT to_regclass('public.alembic_version') IS NOT NULL AS ok"
            )
        ).scalar_one()
        if not version:
            pytest.fail(
                "대상 DB 에 마이그레이션이 적용되지 않았다. "
                "`cd infra && DATABASE_URL=... alembic upgrade head` 를 먼저 실행하라."
            )


def _reset_seed(conn) -> None:
    """org 행 삭제 → 19개 org 스코프 테이블이 FK ON DELETE CASCADE 로 함께 정리된다.

    참조 무결성(FK) 처리는 Postgres 가 RLS 를 우회하므로 org 컨텍스트 없이도 전량 삭제된다.
    `organizations` 자체는 RLS 비대상(ADR 0007 맥락 절).
    """
    conn.execute(
        text("DELETE FROM organizations WHERE id = ANY(:ids)"), {"ids": list(_ORG_IDS)}
    )


def _seed_org(conn, *, org_id: str, plan: str) -> None:
    conn.execute(
        text("INSERT INTO organizations (id, name, plan) VALUES (:id, :name, :plan)"),
        {"id": org_id, "name": f"RLS 검증 법인 {org_id}", "plan": plan},
    )


def _set_ctx(conn, org_id: str) -> None:
    conn.execute(
        text("SELECT set_config('app.current_org_id', :org_id, true)"), {"org_id": org_id}
    )


@contextlib.contextmanager
def org_transaction(org_id: str):
    """org 컨텍스트가 걸린 raw 트랜잭션(검증용 직접 SQL). 앱 코드 경로와 독립.

    테스트가 "무엇이 DB 에 실제로 들어갔는가"를 확인할 때 앱의 세션 계약(검증 대상)에
    의존하지 않도록 별도 경로를 쓴다.
    """
    with engine.begin() as conn:
        _set_ctx(conn, org_id)
        yield conn


@pytest.fixture(scope="session", autouse=True)
def rls_seed():
    """2개 org(A/B) + site/tank/user/api_key/meter/reading 시드(결정론·멱등).

    쓰기는 전부 org 컨텍스트를 건 트랜잭션 안에서 수행한다 — RLS 쓰기 정책(FOR ALL 이든
    명령 분할이든)이 강제되므로 이 시드 자체가 "쓰기 격리가 살아 있는가"의 1차 검증이다.
    """
    _assert_environment_is_valid()

    with engine.begin() as conn:
        _reset_seed(conn)
        _seed_org(conn, org_id=ORG_A, plan="PRO")
        _seed_org(conn, org_id=ORG_B, plan="START")

    # --- org-A ---
    with engine.begin() as conn:
        _set_ctx(conn, ORG_A)
        conn.execute(
            text(
                "INSERT INTO sites (id, org_id, name, region) "
                "VALUES (:id, :org, :name, :region)"
            ),
            {"id": SITE_A, "org": ORG_A, "name": "RLS A 양식장", "region": "서산"},
        )
        conn.execute(
            text("INSERT INTO tanks (id, site_id, org_id, name) VALUES (:id, :s, :o, :n)"),
            {"id": TANK_A, "s": SITE_A, "o": ORG_A, "n": "A-1 수조"},
        )
        conn.execute(
            text(
                "INSERT INTO users (id, org_id, email, role, supabase_user_id) "
                "VALUES (:id, :o, :e, :r, :uid)"
            ),
            {
                "id": USER_A_LINKED,
                "o": ORG_A,
                "e": EMAIL_A_LINKED,
                "r": "owner",
                "uid": UID_A_LINKED,
            },
        )
        # 미연계 초대 행(lazy-link 대상) — supabase_user_id IS NULL.
        conn.execute(
            text(
                "INSERT INTO users (id, org_id, email, role, supabase_user_id) "
                "VALUES (:id, :o, :e, :r, NULL)"
            ),
            {"id": USER_A_INVITED, "o": ORG_A, "e": EMAIL_A_INVITED, "r": "operator"},
        )
        # lazy-link e2e 전용 미연계 초대 행(test 10 이 이 행을 소비한다).
        conn.execute(
            text(
                "INSERT INTO users (id, org_id, email, role, supabase_user_id) "
                "VALUES (:id, :o, :e, :r, NULL)"
            ),
            {"id": USER_A_LOGIN, "o": ORG_A, "e": EMAIL_A_LOGIN, "r": "operator"},
        )
        conn.execute(
            text(
                "INSERT INTO api_keys (id, org_id, site_id, key_hash, label, revoked) "
                "VALUES (:id, :o, :s, :h, :l, false)"
            ),
            {
                "id": API_KEY_A_ID,
                "o": ORG_A,
                "s": SITE_A,
                "h": api_key_hash(API_KEY_A_RAW),
                "l": "RLS A 게이트웨이",
            },
        )
        conn.execute(
            text(
                "INSERT INTO meters (id, site_id, org_id, type, unit, is_aeration) "
                "VALUES (:id, :s, :o, 'do', 'mg_L', false)"
            ),
            {"id": DO_METER_A, "s": SITE_A, "o": ORG_A},
        )
        conn.execute(
            text(
                "INSERT INTO meters (id, site_id, org_id, type, unit, is_aeration) "
                "VALUES (:id, :s, :o, 'power', 'kWh_interval', false)"
            ),
            {"id": POWER_METER_A, "s": SITE_A, "o": ORG_A},
        )
        conn.execute(
            text(
                "INSERT INTO readings (time, meter_id, org_id, value, quality_flag) "
                "VALUES (:t, :m, :o, :v, 'ok')"
            ),
            {"t": DO_SAMPLE_TIME, "m": DO_METER_A, "o": ORG_A, "v": DO_SAMPLE_VALUE},
        )

    # --- org-B ---
    with engine.begin() as conn:
        _set_ctx(conn, ORG_B)
        conn.execute(
            text(
                "INSERT INTO sites (id, org_id, name, region) "
                "VALUES (:id, :org, :name, :region)"
            ),
            {"id": SITE_B, "org": ORG_B, "name": "RLS B 양식장", "region": "고성"},
        )
        conn.execute(
            text("INSERT INTO tanks (id, site_id, org_id, name) VALUES (:id, :s, :o, :n)"),
            {"id": TANK_B, "s": SITE_B, "o": ORG_B, "n": "B-1 수조"},
        )
        conn.execute(
            text(
                "INSERT INTO users (id, org_id, email, role, supabase_user_id) "
                "VALUES (:id, :o, :e, :r, :uid)"
            ),
            {
                "id": USER_B_LINKED,
                "o": ORG_B,
                "e": EMAIL_B_LINKED,
                "r": "owner",
                "uid": UID_B_LINKED,
            },
        )
        conn.execute(
            text(
                "INSERT INTO api_keys (id, org_id, site_id, key_hash, label, revoked) "
                "VALUES (:id, :o, :s, :h, :l, false)"
            ),
            {
                "id": API_KEY_B_ID,
                "o": ORG_B,
                "s": SITE_B,
                "h": api_key_hash(API_KEY_B_RAW),
                "l": "RLS B 게이트웨이",
            },
        )
        conn.execute(
            text(
                "INSERT INTO meters (id, site_id, org_id, type, unit, is_aeration) "
                "VALUES (:id, :s, :o, 'do', 'mg_L', false)"
            ),
            {"id": DO_METER_B, "s": SITE_B, "o": ORG_B},
        )
        conn.execute(
            text(
                "INSERT INTO readings (time, meter_id, org_id, value, quality_flag) "
                "VALUES (:t, :m, :o, :v, 'ok')"
            ),
            {"t": DO_SAMPLE_TIME, "m": DO_METER_B, "o": ORG_B, "v": DO_SAMPLE_VALUE},
        )

    yield
    # 정리: 다음 실행이 어차피 _reset_seed 로 시작하므로 강제 삭제하지 않는다(디버깅 편의).


@pytest.fixture
def session() -> Session:
    """org 컨텍스트가 **바인딩되지 않은** 새 세션(인증 조회 시나리오 재현)."""
    sess = SessionLocal()
    try:
        yield sess
    finally:
        sess.rollback()
        sess.close()
