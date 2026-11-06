\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on

create or replace function chk(name text, got anyelement, want anyelement)
returns text language sql immutable as $$
  select case when got is not distinct from want
              then '  ok    ' || name || ' — ' || coalesce(got::text, 'null')
              else '  FAIL  ' || name || ' — 나온 값 ' || coalesce(got::text, 'null')
                   || ' / 기대한 값 ' || coalesce(want::text, 'null') end
$$;

\echo '── 한 시간 구간, 카메라별 ───────────────────────────────'

-- 가: 10초마다 빠짐없이 → 100%
select chk('빠짐없이 돈 카메라는 100%', uptime_pct, 100.00::numeric)
from vision_uptime('11111111-1111-1111-1111-111111111111',
                   '2026-10-16 00:00+00', '2026-10-16 01:00+00');
select chk('그 줄 수는 360', records, 360::bigint)
from vision_uptime('11111111-1111-1111-1111-111111111111',
                   '2026-10-16 00:00+00', '2026-10-16 01:00+00');
select chk('정지 0회', outages, 0)
from vision_uptime('11111111-1111-1111-1111-111111111111',
                   '2026-10-16 00:00+00', '2026-10-16 01:00+00');

-- 나: 1190초 줄 다음이 1800초 줄이므로 구멍은 610초.
--     3600 - (610-60) = 3050초 → 84.72%
select chk('10분 멈춘 카메라는 84.72%', uptime_pct, 84.72::numeric)
from vision_uptime('22222222-2222-2222-2222-222222222222',
                   '2026-10-16 00:00+00', '2026-10-16 01:00+00');
select chk('정지 1회로 센다', outages, 1)
from vision_uptime('22222222-2222-2222-2222-222222222222',
                   '2026-10-16 00:00+00', '2026-10-16 01:00+00');
select chk('가장 긴 정지는 610초', longest_outage_seconds, 610.0::numeric)
from vision_uptime('22222222-2222-2222-2222-222222222222',
                   '2026-10-16 00:00+00', '2026-10-16 01:00+00');

-- 다: 30분만 → 179*10 + 60(허용치) = 1850 → 51.39%
select chk('앞 30분만 돈 카메라', uptime_pct, 51.39::numeric)
from vision_uptime('55555555-5555-5555-5555-555555555555',
                   '2026-10-16 00:00+00', '2026-10-16 01:00+00');

-- 라: 기록 없음 → 0%
select chk('한 줄도 없으면 0%', uptime_pct, 0.00::numeric)
from vision_uptime('66666666-6666-6666-6666-666666666666',
                   '2026-10-16 00:00+00', '2026-10-16 01:00+00');
select chk('그때 줄 수는 0', records, 0::bigint)
from vision_uptime('66666666-6666-6666-6666-666666666666',
                   '2026-10-16 00:00+00', '2026-10-16 01:00+00');
select chk('그때 정지 횟수도 0', outages, 0)
from vision_uptime('66666666-6666-6666-6666-666666666666',
                   '2026-10-16 00:00+00', '2026-10-16 01:00+00');

-- 마: 주기가 흔들려도 100%. 이것이 "줄 수로 세면 안 되는" 이유다.
select chk('주기가 흔들려도 100%', uptime_pct, 100.00::numeric)
from vision_uptime('77777777-7777-7777-7777-777777777777',
                   '2026-10-16 00:00+00', '2026-10-16 01:00+00');
select chk('줄 수로 세면 90% 아래로 떨어진다(이 방식을 안 쓰는 이유)',
           round(records * 10.0 / 3600 * 100, 1) < 90, true)
from vision_uptime('77777777-7777-7777-7777-777777777777',
                   '2026-10-16 00:00+00', '2026-10-16 01:00+00');

\echo ''
\echo '── 날짜별(한국 시간) ────────────────────────────────────'

-- 10/16 12:00 KST ~ 10/17 12:00 KST 를 빈틈없이 채웠다.
-- 10/16 은 12시간(43200초), 10/17 도 12시간이어야 한다 — 24시간으로 나누면 안 된다.
select chk('첫날 구간 길이는 12시간', window_seconds, 43200.0::numeric)
from vision_uptime_daily('11111111-1111-1111-1111-111111111111',
                         '2026-10-16 12:00+09', '2026-10-17 12:00+09')
where day = date '2026-10-16';
select chk('첫날 가동률 100%', uptime_pct, 100.00::numeric)
from vision_uptime_daily('11111111-1111-1111-1111-111111111111',
                         '2026-10-16 12:00+09', '2026-10-17 12:00+09')
