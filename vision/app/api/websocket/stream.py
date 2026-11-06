"""WebSocket endpoint /ws/stream/{camera_id}.

서버가 count_update / alert / camera_status 이벤트를 밀어 준다. 경로의
camera_id 가 최초 구독이고, 클라이언트는 언제든
`{"type": "subscribe", "camera_ids": [...]}` 로 구독 집합을 바꿀 수 있다.

원본과 달라진 것 — **인증이 필수이고, 구독 범위가 토큰에 묶인다.**

원본은 누구나 붙을 수 있었고 `all` 을 보내면 모든 카메라 이벤트를 받았다.
여러 양식장이 한 서비스를 쓰는 통합판에서 그대로 두면 카메라 id 를 몰라도
`all` 한 번으로 남의 수조 개체수와 경보가 흘러간다. 그래서 shrimp365 가
"이 사용자가 가진 카메라 id 목록"을 서명해 주고, 여기서는 그 집합을 벗어난
구독 요청을 조용히 잘라 낸다.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status

from app.core.security import decode_stream_token
from app.services.broadcaster import broadcaster

logger = logging.getLogger(__name__)

router = APIRouter()

# 경로에 이 값을 넣으면 "토큰이 허락하는 카메라 전부"를 구독한다.
ALL = "all"


class _Subscription:
    """구독 집합. 어떤 경우에도 허용 집합(allowed)을 넘지 않는다."""

    def __init__(self, initial: str, allowed: frozenset[str]) -> None:
        self.allowed = allowed
        self.camera_ids = set(allowed) if initial == ALL else ({initial} & allowed)

    def update(self, camera_ids: list[str]) -> None:
        if ALL in camera_ids:
            self.camera_ids = set(self.allowed)
        else:
            self.camera_ids = set(camera_ids) & self.allowed

    def matches(self, message: dict[str, Any]) -> bool:
        return str(message.get("camera_id")) in self.camera_ids


@router.websocket("/ws/stream/{camera_id}")
async def stream_ws(websocket: WebSocket, camera_id: str, token: str | None = None) -> None:
    grant = decode_stream_token(token)
    if grant is None:
        # accept 전에 닫으면 브라우저는 사유 없이 끊긴 것으로만 본다. 정책
        # 위반 코드를 실어 보내야 화면이 "다시 로그인" 같은 안내를 할 수 있다.
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    subscription = _Subscription(camera_id, grant.camera_ids)
    if not subscription.camera_ids:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()
    queue = broadcaster.subscribe()

    async def sender() -> None:
        while True:
            message = await queue.get()
            if subscription.matches(message):
                await websocket.send_json(message)

    send_task = asyncio.create_task(sender())
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                message = json.loads(raw)
            except ValueError:
                continue
            if message.get("type") == "subscribe" and isinstance(
                message.get("camera_ids"), list
            ):
                subscription.update([str(c) for c in message["camera_ids"]])
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001 - connection teardown races
        logger.debug("WebSocket connection closed unexpectedly", exc_info=True)
    finally:
        send_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await send_task
        broadcaster.unsubscribe(queue)
