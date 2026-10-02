# syntax=docker/dockerfile:1
# shrimp365 비전 서비스 — 내부 전용 컨테이너.
# 웹 컨테이너(shrimp365)만 이 서비스를 부른다. 호스트에 포트를 열지 않는다.
FROM python:3.11-slim

# OpenCV(headless)와 asyncpg 빌드에 필요한 시스템 패키지.
# fonts-noto-cjk 는 영상 오버레이에 한글 수조 이름을 그리는 데 쓴다 — 없으면
# 카메라 이름이 네모(두부)로 나온다(app/services/rendering.py 참고).
RUN apt-get update && apt-get install -y --no-install-recommends \
        libglib2.0-0 libgl1 \
        fonts-noto-cjk \
        curl \
    && rm -rf /var/lib/apt/lists/*

# uv for fast installs.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

# Install dependencies first for better layer caching.
COPY pyproject.toml ./
RUN uv pip install --system --no-cache ".[ml]"

# App source.
COPY . .

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS http://localhost:8000/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
