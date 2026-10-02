"""기기 페어링 — 6자리 코드로 이 장비를 계정에 붙인다.

수질 센서 파이(raspberry-pi/shrimp365_sensor.py)와 같은 방식이다. 현장에서
긴 키를 설정 파일에 옮겨 적는 것이 가장 큰 걸림돌이라, TV·셋톱박스처럼
코드를 계정 주인이 승인하게 한다.

  1. 이 서비스가 shrimp365 에 코드를 요청한다 → 로그에 6자리 코드를 띄운다
  2. 농가가 로그인한 상태에서 개체수 → 설정에서 코드를 입력하고 수조를 고른다
  3. 이 서비스가 폴링하다가 기기 키를 받아 상태 파일에 저장한다

받은 키는 환경변수가 아니라 상태 파일에 적는다 — 서비스가 자기 설정 파일을
고치면 배포 도구가 덮어쓸 때 신원이 사라진다.

승인 전까지 이 장비는 아무 카메라도 맡지 않는다(camera_manager.owns_camera).
"""
from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

from app.config import settings

logger = logging.getLogger(__name__)

# 코드 유효 시간(서버 기준 15분)에 맞춰 폴링한다.
POLL_INTERVAL_SECONDS = 5
POLL_DEADLINE_SECONDS = 15 * 60


def board_serial() -> str:
    """라즈베리파이 CPU 시리얼. 보드마다 고정이라 기기 식별에 쓴다.

    수질 센서 파이의 board_serial() 과 같은 값을 읽는다 — 같은 보드를 두
    시스템이 다르게 부르면 현장에서 대조할 수 없다.
    """
    try:
        for line in Path("/proc/cpuinfo").read_text().splitlines():
            if line.startswith("Serial"):
                return line.split(":")[1].strip()
    except OSError:
        pass
    # 라즈베리파이가 아닌 환경(개발용 PC 등)에서도 값이 있도록.
    try:
        return Path("/etc/machine-id").read_text().strip()[:16]
    except OSError:
        return "unknown"


def _state_path() -> Path:
    return Path(settings.device_state_path)


def load_device_key() -> str | None:
    """저장된 기기 키. 없으면 None."""
    if settings.device_key:
        return settings.device_key  # 환경변수가 우선
    try:
        data = json.loads(_state_path().read_text())
    except (OSError, ValueError):
        return None
    key = data.get("device_key")
    return str(key) if key else None


def save_device_key(key: str, camera_id: str | None, tank_name: str | None) -> bool:
    path = _state_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                {"device_key": key, "camera_id": camera_id, "tank_name": tank_name},
                ensure_ascii=False,
            )
        )
        # 기기 키가 들어 있으므로 권한을 좁힌다.
        path.chmod(0o600)
        return True
    except OSError as exc:
        logger.error("기기 키를 저장하지 못했습니다: %s (권한을 확인하세요)", exc)
        return False


async def _post_json(client, url: str, payload: dict) -> tuple[int, dict]:
    try:
        res = await client.post(url, json=payload)
        return res.status_code, (res.json() if res.content else {})
    except Exception as exc:  # noqa: BLE001 - 네트워크는 무엇이든 터진다
        logger.debug("페어링 요청 실패: %s", exc)
        return 0, {}


async def _get_json(client, url: str) -> tuple[int, dict]:
    try:
        res = await client.get(url)
        return res.status_code, (res.json() if res.content else {})
    except Exception as exc:  # noqa: BLE001
        logger.debug("페어링 확인 실패: %s", exc)
        return 0, {}


async def run_pairing(version: str = "1.0.0") -> str | None:
    """코드를 받아 로그에 띄우고, 승인될 때까지 기다린다.

    성공하면 기기 키를 돌려주고 상태 파일에도 저장한다. 실패하면 None —
    호출부는 서비스를 계속 띄우되 카메라를 맡지 않는다(그래야 /health 로
    상태를 볼 수 있고, 사용자가 다시 시도할 수 있다).
    """
    base = settings.shrimp365_internal_url.rstrip("/")
    if not base:
        logger.error(
            "SHRIMP365_URL 이 없어 페어링을 시작할 수 없습니다 — "
            "예: https://www.shrimp365.kr"
        )
        return None

    try:
        import httpx
    except ImportError:
        logger.error("httpx 가 없어 페어링을 할 수 없습니다.")
        return None

    pair_url = f"{base}/api/vision/pair"
    serial = board_serial()

    async with httpx.AsyncClient(timeout=10) as client:
        status, data = await _post_json(
            client,
            pair_url,
            {
                "serial": serial,
                "firmware": f"vision-{version}",
                # 브라우저가 이 장비의 영상에 붙을 주소. 승인 때 카메라 행에
                # 적혀, 파이가 여러 대여도 각 카메라가 제 장비로 연결된다.
                "public_url": settings.vision_public_url or None,
            },
        )
        if status != 200 or "code" not in data:
            reason = data.get("error") or (
                "인터넷 연결을 확인하세요" if not status else f"서버 오류 {status}"
            )
            # 여기서 자동으로 반복하면 요청 제한에 걸린다. 사유를 남기고 멈춘다.
            logger.error("연결 코드를 받지 못했습니다: %s", reason)
            return None

        code = str(data["code"])
        secret = data["pairing_secret"]
        logger.warning(
            "───────────────────────────────────────────────\n"
            "  연결 코드: %s\n"
            "  shrimp365 에 로그인해 개체수 → 설정에서 이 코드를 입력하세요.\n"
            "  (시리얼 %s · 15분간 유효)\n"
            "───────────────────────────────────────────────",
            " ".join(code),
            serial,
        )

        loop = asyncio.get_running_loop()
        deadline = loop.time() + POLL_DEADLINE_SECONDS
        while loop.time() < deadline:
            await asyncio.sleep(POLL_INTERVAL_SECONDS)
            status, info = await _get_json(client, f"{pair_url}?secret={secret}")
            state = info.get("status")

            if state == "linked":
                key = info.get("device_key")
                tank = info.get("tank_name") or "(이름 없음)"
                logger.warning("연결 완료 — 수조: %s", tank)
                if key:
                    save_device_key(key, info.get("camera_id"), info.get("tank_name"))
                    return str(key)
                return None

            if state in ("expired", "not_found", "revoked"):
                logger.info("코드가 만료되었습니다. 서비스를 다시 시작하면 새 코드를 받습니다.")
                return None

    logger.info("승인 대기 시간이 지났습니다. 서비스를 다시 시작하면 새 코드를 받습니다.")
    return None


async def ensure_device_key(version: str = "1.0.0") -> str | None:
    """기기 키를 확보한다. 이미 있으면 그대로, 없으면 페어링을 돌린다."""
    key = load_device_key()
    if key:
        settings.device_key = key
        return key

    logger.warning("아직 연결되지 않은 장비입니다. 연결 코드를 받습니다…")
    key = await run_pairing(version)
    if key:
        settings.device_key = key
    return key
