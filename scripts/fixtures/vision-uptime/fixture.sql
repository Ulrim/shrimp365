-- Supabase 에는 있는 역할. 맨 아래 grant 가 실제로 걸리는지 보려고 만든다.
create role authenticated;

-- 실제 스키마의 최소 모형. 열 이름과 타입은 supabase/migrations 와 같게 둔다.
create table farms (
  id uuid primary key,
  name text not null
);
create table tanks (
  id uuid primary key,
  farm_id uuid not null references farms(id) on delete cascade,
  name text not null
);
create table vision_cameras (
  id uuid primary key,
  tank_id uuid not null references tanks(id) on delete cascade,
  name text not null
);
create table count_records (
  time timestamptz not null,
  camera_id uuid not null references vision_cameras(id) on delete cascade,
  tank_id uuid not null,
  farm_id uuid not null,
  count int not null check (count >= 0),
  confidence_avg real,
  frame_path text,
  model_version text,
  inference_ms int,
  primary key (camera_id, time)
);

insert into farms values ('44444444-4444-4444-4444-444444444444', '시험 농장');
insert into tanks values ('33333333-3333-3333-3333-333333333333',
                          '44444444-4444-4444-4444-444444444444', '1호 수조');

insert into vision_cameras values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '가 쉬지 않고 돈 카메라'),
  ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', '나 중간에 멈춘 카메라'),
  ('55555555-5555-5555-5555-555555555555', '33333333-3333-3333-3333-333333333333', '다 반만 돈 카메라'),
  ('66666666-6666-6666-6666-666666666666', '33333333-3333-3333-3333-333333333333', '라 한 번도 안 돈 카메라'),
  ('77777777-7777-7777-7777-777777777777', '33333333-3333-3333-3333-333333333333', '마 주기가 흔들린 카메라');

-- 기준 시각: 2026-10-16 00:00 UTC 부터 한 시간.
--
-- 가: 10초마다 빠짐없이 (360줄) → 100%
insert into count_records (time, camera_id, tank_id, farm_id, count)
select timestamptz '2026-10-16 00:00:00+00' + make_interval(secs => s),
       '11111111-1111-1111-1111-111111111111',
       '33333333-3333-3333-3333-333333333333',
       '44444444-4444-4444-4444-444444444444', 10
from generate_series(0, 3590, 10) s;

-- 나: 10분(600초)짜리 구멍 하나. 20:00~30:00 구간을 뺀다.
insert into count_records (time, camera_id, tank_id, farm_id, count)
select timestamptz '2026-10-16 00:00:00+00' + make_interval(secs => s),
       '22222222-2222-2222-2222-222222222222',
       '33333333-3333-3333-3333-333333333333',
       '44444444-4444-4444-4444-444444444444', 10
from generate_series(0, 3590, 10) s
where s < 1200 or s >= 1800;

-- 다: 앞 30분만 돌고 멈췄다 (180줄)
insert into count_records (time, camera_id, tank_id, farm_id, count)
select timestamptz '2026-10-16 00:00:00+00' + make_interval(secs => s),
       '55555555-5555-5555-5555-555555555555',
       '33333333-3333-3333-3333-333333333333',
       '44444444-4444-4444-4444-444444444444', 10
from generate_series(0, 1790, 10) s;

-- 라: 한 줄도 없다.

-- 마: 주기가 10~13초로 흔들린다. 한 번도 안 멈췄으므로 100% 여야 한다.
--     "줄 수 ÷ 쌓여야 할 줄" 로 세면 여기서 80% 아래로 떨어진다.
insert into count_records (time, camera_id, tank_id, farm_id, count)
select timestamptz '2026-10-16 00:00:00+00' + make_interval(secs => s),
       '77777777-7777-7777-7777-777777777777',
       '33333333-3333-3333-3333-333333333333',
       '44444444-4444-4444-4444-444444444444', 10
from (
  select sum(step) over (order by i) - step as s
  from (select i, 10 + (i * 7) % 4 as step from generate_series(0, 400) i) g
) x
where s < 3600;

-- 하루 경계 시험용: 가 카메라에 한국 시간 10/16 12:00 ~ 10/17 12:00 구간을
-- 10초마다 빈틈없이 채운다(위 한 시간과 겹치지 않는 시각대).
insert into count_records (time, camera_id, tank_id, farm_id, count)
select timestamptz '2026-10-16 12:00:00+09' + make_interval(secs => s),
       '11111111-1111-1111-1111-111111111111',
       '33333333-3333-3333-3333-333333333333',
       '44444444-4444-4444-4444-444444444444', 10
from generate_series(0, 86390, 10) s
on conflict do nothing;
