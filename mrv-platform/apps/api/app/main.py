"""FastAPI 앱 엔트리 + OpenAPI(/docs).

스프린트 0 수직 슬라이스: GET /sites/{site_id}/kpi 만 노출.
phase-3 슬라이스 N(프로덕션 준비성, docs/design/phase-3.md 8절)에서 상용화 필수 항목을
보강했다: CORS(8.4절), /ready 헬스체크(8.3절), 구조화 로깅(8.2절), 전역 예외 핸들러(8.5절),
/docs 노출 스위치(8.6절).

헬스체크:
  - GET /health : liveness(프로세스 생존만, DB 미조회) — docker-compose 헬스체크 기본값.
  - GET /ready  : readiness(DB `SELECT 1` 확인) — DB 연결 끊김을 잡아내려면 이쪽을 써야 함.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.config import assert_non_superuser_db_role, get_settings
from app.db.session import engine
from app.logging_config import configure_logging
from app.routers import alerts as alerts_router
from app.routers import audit_logs as audit_logs_router
from app.routers import auth as auth_router
from app.routers import baseline as baseline_router
from app.routers import batches as batches_router
from app.routers import comparison as comparison_router
from app.routers import control_actions as control_actions_router
from app.routers import emission_factors as emission_factors_router
from app.routers import ingest as ingest_router
from app.routers import kpi as kpi_router
from app.routers import kpi_snapshots as kpi_snapshots_router
from app.routers import logs as logs_router
from app.routers import meters as meters_router
from app.routers import mrv_reports as mrv_reports_router
from app.routers import onboarding as onboarding_router
from app.routers import organizations as organizations_router
from app.routers import readings as readings_router
from app.routers import recommendations as recommendations_router
from app.routers import sites as sites_router
from app.routers import sop as sop_router

settings = get_settings()

configure_logging(settings.log_level)
logger = logging.getLogger("culiver.api")


@asynccontextmanager
async def _lifespan(_app: FastAPI) -> AsyncIterator[None]:
    logger.info(
        "culiver-mrv-api starting: app=%s env=%s docs=%s cors_origins=%d",
        settings.app_name,
        settings.environment,
        settings.enable_docs,
        len(settings.cors_allowed_origins),
    )
    # ADR 0007 5절(D5) 기동 가드: 앱 DB 역할이 RLS 를 우회하면(production) 기동을 중단한다.
    # 여기(lifespan)에 두는 이유는 config.assert_non_superuser_db_role docstring 참조 —
    # 요약: DB 조회가 필요한 검증을 Settings 검증기에 넣으면 설정 로드만으로 커넥션이 열려
    # 테스트/alembic 에 부작용이 번진다. 실행 시점 1회 확인이 옳은 자리다.
    assert_non_superuser_db_role(engine, settings.environment)
    yield
    logger.info("culiver-mrv-api shutting down")


app = FastAPI(
    title="컬리버 MRV API",
    description=(
        "컬리버 통합관리 + 탄소 MRV 플랫폼 백엔드(스프린트 0). "
        "KPI 산식은 packages/kpi 에서만 정의하며 API 는 호출만 한다(Rule 1)."
    ),
    version="0.1.0",
    # 8.6절: 인증(Bearer JWT)이 최종 방어선이므로 문서 자체를 숨길 필수 이유는 없다.
    # 필요 시 운영에서 끄는 스위치만 확보(ENABLE_DOCS=false).
    docs_url="/docs" if settings.enable_docs else None,
    redoc_url="/redoc" if settings.enable_docs else None,
    lifespan=_lifespan,
)

# 8.4절(P0): CORS 미들웨어. 배포된 FE가 API 와 다른 오리진이면 브라우저가 차단하므로 필수.
# allow_credentials=False 인 이유: 인증은 Authorization 헤더의 Bearer JWT 방식이며 쿠키
# 자격증명을 쓰지 않는다. credentials=True 는 CSRF 공격 표면을 넓히고 allow_origins="*" 와도
# 함께 쓸 수 없게 되므로(브라우저 스펙상 금지), Bearer 전용 구조에서는 얻는 이득 없이 위험만
# 늘어난다 — False 로 고정한다(운영 배포에서도 CORS_ALLOWED_ORIGINS 는 와일드카드 금지, 실제
# FE 도메인만 명시).
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(auth_router.router)
app.include_router(kpi_router.router)
app.include_router(baseline_router.router)
app.include_router(logs_router.router)
app.include_router(batches_router.router)
app.include_router(ingest_router.router)
app.include_router(readings_router.router)
app.include_router(alerts_router.router)
app.include_router(comparison_router.router)
app.include_router(recommendations_router.router)
app.include_router(organizations_router.router)
app.include_router(emission_factors_router.router)
app.include_router(mrv_reports_router.router)
app.include_router(kpi_snapshots_router.router)
app.include_router(sop_router.router)
app.include_router(meters_router.router)
app.include_router(sites_router.router)
app.include_router(onboarding_router.router)
app.include_router(control_actions_router.router)
app.include_router(audit_logs_router.router)


@app.get("/health", tags=["meta"], summary="헬스체크(liveness)")
def health() -> dict:
    """컨테이너 헬스체크용 단순 응답. DB 는 조회하지 않는다(빠른 liveness)."""
    return {"status": "ok", "app": settings.app_name, "env": settings.environment}


@app.get("/ready", tags=["meta"], summary="헬스체크(readiness, DB 연결 확인)")
def ready() -> JSONResponse:
    """`SELECT 1` 로 DB 연결을 확인. 실패 시 503(컨테이너는 떠 있으나 DB 미가용 상태)."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        logger.warning("readiness check failed: db unavailable")
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"status": "not_ready", "detail": f"database unavailable: {exc.__class__.__name__}"},
        )
    return JSONResponse(status_code=status.HTTP_200_OK, content={"status": "ready"})


@app.exception_handler(Exception)
def _unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """미처리 예외를 기존 `{"detail": "..."}` 봉투로 통일(8.5절, OWASP A05).

    HTTPException(및 그 서브클래스)은 starlette 기본 핸들러가 먼저 처리하므로 이 핸들러에는
    도달하지 않는다 — 여기 도달하는 것은 순수 예기치 못한 예외뿐이다. 트레이스백/내부
    구현은 응답에 노출하지 않고 서버 로그에만 남긴다.
    """
    logger.error("unhandled exception", exc_info=exc, extra={"path": str(request.url)})
    return JSONResponse(status_code=500, content={"detail": "internal server error"})
