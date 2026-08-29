-- ============================================================
-- 카메라 비전 개체수 모니터링 (ShrimpVision 이식)
--
-- 비전 AI 서비스(vision/, Python)가 카메라 영상에서 흰다리새우를 세어
-- 그 값을 여기에 적는다. 화면(Next.js)은 이 테이블들을 직접 읽는다.
--
-- 원본(ShrimpVision)은 farms·cameras·users 를 따로 들고 있었지만, 여기서는
-- shrimp365 의 farms·tanks·auth.users 가 단일 소스다. 카메라는 수조에 달린
-- 장비이므로 sensor_devices 와 같은 자리에 놓는다 — tank_id 로 매단다.
--
-- 원본은 개체수 시계열을 TimescaleDB 하이퍼테이블로 뒀지만 Supabase 에는
-- 그 확장이 없다. 대신 (camera_id, time) 복합 기본키 + 내림차순 인덱스로
-- 같은 조회 패턴을 감당하고, 구간 집계는 아래 vision_count_history() 가
-- 맡는다. 1 fps × 카메라 16대 = 하루 138만 행 수준이라 인덱스로 충분하다.
--
-- 실행 조건: farms, tanks, alerts 테이블이 이미 있어야 한다.
-- 실행 위치: Supabase Dashboard → SQL Editor
-- ============================================================

-- ------------------------------------------------------------
-- vision_cameras — 수조에 달린 카메라
-- ------------------------------------------------------------
create table if not exists public.vision_cameras (
  id            uuid primary key default gen_random_uuid(),
  tank_id       uuid not null references public.tanks(id) on delete cascade,
  name          text not null,

  -- picamera: 라즈베리파이 CSI 카메라(리본). stream_url 이 필요 없다 — 보드에
  --           직접 붙어 있어 주소로 가리킬 대상이 없다.
  -- usb     : stream_url 이 장치 번호("0")
  -- rtsp/http: stream_url 이 전체 URL
  camera_type   text not null default 'usb'
                  check (camera_type in ('picamera','usb','rtsp','http')),
  stream_url    text,

  resolution_w  int  not null default 1920,
  resolution_h  int  not null default 1080,
  -- 추론용 샘플링 FPS. 영상 재생 속도가 아니라 "초당 몇 번 세는가"다.
  fps_target    real not null default 1 check (fps_target > 0 and fps_target <= 5),
  is_active     boolean not null default true,

  -- 설치 높이(cm)와 수조 면적(㎡). 화면에 잡힌 수를 수조 전체로 환산할 때 쓴다.
  install_height real,
  tank_area_m2   real,

  -- ── 기기 신원 ──
  -- 이 카메라가 물려 있는 라즈베리파이를 가리킨다. CSI 카메라는 보드에 리본으로
  -- 직접 붙어 있어 그 보드에서 도는 서비스만 열 수 있으므로, 어느 장비 것인지
  -- 반드시 구분되어야 한다. sensor_devices 와 같은 방식이다.
  --
  -- api_key 는 페어링(6자리 코드 승인) 때 발급되어 장비가 보관한다. 장비는
  -- 이 값으로 "내 카메라"를 알아본다. 사람이 옮겨 적지 않는다.
  api_key       text,
  -- 라즈베리파이 CPU 시리얼. 보드마다 고정이라 같은 기기의 재연결을 알아본다.
  serial        text,
  firmware      text,
  agent_version text,
  last_seen_at  timestamptz,

  created_at    timestamptz not null default now()
);

create index if not exists idx_vision_cameras_tank
  on public.vision_cameras (tank_id);

-- 이 파일을 이미 한 번 실행한 뒤 picamera 가 추가됐다. create table if not exists
-- 는 기존 표를 고치지 않으므로 제약을 다시 걸어 준다(처음 실행이면 방금 만든
-- 제약을 같은 내용으로 덮어쓴다 — 어느 쪽이든 안전하다).
alter table public.vision_cameras
  drop constraint if exists vision_cameras_camera_type_check;
alter table public.vision_cameras
  add constraint vision_cameras_camera_type_check
  check (camera_type in ('picamera','usb','rtsp','http'));

