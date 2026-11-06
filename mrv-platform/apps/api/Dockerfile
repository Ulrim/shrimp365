# 컬리버 MRV API 컨테이너 (FastAPI, Python 3.12).
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# 시스템 의존성(psycopg 빌드 등 최소 + MRV 리포트 PDF 파이프라인 — WeasyPrint 런타임
# 의존, ADR 0004 4절. Chromium 관련 패키지·브라우저 다운로드는 불필요).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl \
        libpango-1.0-0 \
        libpangocairo-1.0-0 \
        libcairo2 \
        libgdk-pixbuf-2.0-0 \
        libffi8 \
        shared-mime-info \
        fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# KPI 패키지(로컬 경로 의존성)를 먼저 복사·설치 → 캐시 효율.
# 빌드 컨텍스트는 repo 루트를 기대한다(docker-compose 참조).
COPY packages/kpi /packages/kpi
RUN pip install /packages/kpi

# API 의존성 설치.
COPY apps/api/pyproject.toml /app/pyproject.toml
RUN pip install \
    "fastapi>=0.110" "uvicorn[standard]>=0.27" "sqlalchemy>=2.0" \
    "alembic>=1.13" "pydantic>=2.6" "pydantic-settings>=2.1" \
    "pyjwt>=2.8" "psycopg[binary]>=3.1" "apscheduler>=3.10" \
    "jinja2>=3.1" "weasyprint>=61"

# 앱 소스 + 마이그레이션.
COPY apps/api /app
COPY infra/migrations /app/migrations
COPY infra/alembic.ini /app/alembic.ini

# MRV 리포트 PDF 저장 디렉터리(MRV_REPORTS_DIR 기본값, docker-compose 볼륨 마운트 대상).
RUN mkdir -p /app/var/mrv-reports

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
    CMD curl -fsS http://localhost:8000/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
