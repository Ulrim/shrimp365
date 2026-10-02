"""경보 엔진 — vision_alert_configs 를 들어오는 개체수에 견준다.

판정 규칙(원본 계약 그대로):
- threshold   : 개체수가 threshold_value 미만
- count_drop  : 최근 평균 대비 threshold_pct% 이상 감소
- count_spike : 최근 평균 대비 threshold_pct% 이상 증가
- offline     : OFFLINE_TIMEOUT_SECONDS 동안 프레임 없음 (워치독이 부른다)

원본과 달라진 것 두 가지:

1. **경보를 shrimp365 알림함(alerts)에 적는다.** 자체 alert_history 를 두지
   않는다. 그래야 헤더 알림함·웹푸시·관제센터가 수질 경보와 똑같이 다룬다.

2. **복합 경보** — 개체수 급감과 용존산소 급락이 같은 시간대에 겹치면 따로
   난 두 경보로 두지 않고 긴급 한 건으로 올린다. 개체수만 줄면 먹이 시간이나
   구석에 몰린 것일 수 있지만, 용존산소가 같이 떨어졌다면 폐사가 진행 중일
   가능성이 높다. 두 데이터가 한 DB 에 모였기에 가능해진 판정이다.

중복 억제: 같은 (수조, parameter) 의 미해결 알림이 있으면 다시 만들지 않는다.
지속되는 상태가 초당 한 줄씩 쌓이면 알림함이 못 쓰게 된다.
"""
from __future__ import annotations

import asyncio
import html
import logging
import smtplib
import time
import uuid
from datetime import datetime, timedelta
from email.message import EmailMessage
from typing import TYPE_CHECKING

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import utcnow
from app.models import AlertConfig, CountRecord, ShrimpAlert
from app.models.water_quality import WaterQualityReading
from app.services.broadcaster import broadcaster

if TYPE_CHECKING:
    from app.services.stream_service import CameraSnapshot

logger = logging.getLogger(__name__)

DEFAULT_DROP_PCT = 30.0
DEFAULT_SPIKE_PCT = 50.0
CONFIG_CACHE_TTL = 15.0

# 복합 경보 판정값. 개체수 급감 시점을 기준으로 이만큼 거슬러 올라가
# 용존산소가 이 비율 이상 떨어졌는지 본다.
COMPOUND_WINDOW_MINUTES = 60
COMPOUND_DO_DROP_PCT = 15.0

# shrimp365 alerts.parameter 에 적는 키. 수질 항목(temperature·ph…)과 같은
# 자리라 접두사로 구분한다. 사람이 읽을 이름은 화면 쪽 PARAM_LABELS 에 있다.
# 중복 억제도 이 키 단위로 도므로, 종류가 다른 경보는 서로를 막지 않는다.
PARAMETERS = {
    "count_drop": "shrimp_count_drop",
    "count_spike": "shrimp_count_spike",
    "threshold": "shrimp_count_low",
    "offline": "shrimp_camera_offline",
    "compound": "shrimp_count_do_critical",
}

# 알림 심각도. 개체수가 늘어난 것은 위험이 아니고(warning), 카메라가 끊긴 것도
# 새우 자체의 위험은 아니다. 줄어든 쪽만 danger 로 올린다.
SEVERITIES = {
    "count_drop": "danger",
    "count_spike": "warning",
    "threshold": "danger",
    "offline": "warning",
    "compound": "danger",
}


