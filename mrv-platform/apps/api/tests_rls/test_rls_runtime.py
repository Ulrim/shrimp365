"""ADR 0007 4절 테스트 9~11 — 배치 순회 + 인증/수집 end-to-end 수용 테스트(Postgres 전용).

9 는 D4(알림 배치의 조용한 영구 무동작), 10 은 최초 보고 결함(Supabase 로그인 403),
11 은 D2(수집 401)의 수용 테스트다. 수정 전 커밋에서 9·10·11 은 실패해야 한다.
"""

from __future__ import annotations

from tests_rls._gate import SUPABASE_JWT_SECRET, require_rls_database

require_rls_database()  # RLS_TEST_DATABASE_URL 부재 시 이 모듈 전체 skip

from datetime import UTC, datetime, timedelta

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.db.session import SessionLocal
from app.main import app
from app.services.alert_jobs import job_evaluate_alerts
from tests_rls.conftest import (
    API_KEY_A_RAW,
    DO_METER_B,
    EMAIL_A_LOGIN,
    EVALUATED_AT,
    ORG_A,
    ORG_B,
    POWER_METER_A,
    SITE_A,
    SITE_B,
    UID_A_LOGIN,
    USER_A_LOGIN,
    org_transaction,
)

@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def _clear_alerts() -> None:
    for org_id in (ORG_A, ORG_B):
        with org_transaction(org_id) as conn:
            conn.execute(text("DELETE FROM alerts WHERE org_id = :o"), {"o": org_id})


# --- (9/D4) 배치 순회 ----------------------------------------------------------------


def test_alert_job_sees_all_orgs_under_rls():
    """org 컨텍스트 없는 워커 세션에서도 배치가 **모든 org 의 site** 를 평가해야 한다.

    수정 전: `select(Site)` 가 RLS 로 0행 → 알림이 한 건도 생성되지 않는다. 예외도 로그도
    남지 않아(조용한 무동작) 가장 발견하기 어려운 유형이었다.
    """
    _clear_alerts()
    try:
        with SessionLocal() as session:  # org 컨텍스트 미바인딩 = 실제 worker.py 전제
            created = job_evaluate_alerts(
                session, evaluated_at=EVALUATED_AT, do_low_lookback_hours=6
            )
            # 속성은 커밋 전에 읽는다 — 커밋 후 세션 org 컨텍스트는 마지막 org 이므로
            # 타 org 인스턴스의 만료 재조회는 RLS 로 실패한다(job_evaluate_alerts 반환 계약).
            created_site_ids = {a.site_id for a in created}
            session.commit()

        assert created_site_ids == {SITE_A, SITE_B}, (
            f"배치가 평가한 site 집합이 {created_site_ids} — RLS 하에서 org 순회가 누락됐다"
        )

        # DB 에 실제로 적재됐는지 org 별로 직접 확인.
        for org_id, site_id in ((ORG_A, SITE_A), (ORG_B, SITE_B)):
            with org_transaction(org_id) as conn:
                rows = conn.execute(
                    text(
                        "SELECT site_id, type FROM alerts "
                        "WHERE org_id = :o AND type = 'do_low'"
                    ),
                    {"o": org_id},
                ).all()
            assert [(site_id, "do_low")] == list(rows)
    finally:
        _clear_alerts()


def test_alert_job_does_not_leak_alerts_across_orgs():
    """(9 보강) org 별 컨텍스트 순회가 타 org 행을 생성/노출하지 않아야 한다(Rule 4)."""
    _clear_alerts()
    try:
        with SessionLocal() as session:
            job_evaluate_alerts(session, evaluated_at=EVALUATED_AT, do_low_lookback_hours=6)
            session.commit()

        with org_transaction(ORG_A) as conn:
            visible = conn.execute(text("SELECT org_id FROM alerts")).scalars().all()
        assert set(visible) == {ORG_A}, "org-A 컨텍스트에서 타 org alert 가 보인다"
    finally:
        _clear_alerts()


# --- (10) Supabase 로그인 end-to-end(최초 보고 결함의 수용 테스트) --------------------


