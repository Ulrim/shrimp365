#!/usr/bin/env bash
# 필수 마이그레이션을 의존성 순서대로 하나로 합친다.
#
# Supabase SQL Editor 에 한 번에 붙여넣어 실행할 수 있는 _ALL_required.sql 을
# 만든다. 손으로 하나씩 복사하다 순서를 틀리거나 빠뜨리는 일을 없앤다.
#
# 마이그레이션을 고치거나 새로 추가하면 아래 ORDER 에 넣고 이 스크립트를
# 다시 돌린다. 원본이 곧 진실이고 통합본은 그 사본이다.
#
#   bash supabase/build-combined.sh
#
# 카드뉴스 콘텐츠 시드(card_news_seed_*)는 넣지 않는다. 그건 데이터라
# 원하는 것만 골라 넣는 것이고, 스키마와 성격이 다르다.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG="$HERE/migrations"
OUT="$MIG/_ALL_required.sql"

# 실행 순서 — 뒤 파일이 앞 테이블에 기대므로 순서를 지킨다.
ORDER=(
  card_news
  card_news_likes
  board_locale
  board_post_likes
  add_sensor_devices
  sensor_device_identity
  sensor_pairing
  sensor_agent_update
  farm_coordinates
  control_center
  agriculture_mode
  push_subscriptions
)

{
  echo "-- ============================================================"
  echo "-- Shrimp365 통합 마이그레이션 (필수 스키마)"
  echo "--"
  echo "-- ⚠ 이 파일은 supabase/build-combined.sh 가 자동 생성합니다."
  echo "--   직접 고치지 마세요. 원본은 migrations/ 의 개별 파일입니다."
  echo "--"
  echo "-- Supabase SQL Editor 에 전체를 붙여넣고 한 번 실행하세요."
  echo "-- 모두 재실행 안전(멱등)이라 이미 실행한 것이 섞여 있어도 됩니다."
  echo "-- 순서: 카드뉴스 → 게시판 → 센서 → 좌표 → 관제센터 → 농업 모드 → 웹푸시"
  echo "-- ============================================================"
  echo
  for f in "${ORDER[@]}"; do
    if [ ! -f "$MIG/$f.sql" ]; then
      echo "원본이 없습니다: $f.sql" >&2
      exit 1
    fi
    echo
    echo "-- ==================== $f.sql ===================="
    cat "$MIG/$f.sql"
    echo
  done
} > "$OUT"

echo "만들었습니다: ${OUT#"$HERE"/}  ($(wc -l < "$OUT")줄, ${#ORDER[@]}개 병합)"
