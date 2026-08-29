"""POST /emission-factors — phase-3.md 1.1절(Rule 5: 배출계수 하드코딩 금지).

owner 전용(operator/viewer 403), 등록 필드 그대로 영속화, version unique 위반 409,
audit_logs(action='create') 기록을 검증한다.
"""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.audit_log import AuditLog
from app.models.emission_factor import EmissionFactor


def _hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _unique_version(label: str) -> str:
    return f"{label}-{uuid4().hex[:8]}"[:32]


def _payload(version: str) -> dict:
    return {
        "factor_tco2e_per_mwh": 0.4747,
        "source": "환경부 온실가스종합정보센터(GIR)",
        "year": 2024,
        "version": version,
        "effective_from": "2026-01-01T00:00:00Z",
    }


def test_owner_can_create_emission_factor(client, owner_token: str):
    version = _unique_version("ef-owner-ok")
    resp = client.post(
        "/emission-factors", json=_payload(version), headers=_hdr(owner_token)
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["version"] == version
    assert body["factor_tco2e_per_mwh"] == 0.4747
    assert body["source"].startswith("환경부")
    assert body["year"] == 2024
    assert body["id"].startswith("ef-")

    with SessionLocal() as session:
        row = session.execute(
            select(EmissionFactor).where(EmissionFactor.id == body["id"])
        ).scalar_one()
        assert row.version == version

        logs = session.execute(
            select(AuditLog).where(
                AuditLog.entity == "emission_factors", AuditLog.entity_id == body["id"]
            )
        ).scalars().all()
        assert len(logs) == 1
        assert logs[0].action == "create"
        assert logs[0].diff_json["before"] is None
        assert logs[0].diff_json["after"]["version"] == version


def test_operator_cannot_create_emission_factor(client, operator_token: str):
    version = _unique_version("ef-operator-403")
    resp = client.post(
        "/emission-factors", json=_payload(version), headers=_hdr(operator_token)
    )
    assert resp.status_code == 403


def test_viewer_cannot_create_emission_factor(client, viewer_token: str):
    version = _unique_version("ef-viewer-403")
    resp = client.post(
        "/emission-factors", json=_payload(version), headers=_hdr(viewer_token)
    )
    assert resp.status_code == 403


def test_duplicate_version_returns_409(client, owner_token: str):
    version = _unique_version("ef-dup")
    resp1 = client.post(
        "/emission-factors", json=_payload(version), headers=_hdr(owner_token)
    )
    assert resp1.status_code == 201, resp1.text

    resp2 = client.post(
        "/emission-factors", json=_payload(version), headers=_hdr(owner_token)
    )
    assert resp2.status_code == 409


def test_non_positive_factor_returns_422(client, owner_token: str):
    version = _unique_version("ef-bad-factor")
    payload = _payload(version)
    payload["factor_tco2e_per_mwh"] = 0.0
    resp = client.post("/emission-factors", json=payload, headers=_hdr(owner_token))
    assert resp.status_code == 422


def test_missing_token_returns_401(client):
    version = _unique_version("ef-no-token")
    resp = client.post("/emission-factors", json=_payload(version))
    assert resp.status_code == 401


def test_list_returns_created_factors_ordered_by_effective_from_desc(
    client, owner_token: str, viewer_token: str
):
    older = _unique_version("ef-list-older")
    newer = _unique_version("ef-list-newer")
    older_payload = _payload(older)
    older_payload["effective_from"] = "2020-01-01T00:00:00Z"
    newer_payload = _payload(newer)
    newer_payload["effective_from"] = "2030-01-01T00:00:00Z"

    assert client.post(
        "/emission-factors", json=older_payload, headers=_hdr(owner_token)
    ).status_code == 201
    assert client.post(
        "/emission-factors", json=newer_payload, headers=_hdr(owner_token)
    ).status_code == 201

    # 읽기는 viewer 도 가능(쓰기보다 위험도 낮음).
    resp = client.get("/emission-factors", headers=_hdr(viewer_token))
    assert resp.status_code == 200
    versions = [item["version"] for item in resp.json()["items"]]
    assert versions.index(newer) < versions.index(older)


def test_list_missing_token_returns_401(client):
    resp = client.get("/emission-factors")
    assert resp.status_code == 401
