"""서버 업로더(ofdf.upload) 검증 — 모의 HTTP 로, 네트워크 없이."""

from __future__ import annotations

import datetime as dt
import json
from dataclasses import dataclass
from pathlib import Path

import pandas as pd
import pytest
import requests

from ofdf import upload
from ofdf.action.recommend import Action, Layer

SEOUL = upload.TZ


@dataclass
class FakeResponse:
    status_code: int
    text: str = ""


class FakeServer:
    """요청을 기록하고 정해진 응답을 차례로 돌려준다."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls: list[dict] = []

    def __call__(self, url, *, json, headers, timeout):
        self.calls.append({"url": url, "json": json, "headers": headers, "timeout": timeout})
        if not self.responses:
            return FakeResponse(200, '{"accepted": %d, "duplicates": 0}' % len(json["judgements"]))
        nxt = self.responses.pop(0)
        if isinstance(nxt, Exception):
            raise nxt
        return nxt


def make_uploader(tmp_path: Path, server, **kwargs) -> upload.Uploader:
    key = tmp_path / "device.key"
    key.write_text("k-123\n", encoding="utf-8")
    return upload.Uploader(
        url="https://example.test/api/field/device/judgements",
        key_file=key, queue_path=tmp_path / "logs" / "upload_queue.jsonl",
        agent_version="ofdf-0.1.0", post=server, **kwargs,
    )


def judgement(ts: str, risk: str = "frost", horizon: int = 3, level: int = 1) -> dict:
    return {"ts": ts, "risk": risk, "horizon_h": horizon, "level": level,
            "level_name": "주의", "confidence": 0.8, "model_version": "ofdf-weather-0.1.0",
            "expected_onset": None, "evidence": [], "actions": [], "environment": {}}


# ---------------------------------------------------------------------------
# 비활성 조건
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("environ", [
    {},
    {"OFDF_UPLOAD_URL": "https://example.test/x"},
    {"OFDF_DEVICE_KEY_FILE": "/etc/ofdf/device.key"},
    {"OFDF_UPLOAD_URL": "", "OFDF_DEVICE_KEY_FILE": "/etc/ofdf/device.key"},
    {"OFDF_UPLOAD_URL": "https://example.test/x", "OFDF_DEVICE_KEY_FILE": "  "},
])
def test_disabled_unless_both_env_vars(tmp_path, environ):
    """둘 중 하나라도 없으면 업로더가 만들어지지 않는다 — 기존 오프라인 동작 그대로."""
    assert upload.Uploader.from_env(tmp_path / "q.jsonl", environ=environ) is None


def test_enabled_with_both_env_vars(tmp_path):
    up = upload.Uploader.from_env(
        tmp_path / "q.jsonl", agent_version="ofdf-9",
        environ={"OFDF_UPLOAD_URL": " https://example.test/x ",
                 "OFDF_DEVICE_KEY_FILE": str(tmp_path / "k")},
    )
    assert up is not None
    assert up.url == "https://example.test/x"
    assert up.key_file == tmp_path / "k"
    assert up.agent_version == "ofdf-9"


# ---------------------------------------------------------------------------
# 시간대
# ---------------------------------------------------------------------------

def test_naive_time_is_read_as_seoul():
    assert upload.to_iso("2026-10-15T06:00:00") == "2026-10-15T06:00:00+09:00"
    assert upload.to_iso(dt.datetime(2026, 10, 15, 6, 0)) == "2026-10-15T06:00:00+09:00"
    assert upload.to_iso(pd.Timestamp("2026-10-15 06:00")) == "2026-10-15T06:00:00+09:00"


def test_aware_time_is_converted_to_seoul():
    utc = dt.datetime(2026, 10, 14, 21, 0, tzinfo=dt.timezone.utc)
    assert upload.to_iso(utc) == "2026-10-15T06:00:00+09:00"
    assert upload.to_iso("2026-10-14T21:00:00+00:00") == "2026-10-15T06:00:00+09:00"


def test_unreadable_time_is_none():
    assert upload.to_iso(None) is None
    assert upload.to_iso("") is None
    assert upload.to_iso("어제") is None


# ---------------------------------------------------------------------------
# 레코드 만들기 — 계약 4-2 의 필드명을 그대로
# ---------------------------------------------------------------------------

class _Decision:
    def __init__(self, actions):
        self.actions = actions


def test_build_judgements_follows_contract():
    now = pd.Timestamp("2026-10-15 06:00")
    by_horizon = {
        1: ({"heat_dry": 0, "rain_wet": 0, "disease": 0, "frost": 1, "compound": 0},
            {"frost": 0.6},
            {"frost": [{"feature": "t_air", "value": 1.2, "contribution": -0.31}]}),
        3: ({"heat_dry": 0, "rain_wet": 0, "disease": 0, "frost": 2, "compound": 1},
            {"frost": 0.81},
            {"frost": [{"feature": f"f{i}", "value": i, "contribution": 0.1} for i in range(7)]}),
    }
    row = pd.Series({"t_air": 1.2, "canopy_temp": 0.4, "rh": 93.0, "leaf_wetness": 1.0,
                     "solar_w": 0.0, "rain": 0.0, "soil_moisture": 31.5, "soil_index": 0.6,
                     "wind_speed": 1.1, "vpd": 0.2, "dew_point": float("nan")})
    decision = _Decision([
        Action("cover", "close", Layer.AI, "서리 예상", "frost", advisory=True),
        Action("irrigation", "stop", Layer.FIELD_RULE, "강우", "rain_wet",
               rejected_by="L0 비상정지"),
        Action("valve", "open", Layer.AI, "건조", "heat_dry"),
    ])

    items = upload.build_judgements(
        now, by_horizon, model_version="ofdf-weather-0.1.0",
        level_names={0: "정상", 1: "주의", 2: "경계"},
        environment=row, decision=decision,
        expected_onset=lambda risk: "2026-10-15T09:00:00" if risk == "frost" else None,
    )

    # 위험 5종 × 시계 2 — 정상(0)도 보낸다
    assert len(items) == 10
    assert {(j["risk"], j["horizon_h"]) for j in items} == {
        (r, h) for r in upload.RISKS for h in (1, 3)}

    frost3 = next(j for j in items if j["risk"] == "frost" and j["horizon_h"] == 3)
    assert set(frost3) == {"ts", "risk", "horizon_h", "level", "level_name", "confidence",
                           "model_version", "expected_onset", "evidence", "actions",
                           "environment"}
    assert frost3["ts"] == "2026-10-15T06:00:00+09:00"
    assert frost3["level"] == 2 and frost3["level_name"] == "경계"
    assert frost3["confidence"] == 0.81
    assert frost3["expected_onset"] == "2026-10-15T09:00:00+09:00"
    assert len(frost3["evidence"]) == upload.MAX_EVIDENCE        # 7개 → 5개
    assert set(frost3["evidence"][0]) == {"feature", "label", "value", "contribution"}

    frost1 = next(j for j in items if j["risk"] == "frost" and j["horizon_h"] == 1)
    assert frost1["evidence"][0] == {"feature": "t_air", "label": "기온",
                                     "value": 1.2, "contribution": -0.31}

    # 환경은 숫자 키 9개만, NaN 제외
    assert set(frost3["environment"]) == set(upload.ENVIRONMENT_KEYS)
    assert "vpd" not in frost3["environment"]

    # 조치 모양
    actions = frost3["actions"]
    assert [a["device"] for a in actions] == ["cover", "irrigation", "valve"]
    assert actions[0] == {"device": "cover", "command": "close", "layer": 2, "reason": "서리 예상",
                          "executed": False, "rejected_by": None, "advisory": True}
    assert actions[1]["rejected_by"] == "L0 비상정지" and actions[1]["executed"] is False
    assert actions[2]["executed"] is True

    # 정상 건은 근거가 비고 예상시점이 없다
    normal = next(j for j in items if j["risk"] == "heat_dry" and j["horizon_h"] == 3)
    assert normal["level"] == 0 and normal["evidence"] == [] and normal["expected_onset"] is None
    assert normal["confidence"] == 1.0


def test_build_judgements_skips_unknown_horizon_and_risk():
    items = upload.build_judgements(
        "2026-10-15T06:00:00", {6: ({"frost": 1}, {}, {}), 3: ({"frost": 1, "wind": 2}, {}, {})},
        model_version="m", level_names={1: "주의"},
    )
    assert [(j["risk"], j["horizon_h"]) for j in items] == [("frost", 3)]


def test_environment_from_handles_missing_and_nan():
    assert upload.environment_from(None) == {}
    assert upload.environment_from({"t_air": "3.25", "rh": float("nan"), "x": 1}) == {"t_air": 3.25}


# ---------------------------------------------------------------------------
# 큐·전송
# ---------------------------------------------------------------------------

def test_flush_splits_into_batches_of_200_in_time_order(tmp_path):
    server = FakeServer()
    up = make_uploader(tmp_path, server)
    base = dt.datetime(2026, 10, 15, 0, 0, tzinfo=SEOUL)
    items = [judgement((base + dt.timedelta(minutes=5 * i)).isoformat()) for i in range(450)]
    up.enqueue(reversed(items))                         # 뒤섞여 들어와도

    result = up.flush(now=base + dt.timedelta(days=2))

    assert result.sent == 450 and result.pending == 0 and result.error is None
    assert [len(c["json"]["judgements"]) for c in server.calls] == [200, 200, 50]
    assert all(c["headers"]["X-Device-Key"] == "k-123" for c in server.calls)
    assert all(c["json"]["agent_version"] == "ofdf-0.1.0" for c in server.calls)
    sent_ts = [j["ts"] for c in server.calls for j in c["json"]["judgements"]]
    assert sent_ts == sorted(sent_ts)                   # 시간순
    assert up.queue_path.read_text(encoding="utf-8") == ""  # 성공분 제거
    assert up.last_success == base + dt.timedelta(days=2)


def test_connection_failure_keeps_queue_then_retries(tmp_path):
    server = FakeServer(requests.ConnectionError("끊김"))
    up = make_uploader(tmp_path, server)
    now = dt.datetime(2026, 10, 15, 6, 0, tzinfo=SEOUL)
    up.enqueue([judgement("2026-10-15T05:55:00+09:00"), judgement("2026-10-15T06:00:00+09:00")])

    first = up.flush(now=now)
    assert first.sent == 0 and first.pending == 2 and "연결 실패" in first.error
    assert len(up.queue_path.read_text(encoding="utf-8").splitlines()) == 2
    assert "실패" in up.status(now=now) and "대기 2건" in up.status(now=now)

    # 다음 주기 — 서버가 살아나면 그대로 올라간다 (멱등이라 중복 전송도 무해)
    second = up.flush(now=now + dt.timedelta(minutes=5))
    assert second.sent == 2 and second.pending == 0 and second.error is None
    assert len(server.calls) == 2
    assert up.status(now=now + dt.timedelta(minutes=5)) == "업로드 0분 전 · 대기 0건"


@pytest.mark.parametrize("status", [401, 403, 429, 500, 503])
def test_retryable_http_errors_keep_queue(tmp_path, status):
    server = FakeServer(FakeResponse(status, "nope"))
    up = make_uploader(tmp_path, server)
    up.enqueue([judgement("2026-10-15T06:00:00+09:00")])
    result = up.flush(now=dt.datetime(2026, 10, 15, 6, 5, tzinfo=SEOUL))
    assert result.pending == 1 and result.error == f"HTTP {status}"
    assert len(server.calls) == 1


def test_422_drops_the_rejected_batch_and_continues(tmp_path):
    """계약에 안 맞는 자료는 다시 보내도 거부된다 — 큐 머리를 막지 않게 버린다."""
    server = FakeServer(FakeResponse(422, '{"error":"risk"}'))
    up = make_uploader(tmp_path, server, batch_size=2)
    up.enqueue([judgement(f"2026-10-15T06:0{i}:00+09:00") for i in range(3)])
    result = up.flush(now=dt.datetime(2026, 10, 15, 6, 10, tzinfo=SEOUL))
    assert result.dropped == 2 and result.sent == 1 and result.pending == 0
    assert len(server.calls) == 2


def test_queue_drops_items_older_than_seven_days(tmp_path):
    server = FakeServer()
    up = make_uploader(tmp_path, server)
    now = dt.datetime(2026, 10, 15, 6, 0, tzinfo=SEOUL)
    up.enqueue([
        judgement((now - dt.timedelta(days=8)).isoformat()),
        judgement((now - dt.timedelta(days=6, hours=23)).isoformat()),
        judgement(now.isoformat()),
    ])
    with up.queue_path.open("a", encoding="utf-8") as handle:
        handle.write("깨진 줄{\n")

    result = up.flush(now=now)
    assert result.dropped == 2                          # 8일 전 + 깨진 줄
    assert result.sent == 2 and result.pending == 0


def test_missing_key_file_keeps_queue_without_sending(tmp_path):
    server = FakeServer()
    up = make_uploader(tmp_path, server)
    up.key_file.unlink()
    up.enqueue([judgement("2026-10-15T06:00:00+09:00")])
    result = up.flush(now=dt.datetime(2026, 10, 15, 6, 5, tzinfo=SEOUL))
    assert result.sent == 0 and result.pending == 1 and "기기 키" in result.error
    assert server.calls == []
    assert json.loads(up.queue_path.read_text(encoding="utf-8").splitlines()[0])["risk"] == "frost"


def test_empty_queue_is_a_noop(tmp_path):
    server = FakeServer()
    up = make_uploader(tmp_path, server)
    result = up.flush()
    assert result == upload.UploadResult()
    assert server.calls == []
    assert up.status().startswith("업로드 기록 없음")
