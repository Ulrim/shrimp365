"""추천(운전 레시피) API — GET /sites/{id}/recommendations, POST /recipes/{id}/versions.

phase-2 슬라이스 K(docs/design/phase-2.md 2.3/2.4절). 검증 범위:
  - 3종(feed/oxygen/circulation) 정상 추천 산출(rationale + source_refs 포함).
  - 근거 부족(데이터 없는 site) → params null, 에러 아님.
  - 동일 입력 재호출 시 버전 미증가(해시=canonical 비교), 값 변화 시 버전 증가.
  - START 플랜 403(GET/POST 양쪽).
  - 수동 버전 추가(POST) 201 + audit_logs 기록.
  - 타 org 403/404(recipe/site 스코프).
  - GET 은 plan 게이팅만(viewer 도 접근 가능 — architect 계약 재확인, comparison.py 의
    viewer 차단과 다름).

feed_history/aeration 조회는 실제 `datetime.now(UTC)` 기준 lookback 윈도우를 쓰므로
(recommendation_service.py), 시드(2026-06)와 무관하게 테스트 시각 기준으로 직접 데이터를
추가한다(결정론적 검증을 위해 seed 날짜에 의존하지 않음).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
import seed_demo_site as seed_mod
from sqlalchemy import delete, select

from app.db.session import SessionLocal
from app.models.audit_log import AuditLog
from app.models.feed_log import FeedLog
from app.models.organization import Organization
from app.models.recipe import Recipe, RecipeVersion
from app.models.site import Site
from tests.conftest import ORG1_ID, ORG2_ID, SITE1_ID, _make_token

SITE_EMPTY_ID = "site-empty-reco-0001"


def _hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _set_plan(org_id: str, plan: str) -> None:
    with SessionLocal() as s:
        org = s.execute(select(Organization).where(Organization.id == org_id)).scalar_one()
        org.plan = plan
        s.commit()


@pytest.fixture(autouse=True)
def _clean(_prepare_db):
    """recipes/recipe_versions/audit_logs(recipes)/추가 feed_logs 를 정리 + 플랜 원복."""
    with SessionLocal() as s:
        before_feed_ids = set(
            s.execute(select(FeedLog.id).where(FeedLog.org_id == ORG1_ID)).scalars()
        )
    yield
    with SessionLocal() as s:
        s.execute(delete(RecipeVersion))
        s.execute(delete(Recipe))
        s.execute(delete(AuditLog).where(AuditLog.entity == "recipes"))
        current_feed_ids = set(
            s.execute(select(FeedLog.id).where(FeedLog.org_id == ORG1_ID)).scalars()
        )
        extra = current_feed_ids - before_feed_ids
        if extra:
            s.execute(delete(FeedLog).where(FeedLog.id.in_(extra)))
        s.execute(delete(Site).where(Site.id == SITE_EMPTY_ID))
        s.commit()
    _set_plan(ORG1_ID, "START")
    _set_plan(ORG2_ID, "START")


@pytest.fixture
def pro_plan():
    _set_plan(ORG1_ID, "PRO")
    yield


@pytest.fixture
def empty_site():
    """근거 부족 시나리오용 — 계측기/이력이 전혀 없는 신규 site(org1 소속)."""
    with SessionLocal() as s:
        s.add(Site(id=SITE_EMPTY_ID, org_id=ORG1_ID, name="빈 사이트(근거부족 테스트)"))
        s.commit()
    yield SITE_EMPTY_ID


def _add_feed_log(feed_kg: float, days_ago: int, *, id_suffix: str) -> None:
    ts = datetime.now(UTC) - timedelta(days=days_ago)
    with SessionLocal() as s:
        s.add(
            FeedLog(
                id=f"feed-reco-test-{id_suffix}",
                batch_id=seed_mod.BATCH_ID,
                org_id=ORG1_ID,
                ts=ts,
                feed_kg=feed_kg,
                source="manual",
                quality_flag="ok",
            )
        )
        s.commit()


def _get_recommendations(client, token, site_id=SITE1_ID):
    return client.get(f"/sites/{site_id}/recommendations", headers=_hdr(token))


# --- 정상 산출 --------------------------------------------------------------


def test_three_recipe_types_produced_with_rationale_and_source_refs(
    client, org1_token, pro_plan
):
    """seed DO/biomass + 추가 feed_log 로 3종 모두 근거(rationale/source_refs) 포함 산출."""
    _add_feed_log(50.0, days_ago=1, id_suffix="basic-1")

    resp = _get_recommendations(client, org1_token)
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["site_id"] == SITE1_ID
    assert body["status"] == "recommend_only"
    assert {item["type"] for item in body["items"]} == {"feed", "oxygen", "circulation"}

    for item in body["items"]:
        assert item["recipe_id"].startswith("recipe-")
        assert item["current_version"] >= 1
        assert isinstance(item["rationale"], str) and len(item["rationale"]) > 0
        assert item["config_version"] == "2026.1.0"
        assert "generated_at" in item

    feed_item = next(i for i in body["items"] if i["type"] == "feed")
    assert feed_item["params"]["feed_kg_per_day"] is not None
    assert len(feed_item["source_refs"]) >= 1

    oxygen_item = next(i for i in body["items"] if i["type"] == "oxygen")
    assert oxygen_item["params"]["oxygen_target_do_mg_l"] is not None
    assert len(oxygen_item["source_refs"]) >= 1

    circulation_item = next(i for i in body["items"] if i["type"] == "circulation")
    assert circulation_item["params"]["circulation_setting"] in (
        "normal", "increase", "reduce",
    )


def test_insufficient_evidence_returns_null_params(client, org1_token, pro_plan, empty_site):
    """계측기/이력이 전혀 없는 site → 3종 모두 params 값 None(에러 아님, 200)."""
    resp = _get_recommendations(client, org1_token, site_id=empty_site)
    assert resp.status_code == 200, resp.text
    body = resp.json()

    by_type = {item["type"]: item for item in body["items"]}
    assert by_type["feed"]["params"]["feed_kg_per_day"] is None
    assert by_type["oxygen"]["params"]["oxygen_target_do_mg_l"] is None
    assert by_type["circulation"]["params"]["circulation_setting"] is None
    for item in body["items"]:
        assert len(item["rationale"]) > 0  # 사유 문구는 항상 채워짐


# --- 버전 영속화(해시 비교) --------------------------------------------------


def test_repeated_call_same_input_does_not_bump_version(client, org1_token, pro_plan):
    """DB 상태 불변인 채 재호출 → 3종 모두 current_version 불변(해시=canonical 비교 동작)."""
    _add_feed_log(50.0, days_ago=1, id_suffix="stable-1")

    resp1 = _get_recommendations(client, org1_token)
    assert resp1.status_code == 200
    versions_1 = {i["type"]: i["current_version"] for i in resp1.json()["items"]}

    resp2 = _get_recommendations(client, org1_token)
    assert resp2.status_code == 200
    versions_2 = {i["type"]: i["current_version"] for i in resp2.json()["items"]}

    assert versions_1 == versions_2

    with SessionLocal() as s:
        for recipe_type in ("feed", "oxygen", "circulation"):
            recipe = s.execute(
                select(Recipe).where(Recipe.site_id == SITE1_ID).where(Recipe.type == recipe_type)
            ).scalar_one()
            count = s.execute(
                select(RecipeVersion).where(RecipeVersion.recipe_id == recipe.id)
            ).scalars().all()
            assert len(count) == 1  # 재호출로 새 버전이 쌓이지 않음


def test_value_change_bumps_feed_version(client, org1_token, pro_plan):
    """급이 이력 변경(새 feed_log 대량 추가) → feed 추천값 변경 → feed recipe 버전 증가."""
    _add_feed_log(50.0, days_ago=1, id_suffix="change-1")
    resp1 = _get_recommendations(client, org1_token)
    assert resp1.status_code == 200
    before = {i["type"]: i for i in resp1.json()["items"]}

    # 급이량을 크게 바꿔 recent_avg_feed_kg_per_day 가 달라지도록 함(target 대비 조정폭도 달라짐).
    _add_feed_log(500.0, days_ago=1, id_suffix="change-2")

    resp2 = _get_recommendations(client, org1_token)
    assert resp2.status_code == 200
    after = {i["type"]: i for i in resp2.json()["items"]}

    assert after["feed"]["params"]["feed_kg_per_day"] != before["feed"]["params"]["feed_kg_per_day"]
    assert after["feed"]["current_version"] == before["feed"]["current_version"] + 1


# --- 플랜 게이팅 -------------------------------------------------------------


def test_get_recommendations_start_plan_403(client, org1_token):
    """기본 플랜(START) → GET 403(2.4절)."""
    resp = _get_recommendations(client, org1_token)
    assert resp.status_code == 403


def test_get_recommendations_viewer_allowed_on_pro_plan(client, viewer_token, pro_plan):
    """GET 은 plan 게이팅만 — viewer 도 PRO 플랜이면 200(architect 계약: viewer 차단 미명시)."""
    _add_feed_log(50.0, days_ago=1, id_suffix="viewer-1")
    resp = _get_recommendations(client, viewer_token)
    assert resp.status_code == 200


def test_post_recipe_version_start_plan_403(client, owner_token, org1_token, pro_plan):
    """POST 는 require_writer + PRO 게이팅 양쪽 — START 로 되돌리면 403."""
    _add_feed_log(50.0, days_ago=1, id_suffix="post-start-1")
    resp = _get_recommendations(client, org1_token)
    recipe_id = resp.json()["items"][0]["recipe_id"]

    _set_plan(ORG1_ID, "START")
    resp2 = client.post(
        f"/recipes/{recipe_id}/versions",
        json={"params": {"feed_kg_per_day": 99.0}, "rationale": "수기 조정"},
        headers=_hdr(owner_token),
    )
    assert resp2.status_code == 403


# --- 수동 버전 추가(POST) ----------------------------------------------------


def test_manual_version_add_201_and_audit_logged(client, owner_token, org1_token, pro_plan):
    _add_feed_log(50.0, days_ago=1, id_suffix="manual-1")
    resp = _get_recommendations(client, org1_token)
    assert resp.status_code == 200
    feed_item = next(i for i in resp.json()["items"] if i["type"] == "feed")
    recipe_id = feed_item["recipe_id"]
    before_version = feed_item["current_version"]

    post_resp = client.post(
        f"/recipes/{recipe_id}/versions",
        json={"params": {"feed_kg_per_day": 77.7}, "rationale": "운영자 수기 조정"},
        headers=_hdr(owner_token),
    )
    assert post_resp.status_code == 201, post_resp.text
    body = post_resp.json()
    assert body["recipe_id"] == recipe_id
    assert body["version"] == before_version + 1
    assert body["params"] == {"feed_kg_per_day": 77.7}
    assert body["rationale"] == "운영자 수기 조정"
    assert body["created_by"] is not None

    with SessionLocal() as s:
        recipe = s.execute(select(Recipe).where(Recipe.id == recipe_id)).scalar_one()
        assert recipe.current_version == before_version + 1

        logs = s.execute(
            select(AuditLog)
            .where(AuditLog.entity == "recipes")
            .where(AuditLog.entity_id == recipe_id)
        ).scalars().all()
        assert len(logs) == 1
        assert logs[0].action == "add_version"
        assert logs[0].diff_json["before"]["current_version"] == before_version
        assert logs[0].diff_json["after"]["current_version"] == before_version + 1


def test_manual_version_add_requires_writer(client, viewer_token, org1_token, pro_plan):
    _add_feed_log(50.0, days_ago=1, id_suffix="viewer-writer-1")
    resp = _get_recommendations(client, org1_token)
    recipe_id = resp.json()["items"][0]["recipe_id"]

    post_resp = client.post(
        f"/recipes/{recipe_id}/versions",
        json={"params": {"feed_kg_per_day": 1.0}, "rationale": "x"},
        headers=_hdr(viewer_token),
    )
    assert post_resp.status_code == 403


# --- 타 org 격리 -------------------------------------------------------------


def test_get_recommendations_cross_org_site_403_or_404(client, org1_token, pro_plan):
    """org2(PRO 로 전환) 토큰으로 site1(org1 소속) 조회 → 403/404."""
    _set_plan(ORG2_ID, "PRO")
    token = _make_token(ORG2_ID, role="admin")
    resp = _get_recommendations(client, token)
    assert resp.status_code in (403, 404)


def test_post_recipe_version_cross_org_403_or_404(client, owner_token, org1_token, pro_plan):
    """recipe 는 site1(org1) 소속 — org2(owner, PRO) 토큰으로 POST 시도 → 403/404."""
    _add_feed_log(50.0, days_ago=1, id_suffix="cross-org-1")
    resp = _get_recommendations(client, org1_token)
    recipe_id = resp.json()["items"][0]["recipe_id"]

    _set_plan(ORG2_ID, "PRO")
    org2_owner_token = _make_token(ORG2_ID, role="owner")
    post_resp = client.post(
        f"/recipes/{recipe_id}/versions",
        json={"params": {"feed_kg_per_day": 1.0}, "rationale": "x"},
        headers=_hdr(org2_owner_token),
    )
    assert post_resp.status_code in (403, 404)
