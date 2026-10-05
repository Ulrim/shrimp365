"""수조 사진을 서버로 밀어 올린다 — 공유기 뒤에서도 수조를 보려고.

왜 "밀어 올리나" — 영상을 "받아 가면" 되지 않나
-----------------------------------------------
방향이 다르다. 이 하나가 전부다.

  개체수  장비 → 서버로 **나가는** 연결. 농장 공유기는 나가는 것을 막지 않는다.
  영상    브라우저 → 장비로 **들어오는** 연결. 공유기가 막는다(NAT).

그래서 "개체수는 보이는데 영상이 안 보인다". 장비가 멀쩡해도 그렇다. 들어오는
길을 여는 방법(Cloudflare 터널)이 있지만, 장비가 열 대를 넘고 남의 농장에도
있는 상황에서 그것을 전부 깔고 관리하는 것은 지금 할 일이 아니다.

사진을 개체수와 **같은 방향**으로 내보내면 공유기를 그대로 두고 쓸 수 있다.
15초에 한 장이라 진짜 실시간은 아니다. 그 점은 화면이 "N초 전"으로 분명히
말한다 — 멈춘 사진을 실시간이라고 보여 주는 것이 가장 나쁘다.

보내는 것은 **박스까지 그려진 프레임**이다(frame_store 에 든 것이 그것이다).
웹에서 박스를 다시 그릴 필요가 없고, 사람이 "이 숫자가 어디서 나온 것인가"를
눈으로 확인할 수 있다.

안 보내는 경우가 있다
---------------------
* 프레임이 지난번과 **똑같으면** 보내지 않는다. 카메라가 멈춘 장비는 같은
  프레임이 frame_store 에 그대로 남아 있다 — 그걸 15초마다 올리면 아무것도
  달라지지 않는데 회선과 DB 쓰기만 먹는다.
* 서버가 받지 못하면 **간격을 늘린다.** 특히 501(마이그레이션 미적용)은
  사람이 SQL 을 돌릴 때까지 영원히 실패하므로, 계속 올려 봐야 회선만 태운다.
"""
from __future__ import annotations

import asyncio
import io
import logging
import uuid
from datetime import UTC, datetime

from app.config import settings
from app.services.reporter import reporter
from app.services.stream_service import frame_store

logger = logging.getLogger(__name__)

#: 실패하면 간격을 몇 배로 늘리는가, 그리고 어디까지 늘리는가(초).
#:
#: 끊긴 회선에 15초마다 수십 KB 를 던지는 것은 복구를 돕지 않는다. 5분이면
#: 사람이 SQL 을 돌리거나 회선이 돌아온 뒤 늦어도 그만큼 안에 다시 붙는다.
BACKOFF_FACTOR = 2.0
MAX_INTERVAL_SECONDS = 300.0


def shrink(jpeg: bytes, *, width: int | None = None, quality: int | None = None) -> tuple[bytes, int, int]:
    """사진을 올릴 만한 크기로 줄인다. (바이트, 폭, 높이).

    이미 그 폭보다 작으면 **다시 인코딩하지 않는다.** 한 번 더 JPEG 으로
    저장할 때마다 화질이 깎이는데, 작아지지도 않는 거래다.
    """
    from PIL import Image  # noqa: PLC0415 - 느린 임포트를 기동 경로에서 뺀다

    target = width or settings.snapshot_width
    with Image.open(io.BytesIO(jpeg)) as img:
        if img.width <= target:
            return jpeg, img.width, img.height
        height = max(1, round(img.height * target / img.width))
        small = img.convert("RGB").resize((target, height), Image.BILINEAR)
        buf = io.BytesIO()
        small.save(buf, format="JPEG", quality=quality or settings.snapshot_quality)
        return buf.getvalue(), target, height


