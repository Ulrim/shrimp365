"""users/api_keys RLS 명령 분할 정책 — ADR 0007 1절(인증 조회 정합성).

문제: 인증 조회는 본질적으로 "org 를 알기 전에 읽어야" 하는데, `org_isolation_users` /
`org_isolation_api_keys`(암묵적 `FOR ALL`)는 "org 를 알아야 읽을 수 있다"고 요구한다.
그 결과 org 컨텍스트 없는 세션에서
  - `SELECT ... FROM users WHERE supabase_user_id = <JWT sub>` → 0행 → 로그인 403
  - `SELECT ... FROM api_keys WHERE key_hash = <sha256>`        → 0행 → 수집 401
이 된다(ADR 0007 D1/D2 실측).

해결: 읽기와 쓰기를 분리한다. 두 테이블의 `FOR ALL` 정책을 **명령별 4개 정책**으로 교체한다.
  - `{table}_select_open`  : `FOR SELECT USING (true)` — DB 계층 개방(안전 근거는 ADR 0007 1-1절
    전수 조사: 두 테이블 모두 목록/검색 노출 엔드포인트가 없고, 읽기 경로는 전역 유니크 키의
    정확 매칭 5곳뿐이다).
  - `{table}_insert_org` / `_update_org` / `_delete_org` : **쓰기는 org 스코프 물리 강제 유지**.
    이 시스템에서 가장 값비싼 공격(피해 org 에 role='owner' users 행을 삽입해 테넌트 탈취)을
    막는 방어선이므로 절대 버리지 않는다(ADR 0007 1-2절 — 단순 RLS 해제안 기각 근거).

`ENABLE / FORCE ROW LEVEL SECURITY` 는 **그대로 유지**한다(끄지 않는다 — 위 쓰기 정책이
테이블 소유자에게도 강제되어야 하기 때문).
다른 17개 RLS 테이블은 손대지 않는다(전부 org 를 안 뒤에 접근하므로 `FOR ALL` 이 옳다).

비교식 문자열은 기존 마이그레이션(0002/0012)과 동일하게
`org_id = current_setting('app.current_org_id', true)` 로 쓴다(일관성).
sqlite(테스트/로컬 폴백)는 RLS 미지원이므로 전부 no-op(0002 폴백 관례 동일).
downgrade 는 원래의 `FOR ALL` 정책을 정확히 복원한다.

Revision ID: 0013_rls_auth_lookup_policies
Revises: 0012_control_actions
Create Date: 2026-08-29
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0013_rls_auth_lookup_policies"
down_revision: Union[str, None] = "0012_control_actions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# 인증 조회(org 를 알기 전) 대상 테이블 — 이 둘만 명령 분할한다.
_AUTH_LOOKUP_TABLES = ("users", "api_keys")

_ORG_MATCH = "org_id = current_setting('app.current_org_id', true)"


def _is_postgres() -> bool:
    return op.get_bind().dialect.name in ("postgresql", "postgres")


def upgrade() -> None:
    if not _is_postgres():
        return
    for table in _AUTH_LOOKUP_TABLES:
        # ENABLE/FORCE ROW LEVEL SECURITY 는 건드리지 않는다(0002 상태 유지).
        op.execute(f"DROP POLICY IF EXISTS org_isolation_{table} ON {table}")
        # 읽기: org 를 알기 전 인증 조회 허용(ADR 0007 1-1절).
        op.execute(f"CREATE POLICY {table}_select_open ON {table} FOR SELECT USING (true)")
        # 쓰기: org 스코프 물리 강제 유지(권한 상승 방어선).
        op.execute(
            f"""
            CREATE POLICY {table}_insert_org ON {table} FOR INSERT
            WITH CHECK ({_ORG_MATCH})
            """
        )
        op.execute(
            f"""
            CREATE POLICY {table}_update_org ON {table} FOR UPDATE
            USING ({_ORG_MATCH})
            WITH CHECK ({_ORG_MATCH})
            """
        )
        op.execute(
            f"""
            CREATE POLICY {table}_delete_org ON {table} FOR DELETE
            USING ({_ORG_MATCH})
            """
        )


def downgrade() -> None:
    if not _is_postgres():
        return
    for table in _AUTH_LOOKUP_TABLES:
        for suffix in ("select_open", "insert_org", "update_org", "delete_org"):
            op.execute(f"DROP POLICY IF EXISTS {table}_{suffix} ON {table}")
        # 0002/0012 와 문자열까지 동일한 FOR ALL 정책으로 정확히 복원.
        op.execute(
            f"""
            CREATE POLICY org_isolation_{table} ON {table}
            USING ({_ORG_MATCH})
            WITH CHECK ({_ORG_MATCH})
            """
        )
