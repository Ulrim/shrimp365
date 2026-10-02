"""서명 스트림 토큰 — MJPEG·WebSocket 이 기대는 유일한 관문이라 촘촘히 본다."""
from __future__ import annotations

from app.core.security import decode_stream_token, sign_stream_token, verify_stream_token

CAM_A = "11111111-1111-1111-1111-111111111111"
CAM_B = "22222222-2222-2222-2222-222222222222"
USER = "99999999-9999-9999-9999-999999999999"


def test_round_trip():
    token = sign_stream_token([CAM_A, CAM_B], USER)
    grant = decode_stream_token(token)
    assert grant is not None
    assert grant.user_id == USER
    assert grant.camera_ids == {CAM_A, CAM_B}
    assert verify_stream_token(token, CAM_A) == USER
    assert verify_stream_token(token, CAM_B) == USER


def test_camera_outside_grant_rejected():
    token = sign_stream_token([CAM_A], USER)
    assert verify_stream_token(token, CAM_B) is None


def test_expired_rejected():
    token = sign_stream_token([CAM_A], USER, ttl_seconds=-1)
    assert decode_stream_token(token) is None


def test_tampered_payload_rejected():
    """서명이 페이로드를 묶고 있으므로 카메라 목록만 바꿔 끼울 수 없다."""
    token = sign_stream_token([CAM_A], USER)
    version, payload, signature = token.split(".")
    forged_payload = sign_stream_token([CAM_B], USER).split(".")[1]
    assert decode_stream_token(f"{version}.{forged_payload}.{signature}") is None


def test_malformed_rejected():
    assert decode_stream_token(None) is None
    assert decode_stream_token("") is None
    assert decode_stream_token("not-a-token") is None
    assert decode_stream_token("v2.abc.def") is None


def test_signed_with_other_secret_rejected():
    token = sign_stream_token([CAM_A], USER, secret="a-different-secret-entirely")
    assert decode_stream_token(token) is None


def test_wire_format_matches_typescript():
    """TS 구현(lib/vision-token.ts)이 발급한 토큰이 그대로 통과해야 한다.

    아래 값은 conftest 와 같은 비밀키로 **실제 TS 코드가 발급한** 토큰이다
    (만료만 먼 미래로 고정했다). 두 구현 중 어느 쪽이든 서명 방식이나
    페이로드 키 순서가 바뀌면 이 테스트가 깨진다 — 그게 목적이다.
    두 언어가 이 형식에 합의하지 못하면 영상과 실시간 연결이 통째로 막힌다.
    """
    token = (
        "v1.eyJjIjoiMTExMTExMTEtMTExMS0xMTExLTExMTEtMTExMTExMTExMTExIiwiZSI6NDEwMjQ0NDgwMCwidSI6Ijk5OTk5OTk5LTk5OTktOTk5OS05OTk5LTk5OTk5OTk5OTk5OSJ9.doDPtGQ3EOWP7KRqdti8bkLSubyCptj-kWVLvIn3ZQM"
    )
    grant = decode_stream_token(token)
    assert grant is not None, "TS 가 만든 토큰을 파이썬이 못 읽는다 — 서명 형식이 갈라졌다"
    assert grant.user_id == USER
    assert grant.camera_ids == {CAM_A}
