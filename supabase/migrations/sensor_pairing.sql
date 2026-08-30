-- ============================================================
-- 센서 기기 페어링 (코드로 연결)
--
-- 기존 방식은 화면에서 발급한 긴 API 키를 장비 설정 파일에 옮겨 적어야 했다.
-- 현장에서 이 작업이 가장 큰 걸림돌이라, TV·셋톱박스가 쓰는 방식으로 바꾼다.
--
--   1. 장비가 서버에 코드를 요청한다 → 6자리 코드를 화면에 띄운다
--   2. 농가가 로그인한 상태에서 코드를 입력하고 수조를 고른다
--   3. 장비가 폴링하다가 기기 키를 받아 저장한다
--
-- 이메일만으로 기기를 지정하지 않는 이유:
--   이메일은 공개 정보라 아무나 남의 계정으로 가짜 수질값을 밀어 넣을 수 있다.
--   수질 데이터는 알림과 판단의 근거이므로 "어디로 보낼지"와 "보내도 되는지"를
--   반드시 분리해야 한다. 승인은 로그인한 계정 주인만 할 수 있다.
--
-- 실행 조건: add_sensor_devices.sql, sensor_device_identity.sql 을 먼저 실행.
-- 실행 위치: Supabase Dashboard → SQL Editor
-- ============================================================

create table if not exists public.sensor_pairings (
  id             uuid primary key default gen_random_uuid(),

  -- 화면에 띄우는 6자리 숫자. 사람이 옮겨 적는 값이라 짧게 유지한다.
  code           text not null check (code ~ '^[0-9]{6}$'),

  -- 코드를 요청한 장비만 아는 값. 기기 키는 이 값을 제시해야 받을 수 있다.
  -- 코드만 알아낸 제3자가 키를 가로채지 못하게 한다.
  pairing_secret text not null,

  -- 장비가 자기소개로 보낸 값. 승인 화면에서 어느 기기인지 보여 준다.
  serial         text,
  firmware       text,

  -- 승인되면 채워진다.
  device_id      uuid references public.sensor_devices(id) on delete cascade,
  claimed_by     uuid references auth.users(id) on delete set null,
  claimed_at     timestamptz,

  -- 코드는 짧게 살아 있어야 한다. 오래 열어 두면 추측 공격의 여지가 커진다.
  expires_at     timestamptz not null default (now() + interval '15 minutes'),
  created_at     timestamptz not null default now()
);

-- 아직 승인되지 않은 코드는 서로 겹치면 안 된다.
-- 승인이 끝난 코드는 나중에 재사용해도 무방하다.
create unique index if not exists sensor_pairings_active_code
  on public.sensor_pairings (code)
  where claimed_at is null;

create index if not exists sensor_pairings_secret_idx
  on public.sensor_pairings (pairing_secret);

create index if not exists sensor_pairings_expires_idx
  on public.sensor_pairings (expires_at);

-- RLS: 이 테이블은 전적으로 서버(service_role)를 통해서만 다룬다.
-- 정책을 만들지 않으므로 anon·authenticated 는 아무것도 할 수 없다.
alter table public.sensor_pairings enable row level security;
revoke all on public.sensor_pairings from anon, authenticated;

-- 만료되고 승인도 안 된 코드를 정리한다.
-- 페어링 요청이 들어올 때 서버가 호출하므로 별도 스케줄러가 필요 없다.
create or replace function public.purge_expired_sensor_pairings()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.sensor_pairings
   where claimed_at is null
     and expires_at < now() - interval '1 hour';
$$;
