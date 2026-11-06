#!/usr/bin/env bash
# 가동률 집계 SQL 을 **진짜 PostgreSQL** 에 올려 답이 맞는지 본다.
#
# 왜 이 점검이 있나
# -----------------
# supabase/migrations/vision_uptime.sql 은 사람이 SQL Editor 에 붙여 넣는
# 파일이다. 틀려도 타입 검사나 빌드가 잡아 주지 않고, 현장에서는 "가동률
# 84.7%" 같은 그럴듯한 숫자로 나온다 — 틀린 줄 모른 채 증빙 서류에 들어간다.
# 그래서 답을 **미리 아는** 자료를 넣고 숫자를 맞춰 본다.
#
#   가 10초마다 빠짐없이        → 100%
#   나 중간에 610초 구멍        → 84.72%, 정지 1회
#   다 앞 30분만                → 51.39%
#   라 한 줄도 없음             → 0%  (목록에서 빠지지 않아야 한다)
#   마 주기가 10~13초로 흔들림  → 100%  (줄 수로 세면 90% 아래로 떨어진다)
#
# 쓰고 버리는 클러스터를 임시 디렉터리에 세우므로 어떤 데이터베이스도 건드리지
# 않는다. 끝나면 지운다.
#
# 실행 (저장소 뿌리에서):
#
#     ./scripts/check-vision-uptime-sql.sh
#
# 필요한 것: PostgreSQL 16 (initdb·pg_ctl·psql). 우분투라면
#
#     sudo apt-get install -y postgresql-16
#
# CI 에는 넣지 않았다 — 데이터베이스 서버가 필요해 다른 검사와 함께 돌릴 수 없다.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATION="$ROOT/supabase/migrations/vision_uptime.sql"
FIXTURES="$ROOT/scripts/fixtures/vision-uptime"

# ── 도구 찾기 ────────────────────────────────────────────────────────────────
PGBIN=""
for candidate in /usr/lib/postgresql/16/bin /usr/lib/postgresql/*/bin /usr/local/pgsql/bin; do
  if [ -x "$candidate/initdb" ]; then PGBIN="$candidate"; break; fi
done
if [ -z "$PGBIN" ] && command -v initdb >/dev/null 2>&1; then
  PGBIN="$(dirname "$(command -v initdb)")"
fi
if [ -z "$PGBIN" ]; then
  echo "PostgreSQL 을 찾지 못했습니다. sudo apt-get install -y postgresql-16" >&2
  exit 1
fi

# ── 어느 계정으로 돌릴까 ─────────────────────────────────────────────────────
# postgres 는 root 로 뜨지 않는다. root 로 불렀다면 평범한 계정을 하나 빌린다.
RUN_AS=""
if [ "$(id -u)" -eq 0 ]; then
  for account in pgtest postgres nobody; do
    if id "$account" >/dev/null 2>&1; then RUN_AS="$account"; break; fi
  done
  if [ -z "$RUN_AS" ]; then
    echo "root 로는 PostgreSQL 을 띄울 수 없습니다. 일반 계정으로 실행하세요." >&2
    exit 1
  fi
fi

WORK="$(mktemp -d)"
cleanup() {
  run "$PGBIN/pg_ctl -D $WORK/data -m immediate stop" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

run() {  # 한 명령을 (필요하면) 빌린 계정으로 돌린다
  if [ -n "$RUN_AS" ]; then su "$RUN_AS" -c "$1"; else sh -c "$1"; fi
}

cp "$MIGRATION" "$WORK/vision_uptime.sql"
cp "$FIXTURES/fixture.sql" "$FIXTURES/checks.sql" "$WORK/"
if [ -n "$RUN_AS" ]; then chown -R "$RUN_AS" "$WORK"; fi
chmod 711 "$WORK"

echo "PostgreSQL 을 임시로 띄웁니다 ($PGBIN)…"
run "$PGBIN/initdb -D $WORK/data -U postgres --locale=C --encoding=UTF8" >/dev/null 2>&1
run "$PGBIN/pg_ctl -D $WORK/data -o \"-k $WORK -c listen_addresses=''\" -l $WORK/log start" >/dev/null
for _ in $(seq 1 30); do
  if run "$PGBIN/psql -h $WORK -U postgres -tAc 'select 1'" >/dev/null 2>&1; then break; fi
  sleep 1
done

PSQL="$PGBIN/psql -h $WORK -U postgres"
run "$PSQL -q -v ON_ERROR_STOP=1 -f $WORK/fixture.sql"
run "$PSQL -q -v ON_ERROR_STOP=1 -f $WORK/vision_uptime.sql" 2>&1 | grep -v '^NOTICE' || true

OUTPUT="$(run "$PSQL -f $WORK/checks.sql" 2>&1 | grep -v '^CREATE FUNCTION\|^Output format')"
echo "$OUTPUT"

if echo "$OUTPUT" | grep -q 'FAIL'; then
  echo
  echo "$(echo "$OUTPUT" | grep -c 'FAIL')건 실패했습니다."
  exit 1
fi
echo
echo "전부 통과했습니다 — $(echo "$OUTPUT" | grep -c '  ok ')건."
