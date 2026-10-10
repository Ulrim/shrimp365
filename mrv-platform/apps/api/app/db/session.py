"""SQLAlchemy 2.0 세션 + org_id 컨텍스트(멀티테넌시 DB 계층 방어).

sprint-0 2.3절 3중 방어의 2번째 계층:
- 세션에 org_id 를 바인딩하면 Postgres RLS 정책이
  `org_id = current_setting('app.current_org_id')` 로 강제된다.
- sqlite(테스트/로컬 폴백)는 RLS/SET LOCAL 을 지원하지 않으므로 GUC 적용은 조용히 무시한다
  (TimescaleDB/Postgres 특수기능 우회 설계 — 격리는 서비스 레이어 재검증으로도 보장).

★ org 컨텍스트의 수명 계약(ADR 0007 2절):
`set_config(..., is_local => true)`(= `SET LOCAL`)는 **트랜잭션 스코프**라 `commit()` 순간
소실된다. 그 상태로 커밋 뒤에 이어지는 SELECT 는 0행이 되고 INSERT 는 RLS 위반으로 거부되며,
ORM 은 `expire_on_commit=True` 기본값 탓에 커밋 후 속성 접근만으로 `ObjectDeletedError` 를
낸다(실측: ADR 0007 D3).
반대로 세션 스코프 GUC(`is_local=false`)는 **더 나쁘다** — 커넥션 풀에 GUC 가 남아 다음 요청이
이전 테넌트 컨텍스트를 물려받는다(Hard Rule 4 정면 위반).
따라서 org_id 를 `Session.info` 에 바인딩하고 **매 트랜잭션 시작(`after_begin`)마다 GUC 를
재적용**한다. 커밋/롤백 경계가 호출부에 투명해지므로 개별 라우터가 "커밋 후 다시 걸기"를
기억할 필요가 없다(ADR 0002 의 "관례가 아니라 물리적 강제" 철학 동형 적용).
`expire_on_commit` 은 기본값(True) 그대로 둔다 — 이 수정으로 커밋 후 재조회가 정상 동작하므로
바꿀 이유가 없고, 바꾸면 저장소 전역 ORM 시맨틱이 변한다(ADR 0007 2절 명시).
"""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings

_settings = get_settings()

# sqlite 는 단일 연결/스레드 이슈가 있어 check_same_thread=False 를 준다.
_connect_args = {}
if _settings.database_url.startswith("sqlite"):
    _connect_args = {"check_same_thread": False}

engine = create_engine(
    _settings.database_url,
    connect_args=_connect_args,
    future=True,
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)

# `Session.info` 에 org_id 를 담는 키(ADR 0007 2절 계약).
_ORG_CONTEXT_KEY = "culiver_org_id"

_SET_ORG_GUC = text("SELECT set_config('app.current_org_id', :org_id, true)")


def _is_postgres() -> bool:
    return engine.dialect.name in ("postgresql", "postgres")


@event.listens_for(Session, "after_begin")
def _reapply_org_context(session: Session, transaction, connection) -> None:
    """모든 트랜잭션 시작 시 org GUC 재적용 — SET LOCAL 은 커밋 시 소실된다(ADR 0007 2절).

    리스너는 `Session` 클래스 전역에 걸린다. 향후 별도 엔진/세션을 도입하면 동일 규약을
    따라야 한다(sqlite 는 `_is_postgres()` 가드로 자동 무해).
    org_id 가 바인딩되지 않은 세션(인증 조회용 unscoped 세션 등)은 그대로 컨텍스트 없이 둔다 —
    "컨텍스트를 잊으면 조용히 전 테넌트가 보이는" 모델은 ADR 0007 대안 (c) 로 기각됐다.
    """
    if not _is_postgres():
        return
    org_id = session.info.get(_ORG_CONTEXT_KEY)
    if org_id is None:
        return
    connection.execute(_SET_ORG_GUC, {"org_id": org_id})


def set_org_context(session: Session, org_id: str) -> None:
    """세션 수명 전체에 현재 org_id 를 바인딩(RLS 강제용).

    - `session.info` 에 기록 → 이후 모든 트랜잭션에서 `after_begin` 이 GUC 를 재적용한다.
      (sqlite 에서도 기록한다 — 테스트가 바인딩 여부를 관찰할 수 있도록.)
    - Postgres 에서는 **이미 열려 있는 트랜잭션에도 즉시 적용**한다(세션 중간 바인딩 =
      `deps._lazy_link` 경로). `set_config` 는 멱등이므로 재호출은 안전하다.
    - sqlite 등 RLS 미지원 백엔드에서 GUC 적용은 no-op(서비스 레이어 재검증이 격리를 보장).
    """
    session.info[_ORG_CONTEXT_KEY] = org_id
    if not _is_postgres():
        return
    session.execute(_SET_ORG_GUC, {"org_id": org_id})


def get_session() -> Iterator[Session]:
    """요청 스코프 세션 제공(FastAPI Depends).

    org_id 바인딩은 인증 의존성(deps.get_db_with_org)에서 수행한다.
    """
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
