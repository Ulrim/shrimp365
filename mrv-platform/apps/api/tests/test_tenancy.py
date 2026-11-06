"""멀티테넌시 누수 테스트(B4/B5) — Rule 4 머지 게이트.

타 org 토큰으로 타 org site 를 조회하면 절대 데이터가 새면 안 된다(403/404, 누수 0건).
sqlite 는 RLS 를 지원하지 않으므로 이 테스트는 서비스 레이어(tenancy.py) 재검증이
격리를 보장함을 증명한다(3중 방어 중 3번째 계층).
"""

from __future__ import annotations

from tests.conftest import SITE1_ID, SITE2_ID


def test_cross_org_access_is_denied(client, org2_token, full_period):
    """org2 토큰으로 org1 소유 site1 조회 → 403(데이터 노출 금지)."""
    resp = client.get(
        f"/sites/{SITE1_ID}/kpi",
        params=full_period,
        headers={"Authorization": f"Bearer {org2_token}"},
    )
    assert resp.status_code in (403, 404), resp.text
    # 어떤 경우에도 org1 데이터(EI/inputs)가 응답 본문에 노출되지 않아야 한다.
    body = resp.json()
    assert "metrics" not in body
    assert "inputs" not in body


def test_org1_cannot_access_org2_site(client, org1_token, full_period):
    """반대 방향: org1 토큰으로 org2 소유 site2 조회 → 403/404."""
    resp = client.get(
        f"/sites/{SITE2_ID}/kpi",
        params=full_period,
        headers={"Authorization": f"Bearer {org1_token}"},
    )
    assert resp.status_code in (403, 404), resp.text


def test_owning_org_can_access_its_site(client, org1_token, full_period):
    """대조군: org1 은 자신의 site1 을 정상 조회(200)."""
    resp = client.get(
        f"/sites/{SITE1_ID}/kpi",
        params=full_period,
        headers={"Authorization": f"Bearer {org1_token}"},
    )
    assert resp.status_code == 200


def test_org2_can_access_its_own_site(client, org2_token, full_period):
    """대조군: org2 는 자신의 site2 를 조회(200). EI 는 데이터 없어 산출불가여도 200."""
    resp = client.get(
        f"/sites/{SITE2_ID}/kpi",
        params=full_period,
        headers={"Authorization": f"Bearer {org2_token}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["org_id"] == "org-OTHER-9999"


def test_invalid_token_401(client, full_period):
    """서명 불일치 토큰 → 401."""
    resp = client.get(
        f"/sites/{SITE1_ID}/kpi",
        params=full_period,
        headers={"Authorization": "Bearer garbage.token.value"},
    )
    assert resp.status_code == 401
