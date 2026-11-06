"""audit — 제어/설정 변경 감사 기록 헬퍼(Rule 9).

모든 제어/설정 변경(baseline lock, 수기입력 등)은 audit_logs 에 diff 를 남긴다.
호출자는 열린 세션/트랜잭션 안에서 record_audit 를 호출하고, 커밋은 호출자가 수행한다
(변경과 감사를 단일 트랜잭션으로 원자화하기 위함).
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog


def record_audit(
    session: Session,
    *,
    org_id: str,
    actor_id: str,
    entity: str,
    entity_id: str,
    action: str,
    diff: dict[str, Any],
    note: str | None = None,
) -> AuditLog:
    """audit_logs 1행 삽입(flush 까지). 커밋은 호출자가 담당한다.

    diff 는 {before, after} 형태를 권장(생성은 before=None).
    """
    log = AuditLog(
        id=f"audit-{uuid4().hex}",
        org_id=org_id,
        actor_id=actor_id,
        entity=entity,
        entity_id=entity_id,
        action=action,
        diff_json=diff,
        note=note,
    )
    session.add(log)
    session.flush()
    return log
