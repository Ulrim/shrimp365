"""ADR 0007 4절 테스트 1~8 — RLS 정책/세션 컨텍스트 계약(Postgres 전용).

각 테스트는 ADR 0007 실측표의 결함 1건과 1:1 대응한다. 수정 전 커밋에서
1·2·5·6 은 **반드시 실패**해야 한다(테스트가 결함을 실제로 잡는지의 증거).
"""

from __future__ import annotations

from tests_rls._gate import require_rls_database

require_rls_database()  # RLS_TEST_DATABASE_URL 부재 시 이 모듈 전체 skip

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError, ProgrammingError

from app.db.session import SessionLocal, set_org_context
from app.models.api_key import ApiKey
from app.models.reading import Reading
from app.models.tank import Tank
from app.models.user import User
from tests_rls.conftest import (
    API_KEY_A_RAW,
    EMAIL_A_INVITED,
    ORG_A,
    ORG_B,
    SITE_A,
    TANK_B,
    UID_A_LINKED,
    USER_A_LINKED,
    api_key_hash,
    org_transaction,
)

# --- D1: org 컨텍스트 없는 인증 조회 -------------------------------------------------


def test_users_lookup_by_supabase_uid_without_org_context(session):
    """(1/D1) org 를 알기 전 `supabase_user_id` 정확 매칭 조회가 1행을 반환해야 한다.

    수정 전: `org_isolation_users`(FOR ALL) 때문에 0행 → `AUTH_MODE=supabase` 전 로그인 403.
    """
    row = session.execute(
        select(User).where(User.supabase_user_id == UID_A_LINKED)
    ).scalar_one_or_none()
    assert row is not None, "org 컨텍스트 없는 supabase uid 조회가 0행 — users_select_open 정책 부재"
    assert row.id == USER_A_LINKED
    assert row.org_id == ORG_A


def test_users_lookup_by_email_unlinked_without_org_context(session):
    """(2/D1) lazy-link 후보 조회(`email` + `supabase_user_id IS NULL`)가 1행이어야 한다."""
    rows = session.execute(
        select(User).where(User.email == EMAIL_A_INVITED, User.supabase_user_id.is_(None))
    ).scalars().all()
    assert len(rows) == 1, f"미연계 초대 행 조회 결과가 {len(rows)}행 — lazy-link 경로가 죽는다"
    assert rows[0].org_id == ORG_A


# --- 1절: 쓰기 측 org 격리는 유지되어야 한다 -----------------------------------------


def test_users_insert_into_foreign_org_denied(session):
    """(3/1절) org-A 컨텍스트에서 org-B 소속 users 행 삽입 → RLS 위반으로 거부.

    가장 값비싼 공격(피해 org 에 role='owner' 행 삽입 = 테넌트 탈취)을 물리적으로 막는
    방어선이다. SELECT 개방과 무관하게 유지되어야 한다.
    """
    set_org_context(session, ORG_A)
    with pytest.raises((ProgrammingError, DBAPIError)) as exc:
        session.execute(
            text(
                "INSERT INTO users (id, org_id, email, role) "
                "VALUES ('user-RLS-attack', :org, 'attacker@rls.example', 'owner')"
            ),
            {"org": ORG_B},
        )
    assert "row-level security" in str(exc.value).lower()


def test_users_update_without_org_context_affects_zero_rows(session):
    """(4/1절) 컨텍스트 없는 UPDATE 는 0행, org 컨텍스트 하에서는 1행.

    SELECT 개방이 UPDATE 까지 개방하지 않음을 고정한다(명령 분할 정책의 핵심).
    """
    no_ctx = session.execute(
        text("UPDATE users SET role = 'owner' WHERE id = :id"), {"id": USER_A_LINKED}
    )
    assert no_ctx.rowcount == 0, "컨텍스트 없는 UPDATE 가 행을 바꿨다 — 쓰기 격리 붕괴"
    session.rollback()

    set_org_context(session, ORG_A)
    with_ctx = session.execute(
        text("UPDATE users SET role = 'owner' WHERE id = :id"), {"id": USER_A_LINKED}
    )
    assert with_ctx.rowcount == 1, "org 컨텍스트 하 UPDATE 가 0행 — lazy-link 갱신이 막힌다"
    session.rollback()


# --- D2: api_keys 인증 조회 ----------------------------------------------------------


def test_api_key_lookup_by_hash_without_org_context(session):
    """(5/D2) org 컨텍스트 없는 key_hash 정확 매칭 조회가 1행이어야 한다.

    수정 전: 0행 → `POST /ingest/readings` 전건 401(AUTH_MODE 와 무관하게 수집이 죽는다).
    """
    row = session.execute(
        select(ApiKey).where(ApiKey.key_hash == api_key_hash(API_KEY_A_RAW))
    ).scalar_one_or_none()
    assert row is not None, "org 컨텍스트 없는 api_keys 조회가 0행 — api_keys_select_open 부재"
    assert row.org_id == ORG_A
    assert row.site_id == SITE_A


