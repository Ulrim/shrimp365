"""현장 화면 서버 검증 — 승인(M2)·조회와 내보내기(M5)·설정(M6)·리포트(M7)."""

from __future__ import annotations

import datetime
import json
import threading
import urllib.error
import urllib.request

import pytest

from ofdf import server, site
from ofdf.cli import EdgeConfig
from tests.test_cases import night

COVER = "야간피복|야간 피복 전개"


@pytest.fixture
def panel(tmp_path):
    """화면 폴더·판단 이력·상태 폴더를 갖춘 서버 하나."""
    today = datetime.date.today()
    records = night(3, 22, 12, {"frost": 2})
    # 조회 기본 기간(최근 30일) 안에 들도록 날짜를 오늘 기준으로 옮긴다
    stamp = (today - datetime.timedelta(days=2)).isoformat()
    for record in records:
        record["timestamp"] = stamp + record["timestamp"][10:]
    journal = tmp_path / "logs" / "journal.jsonl"
    journal.parent.mkdir()
    journal.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in records),
                       encoding="utf-8")
    screen = tmp_path / "dashboard"
    screen.mkdir()
    (screen / "index.html").write_text("<!doctype html><title>화면</title>", encoding="utf-8")

    config = EdgeConfig(
        field_dir=tmp_path / "field", model_dir=tmp_path / "models", journal_path=journal,
        state_dir=tmp_path / "state", station="실증포장",
        installed_devices=frozenset({"관수밸브", "전 구동부"}),
        thresholds={"frost": {"caution_canopy": 2.0}},
    )

    def start(pin=None):
        httpd = server.make_server(config, screen, pin=pin)
        threading.Thread(target=httpd.serve_forever, kwargs={"poll_interval": 0.05},
                         daemon=True).start()
        started.append(httpd)
        return f"http://127.0.0.1:{httpd.server_address[1]}"

    started: list = []
    yield type("Panel", (), {"start": staticmethod(start), "config": config, "day": stamp})
    for httpd in started:
        httpd.shutdown()
        httpd.server_close()


def call(url: str, body=None, headers=None):
    """``(상태, 본문, 머리말)``. 오류 응답도 예외 대신 돌려준다."""
    data = None if body is None else json.dumps(body).encode("utf-8")
    send = {"Content-Type": "application/json", "X-OFDF-Panel": "1"} if body is not None else {}
    send.update(headers or {})
    send = {k: v for k, v in send.items() if v is not None}
    request = urllib.request.Request(url, data=data, headers=send)
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status, response.read(), response.headers
    except urllib.error.HTTPError as error:
        return error.code, error.read(), error.headers


def get_json(url, **kwargs):
    status, body, _ = call(url, **kwargs)
    return status, json.loads(body)


def test_serves_screen_files_and_status(panel):
    base = panel.start()
    status, body, headers = call(base + "/index.html")
    assert status == 200 and "화면" in body.decode("utf-8")
    assert headers["Cache-Control"] == "no-store"            # 낡은 값을 캐시에서 꺼내지 않는다
    status, info = get_json(base + "/api/status")
    assert status == 200 and info["ok"] and info["pinRequired"] is False
    assert call(base + "/api/nothing")[0] == 404


def test_state_files_are_not_served(panel):
    """상태·이력 폴더는 화면 폴더 밖이다. 주소로 꺼낼 수 없다."""
    base = panel.start()
    call(base + "/api/approvals", {"id": COVER, "response": "approve"})
    assert call(base + "/../state/approvals.jsonl")[0] == 404
    assert call(base + "/%2e%2e/logs/journal.jsonl")[0] == 404


def test_cases_query_and_filters(panel):
    base = panel.start()
    status, result = get_json(base + "/api/cases")
    assert status == 200 and result["records"] == 12 and len(result["cases"]) == 1
    assert result["cases"][0]["riskName"] == "저온·서리"
    assert result["cases"][0]["evidence"][0]["label"] == "초관부 온도"     # 변수 이름이 아니라 말로
    assert "기온" in result["cases"][0]["inputs"]
    _, none = get_json(base + "/api/cases?risk=heat_dry")
    assert none["cases"] == []
    _, outside = get_json(base + "/api/cases?from=2020-01-01&to=2020-01-31")
    assert outside["records"] == 0 and outside["to"] == "2020-01-31"


