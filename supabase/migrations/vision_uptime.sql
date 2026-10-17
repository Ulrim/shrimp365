-- ============================================================
-- 카메라 가동률 — "이 장비가 실제로 몇 %의 시간 동안 돌았는가"
--
-- 실행 위치: Supabase Dashboard → SQL Editor (한 번만)
-- 실행 조건: vision_monitoring.sql 이 먼저 실행되어 있어야 한다.
--
--
-- 왜 필요한가
-- -----------
-- "카메라를 달았다"와 "카메라가 돌았다"는 다른 말이다. 지원사업 증빙이든
-- 현장 점검이든 물어보는 것은 뒤쪽이다 — 몇 월 며칠부터 며칠까지, 하루
-- 24시간 중 몇 시간을 실제로 셌는가. 지금은 그 숫자를 댈 방법이 없다.
-- 화면은 "지금 돌고 있다"만 보여 주고, 지나간 시간에 대해서는 아무 말도
-- 하지 않는다.
--
-- 근거 자료는 이미 쌓여 있다. 장비는 돌고 있는 동안 count_records 에
-- **10초마다 한 줄**을 적는다(vision/app/config.py 의
-- COUNT_WRITE_INTERVAL_SECONDS). 그러니 "줄이 끊긴 구간"이 곧 "멈춰 있던
-- 구간"이다. 이 파일은 그 끊김을 세어 시간으로 바꾼다.
--
--
-- 어떻게 세는가 — 줄 수가 아니라 **덮은 시간**으로
-- ------------------------------------------------
-- 가장 쉬운 방법은 "쌓인 줄 ÷ 쌓여야 할 줄"이다. 그러나 그것은 틀린 숫자를
-- 낸다. 장비의 쓰기 주기는 정확히 10.000초가 아니라 "10초가 지났으면 적는다"
-- 라서 10.0~10.3초 사이에서 흔들리고(tick - last >= interval), 설정을 바꾸면
-- 아예 달라진다. 한 번도 안 멈춘 장비가 97% 로 나오는 식이다.
--
-- 그래서 **한 줄이 다음 줄까지의 시간을 덮는다**고 본다. 다만 그 간격이
-- 허용치(기본 60초)를 넘으면 그 사이는 "멈춰 있었다"로 치고 허용치까지만
-- 덮는다. 마지막 줄은 조회 끝 시각까지를 같은 방식으로 덮는다.
--
--     가동 시간 = Σ min(다음 줄까지의 간격, 허용치)
--     가동률    = 가동 시간 ÷ 조회 구간 길이
--
-- 이 방식은 주기가 흔들려도, 설정을 10초에서 30초로 바꿔도 같은 답을 낸다.
-- 허용치 60초는 "10초 주기로 여섯 번 연속 놓쳤으면 멈춘 것으로 본다"는 뜻이다.
-- 주기를 늘렸다면 허용치도 함께 늘려 부르면 된다(주기의 3~6배를 권한다).
--
--
-- 이 숫자를 믿을 때 알고 있어야 할 것
-- -----------------------------------
-- · **정지 1회당 허용치만큼 넉넉하게 잡힌다.** 장비가 멈춘 것은 허용치가
--   지나야 알 수 있으므로, 멈춘 순간부터 허용치까지는 "돌고 있었다"로 센다.
--   과대평가의 상한은 `정지 횟수 × 허용치` 이고, 정지 횟수(outages)를 함께
--   돌려주므로 보는 사람이 직접 계산할 수 있다. 하루 구간에서 정지가 한 번
--   있었다면 상한은 60초, 0.07%다.
-- · **보존 기간을 넘은 구간은 0% 로 보인다.** vision_prune_count_records()
--   가 기본 180일 이전 기록을 지운다(vision_retention.sql). 지워진 구간의
--   가동률을 물으면 "안 돌았다"와 구분되지 않는다. 180일 안에서 쓰거나,
--   길게 남길 자료는 아래 vision_uptime_daily() 결과를 따로 보관하라.
-- · **카메라를 끈 시간도 '멈춤'으로 센다.** 밤에 조명이 없어 꺼 두었다면
--   그만큼 가동률이 내려간다. 의도한 정지와 고장을 구분하지 않는다 —
--   구분하려면 운전 일정표가 따로 있어야 하는데, 그런 표는 아직 없다.
-- · **셋 다 security invoker 다.** 호출자의 RLS 가 그대로 걸리므로 남의
--   카메라 id 를 넣으면 빈 결과가 온다. 단, SQL Editor 는 소유자 권한으로
--   돌아 RLS 를 지나친다 — 거기서는 모든 농장이 보인다.
-- ============================================================