# --- D3: 세션 수명 전체에 org 컨텍스트 재적용 ----------------------------------------


def test_org_context_survives_commit():
    """(6/D3) 커밋 후에도 SELECT/INSERT/refresh() 가 모두 org 컨텍스트 하에서 동작.

    수정 전: `set_config(..., is_local=true)` 가 커밋 시 소실 → 커밋 후 SELECT 0행,
    2번째 INSERT 는 InsufficientPrivilege, ORM refresh 는 ObjectDeletedError.
    """
    created_ids: list[str] = []
    sess = SessionLocal()
    try:
        set_org_context(sess, ORG_A)

        before = sess.execute(
            select(Tank).where(Tank.org_id == ORG_A)
        ).scalars().all()
        assert len(before) >= 1

        first = Tank(id="tank-RLS-A-commit-1", site_id=SITE_A, org_id=ORG_A, name="커밋검증 1")
        sess.add(first)
        sess.commit()
        created_ids.append(first.id)

        # (a) 커밋 후 SELECT — GUC 소실 시 0행이 된다.
        after = sess.execute(select(Tank).where(Tank.org_id == ORG_A)).scalars().all()
        assert len(after) == len(before) + 1, "커밋 후 SELECT 가 org 컨텍스트를 잃었다"

        # (b) 커밋 후 2번째 INSERT — GUC 소실 시 RLS 위반으로 거부된다.
        second = Tank(id="tank-RLS-A-commit-2", site_id=SITE_A, org_id=ORG_A, name="커밋검증 2")
        sess.add(second)
        sess.commit()
        created_ids.append(second.id)

        # (c) 커밋 후 ORM refresh — expire_on_commit=True(기본값) 유지 전제.
        sess.refresh(second)
        assert second.name == "커밋검증 2"

        # (d) 커밋 후 GUC 가 실제로 살아 있는지 직접 확인.
        guc = sess.execute(text("SELECT current_setting('app.current_org_id', true)")).scalar_one()
        assert guc == ORG_A
    finally:
        sess.rollback()
        sess.close()
        with org_transaction(ORG_A) as conn:
            conn.execute(
                text("DELETE FROM tanks WHERE id = ANY(:ids)"),
                {"ids": ["tank-RLS-A-commit-1", "tank-RLS-A-commit-2"]},
            )


def test_org_context_does_not_leak_to_new_session():
    """(7/D3) 컨텍스트를 건 세션이 닫힌 뒤, 새 세션(풀 재사용)은 tanks 0행이어야 한다.

    D3 수정을 `is_local=false`(세션 스코프 GUC)로 하면 이 테스트가 깨진다 — 커넥션 풀에
    이전 테넌트 컨텍스트가 남기 때문이다(ADR 0007 대안 절에서 기각한 선택지의 가드레일).
    """
    sess = SessionLocal()
    try:
        set_org_context(sess, ORG_A)
        assert sess.execute(select(Tank)).scalars().all()
        sess.commit()
    finally:
        sess.close()

    for _ in range(3):  # 풀 재사용 반복
        fresh = SessionLocal()
        try:
            leaked = fresh.execute(select(Tank)).scalars().all()
            assert leaked == [], "새 세션이 이전 테넌트의 org 컨텍스트를 물려받았다(Rule 4 위반)"
            guc = fresh.execute(
                text("SELECT current_setting('app.current_org_id', true)")
            ).scalar_one()
            assert guc in ("", None)
        finally:
            fresh.rollback()
            fresh.close()


# --- Rule 4: 교차 org 읽기 차단 ------------------------------------------------------


def test_cross_org_read_blocked(session):
    """(8/Rule 4) org-A 컨텍스트에서 org-B 의 tanks/readings 가 0행이어야 한다.

    17개 org 스코프 테이블의 FOR ALL 정책이 유지되고 있음을 대표 2개로 고정한다
    (0013 이 users/api_keys 외 테이블을 건드리지 않았다는 회귀 가드).
    """
    set_org_context(session, ORG_A)
    assert session.execute(select(Tank).where(Tank.id == TANK_B)).scalars().all() == []
    assert session.execute(select(Reading).where(Reading.org_id == ORG_B)).scalars().all() == []
    # 대조군: 자기 org 는 보인다(정책이 전면 차단이 아님을 함께 확인).
    assert session.execute(select(Tank).where(Tank.org_id == ORG_A)).scalars().all()
