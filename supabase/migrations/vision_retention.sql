-- 개체수 기록 보존 기간 — Supabase SQL Editor 에서 한 번 실행하세요.
--
-- 왜 필요한가
-- -----------
-- count_records 는 지우는 사람이 없으면 끝없이 쌓인다. 장비가 10초마다 한 줄을
-- 적으므로 카메라 한 대가 하루 8,640행, 1년이면 약 315만 행이다. Supabase
-- 무료 구간은 500MB 라, 그냥 두면 언젠가 꽉 차고 **그때 수질 기록까지 같이
-- 멈춘다** — 조용히 진행되고 알아차렸을 때는 이미 늦다.
--
-- 지워도 되는 이유: 화면이 보여 주는 것은 구간 집계(1분·1시간·1일)다. 1년 전
-- 어느 10초의 개체수를 다시 보는 일은 없다. 길게 보관하고 싶다면 아래
-- RETENTION_DAYS 를 늘리거나, 지우기 전에 일 단위로 접어 두는 표를 따로
-- 만들면 된다(맨 아래 참고).
--
-- 이 파일은 **되돌릴 수 있는 것부터** 한다: 함수만 만들고, 실제 삭제는
-- 사람이 부르거나 pg_cron 이 부를 때만 일어난다.

-- ---------------------------------------------------------------------------
-- 1. 지우는 함수
-- ---------------------------------------------------------------------------
-- 한 번에 다 지우지 않고 끊어서 지운다. 수백만 행을 한 트랜잭션으로 지우면
-- 잠금이 길어져 그동안 장비의 쓰기가 밀린다.
create or replace function public.vision_prune_count_records(
  p_days          integer default 180,
  p_batch_size    integer default 50000,
  p_max_batches   integer default 100
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff   timestamptz := now() - make_interval(days => p_days);
  v_deleted  bigint := 0;
  v_round    bigint;
  i          integer := 0;
begin
  if p_days < 7 then
    raise exception '보존 기간이 너무 짧습니다(%일). 최소 7일로 두세요.', p_days;
  end if;

  loop
    i := i + 1;
    exit when i > p_max_batches;

    with doomed as (
      select camera_id, time
      from public.count_records
      where time < v_cutoff
      limit p_batch_size
    )
    delete from public.count_records c
    using doomed d
    where c.camera_id = d.camera_id and c.time = d.time;

    get diagnostics v_round = row_count;
    v_deleted := v_deleted + v_round;
    exit when v_round = 0;
  end loop;

  return v_deleted;
end;
$$;

comment on function public.vision_prune_count_records is
  '개체수 기록에서 p_days 보다 오래된 행을 끊어서 지운다. 지운 행 수를 돌려준다.';

-- 아무나 부르지 못하게 한다. 아래 pg_cron 또는 SQL Editor 에서만 쓴다.
-- anon·authenticated 는 Supabase 의 롤이라 다른 Postgres 에는 없다. 없는
-- 롤에 revoke 를 걸면 거기서 오류가 나고, SQL Editor 에서는 그 뒤가 통째로
-- 안 돈 것처럼 보인다. 있는 롤에만 건다.
revoke all on function public.vision_prune_count_records(integer, integer, integer)
  from public;

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'revoke all on function public.vision_prune_count_records(integer, integer, integer) from %I',
        r
      );
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. 얼마나 쌓였는지 먼저 보기 (지우기 전에 확인하세요)
-- ---------------------------------------------------------------------------
--   select count(*) as 전체행,
--          min(time) as 가장_오래된,
--          pg_size_pretty(pg_total_relation_size('public.count_records')) as 크기
--     from public.count_records;

-- ---------------------------------------------------------------------------
-- 3. 한 번 지워 보기
-- ---------------------------------------------------------------------------
--   select public.vision_prune_count_records(180);   -- 180일 이전 삭제
--
-- **지운 직후에는 표 크기가 그대로 보입니다.** Postgres 는 지운 자리를 바로
-- 돌려주지 않고 다음 쓰기에 재사용합니다. 자동 청소(autovacuum)가 알아서
-- 하므로 그냥 두면 되고, 당장 디스크를 돌려받아야 하면:
--   vacuum (full, analyze) public.count_records;   -- 그동안 쓰기가 막힙니다
--
-- 실제로 돌려 본 결과(40,000행 → 18,000행): 6544 kB → (vacuum full) → 2376 kB

-- ---------------------------------------------------------------------------
-- 4. 매일 자동으로 (pg_cron 이 있을 때만)
-- ---------------------------------------------------------------------------
-- Supabase 는 Database → Extensions 에서 pg_cron 을 켤 수 있습니다. 켠 뒤
-- 아래를 실행하면 매일 새벽 3시 10분(UTC)에 돕니다. 정각을 피한 것은 그
-- 시각에 작업이 몰리기 때문입니다.
--
--   select cron.schedule(
--     'vision-prune-count-records',
--     '10 3 * * *',
--     $cron$ select public.vision_prune_count_records(180); $cron$
--   );
--
-- 끄려면:
--   select cron.unschedule('vision-prune-count-records');

-- ---------------------------------------------------------------------------
-- 5. 오래된 것을 지우지 말고 접어 두고 싶다면
-- ---------------------------------------------------------------------------
-- 일 단위 요약을 따로 남기고 원본만 지우는 방법입니다. 1년치가 카메라당
-- 365행으로 줄어듭니다. 필요해지면 그때 만드세요 — 지금 만들어 두면 쓰지
-- 않는 표를 들고 다니게 됩니다.
--
--   create table if not exists public.count_records_daily (
--     day        date not null,
--     camera_id  uuid not null,
--     tank_id    uuid not null,
--     farm_id    uuid not null,
--     count_avg  numeric not null,
--     count_min  integer not null,
--     count_max  integer not null,
--     samples    integer not null,
--     primary key (camera_id, day)
--   );
