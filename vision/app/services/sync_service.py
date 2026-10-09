"""로컬 기록을 shrimp365 와 맞춘다 — 장비가 DB 비밀번호를 들지 않게 하는 쪽.

두 방향이 있다.

  내려받기  내가 맡은 카메라와 수조를 받아 로컬 DB 에 적는다. 그래야
            camera_manager 가 평소처럼 로컬에서 읽어 카메라를 띄운다.
  올려보내기 아직 안 보낸 개체수를 기기 키로 올린다.

**회선이 끊겨도 잃지 않는다.** 측정값은 먼저 로컬 파일에 적히고, 올라간
지점(워터마크)만 따로 기억한다. 회선이 돌아오면 그 뒤부터 다시 보낸다.
메모리가 아니라 파일이라 재부팅해도 남는다.

서버는 같은 (카메라, 시각) 을 덮어쓰므로 두 번 보내도 행이 늘지 않는다 —
끊김 전후가 겹쳐도 기록이 부풀지 않는다.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import delete, func, select

from app.version import VERSION
from app.config import server_sync_mode, settings
from app.database import SessionLocal
from app.models import Camera, CountRecord, Farm, Tank
from app.services.reporter import BATCH_SIZE, reporter

logger = logging.getLogger(__name__)

#: 맞추는 주기(초). 개체수는 10초마다 한 줄이라 30초면 서너 줄씩 올라간다.
SYNC_INTERVAL_SECONDS = 30

#: 서버에 보고하는 프로그램 버전. 값은 app/version.py 한 곳에서만 정한다
#: (원격 업데이트가 VERSION 파일을 바꾸면 그대로 따라간다).
AGENT_VERSION = VERSION


def _watermark_path() -> Path:
    """어디까지 올렸는지 적어 두는 자리. 기기 키 파일 옆에 둔다."""
    return Path(settings.device_state_path).with_name("sync-watermark.json")


def read_watermark() -> datetime | None:
    try:
        raw = json.loads(_watermark_path().read_text())
        return datetime.fromisoformat(raw["sent_through"])
    except (OSError, ValueError, KeyError):
        return None


def write_watermark(when: datetime) -> None:
    try:
        _watermark_path().write_text(json.dumps({"sent_through": when.isoformat()}))
    except OSError as exc:
        # 못 적으면 다음에 같은 구간을 다시 보낸다. 서버가 덮어쓰므로 기록이
        # 틀어지지는 않는다 — 손해는 통신 한 번뿐이라 서비스를 멈추지 않는다.
        logger.debug("워터마크를 적지 못했습니다: %s", exc)


async def pull_assignment() -> int:
    """내가 맡은 카메라·수조를 받아 로컬 DB 에 반영한다. 반영한 카메라 수."""
    data = await reporter.fetch_assignment()
    if data is None:
        return 0

    cameras = data.get("cameras") or []
    async with SessionLocal() as session:
        for row in cameras:
            try:
                cam_id = uuid.UUID(str(row["id"]))
                tank_id = uuid.UUID(str(row["tank_id"]))
                farm_id = uuid.UUID(str(row["farm_id"]))
            except (KeyError, ValueError):
                continue  # 서버가 준 모양이 어긋나면 그 줄만 건너뛴다

            # 외래키가 걸려 있어 양식장·수조가 먼저 있어야 한다. 이름 정도만
            # 들고 있으면 되고, 진짜 원본은 서버다.
            if not await session.get(Farm, farm_id):
                session.add(Farm(id=farm_id, user_id=uuid.uuid4(), name="(서버)"))
            if not await session.get(Tank, tank_id):
                session.add(Tank(id=tank_id, farm_id=farm_id, name=row.get("tank_name") or "수조"))
            await session.flush()

            camera = await session.get(Camera, cam_id)
            if camera is None:
                camera = Camera(id=cam_id, tank_id=tank_id, name=row.get("name") or "카메라")
                session.add(camera)
            camera.tank_id = tank_id
            camera.name = row.get("name") or camera.name
            camera.camera_type = row.get("camera_type") or camera.camera_type
            camera.stream_url = row.get("stream_url")
            camera.resolution_w = int(row.get("resolution_w") or camera.resolution_w)
            camera.resolution_h = int(row.get("resolution_h") or camera.resolution_h)
            camera.fps_target = float(row.get("fps_target") or camera.fps_target)
            camera.is_active = bool(row.get("is_active", True))
            camera.api_key = settings.device_key
        await session.commit()
    return len(cameras)


async def push_counts() -> int:
    """아직 안 올린 개체수를 올린다. 올린 건수.

    **보낸 만큼만 워터마크를 올린다.** 한때 메모리에 따로 쌓아 두고 올렸는데,
    한 번에 500건만 보내면서 워터마크는 읽어 온 전체만큼 올라갔다. 재부팅하면
    그 차이가 "올린 것"으로 남아 영구히 건너뛰어졌다 — 끊겼다 붙은 장비에서
    조용히 기록이 비는 길이다. 보관함은 장비 안의 DB 하나뿐이어야 한다.
    """
    since = read_watermark()
    async with SessionLocal() as session:
        stmt = select(CountRecord).order_by(CountRecord.time)
        if since is not None:
            stmt = stmt.where(CountRecord.time > since)
        rows = list((await session.execute(stmt.limit(BATCH_SIZE))).scalars())

    if not rows:
        _set_backlog(0)
        return 0

    counts = [
        {
            "camera_id": str(r.camera_id),
            "time": (r.time if r.time.tzinfo else r.time.replace(tzinfo=UTC)).isoformat(),
            "count": r.count,
            "confidence_avg": r.confidence_avg,
            "model_version": r.model_version,
            "inference_ms": r.inference_ms,
            "length_cm": r.length_cm,
        }
        for r in rows
    ]
    if not await reporter.send_counts(counts, agent_version=AGENT_VERSION):
        await _refresh_backlog()
        return 0  # 다음 주기에 다시 — 워터마크를 올리지 않는다
    write_watermark(rows[-1].time)
    await _refresh_backlog()
    return len(rows)


#: 올린 뒤에도 장비에 남겨 두는 기간(일).
#:
#: 원본은 서버에 있다 — 장비는 거쳐 가는 자리다. 안 지우면 10초마다 한 줄씩
#: 1년이면 300만 줄이 SD 카드에 쌓인다. 카드는 쓰기로 닳아 죽는 부품이고,
#: 농장에서 그걸 들여다보는 사람은 없다.
LOCAL_KEEP_DAYS = 7

#: 몇 번 맞출 때마다 한 번 지울지. 30초 주기이므로 약 한 시간에 한 번.
PRUNE_EVERY = 120


async def prune_local() -> int:
    """이미 올린 기록 중 오래된 것을 지운다. 지운 건수.

    기준선은 **워터마크보다 뒤**로 잡는다. 아직 못 올린 줄은 어떤 경우에도
    지우지 않는다 — 그걸 지우면 서버에도 없고 장비에도 없게 된다.
    """
    since = read_watermark()
    if since is None:
        return 0  # 한 번도 올린 적이 없다 — 지울 것이 없다
    cutoff = since - timedelta(days=LOCAL_KEEP_DAYS)
    async with SessionLocal() as session:
        result = await session.execute(delete(CountRecord).where(CountRecord.time < cutoff))
        await session.commit()
    removed = result.rowcount or 0
    if removed:
        logger.info("장비에 쌓인 오래된 개체수 %d건을 지웠습니다(원본은 서버).", removed)
    return removed


#: 아직 못 올린 기록 수. 장비 화면이 "서버 끊김 · N건 보관"으로 보여 준다.
#: 화면은 동기 함수에서 상태를 만들어 DB 를 기다릴 수 없으므로, 맞춤 주기마다
#: 여기에 적어 둔 값을 읽는다.
_backlog = 0


def backlog() -> int:
    return _backlog


def _set_backlog(n: int) -> None:
    global _backlog
    _backlog = n


async def _refresh_backlog() -> None:
    since = read_watermark()
    try:
        async with SessionLocal() as session:
            stmt = select(func.count()).select_from(CountRecord)
            if since is not None:
                stmt = stmt.where(CountRecord.time > since)
            _set_backlog(int((await session.execute(stmt)).scalar() or 0))
    except Exception as exc:  # noqa: BLE001 - 표시용 숫자가 측정을 멈추면 안 된다
        logger.debug("보관 건수를 세지 못했습니다: %s", exc)


async def run() -> None:
    """주기적으로 양쪽을 맞춘다. 연결되기 전에는 아무것도 하지 않는다.

    **먼저 한 번 맞추고 나서 쉰다.** 뒤로 미루면, 꺼진 동안 웹에서 바꾼 것
    (카메라 이름·해상도·켜고 끔)이 재부팅 후에도 30초간 옛 값으로 돌고,
    끊긴 채 꺼졌다 켜진 장비는 밀린 기록을 30초 더 쥐고 있는다.
    """
    tick = 0
    while True:
        if settings.device_key:  # 아직 수조에 연결되지 않은 장비는 건너뛴다
            with contextlib.suppress(Exception):  # 맞춤 실패가 측정을 멈추면 안 된다
                await pull_assignment()
            with contextlib.suppress(Exception):
                await push_counts()
            if tick % PRUNE_EVERY == 0:
                with contextlib.suppress(Exception):
                    await prune_local()
            tick += 1
        await asyncio.sleep(SYNC_INTERVAL_SECONDS)


def enabled() -> bool:
    """서버로 올리는 구성인가. DATABASE_URL 을 직접 준 배포에서는 끈다."""
    return server_sync_mode() and bool(settings.shrimp365_internal_url.strip())