where day = date '2026-10-16';
select chk('이튿날도 100%', uptime_pct, 100.00::numeric)
from vision_uptime_daily('11111111-1111-1111-1111-111111111111',
                         '2026-10-16 12:00+09', '2026-10-17 12:00+09')
where day = date '2026-10-17';
select chk('날짜는 두 줄만 나온다', count(*), 2::bigint)
from vision_uptime_daily('11111111-1111-1111-1111-111111111111',
                         '2026-10-16 12:00+09', '2026-10-17 12:00+09');

-- 시간대를 UTC 로 주면 하루의 경계가 달라진다. 같은 구간인데 첫날이
-- 12시간이 아니라 21시간(03:00~24:00)으로 잡힌다 — 한국 표에 UTC 를 쓰면
-- 하루치가 통째로 어긋나는 이유다.
select chk('UTC 로 자르면 첫날이 21시간이 된다', window_seconds, 75600.0::numeric)
from vision_uptime_daily('11111111-1111-1111-1111-111111111111',
                         '2026-10-16 12:00+09', '2026-10-17 12:00+09', 'UTC')
where day = date '2026-10-16';

\echo ''
\echo '── 카메라 전체 ──────────────────────────────────────────'

select chk('등록된 카메라가 모두 나온다', count(*), 5::bigint)
from vision_uptime_all('2026-10-16 00:00+00', '2026-10-16 01:00+00');

select chk('한 줄도 없는 카메라도 빠지지 않는다', count(*), 1::bigint)
from vision_uptime_all('2026-10-16 00:00+00', '2026-10-16 01:00+00')
where camera_name like '라 %' and uptime_pct = 0;

select chk('수조·농장 이름이 붙어 나온다', farm_name || ' / ' || tank_name, '시험 농장 / 1호 수조')
from vision_uptime_all('2026-10-16 00:00+00', '2026-10-16 01:00+00')
where camera_name like '가 %';

select chk('가동률 높은 순으로 정렬된다', string_agg(left(camera_name, 1), '' order by ord), '가마나다라')
from (select camera_name, row_number() over () as ord
      from vision_uptime_all('2026-10-16 00:00+00', '2026-10-16 01:00+00')) t;

\echo ''
\echo '── 가장자리 ─────────────────────────────────────────────'

select chk('길이가 0인 구간을 물어도 터지지 않는다', uptime_pct, 0.00::numeric)
from vision_uptime('11111111-1111-1111-1111-111111111111',
                   '2026-10-16 00:00+00', '2026-10-16 00:00+00');

select chk('거꾸로 된 구간도 터지지 않는다', uptime_pct, 0.00::numeric)
from vision_uptime('11111111-1111-1111-1111-111111111111',
                   '2026-10-16 01:00+00', '2026-10-16 00:00+00');

select chk('허용 간격을 0 으로 줘도 나눗셈이 터지지 않는다', uptime_pct, 10.00::numeric)
from vision_uptime('11111111-1111-1111-1111-111111111111',
                   '2026-10-16 00:00+00', '2026-10-16 01:00+00', 0);

-- 허용치가 구멍(610초)보다 커야 메워진다. 600 으로는 10초가 모자라 99.72% 다.
select chk('허용치를 구멍보다 크게 주면 100%', uptime_pct, 100.00::numeric)
from vision_uptime('22222222-2222-2222-2222-222222222222',
                   '2026-10-16 00:00+00', '2026-10-16 01:00+00', 700);
select chk('허용치가 구멍보다 작으면 메워지지 않는다', uptime_pct, 99.72::numeric)
from vision_uptime('22222222-2222-2222-2222-222222222222',
                   '2026-10-16 00:00+00', '2026-10-16 01:00+00', 600);

select chk('가동 시간이 구간 길이를 넘지 않는다', bool_and(running_seconds <= window_seconds), true)
from vision_uptime_all('2026-10-16 00:00+00', '2026-10-16 01:00+00');

select chk('세 함수 모두 security invoker 다', count(*), 3::bigint)
from pg_proc
where proname in ('vision_uptime', 'vision_uptime_daily', 'vision_uptime_all')
  and prosecdef = false;

select chk('로그인한 사용자가 세 함수를 부를 수 있다', count(*), 3::bigint)
from pg_proc p
where p.proname in ('vision_uptime', 'vision_uptime_daily', 'vision_uptime_all')
  and has_function_privilege('authenticated', p.oid, 'execute');

\echo ''