def test_supabase_login_end_to_end_on_postgres(client: TestClient):
    """AUTH_MODE=supabase + 합성 JWT → `GET /auth/me` 200 + audit_logs(action='link') 1행.

    수정 전: `users` FOR ALL 정책 때문에 uid 조회·email 후보 조회가 모두 0행 → 403.
    수정 후에도 `_lazy_link` 가 org 컨텍스트를 걸지 않으면 users UPDATE 가 0행이 되고
    audit_logs INSERT 가 RLS 로 거부된다(ADR 0007 C3).
    """
    token = jwt.encode(
        {
            "sub": UID_A_LOGIN,
            "aud": "authenticated",
            "email": EMAIL_A_LOGIN,
            "exp": datetime.now(UTC) + timedelta(hours=1),
        },
        SUPABASE_JWT_SECRET,  # _gate 가 환경변수로 주입한 값과 동일
        algorithm="HS256",
    )

    try:
        res = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200, f"lazy-link 로그인 실패: {res.status_code} {res.text}"
        body = res.json()
        assert body["org_id"] == ORG_A
        assert body["user_id"] == USER_A_LOGIN
        assert body["role"] == "operator"

        with org_transaction(ORG_A) as conn:
            linked = conn.execute(
                text("SELECT supabase_user_id FROM users WHERE id = :id"),
                {"id": USER_A_LOGIN},
            ).scalar_one()
            assert linked == UID_A_LOGIN, "users.supabase_user_id 갱신이 0행 처리됐다"

            audits = conn.execute(
                text(
                    "SELECT id FROM audit_logs "
                    "WHERE entity = 'users' AND entity_id = :id AND action = 'link'"
                ),
                {"id": USER_A_LOGIN},
            ).all()
            assert len(audits) == 1, f"audit_logs(action='link') 가 {len(audits)}행 — Rule 9 위반"

        # 재요청은 uid 직접 매칭 경로로 200(중복 link audit 이 쌓이지 않아야 한다).
        res2 = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert res2.status_code == 200
        with org_transaction(ORG_A) as conn:
            again = conn.execute(
                text(
                    "SELECT count(*) FROM audit_logs "
                    "WHERE entity = 'users' AND entity_id = :id AND action = 'link'"
                ),
                {"id": USER_A_LOGIN},
            ).scalar_one()
        assert again == 1
    finally:
        # 시드 상태로 원복(스위트 재실행 멱등).
        with org_transaction(ORG_A) as conn:
            conn.execute(
                text("UPDATE users SET supabase_user_id = NULL WHERE id = :id"),
                {"id": USER_A_LOGIN},
            )
            conn.execute(
                text(
                    "DELETE FROM audit_logs WHERE entity = 'users' AND entity_id = :id"
                ),
                {"id": USER_A_LOGIN},
            )


# --- (11/D2) API Key 수집 end-to-end ------------------------------------------------


def test_ingest_with_api_key_end_to_end_on_postgres(client: TestClient):
    """`X-API-Key` → `POST /ingest/readings` 200 + readings 실제 적재.

    수정 전: api_keys 조회가 0행 → 401(AUTH_MODE 와 무관하게 수집 경로가 죽는다).
    """
    ts = datetime(2026, 8, 2, 0, 0, tzinfo=UTC)
    payload = {
        "gateway_id": "gw-rls-a",
        "readings": [
            {
                "meter_id": POWER_METER_A,
                "ts": ts.isoformat(),
                "value": 12.5,
                "reading_kind": "interval_kwh",
            }
        ],
    }
    try:
        res = client.post(
            "/ingest/readings", json=payload, headers={"X-API-Key": API_KEY_A_RAW}
        )
        assert res.status_code == 200, f"수집 실패: {res.status_code} {res.text}"
        assert res.json()["accepted"] == 1
        assert res.json()["rejected"] == []

        with org_transaction(ORG_A) as conn:
            value = conn.execute(
                text(
                    "SELECT value FROM readings WHERE meter_id = :m AND time = :t"
                ),
                {"m": POWER_METER_A, "t": ts},
            ).scalar_one()
        assert value == pytest.approx(12.5)

        # 재전송 멱등(at-least-once) — 같은 (meter_id, ts) 는 deduped 로 흡수.
        res2 = client.post(
            "/ingest/readings", json=payload, headers={"X-API-Key": API_KEY_A_RAW}
        )
        assert res2.status_code == 200
        assert res2.json() == {"accepted": 0, "deduped": 1, "rejected": []}
    finally:
        with org_transaction(ORG_A) as conn:
            conn.execute(
                text("DELETE FROM readings WHERE meter_id = :m AND time = :t"),
                {"m": POWER_METER_A, "t": ts},
            )


def test_ingest_rejects_meter_outside_api_key_scope(client: TestClient):
    """(11 보강) 타 org meter 는 tenancy 스코프 밖 → 부분 거부(rejected)."""
    res = client.post(
        "/ingest/readings",
        json={
            "gateway_id": "gw-rls-a",
            "readings": [
                {
                    "meter_id": DO_METER_B,
                    "ts": datetime(2026, 8, 2, 1, 0, tzinfo=UTC).isoformat(),
                    "value": 5.0,
                    "reading_kind": "do_mg_l",
                }
            ],
        },
        headers={"X-API-Key": API_KEY_A_RAW},
    )
    assert res.status_code == 200
    assert res.json()["accepted"] == 0
    assert len(res.json()["rejected"]) == 1

    with org_transaction(ORG_B) as conn:
        leaked = conn.execute(
            text("SELECT count(*) FROM readings WHERE meter_id = :m"), {"m": DO_METER_B}
        ).scalar_one()
    assert leaked == 1, "타 org meter 에 수집 데이터가 주입됐다(시드 1행이어야 한다)"
