"""구조화 로깅(stdlib 만 사용, 외부 의존성 없음) — phase-3 8.2절.

과설계 금지 원칙: 외부 로그 수집기/포맷터 패키지를 도입하지 않고 stdlib
`logging.Formatter` 서브클래스로 최소 JSON 한 줄 로그만 만든다. 컨테이너는 stdout 으로만
출력하고 수집은 도커/오케스트레이터에 위임한다(Grafana 등 연동은 범위 밖).

**비밀값·JWT 원문·PII(email 등)는 절대 로그에 남기지 않는다**(OWASP A09/A02 교차 원칙).
호출부는 이 원칙을 지켜 `extra=` 로 안전한 필드만 덧붙여야 한다.
"""

from __future__ import annotations

import json
import logging
import sys

# LogRecord 표준 속성(이 이름들은 extra 로 들어와도 별도 필드로 다루지 않고 그대로 둔다 —
# 표준 속성과 겹치는 extra 키는 logging 자체가 이미 예약어로 막는다).
_RESERVED = frozenset(logging.LogRecord(
    "", 0, "", 0, "", (), None,
).__dict__.keys()) | {"message", "asctime"}


class JsonLogFormatter(logging.Formatter):
    """1줄 JSON 로그 포맷터. 타임스탬프/레벨/로거명/메시지 + 안전한 extra 필드만 포함."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        # 호출부가 extra= 로 넘긴 커스텀 필드만 추가(표준 LogRecord 속성 제외).
        for key, value in record.__dict__.items():
            if key not in _RESERVED:
                payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


def configure_logging(level: str = "INFO") -> None:
    """루트 로거를 JSON 포맷 + stdout 핸들러로 구성.

    앱/워커 기동 시 1회 호출. `logging.basicConfig` 대신 명시적으로 핸들러를 구성해
    (uvicorn 등이 이미 basicConfig 를 호출했더라도) 포맷이 확실히 적용되게 한다.
    """
    root = logging.getLogger()
    resolved_level = getattr(logging, level.upper(), logging.INFO)
    root.setLevel(resolved_level)

    handler = logging.StreamHandler(stream=sys.stdout)
    handler.setFormatter(JsonLogFormatter())

    # 중복 핸들러 방지(재호출/리로드 대비).
    root.handlers.clear()
    root.addHandler(handler)