-- 위와 같은 이유로, 이미 실행한 DB 에도 컬럼을 더해 준다.
alter table public.vision_cameras
  add column if not exists api_key text,
  add column if not exists serial text,
  add column if not exists firmware text,
  add column if not exists agent_version text,
  add column if not exists last_seen_at timestamptz;

-- 손으로 적던 장비 이름은 기기 키로 대체됐다. 남아 있으면 지운다.
alter table public.vision_cameras drop column if exists host_id;

-- 키가 없는 기존 행에 하나씩 채운다.
-- ⚠ ADD COLUMN ... DEFAULT 로 한 번에 넣으면 안 된다 — 기존 행 전체가
--   **같은 값**을 갖게 되어 모든 장비가 서로를 자기 카메라로 여긴다.
--   UPDATE 는 행마다 함수를 다시 평가하므로 각기 다른 키가 들어간다.
update public.vision_cameras
   set api_key = encode(gen_random_bytes(24), 'hex')
 where api_key is null;

alter table public.vision_cameras
  alter column api_key set default encode(gen_random_bytes(24), 'hex');
alter table public.vision_cameras
  alter column api_key set not null;

-- 장비는 뜰 때 이 키로 "내 카메라"를 찾는다.
create unique index if not exists vision_cameras_api_key_idx
  on public.vision_cameras (api_key);

-- 같은 보드를 두 번 등록하는 실수를 잡기 위한 인덱스(유일성은 강제하지 않는다 —
-- 보드를 교체하고 기존 카메라 항목을 재사용하는 경우가 있다).
create index if not exists idx_vision_cameras_serial
  on public.vision_cameras (serial) where serial is not null;

alter table public.vision_cameras enable row level security;

-- 본인 수조의 카메라만. sensor_devices 의 devices_all_own 과 같은 형태다.
drop policy if exists "vision_cameras_all_own" on public.vision_cameras;
create policy "vision_cameras_all_own" on public.vision_cameras for all
  using (tank_id in (
    select t.id from public.tanks t
    join public.farms f on f.id = t.farm_id
    where f.user_id = auth.uid()
  ));

-- ------------------------------------------------------------
-- count_records — 개체수 시계열
--
-- tank_id·farm_id 는 카메라에서 유도할 수 있지만 일부러 같이 적는다.
-- 조회는 거의 전부 "이 수조/이 양식장의 기간 추이"라, 매번 조인하면
-- 수백만 행에 조인이 붙는다. 쓰는 쪽은 비전 서비스 한 곳뿐이라
-- 비정규화의 대가인 갱신 불일치 위험이 사실상 없다.
--
-- count 는 **원본 그대로** 적는다. 스무딩(EMA)은 경보 판정에만 쓰고
-- 저장값에는 손대지 않는다 — 나중에 판정 기준이 바뀌어도 원본이 남아야 한다.
-- ------------------------------------------------------------
create table if not exists public.count_records (
  time           timestamptz not null,
  camera_id      uuid not null references public.vision_cameras(id) on delete cascade,
  tank_id        uuid not null references public.tanks(id) on delete cascade,
  farm_id        uuid not null references public.farms(id) on delete cascade,

  count          int not null check (count >= 0),
  confidence_avg real,
  frame_path     text,
  model_version  text,
  inference_ms   int,

  -- 같은 카메라가 같은 마이크로초에 두 번 적을 수는 없다.
  primary key (camera_id, time)
);

-- 조회는 언제나 "최근부터". 인덱스도 내림차순으로 맞춰 둔다.
create index if not exists idx_count_records_tank_time
  on public.count_records (tank_id, time desc);
create index if not exists idx_count_records_farm_time
  on public.count_records (farm_id, time desc);

alter table public.count_records enable row level security;

-- 읽기만 열어 준다. 쓰기는 비전 서비스가 DB 직결(서비스 권한)로 한다.
drop policy if exists "count_records_select_own" on public.count_records;
create policy "count_records_select_own" on public.count_records for select
  using (farm_id in (
    select f.id from public.farms f where f.user_id = auth.uid()
  ));

