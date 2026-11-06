"""서명 스트림 토큰 검증 + 서버 간 공유 키 확인.

원본에는 여기에 자체 JWT 발급과 bcrypt 해시가 있었다. shrimp365 통합판에는
자체 로그인이 없으므로 전부 걷어내고, 대신 두 가지 확인만 남긴다.

1. **서비스 키** — shrimp365 의 API 라우트가 서버에서 이 서비스를 부를 때
   보내는 공유 비밀(X-Vision-Key). 이 서비스는 외부에 직접 노출하지 않는다.

2. **스트림 토큰** — MJPEG(<img>)과 WebSocket 은 Authorization 헤더를 실을
   수 없다. 그래서 shrimp365 가 로그인 세션을 확인한 뒤 "이 사용자가 이
   카메라를 3분간 볼 수 있다"는 짧은 서명을 발급하고, 여기서 검증한다.
   서명 알고리즘과 형식은 shrimp365 의 lib/vision-token.ts 와 짝을 이룬다 —
   한쪽을 고치면 반드시 다른 쪽도 고쳐야 한다.

토큰 형식:  v1.<base64url(payload JSON)>.<base64url(HMAC-SHA256)>
페이로드 :  {"c": 카메라 id 목록(쉼표 구분), "u": 사용자 id, "e": 만료 epoch(초)}

`c` 가 목록인 이유: 실시간 연결(WebSocket)은 한 번 붙어 여러 카메라를 한꺼번에
구독한다. 여기에 "전체"를 뜻하는 값을 두면 남의 양식장 카메라 이벤트까지
흘러가므로, shrimp365 가 **그 사용자가 소유한 카메라 id 만** 담아 서명한다.
MJPEG 처럼 한 대만 보는 경우에는 목록에 한 개만 들어간다.
"""
from __future__ import annotations

import base64
import hmac
import json
import time
from collections.abc import Sequence
from dataclasses import dataclass
from hashlib import sha256

from app.config import settings

TOKEN_VERSION = "v1"


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _b64url_decode(text: str) -> bytes:
    # base64url 은 4의 배수 길이를 요구한다. 발급 쪽에서 '=' 를 떼므로 되붙인다.
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(payload_b64: str, secret: str) -> str:
    mac = hmac.new(secret.encode(), payload_b64.encode(), sha256).digest()
    return _b64url_encode(mac)


@dataclass(frozen=True)
class StreamGrant:
    """토큰이 허락하는 범위."""

    user_id: str
    camera_ids: frozenset[str]


def sign_stream_token(
    camera_ids: Sequence[str],
    user_id: str,
    ttl_seconds: int = 180,
    secret: str | None = None,
) -> str:
    """스트림 토큰을 발급한다.

    운영에서는 shrimp365(lib/vision-token.ts)가 발급하고 이 서비스는 검증만
    한다. 이 함수는 테스트와 로컬 확인용이며, 두 구현이 같은 형식을 내는지
    맞춰 보는 기준이 된다.
    """
    key = secret if secret is not None else settings.stream_secret
    payload = json.dumps(
        {
            "c": ",".join(camera_ids),
            "u": user_id,
            "e": int(time.time()) + ttl_seconds,
        },
        separators=(",", ":"),
        sort_keys=True,
    )
    payload_b64 = _b64url_encode(payload.encode())
    return f"{TOKEN_VERSION}.{payload_b64}.{_sign(payload_b64, key)}"


def decode_stream_token(token: str | None) -> StreamGrant | None:
    """서명과 만료를 확인하고 허용 범위를 돌려준다. 실패하면 None.

    실패 사유는 구분해서 돌려주지 않는다 — 서명이 틀린 것인지 만료된 것인지
    알려 주면 토큰을 깎아 볼 여지를 준다.
    """
    if not token or not settings.stream_secret:
        return None
    parts = token.split(".")
    if len(parts) != 3 or parts[0] != TOKEN_VERSION:
        return None
    _, payload_b64, signature = parts

    # 서명을 먼저 본다. 페이로드를 파싱하기 전에 위조를 걸러 낸다.
    if not hmac.compare_digest(signature, _sign(payload_b64, settings.stream_secret)):
        return None

    try:
        payload = json.loads(_b64url_decode(payload_b64))
    except (ValueError, TypeError):
        return None

    expires_at = payload.get("e")
    if not isinstance(expires_at, int | float) or expires_at < time.time():
        return None
    user_id = payload.get("u")
    raw_cameras = payload.get("c")
    if not user_id or not isinstance(raw_cameras, str):
        return None
    camera_ids = frozenset(c for c in raw_cameras.split(",") if c)
    if not camera_ids:
        return None
    return StreamGrant(user_id=str(user_id), camera_ids=camera_ids)


def verify_stream_token(token: str | None, camera_id: str) -> str | None:
    """토큰이 이 카메라에 유효하면 사용자 id, 아니면 None."""
    grant = decode_stream_token(token)
    if grant is None or camera_id not in grant.camera_ids:
        return None
    return grant.user_id


def service_key_valid(provided: str | None) -> bool:
    """X-Vision-Key 헤더가 설정된 서비스 키와 일치하는가.

    키가 설정되지 않았으면 항상 거부한다. 빈 키를 "인증 없음"으로 흘려보내면
    설정을 빠뜨린 배포가 조용히 무방비 상태로 뜬다.
    """
    if not settings.vision_service_key or not provided:
        return False
    return hmac.compare_digest(provided, settings.vision_service_key)