@pytest.mark.parametrize("query", [
    "from=2026-13-01&to=2026-12-01", "from=20261101&to=2026-11-30", "from=2026-11-30&to=2026-11-01",
    "from=2020-01-01&to=2026-11-01", "risk=<script>",
])
def test_bad_queries_are_refused(panel, query):
    status, result = get_json(panel.start() + "/api/cases?" + query)
    assert status == 400 and result["ok"] is False and result["error"]


@pytest.mark.parametrize("kind,first", [
    ("cases", "사례번호"), ("judgements", "시각"), ("control", "시각")])
def test_csv_export(panel, kind, first):
    status, body, headers = call(panel.start() + f"/api/export/{kind}.csv")
    assert status == 200 and headers["Content-Type"].startswith("text/csv")
    assert f"ofdf_{kind}_" in headers["Content-Disposition"]
    text = body.decode("utf-8")
    assert text.startswith("﻿" + first)
    assert len(text.strip().splitlines()) > 1


def test_unknown_export_is_404(panel):
    assert call(panel.start() + "/api/export/passwords.csv")[0] == 404


def test_monthly_report(panel):
    base = panel.start()
    status, report = get_json(base + f"/api/report?month={panel.day[:7]}")
    assert status == 200 and report["records"] == 12 and report["caseTotal"] == 1
    assert report["station"] == "실증포장" and report["controlCommandTarget"] == 60
    _, empty = get_json(base + "/api/report?month=2020-12")       # 12월 → 다음 해 1월 경계
    assert empty["records"] == 0 and empty["month"] == "2020-12"
    assert get_json(base + "/api/report?month=2026-13")[0] == 400
    assert get_json(base + "/api/report?month=november")[0] == 400


def test_approval_roundtrip(panel):
    base = panel.start()
    status, result = get_json(base + "/api/approvals", body={"id": COVER, "response": "approve"})
    assert status == 200 and result["responses"][COVER]["response"] == "approve"
    # 제어기가 읽는 파일에 그대로 적혔다
    assert site.active_responses(panel.config.state_dir)[COVER]["response"] == "approve"
    _, listed = get_json(base + "/api/approvals")
    assert COVER in listed["responses"]
    _, cleared = get_json(base + "/api/approvals", body={"id": COVER, "response": "clear"})
    assert cleared["responses"] == {}


def test_writes_must_come_from_the_screen(panel):
    """다른 웹사이트가 농가 브라우저를 빌려 몰래 승인을 누르지 못한다."""
    base = panel.start()
    body = {"id": COVER, "response": "approve"}
    assert call(base + "/api/approvals", body, {"X-OFDF-Panel": None})[0] == 403
    assert call(base + "/api/approvals", body, {"Content-Type": "text/plain"})[0] == 415
    assert call(base + "/api/approvals", {"id": "아무거나", "response": "approve"})[0] == 400
    assert call(base + "/api/approvals", {"id": COVER, "response": "maybe"})[0] == 400
    assert call(base + "/api/approvals", ["approve"])[0] == 400
    assert call(base + "/api/approvals", {"id": COVER, "pad": "x" * 20000,
                                           "response": "approve"})[0] == 413
    assert site.active_responses(panel.config.state_dir) == {}


