"""애플리케이션 설정 로드(.env).

비밀값은 `.env`(커밋 금지)에서 로드하고 예시는 `infra/.env.example` 로 유지한다(CLAUDE Rule 7).
스프린트 0 인증은 users 테이블 없이 대칭키(HS256) JWT 클레임만 사용한다(sprint-0 2.5절).
"""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import TYPE_CHECKING, Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import text

if TYPE_CHECKING:  # pragma: no cover - 타입 전용(런타임 임포트 없음 = 순환 임포트 방지)
    from sqlalchemy.engine import Engine

logger = logging.getLogger("culiver.api")


class Settings(BaseSettings):
    """환경변수 기반 설정. 접두사 없이 그대로 대문자 키를 읽는다."""

    model_config = SettingsConfigDict(
        env_file=(".env", "../../infra/.env", "infra/.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # DB 접속 URL. 로컬/CI 는 sqlite 로 폴백 가능(TimescaleDB 특수기능은 우회 설계).
    database_url: str = "sqlite+pysqlite:///./culiver_dev.db"

    # JWT 대칭키(HS256). 실제 값은 .env 로만 주입, 저장소 커밋 금지.
    jwt_secret: str = "dev-insecure-change-me"
    jwt_algorithm: str = "HS256"

    # 앱 메타
    app_name: str = "culiver-mrv-api"
    environment: str = "development"

    # --- Phase 3 8.4절: CORS. .env 원본은 콤마구분 문자열(list 타입 env 필드는
    # pydantic-settings 가 기본적으로 JSON 디코드를 시도해 "a,b" 형태를 에러로 처리하므로,
    # 단순 str 필드로 받아 아래 프로퍼티에서 직접 split 한다 — 과설계 금지). ---
    cors_allowed_origins_csv: str = Field(
        default="http://localhost:5173", validation_alias="CORS_ALLOWED_ORIGINS"
    )

    # --- Phase 3 8.2절: 구조화 로깅 레벨(app/logging_config.py 에서 사용). ---
    log_level: str = "INFO"

    # --- Phase 3 8.6절: /docs(Swagger UI) 노출 스위치. 기본 True(인증이 최종 방어선이므로
    # 문서 자체를 숨길 필수 이유는 없음 — 필요 시 운영에서 끄는 스위치만 확보). ---
    enable_docs: bool = True

    # --- Phase 3 슬라이스 M(MRV 리포트, 1.8절): PDF 산출물 저장 경로(로컬 파일시스템).
    # docker-compose 볼륨 마운트로 컨테이너 재기동에도 보존(phase-3.md 1.8절). ---
    mrv_reports_dir: str = Field(
        default="/app/var/mrv-reports", validation_alias="MRV_REPORTS_DIR"
    )

    # --- Phase 3 슬라이스 O(Supabase Auth 통합, ADR 0005/docs/design/phase-3-auth.md 2절) ---
    # "test-local" = 기존 대칭키(jwt_secret) 클레임 직접 신뢰 경로(테스트/개발 기본값).
    # "supabase"   = Supabase 발급 HS256 JWT 검증 + users 조회/lazy-link 경로(운영 전용).
    auth_mode: Literal["test-local", "supabase"] = "test-local"
    # Supabase 프로젝트 설정 > API > JWT Secret(레거시 HS256 공유 비밀). auth_mode=supabase 필수.
    supabase_jwt_secret: str = ""
    # 참고용(현재 백엔드 코드는 미사용 — 향후 Admin API 연동 대비 자리만 확보).
    supabase_url: str = ""

    @property
    def cors_allowed_origins(self) -> list[str]:
        """`CORS_ALLOWED_ORIGINS=a,b,c` 콤마구분 문자열 → list[str] 파싱."""
        return [
            origin.strip()
            for origin in self.cors_allowed_origins_csv.split(",")
            if origin.strip()
        ]

    @model_validator(mode="after")
    def _guard_production_auth_mode(self) -> Settings:
        """production 환경의 test-local 노출을 설정 로드 시점에 물리적으로 차단(ADR 0002 동형).

        - production + auth_mode!=supabase → 기동 자체를 막는다(ValueError).
        - auth_mode=supabase 인데 supabase_jwt_secret 이 비어 있으면 즉시 실패(검증 불가 상태
          로 조용히 기동하는 것을 방지).
        """
        if self.environment == "production" and self.auth_mode != "supabase":
            raise ValueError(
                "production 환경에서는 AUTH_MODE=supabase 가 필수다 (ADR 0005)"
            )
        if self.auth_mode == "supabase" and not self.supabase_jwt_secret:
            raise ValueError("AUTH_MODE=supabase 인데 SUPABASE_JWT_SECRET 이 비어 있다")
        return self


@lru_cache
def get_settings() -> Settings:
    """설정 싱글턴. 테스트에서 환경변수 오버라이드 후 캐시 클리어 가능."""
    return Settings()


class InsecureDatabaseRoleError(RuntimeError):
    """앱이 RLS 를 우회하는 DB 역할로 접속했을 때(production) 기동을 막는 예외."""


_ROLE_PRIVILEGE_SQL = (
    "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user"
)


def assert_non_superuser_db_role(engine: Engine, environment: str) -> None:
    """앱 DB 역할이 RLS 를 우회하지 않는지 확인한다(ADR 0007 5절 = D5).

    왜 필요한가:
        Postgres 는 **superuser 에 대해 RLS 를 아예 적용하지 않고**, `BYPASSRLS` 속성 역시
        모든 정책을 무시한다(`FORCE ROW LEVEL SECURITY` 는 테이블 *소유자* 에게만 적용된다).
        따라서 앱이 그런 역할로 접속하면 마이그레이션 0001~0013 이 심은 RLS 정책 전부가
        **0의 보호**가 되고, 멀티테넌시 격리는 서비스 레이어 재검증 하나에만 의존하게 된다
        (CLAUDE Hard Rule 4 의 3중 방어 중 DB 계층이 통째로 사라진다).
        관례("운영에서는 culiver_app 을 쓰기로 했다")가 아니라 기동 시 물리적 강제로 만든다
        — ADR 0002 / ADR 0005 `_guard_production_auth_mode` 와 동형.

    왜 `Settings.model_validator` 가 아니라 이 함수인가(★배치 근거):
        `model_validator` 는 **DB 접속 없이 도는 순수 설정 검증**이다. DB 조회가 필요한 이
        가드를 거기 넣으면 `get_settings()` 호출만으로 커넥션이 열려, 설정만 읽는 테스트·
        alembic env·CLI 스크립트에 부작용(연결 실패로 인한 임포트 에러)이 번진다.
        그래서 순수 함수로 두고 **앱 시작 시점(`main.py` 의 lifespan)** 에서 1회 호출한다.
        lifespan 이 적절한 이유: (1) 실제 요청을 받기 전이라 위반 상태로 트래픽을 처리할
        창이 없다, (2) 예외를 던지면 uvicorn 이 기동을 중단한다(= 물리적 강제), (3) 임포트
        시점이 아니라 실행 시점이라 테스트가 앱을 임포트하는 것만으로 DB 를 건드리지 않는다.

    동작:
        - Postgres 가 아니면(예: SQLite 개발/테스트) no-op. RLS 개념 자체가 없다.
        - `environment == "production"` + 역할이 superuser/BYPASSRLS → `InsecureDatabaseRoleError`.
        - 그 외 환경 → 통과시키되 **경고 로그**. 현재 로컬 개발은 `POSTGRES_USER`(superuser)로
          도는 것이 정상이지만, 그 환경에서 관측한 "RLS 가 잘 동작한다"는 결론은 무효라는
          사실을 눈에 보이게 남긴다.
        - 조회 자체가 실패(DB 미가용 등)하면 production 에서는 **실패로 간주**한다(fail closed).
          "확인할 수 없었으므로 통과"는 DB 를 불안정하게 만드는 것만으로 가드를 우회하는
          경로가 된다. compose 는 이미 `depends_on: db: service_healthy` 로 기동을 게이트하며,
          런타임 중 DB 끊김은 `/ready` 503 이 담당한다(기동 가드와 역할이 다르다).
    """
    if engine.dialect.name not in ("postgresql", "postgres"):
        return

    is_production = environment == "production"
    try:
        with engine.connect() as conn:
            row = conn.execute(text(_ROLE_PRIVILEGE_SQL)).first()
    except Exception as exc:  # noqa: BLE001 - 드라이버별 예외가 다양해 일괄 처리
        message = (
            "DB 역할 권한을 확인하지 못했다(ADR 0007 5절 기동 가드): "
            f"{exc.__class__.__name__}: {exc}"
        )
        if is_production:
            raise InsecureDatabaseRoleError(
                message + " — production 에서는 확인 불가를 통과로 처리하지 않는다(fail closed)."
            ) from exc
        logger.warning("%s — 비 production 이므로 계속 진행한다", message)
        return

    if row is None:
        # current_user 가 pg_roles 에 없는 경우는 정상 Postgres 에서 발생하지 않는다.
        message = "current_user 를 pg_roles 에서 찾지 못했다(ADR 0007 5절 기동 가드)"
        if is_production:
            raise InsecureDatabaseRoleError(message)
        logger.warning("%s — 비 production 이므로 계속 진행한다", message)
        return

    if not (row.rolsuper or row.rolbypassrls):
        return

    detail = (
        f"앱 DB 역할이 RLS 를 우회한다(rolsuper={row.rolsuper}, rolbypassrls={row.rolbypassrls}). "
        "런타임은 NOSUPERUSER NOBYPASSRLS 역할(기본: culiver_app)로 접속해야 한다 — "
        "infra/db/init/10_app_role.sh, ADR 0007 5절."
    )
    if is_production:
        raise InsecureDatabaseRoleError(detail)
    logger.warning(
        "%s 개발 환경이라 기동은 계속하지만, 이 접속으로는 RLS 동작을 검증할 수 없다"
        "(RLS 검증은 make test-rls 로 한다).",
        detail,
    )
