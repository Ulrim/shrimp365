"""MJPEG live stream: GET /stream/{camera_id} (multipart/x-mixed-replace).

카메라의 스트림 처리기가 만든 최신 프레임(탐지 박스 + 개체수 오버레이)을
내보낸다. /api/v1 밖에 두는 이유는 <img> 태그가 이 주소를 직접 물기 때문이다.

원본은 이 경로에 인증이 아예 없었다(“<img> 는 헤더를 못 보낸다”). 통합판은
두 가지 중 하나를 요구한다:

  · `?token=` — shrimp365 가 로그인 세션을 확인하고 발급한 짧은 서명.
    브라우저가 리버스 프록시를 거쳐 이 서비스로 직접 붙을 때 쓴다.
  · `X-Vision-Key` — shrimp365 서버가 대신 받아 중계할 때(프록시 경로).

둘 다 없으면 401. 인증 없는 영상 경로를 남겨 두면 카메라 id 하나로 남의
수조를 들여다볼 수 있다.
"""
from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import StreamingResponse

from app.core.security import service_key_valid, verify_stream_token
from app.services.camera_manager import camera_manager
from app.services.stream_service import frame_store

router = APIRouter()

_BOUNDARY = "shrimpframe"


@router.get("/stream/{camera_id}")
async def mjpeg_stream(
    camera_id: uuid.UUID,
    token: str | None = None,
    x_vision_key: Annotated[str | None, Header(alias="X-Vision-Key")] = None,
) -> StreamingResponse:
    if not service_key_valid(x_vision_key) and not verify_stream_token(token, str(camera_id)):
        raise HTTPException(status_code=401, detail="영상 열람 권한이 없습니다.")

    if not camera_manager.is_running(camera_id) and frame_store.latest_frame(camera_id) is None:
        raise HTTPException(
            status_code=404,
            detail="실행 중인 스트림이 없습니다. 카메라를 먼저 시작하세요.",
        )

    async def frames() -> AsyncIterator[bytes]:
        # Emit the current frame immediately, then follow new ones.
        last: bytes | None = None
        while True:
            jpeg = frame_store.latest_frame(camera_id)
            if jpeg is not None and jpeg is not last:
                last = jpeg
                yield (
                    f"--{_BOUNDARY}\r\n"
                    "Content-Type: image/jpeg\r\n"
                    f"Content-Length: {len(jpeg)}\r\n\r\n"
                ).encode() + jpeg + b"\r\n"
            new = await frame_store.wait_for_frame(camera_id, timeout=5.0)
            if new is None and not camera_manager.is_running(camera_id):
                break  # stream stopped and no frames are coming

    return StreamingResponse(
        frames(), media_type=f"multipart/x-mixed-replace; boundary={_BOUNDARY}"
    )
