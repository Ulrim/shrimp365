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
    # shrimp365 주소. 두 곳에 쓴다 — 경보 웹푸시를 되부를 때, 그리고 기기
    # 페어링 때. 같은 호스트에 있으면 컨테이너 내부 주소, 파이면 공개 주소다.
    # 비워 두면 푸시와 페어링만 건너뛰고 나머지는 그대로 돈다.
    shrimp365_internal_url: str = Field(
        default="",
        validation_alias=AliasChoices("SHRIMP365_URL", "SHRIMP365_INTERNAL_URL"),
    )

    # 이 장비의 기기 키. 페어링(6자리 코드 승인) 때 발급되어 vision_cameras 의
    # api_key 와 짝을 이룬다. 이 값으로 "내 카메라"를 알아본다.
    #
    # 왜 필요한가: CSI 카메라는 보드에 리본으로 직접 붙어 있어 그 보드에서만
    # 열 수 있다. 신원이 없으면 모든 장비가 DB 의 모든 카메라를 열려 들고,
    # 남의 카메라를 잡지 못해 영원히 재시도한다.
    #
    # 보통은 환경변수가 아니라 페어링이 채운다(app/services/pairing.py 가
    # 상태 파일에 적는다). 환경변수로 주면 그쪽이 우선한다.
    device_key: str = Field(
        default="", validation_alias=AliasChoices("VISION_DEVICE_KEY", "DEVICE_KEY")
    )

    # 이 장비의 공개 주소. 브라우저가 영상과 실시간 연결을 여기로 직접 붙는다.
    # 파이가 여러 대면 각자 다른 주소를 갖는다(vision-1/vision-2…).
    # 페어링과 살아 있음 보고 때 shrimp365 에 알려 카메라 행에 적힌다.
    vision_public_url: str = Field(default="")

    # 페어링으로 받은 기기 키를 보관하는 곳. systemd 의 StateDirectory 가
    # 만들어 주는 자리다. 환경변수를 다시 쓰지 않는 이유는 서비스가 자기
    # 설정 파일을 고치면 배포 도구와 어긋나기 때문이다.
    device_state_path: str = Field(default="/var/lib/shrimp365-vision/device.json")

    # AI model
    model_path: str = Field(default="./ai/models/shrimp_yolov8n.pt")
    confidence_threshold: float = Field(default=0.25)
    # NMS IoU. 겹쳐 있는 새우를 하나로 합쳐 버리면 과소 계수가 되므로, 겹침이
    # 심한 수조에서는 올려 본다(ai/trainer/eval_count.py --iou 로 먼저 확인).
    nms_iou_threshold: float = Field(default=0.7)
    # 추론 해상도. 0 이면 모델에 적힌 값을 쓴다. 파이 4 에서 속도가 급하면
    # 416/320 으로 내보낸 ONNX 를 쓴다(ai/trainer/export_edge.py --imgsz).
    model_imgsz: int = Field(default=0)
    # 한 프레임에서 셀 수 있는 최대 개체 수. ultralytics 기본값은 300 인데,
    # 밀식 수조는 한 화면에 그보다 많이 잡힐 수 있어 그대로 두면 **조용히
    # 300 에서 잘린다**(과소 계수인데 오류가 없어 알아채기 어렵다).
    max_detections: int = Field(default=1000)
    # ONNX Runtime 스레드 수. 0 이면 런타임 기본값(코어 수 전부). 파이 4 에서
    # 다른 작업과 코어를 나눠 써야 하면 2~3 으로 제한한다.
    inference_threads: int = Field(default=0)
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
    if settings.model_path.lower().endswith(".onnx"):
        # 파이에서는 torch/ultralytics 없이 onnxruntime 만 깔고 돌린다.
        # 여기서 ultralytics 를 요구하면 실제 모델이 있어도 시뮬레이션으로
        # 떨어져 버린다.
        try:  # pragma: no cover - depends on optional edge extra
            import onnxruntime  # noqa: F401
        except ImportError:
            return True
        return False
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
