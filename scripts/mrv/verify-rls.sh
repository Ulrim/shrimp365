#!/usr/bin/env bash
# MRV 스키마 방어선 검증 — 임시 Postgres 를 띄워 마이그레이션을 실제로 적용하고
# 테넌트 격리(Hard Rule 4) · 기준선 불변성(ADR 0002) · 승인 게이트를 시험한다.
#
# 사용:  bash scripts/mrv/verify-rls.sh
# 요구:  postgresql-16 클라이언트/서버 바이너리, postgres 계정으로 initdb 가능한 환경.
#        (Supabase 에 접속하지 않는다 — 운영 DB 를 건드리지 않고 검증하기 위함이다.)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGDATA="${PGDATA:-/var/tmp/mrv-verify-pg}"
PGPORT="${PGPORT:-55432}"
export PATH="$PATH:$PGBIN"

cleanup() {
  su postgres -c "$PGBIN/pg_ctl -D $PGDATA stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$PGDATA"
}
trap cleanup EXIT

rm -rf "$PGDATA"; mkdir -p "$PGDATA"; chown postgres "$PGDATA"; chmod 700 "$PGDATA"
su postgres -c "$PGBIN/initdb -D $PGDATA -U postgres --auth=trust" >/dev/null
su postgres -c "$PGBIN/pg_ctl -D $PGDATA -o '-k /tmp -p $PGPORT -c listen_addresses=' -l $PGDATA/log start" >/dev/null
for _ in $(seq 1 30); do
  psql -h /tmp -p "$PGPORT" -U postgres -tc "select 1" >/dev/null 2>&1 && break
  sleep 1
done

PSQL="psql -h /tmp -p $PGPORT -U postgres -d mrvtest -v ON_ERROR_STOP=1"
psql -h /tmp -p "$PGPORT" -U postgres -q -c "create database mrvtest;"
$PSQL -q -f "$ROOT/scripts/mrv/supabase-auth-stub.sql"
$PSQL -q -f "$ROOT/supabase/migrations/mrv_platform.sql"

# NOTICE: 접두사를 떼고 PASS/FAIL 줄만 남긴다.
RESULT="$($PSQL -f "$ROOT/scripts/mrv/verify-rls.sql" 2>&1 \
  | sed -E 's/^.*NOTICE:  //' | grep -E '^(PASS|FAIL)' || true)"
echo "$RESULT"

if echo "$RESULT" | grep -q FAIL; then
  echo
  echo "✗ MRV 스키마 방어선 검증 실패 — 위 FAIL 항목을 확인할 것"
  exit 1
fi
echo
echo "✓ MRV 스키마 방어선 검증 통과 — $(echo "$RESULT" | grep -c PASS)개 항목"