class AlertService:
    def __init__(self) -> None:
        self._config_cache: tuple[float, list[AlertConfig]] | None = None

    def invalidate_config_cache(self) -> None:
        self._config_cache = None

    async def _enabled_configs(self, session: AsyncSession) -> list[AlertConfig]:
        now = time.monotonic()
        if self._config_cache and now - self._config_cache[0] < CONFIG_CACHE_TTL:
            return self._config_cache[1]
        result = await session.execute(
            select(AlertConfig).where(AlertConfig.is_enabled.is_(True))
        )
        configs = list(result.scalars())
        self._config_cache = (now, configs)
        return configs

    # -- evaluation --------------------------------------------------------------
    async def process_count(
        self,
        session: AsyncSession,
        camera: CameraSnapshot,
        count: int,
        timestamp: datetime,
    ) -> list[ShrimpAlert]:
        configs = [
            c
            for c in await self._enabled_configs(session)
            if c.camera_id is None or c.camera_id == camera.id
        ]
        if not configs:
            return []

        triggered: list[ShrimpAlert] = []
        rolling_avg: float | None = None
        for config in configs:
            if config.alert_type == "threshold":
                if config.threshold_value is not None and count < config.threshold_value:
                    message = (
                        f"[임계값 경보] {camera.name}: 개체수 {count}마리가 설정 임계값 "
                        f"{config.threshold_value:.0f}마리 미만입니다."
                    )
                    alert = await self._trigger(
                        session,
                        config,
                        camera,
                        "threshold",
                        message,
                        timestamp,
                        value=count,
                        threshold=config.threshold_value,
                    )
                    if alert:
                        triggered.append(alert)

            elif config.alert_type in ("count_drop", "count_spike"):
                if rolling_avg is None:
                    rolling_avg = await self._rolling_average(
                        session, camera.id, timestamp, config.window_minutes
                    )
                if rolling_avg is None or rolling_avg <= 0:
                    continue
                pct = config.threshold_pct or (
                    DEFAULT_DROP_PCT if config.alert_type == "count_drop" else DEFAULT_SPIKE_PCT
                )
                change_pct = (count - rolling_avg) / rolling_avg * 100
                if config.alert_type == "count_drop" and change_pct <= -pct:
                    # 용존산소가 같이 떨어졌는지부터 본다. 겹쳤다면 개체수
                    # 경보로 따로 내지 않고 긴급 복합 경보 한 건으로 올린다.
                    do_drop = await self._recent_do_drop_pct(
                        session, camera.tank_id, timestamp
                    )
                    if do_drop is not None and do_drop >= COMPOUND_DO_DROP_PCT:
                        message = (
                            f"[긴급·복합] {camera.name}: 최근 {config.window_minutes}분 평균 "
                            f"{rolling_avg:.0f}마리 대비 {count}마리로 {abs(change_pct):.0f}% "
                            f"감소했고, 같은 시간대에 용존산소도 {do_drop:.0f}% 떨어졌습니다. "
                            f"폐사가 진행 중일 수 있습니다 — 즉시 확인하세요."
                        )
                        kind = "compound"
                    else:
                        message = (
                            f"[개체수 급감] {camera.name}: 최근 {config.window_minutes}분 평균 "
                            f"{rolling_avg:.0f}마리 대비 {count}마리로 {abs(change_pct):.0f}% "
                            f"감소했습니다. 수조 상태를 확인하세요."
                        )
                        kind = "count_drop"
                    alert = await self._trigger(
                        session,
                        config,
                        camera,
                        kind,
                        message,
                        timestamp,
                        value=count,
                        threshold=rolling_avg,
                    )
                    if alert:
                        triggered.append(alert)
                elif config.alert_type == "count_spike" and change_pct >= pct:
                    message = (
                        f"[개체수 급증] {camera.name}: 최근 {config.window_minutes}분 평균 "
                        f"{rolling_avg:.0f}마리 대비 {count}마리로 {change_pct:.0f}% "
                        f"증가했습니다."
                    )
                    alert = await self._trigger(
                        session,
                        config,
                        camera,
                        "count_spike",
                        message,
                        timestamp,
                        value=count,
                        threshold=rolling_avg,
                    )
                    if alert:
                        triggered.append(alert)
        return triggered

    async def trigger_offline(self, session: AsyncSession, camera: CameraSnapshot) -> None:
        configs = [
            c
            for c in await self._enabled_configs(session)
            if c.alert_type == "offline" and (c.camera_id is None or c.camera_id == camera.id)
        ]
        message = f"[카메라 오프라인] {camera.name}: 카메라 연결이 끊어졌습니다."
        for config in configs:
            await self._trigger(session, config, camera, "offline", message, utcnow())

    async def _rolling_average(
        self,
        session: AsyncSession,
        camera_id: uuid.UUID,
        timestamp: datetime,
        window_minutes: int,
    ) -> float | None:
        window_start = timestamp - timedelta(minutes=window_minutes)
        result = await session.execute(
            select(func.avg(CountRecord.count)).where(
                CountRecord.camera_id == camera_id,
                CountRecord.time >= window_start,
                CountRecord.time < timestamp,
            )
        )
        avg = result.scalar()
        return float(avg) if avg is not None else None

    async def _recent_do_drop_pct(
        self, session: AsyncSession, tank_id: uuid.UUID, timestamp: datetime
    ) -> float | None:
        """최근 한 시간 동안 용존산소가 몇 % 떨어졌는가.

        구간의 **최고값 대비 마지막값**으로 본다. 평균 대비로 보면 이미
        떨어진 값들이 평균을 끌어내려 급락을 못 잡는다.

        수질 값이 없거나(센서 미설치) 한 점뿐이면 None — 판정을 포기한다.
        여기서 실패해도 개체수 경보 자체는 그대로 나가야 하므로 예외는
        올리지 않고 호출부가 None 을 일반 경보로 다룬다.
        """
        window_start = timestamp - timedelta(minutes=COMPOUND_WINDOW_MINUTES)
        rows = (
            await session.execute(
                select(WaterQualityReading.do_level, WaterQualityReading.recorded_at)
                .where(
                    WaterQualityReading.tank_id == tank_id,
                    WaterQualityReading.recorded_at >= window_start,
                    WaterQualityReading.recorded_at <= timestamp,
                    WaterQualityReading.do_level.is_not(None),
                )
                .order_by(WaterQualityReading.recorded_at)
            )
        ).all()
        values = [float(r[0]) for r in rows if r[0] is not None]
        if len(values) < 2:
            return None
        peak = max(values)
        if peak <= 0:
            return None
        latest = values[-1]
        return max(0.0, (peak - latest) / peak * 100)

    # -- persistence + notification ------------------------------------------------
    async def _trigger(
        self,
        session: AsyncSession,
        config: AlertConfig,
        camera: CameraSnapshot,
        kind: str,
        message: str,
        timestamp: datetime,
        value: float | None = None,
        threshold: float | None = None,
    ) -> ShrimpAlert | None:
        parameter = PARAMETERS[kind]
        severity = SEVERITIES[kind]

        # 중복 억제: 같은 수조·항목의 미해결 알림이 있으면 새로 만들지 않는다.
        existing = await session.execute(
            select(ShrimpAlert.id)
            .where(
                ShrimpAlert.tank_id == camera.tank_id,
                ShrimpAlert.parameter == parameter,
                ShrimpAlert.resolved.is_(False),
            )
            .limit(1)
        )
        if existing.scalar() is not None:
            return None

        alert = ShrimpAlert(
            tank_id=camera.tank_id,
            type=severity,
            parameter=parameter,
            value=value,
            threshold=threshold,
            message=message,
            resolved=False,
            created_at=timestamp,
        )
        session.add(alert)
        await session.commit()

        await broadcaster.publish(
            {
                "type": "alert",
                "camera_id": str(camera.id),
                "tank_id": str(camera.tank_id),
                "alert_type": kind,
                "severity": severity,
                "message": message,
                "timestamp": timestamp.isoformat(),
            }
        )
        await self._notify(config, camera, severity, parameter, message)
        logger.warning("ALERT triggered: %s", message)
        return alert

    async def _notify(
        self,
        config: AlertConfig,
        camera: CameraSnapshot,
        severity: str,
        parameter: str,
        message: str,
    ) -> None:
        # 웹푸시는 shrimp365 가 보낸다 — VAPID 키와 구독 정보가 거기 있다.
        await self._push_via_shrimp365(camera, severity, parameter, message)
        if config.notify_email:
            await self._send_email(config.notify_email, message)
        if config.notify_webhook:
            await self._post_webhook(config.notify_webhook, message)

    @staticmethod
    async def _push_via_shrimp365(
        camera: CameraSnapshot, severity: str, parameter: str, message: str
    ) -> None:
        """shrimp365 의 내부 알림 경로로 웹푸시를 부탁한다.

        실패해도 삼킨다 — 알림 전달이 안 됐다고 추론 루프가 멈추면 안 되고,
        경보 자체는 이미 alerts 에 적혀 화면에서 보인다.
        """
        if not settings.shrimp365_internal_url or not settings.vision_service_key:
            return
        try:
            import httpx

            async with httpx.AsyncClient(timeout=5) as client:
                await client.post(
                    f"{settings.shrimp365_internal_url.rstrip('/')}/api/vision/notify",
                    headers={"X-Vision-Key": settings.vision_service_key},
                    json={
                        "tank_id": str(camera.tank_id),
                        "type": severity,
                        "parameter": parameter,
                        "message": message,
                    },
                )
        except ImportError:
            logger.info("[push] httpx 미설치 — 웹푸시를 건너뜁니다.")
        except Exception as exc:  # noqa: BLE001 - 알림은 best effort
            logger.warning("[push] 전달 실패: %s", exc)

    async def _send_email(self, to_address: str, message: str) -> None:
        """SMTP (STARTTLS) alert email. Never raises into the stream loop."""
        if not settings.smtp_user or not settings.smtp_password:
            # SMTP not configured — keep the previous log-and-skip behaviour.
            logger.info(
                "[notify_email skipped] SMTP_USER/SMTP_PASSWORD not set; to=%s message=%s",
                to_address,
                message,
            )
            return
        try:
            email = build_alert_email(to_address, message)
            await asyncio.to_thread(self._smtp_send, email)
            logger.info("[notify_email] delivered to %s", to_address)
        except Exception as exc:  # noqa: BLE001 - notification is best effort
            logger.warning("[notify_email] delivery to %s failed: %s", to_address, exc)

    @staticmethod
    def _smtp_send(email: EmailMessage) -> None:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
            smtp.ehlo()
            smtp.starttls()
            smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(email)

    @staticmethod
    async def _post_webhook(url: str, message: str) -> None:
        try:
            import httpx  # dev/optional dependency; degrade to logging

            async with httpx.AsyncClient(timeout=5) as client:
                await client.post(url, json={"text": message})
            logger.info("[notify_webhook] delivered to %s", url)
        except ImportError:
            logger.info("[notify_webhook stub] httpx not installed; would POST to %s", url)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[notify_webhook] delivery to %s failed: %s", url, exc)


def build_alert_email(to_address: str, message: str) -> EmailMessage:
    """Korean-language alert email: plain text + simple HTML alternative."""
    email = EmailMessage()
    email["Subject"] = "[shrimp365] 개체수 모니터링 경보"
    email["From"] = settings.alert_email_from or settings.smtp_user
    email["To"] = to_address
    email.set_content(
        "shrimp365 개체수 경보\n"
        "======================\n\n"
        f"{message}\n\n"
        "대시보드에서 실시간 영상과 개체수 추이를 확인하세요.\n\n"
        f"- {settings.company_name} shrimp365 자동 발송 메일입니다.\n"
    )
    safe_message = html.escape(message)
    email.add_alternative(
        "<html><body style=\"font-family: sans-serif;\">"
        "<h2 style=\"color:#c0392b;\">shrimp365 개체수 경보</h2>"
        f"<p style=\"font-size:15px;\">{safe_message}</p>"
        "<p>대시보드에서 실시간 영상과 개체수 추이를 확인하세요.</p>"
        f"<hr><p style=\"color:#888;font-size:12px;\">{html.escape(settings.company_name)} "
        "shrimp365 자동 발송 메일입니다.</p>"
        "</body></html>",
        subtype="html",
    )
    return email


alert_service = AlertService()