def test_settings_read_and_save(panel):
    base = panel.start()
    _, current = get_json(base + "/api/settings")
    assert current["values"]["confidence_threshold"] == 0.70
    assert current["values"]["installed_devices"] == ["관수밸브"]
    assert current["thresholds"] == {"frost": {"caution_canopy": 2.0}}
    assert current["bounds"]["wind_lock"]["max"] == 18.0 and current["overridden"] == []

    status, saved = get_json(base + "/api/settings", body={"values": {
        "confidence_threshold": 0.8, "installed_devices": ["관수밸브", "야간피복"]}})
    assert status == 200 and saved["values"]["confidence_threshold"] == 0.8
    assert saved["overridden"] == ["confidence_threshold", "installed_devices"]
    assert saved["log"][0]["changes"]["confidence_threshold"] == {"from": 0.7, "to": 0.8}
    # 제어기가 다음 주기에 읽는 값
    effective = panel.config.site_settings()
    assert effective.confidence_threshold == 0.8 and "야간피복" in effective.installed_devices
    assert "전 구동부" in effective.installed_devices             # 안전 차단은 그대로

    status, error = get_json(base + "/api/settings", body={"values": {"wind_lock": 99}})
    assert status == 400 and "8~18" in error["error"]
    assert panel.config.site_settings().field_rules.wind_lock == 14.0

    _, reset = get_json(base + "/api/settings", body={"reset": True})
    assert reset["values"]["confidence_threshold"] == 0.70 and reset["overridden"] == []


def test_settings_need_pin_when_configured(panel):
    base = panel.start(pin="2468")
    body = {"values": {"soil_upper_limit": 80}}
    assert get_json(base + "/api/status")[1]["pinRequired"] is True
    assert call(base + "/api/settings", body)[0] == 403
    assert call(base + "/api/settings", body, {"X-OFDF-Pin": "0000"})[0] == 403
    assert panel.config.site_settings().field_rules.soil_upper_limit == 90.0
    assert call(base + "/api/settings", body, {"X-OFDF-Pin": "2468"})[0] == 200
    assert panel.config.site_settings().field_rules.soil_upper_limit == 80.0
    # 승인·거부는 번호를 묻지 않는다 — 서리 오는 밤에 번호를 치게 하지 않는다
    assert call(base + "/api/approvals", {"id": COVER, "response": "approve"})[0] == 200


def test_writes_fail_cleanly_without_state_dir(panel):
    panel.config.state_dir = None
    base = panel.start()
    status, result = get_json(base + "/api/approvals", body={"id": COVER, "response": "approve"})
    assert status == 503 and result["error"]
    assert get_json(base + "/api/status")[1]["writable"] is False


def test_writes_from_a_foreign_host_name_are_refused(panel):
    """바깥 도메인이 제어기 주소로 바뀌어 들어오는 수법(DNS 리바인딩)을 막는다."""
    base = panel.start()
    body = {"id": COVER, "response": "approve"}
    assert call(base + "/api/approvals", body, {"Host": "evil.example"})[0] == 403
    assert call(base + "/api/approvals", body, {"Origin": "http://evil.example"})[0] == 403
    assert site.active_responses(panel.config.state_dir) == {}
    assert call(base + "/api/approvals", body, {"Host": "ofdf.local:8080"})[0] == 200
    assert call(base + "/api/approvals", body, {"Host": "192.168.0.20:8080"})[0] == 200


def test_pin_guessing_is_locked_out(panel):
    base = panel.start(pin="2468")
    body = {"values": {"soil_upper_limit": 80}}
    for _ in range(server.PIN_MAX_FAILURES):
        assert call(base + "/api/settings", body, {"X-OFDF-Pin": "0000"})[0] == 403
    # 잠긴 동안에는 맞는 번호도 받지 않는다
    assert call(base + "/api/settings", body, {"X-OFDF-Pin": "2468"})[0] == 429
    assert panel.config.site_settings().field_rules.soil_upper_limit == 90.0


@pytest.mark.parametrize("query", [
    "to=9999-12-31", "to=0001-01-05", "from=1999-01-01&to=1999-01-31"])
def test_far_dates_are_400_not_500(panel, query):
    assert get_json(panel.start() + "/api/cases?" + query)[0] == 400
    assert get_json(panel.start() + "/api/report?month=9999-12")[0] == 400


def test_heavy_lock_is_released_after_export(panel):
    base = panel.start()
    for _ in range(3):
        assert call(base + "/api/export/judgements.csv")[0] == 200
    assert get_json(base + "/api/report")[0] == 200