class SnapshotSender:
    """카메라마다 최신 프레임 한 장씩을 주기적으로 올린다."""

    def __init__(self) -> None:
        #: 카메라별로 마지막에 올린 원본 프레임. 같은 것을 또 올리지 않으려고 든다.
        #: 프레임 자체를 들고 있으면 메모리가 카메라 수 × 수백 KB 가 되므로,
        #: 길이와 해시만 쥔다.
        self._last_sent: dict[uuid.UUID, tuple[int, int]] = {}
        self._interval = 0.0
        #: 서버가 받지 못한 이유를 한 번만 적기 위한 표시.
        self._failure_logged: int | None = None

    def interval(self) -> float:
        """지금의 전송 간격(초). 실패가 이어지면 늘어나 있다."""
        return self._interval or settings.snapshot_interval_seconds

    def _fingerprint(self, jpeg: bytes) -> tuple[int, int]:
        """같은 프레임인지 가리는 값. 길이 + 해시로 충분하다.

        이것이 우연히 겹쳐 사진 한 장을 건너뛰어도 다음 주기에 올라간다 —
        감당할 수 있는 손해고, 수백 KB 를 카메라마다 들고 있는 것보다 가볍다.
        """
        return len(jpeg), hash(jpeg)

    async def send_once(self, camera_id: uuid.UUID) -> int | None:
        """이 카메라의 최신 프레임을 한 장 올린다.

        돌려주는 값: 올렸으면 HTTP 상태 코드, 보낼 것이 없으면 None.
        """
        jpeg = frame_store.latest_frame(camera_id)
        if jpeg is None:
            return None
        fingerprint = self._fingerprint(jpeg)
        if self._last_sent.get(camera_id) == fingerprint:
            return None  # 지난번과 같은 프레임 — 카메라가 멈춰 있다

        small, width, height = await asyncio.to_thread(shrink, jpeg)
        latest = frame_store.latest_count(camera_id)
        taken_at = (latest.timestamp if latest else datetime.now(UTC)).astimezone(UTC)
        status = await reporter.send_snapshot(
            str(camera_id),
            small,
            taken_at=taken_at.isoformat(),
            count=latest.count if latest else None,
            length_cm=latest.length_cm if latest else None,
            size=(width, height),
        )
        if status == 200:
            self._last_sent[camera_id] = fingerprint
        return status

    def _note(self, results: list[int]) -> None:
        """실패가 이어지면 간격을 늘리고, 돌아오면 되돌린다."""
        base = settings.snapshot_interval_seconds
        if not results:
            return  # 올릴 것이 없었다 — 성공도 실패도 아니다
        if any(status == 200 for status in results):
            if self._failure_logged is not None:
                logger.info("수조 사진을 다시 올리고 있습니다.")
                self._failure_logged = None
            self._interval = base
            return

        status = results[0]
        if self._failure_logged != status:
            self._failure_logged = status
            if status == 501:
                logger.warning(
                    "서버가 아직 수조 사진을 받지 않습니다 —"
                    " supabase/migrations/vision_snapshot.sql 을 실행하면 웹에서 보입니다."
                    " 개체수는 그대로 올라갑니다."
                )
            else:
                logger.info(
                    "수조 사진을 올리지 못했습니다(%s) — 간격을 늘려 다시 시도합니다."
                    " 개체수는 그대로 올라갑니다.",
                    status or "연결 실패",
                )
        self._interval = min(max(self._interval, base) * BACKOFF_FACTOR, MAX_INTERVAL_SECONDS)

    async def run(self) -> None:
        """주기적으로 돌아 있는 모든 카메라의 사진을 올린다."""
        from app.services.camera_manager import camera_manager  # noqa: PLC0415 - 순환 임포트

        self._interval = settings.snapshot_interval_seconds
        while True:
            await asyncio.sleep(self.interval())
            if not settings.device_key:
                continue  # 아직 수조에 연결되지 않은 장비
            results: list[int] = []
            for camera_id in camera_manager.running_camera_ids():
                try:
                    status = await self.send_once(camera_id)
                except Exception as exc:  # noqa: BLE001 - 사진 한 장이 측정을 멈추면 안 된다
                    logger.debug("사진을 만들지 못했습니다(%s): %s", camera_id, exc)
                    continue
                if status is not None:
                    results.append(status)
            self._note(results)


snapshot_sender = SnapshotSender()


async def run() -> None:
    """모듈 단위 진입점. sync_service.run() 과 같은 모양으로 부르게 둔다."""
    await snapshot_sender.run()


def enabled() -> bool:
    """사진을 올리는 구성인가.

    서버로 올리는 길이 있어야 하고(기기 키 + 주소), 간격이 0 보다 커야 한다.
    DB 에 직접 붙는 배포(도커·서버)에서는 웹과 장비가 같은 망에 있어 영상이
    그냥 열리므로 사진을 밀어 올릴 이유가 없다.
    """
    from app.services.sync_service import enabled as sync_enabled  # noqa: PLC0415

    return sync_enabled() and settings.snapshot_interval_seconds > 0