-- ------------------------------------------------------------
-- vision_alert_configs — 개체수 경보 설정
--
-- 경보 **이력**은 만들지 않는다. 발생한 경보는 기존 alerts 테이블에 적어야
-- 헤더 알림함·웹푸시·관제센터가 수질 경보와 똑같이 다룬다. 통합의 핵심이다.
-- camera_id 가 null 이면 그 사용자의 모든 카메라에 적용되는 기본 설정이다.
-- ------------------------------------------------------------
create table if not exists public.vision_alert_configs (
  id              uuid primary key default gen_random_uuid(),
  camera_id       uuid references public.vision_cameras(id) on delete cascade,
  -- 설정의 주인. camera_id 가 null 인 기본 설정도 주인이 있어야 RLS 가 선다.
  user_id         uuid not null references auth.users(id) on delete cascade,

  alert_type      text not null
                    check (alert_type in ('count_drop','count_spike','offline','threshold')),
  threshold_value real,   -- 절대 임계값 (threshold)
  threshold_pct   real,   -- 변화율 임계값 % (count_drop / count_spike)
  window_minutes  int not null default 10 check (window_minutes between 1 and 1440),
  is_enabled      boolean not null default true,
  notify_email    text,
  notify_webhook  text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_vision_alert_configs_camera
  on public.vision_alert_configs (camera_id);
create index if not exists idx_vision_alert_configs_enabled
  on public.vision_alert_configs (is_enabled) where is_enabled;

alter table public.vision_alert_configs enable row level security;

drop policy if exists "vision_alert_configs_all_own" on public.vision_alert_configs;
create policy "vision_alert_configs_all_own" on public.vision_alert_configs for all
  using (user_id = auth.uid());

-- ------------------------------------------------------------
-- vision_pairings — 카메라 기기 페어링 (코드로 연결)
--
-- sensor_pairings 와 같은 방식이다. 긴 키를 장비 설정 파일에 옮겨 적는 대신,
-- TV·셋톱박스처럼 6자리 코드를 승인한다.
--
--   1. 파이가 서버에 코드를 요청한다 → 화면·로그에 6자리 코드를 띄운다
--   2. 농가가 로그인한 상태에서 코드를 입력하고 수조를 고른다
--   3. 파이가 폴링하다가 기기 키를 받아 저장한다
--
-- 시리얼만으로 기기를 지정하지 않는 이유:
--   시리얼은 장비 겉면에서 읽을 수 있는 값이라 아무나 남의 계정에 카메라를
--   붙일 수 있다. 개체수는 경보와 판단의 근거이므로 "어디에 붙일지"와
--   "붙여도 되는지"를 분리해야 한다. 승인은 로그인한 계정 주인만 할 수 있다.
-- ------------------------------------------------------------
create table if not exists public.vision_pairings (
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
  camera_id      uuid references public.vision_cameras(id) on delete cascade,
  claimed_by     uuid references auth.users(id) on delete set null,
  claimed_at     timestamptz,

  -- 코드는 짧게 살아 있어야 한다. 오래 열어 두면 추측 공격의 여지가 커진다.
  expires_at     timestamptz not null default (now() + interval '15 minutes'),
  created_at     timestamptz not null default now()
);

-- 아직 승인되지 않은 코드는 서로 겹치면 안 된다.
-- 승인이 끝난 코드는 나중에 재사용해도 무방하다.
create unique index if not exists vision_pairings_active_code
  on public.vision_pairings (code)
  where claimed_at is null;

create index if not exists vision_pairings_secret_idx
  on public.vision_pairings (pairing_secret);
create index if not exists vision_pairings_expires_idx
  on public.vision_pairings (expires_at);

-- RLS: 이 표는 전적으로 서버(service_role)를 통해서만 다룬다.
-- 정책을 만들지 않으므로 anon·authenticated 는 아무것도 할 수 없다.
alter table public.vision_pairings enable row level security;
revoke all on public.vision_pairings from anon, authenticated;

-- 만료되고 승인도 안 된 코드를 정리한다.
-- 페어링 요청이 들어올 때 서버가 호출하므로 별도 스케줄러가 필요 없다.
create or replace function public.purge_expired_vision_pairings()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.vision_pairings
   where claimed_at is null
     and expires_at < now() - interval '1 hour';
$$;

-- ------------------------------------------------------------
-- vision_count_history() — 구간 집계
--
-- 원본의 TimescaleDB 연속집계(count_1min/1hour/1day)를 대신한다.
-- epoch 를 버킷 크기로 내림해 묶는 방식이라 어떤 간격이든 같은 코드로 된다.
--
-- security invoker 로 둬서 호출자의 RLS 가 그대로 적용된다 —
-- 남의 카메라 id 를 넣어도 빈 결과만 돌아온다.
-- ------------------------------------------------------------
create or replace function public.vision_count_history(
  p_camera_id      uuid,
  p_start          timestamptz,
  p_end            timestamptz,
  p_bucket_seconds int default 3600
)
returns table (
  bucket       timestamptz,
  avg_count    int,
  max_count    int,
  min_count    int,
  confidence_avg real,
  sample_count int
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    to_timestamp(floor(extract(epoch from time) / p_bucket_seconds) * p_bucket_seconds) as bucket,
    round(avg(count))::int   as avg_count,
    max(count)               as max_count,
    min(count)               as min_count,
    avg(confidence_avg)::real as confidence_avg,
    count(*)::int            as sample_count
  from public.count_records
  where camera_id = p_camera_id
    and time >= p_start
    and time <  p_end
  group by 1
  order by 1
$$;

-- ------------------------------------------------------------
-- vision_count_wq_series() — 개체수 ↔ 수질 통합 시계열
--
-- 통합의 실익이 여기 있다. 개체수와 수질을 같은 시간 버킷으로 맞춰 한 번에
-- 돌려주므로, 화면은 두 축을 겹쳐 그리기만 하면 된다.
--
-- full outer join 을 쓴다 — 수질은 보통 분 단위, 개체수는 초 단위로 들어와
-- 한쪽만 있는 버킷이 흔하다. inner join 이면 그런 구간이 통째로 사라진다.
-- ------------------------------------------------------------
create or replace function public.vision_count_wq_series(
  p_tank_id        uuid,
  p_start          timestamptz,
  p_end            timestamptz,
  p_bucket_seconds int default 3600
)
returns table (
  bucket          timestamptz,
  avg_count       int,
  count_samples   int,
  avg_temperature real,
  avg_do          real,
  avg_ph          real,
  wq_samples      int
)
language sql
stable
security invoker
set search_path = public
as $$
  with counts as (
    select
      to_timestamp(floor(extract(epoch from time) / p_bucket_seconds) * p_bucket_seconds) as bucket,
      round(avg(count))::int as avg_count,
      count(*)::int          as samples
    from public.count_records
    where tank_id = p_tank_id and time >= p_start and time < p_end
    group by 1
  ),
  wq as (
    select
      to_timestamp(floor(extract(epoch from recorded_at) / p_bucket_seconds) * p_bucket_seconds) as bucket,
      avg(temperature)::real as avg_temperature,
      avg(do_level)::real    as avg_do,
      avg(ph)::real          as avg_ph,
      count(*)::int          as samples
    from public.water_quality_readings
    where tank_id = p_tank_id and recorded_at >= p_start and recorded_at < p_end
    group by 1
  )
  select
    coalesce(c.bucket, w.bucket) as bucket,
    c.avg_count,
    coalesce(c.samples, 0) as count_samples,
    w.avg_temperature,
    w.avg_do,
    w.avg_ph,
    coalesce(w.samples, 0) as wq_samples
  from counts c
  full outer join wq w on w.bucket = c.bucket
  order by 1
$$;

grant execute on function public.vision_count_history(uuid, timestamptz, timestamptz, int) to authenticated;
grant execute on function public.vision_count_wq_series(uuid, timestamptz, timestamptz, int) to authenticated;

do $$ begin
  raise notice 'vision_monitoring: vision_cameras / count_records / vision_alert_configs / vision_pairings 준비 완료';
end $$;
