"""Application configuration loaded from environment variables.

All settings come from the environment (see ../.env.example). No hardcoded
secrets.

shrimp365 통합판 — 원본(ShrimpVision 단독 서비스)과 달라진 것:
  · 자체 로그인이 없다. `secret_key` 는 토큰 발급용이 아니라 shrimp365 가
    서명한 스트림 토큰을 **검증**하는 데만 쓴다.
  · `database_url` 은 shrimp365 의 Supabase Postgres 를 가리킨다. 개체수는
    수질과 같은 DB 에 쌓여야 통합 조회가 조인 한 번으로 끝난다.
"""
from __future__ import annotations

import os
from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database / cache
    # Supabase 연결 문자열(asyncpg 드라이버). 세션 풀러 주소를 쓴다.
    database_url: str = Field(
        default="postgresql+asyncpg://postgres:change-me@db:5432/postgres"
    )
    redis_url: str = Field(default="redis://redis:6379/0")

    # ── 인증 ────────────────────────────────────────────────
    # 서버 간 호출용 공유 키. shrimp365 의 API 라우트가 X-Vision-Key 헤더로
    # 보낸다. 이 서비스는 외부에 직접 노출하지 않는다.
    vision_service_key: str = Field(default="")
    # MJPEG·WebSocket 서명 토큰 검증용 비밀키. shrimp365 의
    # VISION_STREAM_SECRET 과 **같은 값**이어야 한다. 두 서비스가 같은 이름의
    # 환경변수를 읽도록 별칭을 명시한다 — 필드 이름만 두면 여기서는
    # STREAM_SECRET 을 찾게 되어, 이름이 어긋난 채 조용히 빈 값으로 뜬다.
    stream_secret: str = Field(
        default="",
        validation_alias=AliasChoices("VISION_STREAM_SECRET", "STREAM_SECRET"),
    )
    # 경보를 웹푸시로 내보낼 때 되부르는 shrimp365 주소(컨테이너 내부).
    # 비워 두면 푸시만 건너뛰고 경보는 그대로 alerts 에 적힌다.
    shrimp365_internal_url: str = Field(default="")

    # AI model
    model_path: str = Field(default="./ai/models/shrimp_yolov8n.pt")
    confidence_threshold: float = Field(default=0.25)
    inference_fps: int = Field(default=1)
    max_cameras: int = Field(default=16)
    # ByteTrack-style tracking for dedup counting (falls back to plain
    # detection per camera if the tracker raises).
    use_tracking: bool = Field(default=True)
    # EMA smoothing factor for the "stable count" fed to the alert engine
    # (0 < alpha <= 1; lower = smoother). Raw counts are stored/broadcast.
    count_smoothing_alpha: float = Field(default=0.3)

    # Simulation / runtime behaviour
    # simulation_mode: None => auto-detect (on when the YOLO model file is
    # missing or ultralytics is not importable).
    simulation_mode: bool | None = Field(default=None)
    # auto_start_streams: None => auto (true when simulation mode is active).
    auto_start_streams: bool | None = Field(default=None)
    offline_timeout_seconds: int = Field(default=30)

    # Streaming
    mjpeg_quality: int = Field(default=75)
    frame_buffer_size: int = Field(default=5)

    # Email notifications (SMTP + STARTTLS). Sending is skipped (log-only)
    # while SMTP_USER or SMTP_PASSWORD is empty.
    smtp_host: str = Field(default="smtp.gmail.com")
    smtp_port: int = Field(default=587)
    smtp_user: str = Field(default="")
    smtp_password: str = Field(default="")
    alert_email_from: str = Field(default="")  # falls back to SMTP_USER

    # Dev / misc
    company_name: str = Field(default="주식회사 컬리버")
    debug: bool = Field(default=False)
    log_level: str = Field(default="INFO")
    # shrimp365 웹 컨테이너에서만 부른다. 브라우저가 직접 오지는 않지만,
    # 개발 중 http://localhost:3000 에서 붙어 보는 경우를 위해 남긴다.
    cors_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:3000"]
    )


settings = Settings()


@lru_cache(maxsize=1)
def simulation_mode_active() -> bool:
    """Resolve the effective simulation mode.

    Explicit SIMULATION_MODE env wins; otherwise auto-on when the YOLO model
    file is missing or ultralytics cannot be imported.

    학습된 모델이 아직 없으므로 기본값은 사실상 시뮬레이션이다. 이 모드가
    있어야 카메라·모델 없이도 전체 화면과 경보를 시연할 수 있다.
    """
    if settings.simulation_mode is not None:
        return settings.simulation_mode
    if not os.path.exists(settings.model_path):
        return True
    try:  # pragma: no cover - depends on optional ml extra
        import ultralytics  # noqa: F401
    except ImportError:
        return True
    return False


def auto_start_streams_active() -> bool:
    """AUTO_START_STREAMS defaults to true in simulation mode."""
    if settings.auto_start_streams is not None:
        return settings.auto_start_streams
    return simulation_mode_active()
