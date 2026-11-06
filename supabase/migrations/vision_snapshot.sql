-- 장비가 밀어 올리는 최신 사진 한 장 — 농장 공유기 뒤에서도 수조를 보려고.
--
-- 왜 필요한가
-- -----------
-- 개체수는 보이는데 영상은 안 보인다는 말의 정체는 **방향**이다.
--
--   개체수  장비 → 서버로 **나가는** 연결. 농장 공유기는 나가는 것을 막지 않는다.
--   영상    브라우저 → 장비로 **들어가는** 연결. 공유기가 막는다(NAT).
--
-- 그래서 영상(MJPEG)은 장비에 공개 주소가 있을 때만 열린다. 터널
-- (Cloudflare Tunnel)을 깔면 되지만, 장비가 열 대를 넘고 남의 농장에도 있는
-- 상황에서 그걸 전부 깔고 관리하는 것은 이 단계에서 할 일이 아니다.
--
-- 그러면 **사진을 개체수와 같은 길로 내보내면** 된다. 나가는 연결이므로
-- 공유기를 그대로 두고 쓸 수 있다. 진짜 실시간은 아니지만(15초 간격),
-- 수조에 무슨 일이 있는지 눈으로 확인하는 데는 충분하다.
--
-- 왜 vision_cameras 의 열이 아니라 따로 두는가
-- --------------------------------------------
-- 카메라 목록은 화면이 열릴 때마다 통째로 읽는다. 사진을 그 행에 넣으면
-- 목록 한 번 읽을 때마다 카메라 수 × 수십 KB 가 함께 딸려 온다 — 사진을 볼
-- 생각이 없는 화면(개요·이력·설정)에서도. 따로 두면 사진을 달라고 할 때만
-- 읽힌다.
--
-- 카메라당 한 줄이고 **덮어쓴다.** 지난 사진은 남기지 않는다 — 영상 기록을
-- 하려는 것이 아니고, 쌓기 시작하면 무료 구간 500 MB 가 며칠에 찬다.
--
-- 이 파일을 실행하지 않아도 개체수는 그대로 쌓인다. 장비는 사진이 거절되면
-- 간격을 늘리고 계수는 계속한다(/api/vision/device/snapshot 참고).

create table if not exists public.vision_snapshots (
  camera_id  uuid primary key
             references public.vision_cameras(id) on delete cascade,
  taken_at   timestamptz not null default now(),
  -- 그 사진을 찍은 순간의 값. 사진과 숫자가 어긋나 보이지 않게 함께 둔다 —
  -- count_records 의 마지막 줄은 최대 30초 전 것이라 사진과 짝이 맞지 않는다.
  count      integer,
  length_cm  real,
  width      integer,
  height     integer,
  -- base64 로 적는다. bytea 로 두면 supabase-js 가 16진수 문자열(\x…)로
  -- 돌려주어 바이트가 두 배로 불고, 라우트에서 손으로 되돌려야 한다.
  image      text not null,
  updated_at timestamptz not null default now()
);

comment on table public.vision_snapshots is
  '카메라당 가장 최근 사진 한 장(덮어쓰기). 장비가 밀어 올리므로 공유기 뒤에서도 보인다. 영상 기록용이 아니다.';
comment on column public.vision_snapshots.image is
  'JPEG 을 base64 로 적은 것. 장비가 640px 폭으로 줄여 보낸다(수십 KB).';

-- 터무니없이 큰 것이 들어와 테이블이 부풀지 않게 한다. 640px/품질 60 이면
-- 보통 20~40 KB(base64 로 30~55 KB)다. 400 KB 는 그보다 열 배 — 설정을
-- 잘못 만져 원본을 그대로 올리는 경우를 여기서 막는다.
alter table public.vision_snapshots
  drop constraint if exists vision_snapshots_image_size;
alter table public.vision_snapshots
  add constraint vision_snapshots_image_size
  check (length(image) between 1 and 400000);

-- ---------------------------------------------------------------------------
-- RLS — 남의 수조를 들여다볼 수 없게.
--
-- 쓰기는 service_role(서버 라우트)만 한다. 그 키는 RLS 를 지나치므로 정책을
-- 따로 두지 않는다. 읽기는 카메라 → 수조 → 양식장 → 사용자로 거슬러 확인한다
-- (vision_cameras_all_own 과 같은 모양).
-- ---------------------------------------------------------------------------
alter table public.vision_snapshots enable row level security;

drop policy if exists "vision_snapshots_select_own" on public.vision_snapshots;
create policy "vision_snapshots_select_own" on public.vision_snapshots for select
  using (camera_id in (
    select c.id
    from public.vision_cameras c
    join public.tanks t on t.id = c.tank_id
    join public.farms f on f.id = t.farm_id
    where f.user_id = auth.uid()
  ));
