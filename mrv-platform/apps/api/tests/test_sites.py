"""GET /sites, GET /sites/kpi-benchmark — phase-3.md 4.2절 검증.

org 소속 site 목록 + 플랜 무관(START 플랜에서도 200) + org 격리(타 org site 미노출).
kpi-benchmark: 다중 site 응답(신규 산식 없음, compute_site_kpi_results 반복 호출),
ENTERPRISE 게이팅, 빈 조직(site 0개) 처리, org 스코프(cross-org 미노출), 기간 검증.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
import seed_demo_site as seed_mod
from sqlalchemy import delete, select

from app.db.session import SessionLocal
from app.models.organization import Organization
from app.models.site import Site
from tests.conftest import ORG1_ID, ORG2_ID, SITE1_ID, SITE2_ID, _make_token

PERIOD_START = seed_mod.PERIOD_START
HOURS = seed_mod.HOURS
PERIOD_END = PERIOD_START + timedelta(hours=HOURS)

SITE_MULTI_ID = "site-benchmark-multi-9999"
ORG_EMPTY_ID = "org-benchmark-empty-9999"


def _hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _set_plan(org_id: str, plan: str) -> None:
    with SessionLocal() as s:
        org = s.execute(select(Organization).where(Organization.id == org_id)).scalar_one()
        org.plan = plan
        s.commit()


@pytest.fixture(autouse=True)
def _clean_benchmark(_prepare_db):
    yield
    with SessionLocal() as s:
        s.execute(delete(Site).where(Site.id == SITE_MULTI_ID))
        s.execute(delete(Organization).where(Organization.id == ORG_EMPTY_ID))
        s.commit()
    _set_plan(ORG1_ID, "START")
    _set_plan(ORG2_ID, "START")


@pytest.fixture
def enterprise_plan():
    _set_plan(ORG1_ID, "ENTERPRISE")
    yield


def _benchmark(client, token, *, frm=None, to=None):
    return client.get(
        "/sites/kpi-benchmark",
        params={
            "from": (frm or PERIOD_START).isoformat(),
            "to": (to or PERIOD_END).isoformat(),
        },
        headers=_hdr(token),
    )


def test_list_sites_returns_org_scoped_items(client, owner_token):
    resp = client.get("/sites", headers=_hdr(owner_token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    ids = [item["id"] for item in body["items"]]
    assert SITE1_ID in ids
    assert SITE2_ID not in ids
    assert body["total"] == len(body["items"])
    for item in body["items"]:
        assert "name" in item


def test_list_sites_plan_agnostic_viewer_ok(client, viewer_token):
    """START 플랜(기본) + viewer 역할에서도 200(플랜/역할 게이팅 없음)."""
    resp = client.get("/sites", headers=_hdr(viewer_token))
    assert resp.status_code == 200


def test_list_sites_org2_scope(client):
    org2_token = _make_token(ORG2_ID)
    resp = client.get("/sites", headers=_hdr(org2_token))
    assert resp.status_code == 200
    ids = [item["id"] for item in resp.json()["items"]]
    assert SITE2_ID in ids
    assert SITE1_ID not in ids


def test_list_sites_missing_token_401(client):
    resp = client.get("/sites")
    assert resp.status_code == 401


# --- GET /sites/kpi-benchmark(4.2절, ENTERPRISE) ------------------------------


def test_kpi_benchmark_multi_site(client, owner_token, enterprise_plan):
    """다중 site 응답: org1 에 site1(데이터 있음) + 신규 빈 site 를 함께 추가해 검증."""
    with SessionLocal() as s:
        s.add(Site(id=SITE_MULTI_ID, org_id=ORG1_ID, name="벤치마크 2호 사이트"))
        s.commit()

    resp = _benchmark(client, owner_token)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["period"]["from"] is not None
    site_ids = {entry["site_id"] for entry in body["sites"]}
    assert {SITE1_ID, SITE_MULTI_ID} <= site_ids

    site1_entry = next(e for e in body["sites"] if e["site_id"] == SITE1_ID)
    assert site1_entry["site_name"]
    assert site1_entry["config_version"]
    assert set(site1_entry["metrics"].keys()) == {
        "ei_total", "ei_aeration", "oei", "fcr", "mortality_rate",
    }
    assert site1_entry["metrics"]["ei_total"] is not None  # 시드 데이터로 산출 가능

    empty_entry = next(e for e in body["sites"] if e["site_id"] == SITE_MULTI_ID)
    assert empty_entry["metrics"]["ei_total"] is None  # 데이터 없음 → 산출 불가


def test_kpi_benchmark_start_plan_403(client, owner_token):
    resp = _benchmark(client, owner_token)
    assert resp.status_code == 403


def test_kpi_benchmark_pro_plan_403(client, owner_token):
    _set_plan(ORG1_ID, "PRO")
    resp = _benchmark(client, owner_token)
    assert resp.status_code == 403


def test_kpi_benchmark_viewer_ok(client, viewer_token, enterprise_plan):
    """읽기 전용 엔드포인트 — viewer 도 ENTERPRISE 면 200(require_writer 불요)."""
    resp = _benchmark(client, viewer_token)
    assert resp.status_code == 200


def test_kpi_benchmark_bad_period_422(client, owner_token, enterprise_plan):
    resp = _benchmark(client, owner_token, frm=PERIOD_END, to=PERIOD_START)
    assert resp.status_code == 422


def test_kpi_benchmark_empty_org_zero_sites(client):
    """빈 조직(site 0개) → sites: [] (에러 아님)."""
    with SessionLocal() as s:
        s.add(Organization(id=ORG_EMPTY_ID, name="빈 조직(벤치마크 테스트)", plan="ENTERPRISE"))
        s.commit()
    token = _make_token(ORG_EMPTY_ID, role="owner")

    resp = _benchmark(client, token)
    assert resp.status_code == 200, resp.text
    assert resp.json()["sites"] == []


def test_kpi_benchmark_cross_org_scope_no_leak(client, owner_token, enterprise_plan):
    """org2 가 org1 소속 site 를 벤치마크 응답에서 볼 수 없다(누수 0)."""
    _set_plan(ORG2_ID, "ENTERPRISE")
    token2 = _make_token(ORG2_ID, role="owner")

    resp = _benchmark(client, token2)
    assert resp.status_code == 200
    site_ids = {entry["site_id"] for entry in resp.json()["sites"]}
    assert SITE1_ID not in site_ids
    assert SITE2_ID in site_ids  # org2 자기 자신의 site 는 보임