-- ------------------------------------------------------------
-- vision_uptime() — 카메라 한 대, 구간 전체를 한 줄로
--
-- 증빙 문서에 "10월 1일~10월 17일, 가동률 99.2%" 한 줄을 적을 때 쓴다.
-- ------------------------------------------------------------
create or replace function public.vision_uptime(
  p_camera_id      uuid,
  p_start          timestamptz,
  p_end            timestamptz,
  p_gap_tolerance_seconds int default 60
)
returns table (
  camera_id           uuid,
  first_record        timestamptz,
  last_record         timestamptz,
  records             bigint,
  running_seconds     numeric,
  window_seconds      numeric,
  uptime_pct          numeric,
  outages             int,
  longest_outage_seconds numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with bounds as (
    select
      greatest(p_gap_tolerance_seconds, 1)::numeric     as tol,
      extract(epoch from (p_end - p_start))::numeric    as window_seconds
  ),
  rows_in_window as (
    select
      c.time,
      -- 다음 줄까지의 간격. 마지막 줄은 조회 끝 시각까지로 본다.
      extract(epoch from (
        coalesce(lead(c.time) over (order by c.time), p_end) - c.time
      ))::numeric as gap
    from public.count_records c
    where c.camera_id = p_camera_id
      and c.time >= p_start
      and c.time <  p_end
  ),
  tallied as (
    select
      min(r.time)                                   as first_record,
      max(r.time)                                   as last_record,
      count(*)                                      as records,
      -- 허용치를 넘는 간격은 그 앞부분(허용치)만 덮은 것으로 친다.
      coalesce(sum(least(r.gap, b.tol)), 0)         as running_seconds,
      count(*) filter (where r.gap > b.tol)::int    as outages,
      coalesce(max(r.gap) filter (where r.gap > b.tol), 0) as longest_outage_seconds
    from rows_in_window r cross join bounds b
  )
  select
    p_camera_id,
    t.first_record,
    t.last_record,
    t.records,
    round(t.running_seconds, 1),
    round(b.window_seconds, 1),
    case
      when b.window_seconds <= 0 then 0::numeric
      -- 떠내려가는 오차(마지막 줄이 조회 끝을 넘겨 덮는 경우)를 잘라 낸다.
      else round(least(t.running_seconds / b.window_seconds, 1) * 100, 2)
    end,
    t.outages,
    round(t.longest_outage_seconds, 1)
  from tallied t cross join bounds b
$$;


-- ------------------------------------------------------------
-- vision_uptime_daily() — 카메라 한 대, 하루 한 줄
--
-- 증빙 문서의 표가 이것이다. 날짜는 **현지 날짜**로 자른다 — UTC 로 자르면
-- 한국의 하루가 오전 9시에 시작해 표가 하루씩 어긋나 보인다.
-- ------------------------------------------------------------
create or replace function public.vision_uptime_daily(
  p_camera_id      uuid,
  p_start          timestamptz,
  p_end            timestamptz,
  p_timezone       text default 'Asia/Seoul',
  p_gap_tolerance_seconds int default 60
)
returns table (
  day             date,
  records         bigint,
  running_seconds numeric,
  window_seconds  numeric,
  uptime_pct      numeric,
  outages         int
)
language sql
stable
security invoker
set search_path = public
as $$
  with bounds as (
    select greatest(p_gap_tolerance_seconds, 1)::numeric as tol
  ),
  rows_in_window as (
    select
      (c.time at time zone p_timezone)::date as day,
      c.time,
      extract(epoch from (
        coalesce(lead(c.time) over (order by c.time), p_end) - c.time
      ))::numeric as gap
    from public.count_records c
    where c.camera_id = p_camera_id
      and c.time >= p_start
      and c.time <  p_end
  ),
  -- 그 날짜가 조회 구간 안에서 **실제로 몇 초인가.** 첫날과 마지막 날은
  -- 24시간이 아니다 — 그걸 24시간으로 나누면 멀쩡한 장비가 30% 로 보인다.
  -- 서머타임이 있는 시간대에서는 23시간·25시간인 날도 있다.
  day_spans as (
    select
      d::date as day,
      -- date → timestamp 는 그 날 00:00, 거기에 at time zone 을 걸면 "그 지역의
      -- 자정"이 된다. generate_series 가 돌려주는 값은 date 가 아니라 timestamp
      -- 라서 d::date 로 한 번 접어야 한다.
      extract(epoch from (
        least(p_end,       ((d::date + 1)::timestamp at time zone p_timezone))
        - greatest(p_start, (d::date::timestamp     at time zone p_timezone))
      ))::numeric as window_seconds
    from generate_series(
      (p_start at time zone p_timezone)::date,
      (p_end   at time zone p_timezone)::date,
      interval '1 day'
    ) as d
  )
  select
    s.day,
    coalesce(t.records, 0),
    round(coalesce(t.running_seconds, 0), 1),
    round(s.window_seconds, 1),
    case
      when s.window_seconds <= 0 then 0::numeric
      else round(least(coalesce(t.running_seconds, 0) / s.window_seconds, 1) * 100, 2)
    end,
    coalesce(t.outages, 0)
  from day_spans s
  left join (
    select
      r.day,
      count(*)                               as records,
      sum(least(r.gap, b.tol))               as running_seconds,
      count(*) filter (where r.gap > b.tol)::int as outages
    from rows_in_window r cross join bounds b
    group by r.day
  ) t on t.day = s.day
  where s.window_seconds > 0
  order by s.day
$$;


-- ------------------------------------------------------------
-- vision_uptime_all() — 내가 볼 수 있는 카메라 전부, 한 대당 한 줄
--
-- 현장에 몇 대가 돌고 있는지를 한 번에 본다. 기록이 **한 줄도 없는** 카메라도
-- 0% 로 나온다 — 그게 핵심이다. 등록만 해 두고 한 번도 안 돌린 카메라가
-- 목록에서 조용히 빠지면, 보는 사람은 그 대수를 가동 대수로 읽는다.
-- ------------------------------------------------------------
create or replace function public.vision_uptime_all(
  p_start          timestamptz,
  p_end            timestamptz,
  p_gap_tolerance_seconds int default 60
)
returns table (
  camera_id       uuid,
  camera_name     text,
  tank_name       text,
  farm_name       text,
  records         bigint,
  running_seconds numeric,
  window_seconds  numeric,
  uptime_pct      numeric,
  outages         int,
  last_record     timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    cam.id,
    cam.name,
    t.name,
    f.name,
    u.records,
    u.running_seconds,
    u.window_seconds,
    u.uptime_pct,
    u.outages,
    u.last_record
  from public.vision_cameras cam
  join public.tanks t on t.id = cam.tank_id
  join public.farms f on f.id = t.farm_id
  cross join lateral public.vision_uptime(
    cam.id, p_start, p_end, p_gap_tolerance_seconds
  ) u
  order by u.uptime_pct desc nulls last, cam.name
$$;


grant execute on function public.vision_uptime(uuid, timestamptz, timestamptz, int) to authenticated;
grant execute on function public.vision_uptime_daily(uuid, timestamptz, timestamptz, text, int) to authenticated;
grant execute on function public.vision_uptime_all(timestamptz, timestamptz, int) to authenticated;


-- ============================================================
-- 쓰는 법 — SQL Editor 에 그대로 붙여 넣으면 된다
-- ============================================================
--
-- 1) 지난 30일, 내 카메라 전부 (제일 먼저 볼 것)
--
--    select * from vision_uptime_all(now() - interval '30 days', now());
--
-- 2) 카메라 한 대, 날짜별 표 (증빙 문서에 그대로 붙인다)
--
--    select * from vision_uptime_daily(
--      '카메라-UUID',
--      '2026-10-01 00:00+09',
--      '2026-10-18 00:00+09'
--    );
--
-- 3) 카메라 한 대, 구간 전체 한 줄
--
--    select * from vision_uptime(
--      '카메라-UUID',
--      '2026-10-01 00:00+09',
--      '2026-10-18 00:00+09'
--    );
--
-- 4) 카메라 UUID 를 모를 때
--
--    select cam.id, cam.name, t.name as tank, f.name as farm, cam.last_seen_at
--      from vision_cameras cam
--      join tanks t on t.id = cam.tank_id
--      join farms f on f.id = t.farm_id
--     order by f.name, t.name, cam.name;
--
-- 쓰기 주기를 10초에서 바꿨다면 마지막 인자(허용 간격, 초)를 주기의 3~6배로
-- 함께 올린다. 예: 30초 주기 → 120.
--
--    select * from vision_uptime_all(now() - interval '7 days', now(), 120);

do $$ begin
  raise notice 'vision_uptime: vision_uptime / vision_uptime_daily / vision_uptime_all 준비 완료';
end $$;
