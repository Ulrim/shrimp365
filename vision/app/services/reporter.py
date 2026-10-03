"""서버로 보고하는 길 — 장비가 DB 비밀번호를 들지 않게 한다.

왜 있나
-------
예전에는 장비가 Supabase Postgres 에 직접 붙었다. 그래서 설치할 때 사람이
DATABASE_URL(비밀번호가 박힌 연결 문자열)을 찾아 넣어야 했고, 그것이 설치에서
가장 큰 걸림돌이었다 — pooler 와 direct 구분, `+asyncpg` 접두사, 비밀번호
특수문자 인코딩. 수질 센서 파이에는 그런 것이 하나도 없다. 기기 키 하나로
`/api/sensors/data` 에 보낸다. 비전도 같게 한다.

보안상으로도 이쪽이 맞다. 장비가 DB 비밀번호를 들고 있으면 그 파이 하나를
집어 가면 **모든 농장의 데이터**를 읽고 쓸 수 있다. 기기 키는 자기 카메라로
범위가 묶인다.

끊겨도 잃지 않는다 — 보관함은 하나다
------------------------------------
농장 회선은 끊긴다. 그동안의 측정값은 **장비 안의 DB 파일**에 그대로 남아
있고, 어디까지 올렸는지는 워터마크 파일에 적힌다. 그래서 여기서는 아무것도
쌓아 두지 않는다.

한때 이 모듈이 메모리에 따로 쌓아 두었다. 보관함이 둘이 되면서 바로 틀어졌다 —
한 번에 500건만 보내는데 워터마크는 그보다 많이 올라가, 재부팅하면 그 차이만큼
**올린 적 없는 기록을 올린 것으로** 치고 영구히 건너뛰었다. 보관함은 하나여야
하고, 그것은 재부팅을 넘기는 쪽(파일)이어야 한다.
"""
from __future__ import annotations

import logging
from typing import Any

from app.config import settings

logger = logging.getLogger(__name__)

#: 한 번에 보내는 양. 서버가 받는 상한(500)과 맞춘다.
BATCH_SIZE = 500


class ServerReporter:
    """개체수를 shrimp365 에 올리고, 내 카메라와 경보 규칙을 받아 온다."""

    def __init__(self) -> None:
        self._offline_logged = False
        #: 마지막 통신이 성공했나. 한 번도 하지 않았으면 None — 장비 화면이
        #: 이 값을 그대로 쓴다. 예전에는 화면이 "서버 끊김"을 로컬 DB 쓰기
        #: 성공으로 판단했는데, 서버로 올리는 구성에서는 로컬 쓰기가 언제나
        #: 성공해서 회선이 끊겨도 "연결됨"으로 보였다.
        self.last_ok: bool | None = None

    async def send_counts(self, counts: list[dict[str, Any]], *, agent_version: str) -> bool:
        """건네받은 기록을 **그대로** 올린다. 서버가 받았으면 True.

        실패하면 False 만 돌려준다 — 부르는 쪽이 워터마크를 올리지 않으므로
        다음 주기에 같은 구간을 다시 보낸다. 서버는 같은 (카메라, 시각) 을
        덮어쓰므로 두 번 보내도 행이 늘지 않는다.
        """
        if not counts:
            return True
        payload = {
            "counts": counts,
            "agent_version": agent_version,
            "host_url": settings.vision_public_url or None,
        }
        status, _ = await _post("/api/vision/device", payload)
        self.last_ok = status == 200
        if status != 200:
            if not self._offline_logged:
                self._offline_logged = True
                logger.warning(
                    "서버에 기록을 올리지 못했습니다(%s) — 장비에 보관했다가 다시"
                    " 보냅니다. 측정은 계속됩니다.",
                    status or "연결 실패",
                )
            return False
        if self._offline_logged:
            self._offline_logged = False
            logger.info("서버 연결이 돌아왔습니다 — 보관분을 올리고 있습니다.")
        return True

    async def fetch_assignment(self) -> dict[str, Any] | None:
        """내가 맡은 카메라와 경보 규칙. 실패하면 None."""
        status, data = await _get("/api/vision/device")
        self.last_ok = status == 200
        if status != 200:
            return None
        return data


async def _client():  # noqa: ANN202 - httpx 지연 임포트
    import httpx  # noqa: PLC0415

    return httpx.AsyncClient(timeout=15)


def _headers() -> dict[str, str]:
    return {"X-Device-Key": settings.device_key, "Content-Type": "application/json"}


async def _post(path: str, payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    base = settings.shrimp365_internal_url.rstrip("/")
    if not base or not settings.device_key:
        return 0, {}
    try:
        async with await _client() as client:
            res = await client.post(f"{base}{path}", json=payload, headers=_headers())
            return res.status_code, (res.json() if res.content else {})
    except Exception as exc:  # noqa: BLE001 - 그물 밖의 일은 무엇이든 터진다
        logger.debug("보고 실패: %s", exc)
        return 0, {}


async def _get(path: str) -> tuple[int, dict[str, Any]]:
    base = settings.shrimp365_internal_url.rstrip("/")
    if not base or not settings.device_key:
        return 0, {}
    try:
        async with await _client() as client:
            res = await client.get(f"{base}{path}", headers=_headers())
            return res.status_code, (res.json() if res.content else {})
    except Exception as exc:  # noqa: BLE001
        logger.debug("조회 실패: %s", exc)
        return 0, {}


reporter = ServerReporter()
