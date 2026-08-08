-- ============================================================
-- Shrimp365 통합 마이그레이션 (필수 스키마)
--
-- ⚠ 이 파일은 supabase/build-combined.sh 가 자동 생성합니다.
--   직접 고치지 마세요. 원본은 migrations/ 의 개별 파일입니다.
--
-- Supabase SQL Editor 에 전체를 붙여넣고 한 번 실행하세요.
-- 모두 재실행 안전(멱등)이라 이미 실행한 것이 섞여 있어도 됩니다.
-- 순서: 카드뉴스 → 게시판 → 센서 → 좌표 → 관제센터
-- ============================================================


-- ==================== card_news.sql ====================
-- ============================================================
-- 카드뉴스 (card news) — 공개 콘텐츠 아카이브
--
-- 목적: SNS용 카드뉴스를 자사 웹사이트에도 게시해 검색 유입을 만든다.
--       비로그인 방문자·검색 크롤러가 전문을 읽을 수 있어야 하므로
--       anon SELECT를 허용하고, 쓰기는 service_role(관리자 API)만 가능하다.
--
-- 실행 위치: Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. 테이블 ---------------------------------------------------
create table if not exists public.card_news (
  id           uuid primary key default gen_random_uuid(),
  -- URL 슬러그. 검색엔진에 노출되는 주소가 되므로 소문자·하이픈만 사용.
  slug         text not null,
  -- 언어. 같은 주제를 언어별로 따로 등록한다(각각 독립 URL).
  locale       text not null default 'ko' check (locale in ('ko','en','vi','id')),
  title        text not null,
  summary      text not null default '',
  -- 본문(카드 밖 설명글). 줄바꿈 유지 텍스트.
  body         text not null default '',
  -- 카드 이미지 URL 배열. 순서가 곧 카드 순서(1장 → N장).
  images       text[] not null default '{}',
  -- 대표 이미지(OG/썸네일). 비우면 images[1]을 사용.
  cover_url    text,
  tags         text[] not null default '{}',
  published    boolean not null default true,
  published_at timestamptz not null default now(),
  view_count   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 슬러그는 언어별로 유일 (같은 슬러그를 ko/en/vi/id로 각각 등록 가능)
create unique index if not exists card_news_slug_locale_key
  on public.card_news (slug, locale);

create index if not exists card_news_published_idx
  on public.card_news (locale, published, published_at desc);

create index if not exists card_news_tags_idx
  on public.card_news using gin (tags);

-- 2. RLS ------------------------------------------------------
alter table public.card_news enable row level security;

-- 읽기: 게시된 글은 누구나(비로그인 포함) 조회 가능 → SEO 색인용
drop policy if exists "card_news public read" on public.card_news;
create policy "card_news public read"
  on public.card_news for select
  to anon, authenticated
  using (published = true);

-- 쓰기 정책은 만들지 않는다.
-- RLS가 켜져 있고 정책이 없으면 anon/authenticated의 insert/update/delete는 모두 거부된다.
-- 등록·수정은 service_role 키를 쓰는 /api/cardnews (관리자 전용)에서만 수행한다.
revoke insert, update, delete on public.card_news from anon, authenticated;

-- 3. 조회수 증가 함수 -----------------------------------------
-- SECURITY DEFINER + search_path 고정 (권한 상승 경로 차단)
create or replace function public.increment_card_news_view(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.card_news set view_count = view_count + 1 where id = p_id and published = true;
$$;

grant execute on function public.increment_card_news_view(uuid) to anon, authenticated;

-- 4. Storage 버킷 ---------------------------------------------
-- 카드 이미지 저장소. 공개 읽기(이미지가 검색결과/SNS 미리보기에 떠야 함).
insert into storage.buckets (id, name, public)
values ('card-news', 'card-news', true)
on conflict (id) do update set public = true;

drop policy if exists "card-news public read" on storage.objects;
create policy "card-news public read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'card-news');

-- 업로드는 로그인 사용자만 가능하되, 실제 등록(insert into card_news)은
-- 관리자 API에서만 되므로 일반 사용자가 파일만 올려도 사이트에는 노출되지 않는다.
drop policy if exists "card-news authenticated upload" on storage.objects;
create policy "card-news authenticated upload"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'card-news');

drop policy if exists "card-news owner delete" on storage.objects;
create policy "card-news owner delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'card-news' and owner = auth.uid());


-- ==================== card_news_likes.sql ====================
-- ============================================================
-- 카드뉴스 좋아요
--
-- 로그인 사용자당 글 하나에 한 번만 누를 수 있다(PK로 강제).
-- 카운트는 목록에서도 필요하므로 card_news.like_count에 트리거로 동기화한다
-- (매번 count(*)를 세면 목록 조회가 느려진다).
--
-- 실행 조건: card_news.sql 을 먼저 실행해야 한다.
-- ============================================================

-- 1. 카운트 컬럼 ----------------------------------------------
alter table public.card_news
  add column if not exists like_count integer not null default 0;

-- 2. 좋아요 테이블 --------------------------------------------
create table if not exists public.card_news_likes (
  card_news_id uuid not null references public.card_news(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (card_news_id, user_id)
);

create index if not exists card_news_likes_user_idx
  on public.card_news_likes (user_id);

-- 3. RLS ------------------------------------------------------
alter table public.card_news_likes enable row level security;

-- 읽기: 누구나(비로그인 포함). 내가 눌렀는지 판별하는 데도 쓰인다.
drop policy if exists "card_news_likes read" on public.card_news_likes;
create policy "card_news_likes read"
  on public.card_news_likes for select
  to anon, authenticated
  using (true);

-- 쓰기: 본인 행만. 남의 이름으로 누를 수 없다.
drop policy if exists "card_news_likes insert" on public.card_news_likes;
create policy "card_news_likes insert"
  on public.card_news_likes for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "card_news_likes delete" on public.card_news_likes;
create policy "card_news_likes delete"
  on public.card_news_likes for delete
  to authenticated
  using (auth.uid() = user_id);

-- update는 의미가 없으므로 정책을 두지 않는다(= 거부).
revoke update on public.card_news_likes from anon, authenticated;

-- 4. 카운트 동기화 트리거 --------------------------------------
create or replace function public.sync_card_news_like_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.card_news
       set like_count = like_count + 1
     where id = new.card_news_id;
    return new;
  else
    update public.card_news
       set like_count = greatest(like_count - 1, 0)
     where id = old.card_news_id;
    return old;
  end if;
end;
$$;

drop trigger if exists card_news_like_count_trg on public.card_news_likes;
create trigger card_news_like_count_trg
  after insert or delete on public.card_news_likes
  for each row execute function public.sync_card_news_like_count();

-- 5. 기존 데이터 정합성 맞추기 ---------------------------------
-- (재실행하거나 수동으로 행을 지운 뒤에도 카운트가 맞도록)
update public.card_news c
   set like_count = coalesce(l.n, 0)
  from (select card_news_id, count(*) as n from public.card_news_likes group by 1) l
 where l.card_news_id = c.id;

update public.card_news
   set like_count = 0
 where id not in (select card_news_id from public.card_news_likes)
   and like_count <> 0;


-- ==================== board_locale.sql ====================
-- ============================================================
-- 게시판 언어 분리
--
-- 목적: 한국어 사용자에게는 한국어 글만, 영어 사용자에게는 영어 글만 보이게 한다.
--       작성자가 언어를 고르지 않아도 되도록, 글 저장 시 앱이 본문을 판별해
--       locale 값을 자동으로 채운다. 이 마이그레이션은 컬럼 추가 + 기존 글 백필.
--
-- 실행 위치: Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. 컬럼 추가 ------------------------------------------------
alter table public.board_posts
  add column if not exists locale text not null default 'ko';

alter table public.board_posts
  drop constraint if exists board_posts_locale_check;
alter table public.board_posts
  add constraint board_posts_locale_check check (locale in ('ko','en','vi','id'));

-- 목록 조회는 항상 (locale, 최신순)이므로 복합 인덱스로 대체
create index if not exists idx_board_posts_locale_created
  on public.board_posts (locale, created_at desc);

-- 2. 기존 글 백필 ---------------------------------------------
-- 문자 체계로 판별한다. 한글/베트남어 성조 문자는 확실한 신호이고,
-- 영어와 인도네시아어는 문자가 같으므로 인도네시아어 고빈도 단어로 구분한다.
update public.board_posts
set locale = case
  -- 한글 음절이 하나라도 있으면 한국어
  when (title || ' ' || content) ~ '[가-힣]' then 'ko'
  -- 베트남어 고유 문자(성조 포함)
  when (title || ' ' || content) ~* '[ăâđêôơưáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]' then 'vi'
  -- 인도네시아어 고빈도 기능어
  when (' ' || lower(title || ' ' || content) || ' ') ~ ' (yang|dan|untuk|tidak|dengan|adalah|saya|ini|itu|dari|akan|sudah|bisa|udang|tambak) ' then 'id'
  -- 라틴 문자만 있고 위 조건에 모두 해당하지 않으면 영어
  when (title || ' ' || content) ~ '[A-Za-z]' then 'en'
  else 'ko'
end;

-- 3. 참고 -----------------------------------------------------
-- RLS 정책은 그대로 둔다. 언어 필터링은 애플리케이션 질의(.eq('locale', …))에서
-- 수행한다 — 정책으로 막으면 사용자가 언어를 바꿨을 때 본인 글이 사라져 혼란스럽다.


-- ==================== board_post_likes.sql ====================
-- ============================================================
-- 게시판 좋아요
--
-- 카드뉴스 좋아요(card_news_likes.sql)와 동일한 구조.
-- 로그인 사용자당 글 하나에 한 번만 누를 수 있고, 카운트는 트리거로
-- board_posts.like_count에 동기화한다.
--
-- 실행 조건: community_board.sql 을 먼저 실행해야 한다.
-- ============================================================

-- 1. 카운트 컬럼 ----------------------------------------------
alter table public.board_posts
  add column if not exists like_count integer not null default 0;

-- 2. 좋아요 테이블 --------------------------------------------
create table if not exists public.board_post_likes (
  post_id    uuid not null references public.board_posts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists board_post_likes_user_idx
  on public.board_post_likes (user_id);

-- 3. RLS ------------------------------------------------------
alter table public.board_post_likes enable row level security;

-- 읽기: 누구나(비로그인 포함). 게시판이 공개 열람이므로 좋아요 수도 공개된다.
drop policy if exists "board_post_likes read" on public.board_post_likes;
create policy "board_post_likes read"
  on public.board_post_likes for select
  to anon, authenticated
  using (true);

-- 쓰기: 본인 행만.
drop policy if exists "board_post_likes insert" on public.board_post_likes;
create policy "board_post_likes insert"
  on public.board_post_likes for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "board_post_likes delete" on public.board_post_likes;
create policy "board_post_likes delete"
  on public.board_post_likes for delete
  to authenticated
  using (auth.uid() = user_id);

revoke update on public.board_post_likes from anon, authenticated;

-- 4. 카운트 동기화 트리거 --------------------------------------
create or replace function public.sync_board_post_like_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.board_posts
       set like_count = like_count + 1
     where id = new.post_id;
    return new;
  else
    update public.board_posts
       set like_count = greatest(like_count - 1, 0)
     where id = old.post_id;
    return old;
  end if;
end;
$$;

drop trigger if exists board_post_like_count_trg on public.board_post_likes;
create trigger board_post_like_count_trg
  after insert or delete on public.board_post_likes
  for each row execute function public.sync_board_post_like_count();

-- 5. 기존 데이터 정합성 맞추기 ---------------------------------
update public.board_posts p
   set like_count = coalesce(l.n, 0)
  from (select post_id, count(*) as n from public.board_post_likes group by 1) l
 where l.post_id = p.id;

update public.board_posts
   set like_count = 0
 where id not in (select post_id from public.board_post_likes)
   and like_count <> 0;


-- ==================== add_sensor_devices.sql ====================
-- ============================================================
-- Sensor Devices Table
-- Supabase SQL Editor에서 실행하세요
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sensor_devices (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tank_id      UUID NOT NULL REFERENCES public.tanks(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  device_type  TEXT NOT NULL DEFAULT 'multi'
                 CHECK (device_type IN ('multi','temperature','ph','do')),
  api_key      TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  active       BOOLEAN DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sensor_devices_tank
  ON public.sensor_devices(tank_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sensor_devices_api_key
  ON public.sensor_devices(api_key);

ALTER TABLE public.sensor_devices ENABLE ROW LEVEL SECURITY;

-- 본인 수조의 기기만 조회·수정·삭제 가능
CREATE POLICY "devices_all_own" ON public.sensor_devices FOR ALL
  USING (tank_id IN (
    SELECT t.id FROM public.tanks t
    JOIN public.farms f ON f.id = t.farm_id
    WHERE f.user_id = auth.uid()
  ));

DO $$ BEGIN
  RAISE NOTICE 'sensor_devices table created successfully!';
END $$;


-- ==================== sensor_device_identity.sql ====================
-- ============================================================
-- 센서 기기 식별 정보
--
-- 라즈베리파이가 스스로를 알릴 수 있게 한다. API 키는 등록 직후 한 번만
-- 보여 주고 다시 확인할 수 없으므로, 화면에서 "이 카드가 어느 장비인지"를
-- 구분할 수단이 없었다. 라즈베리파이 CPU 시리얼(보드마다 고정)을 받아
-- 기기 카드에 표시한다.
--
-- 실행 조건: add_sensor_devices.sql 을 먼저 실행해야 한다.
-- 실행 위치: Supabase Dashboard → SQL Editor
-- ============================================================

alter table public.sensor_devices
  -- 라즈베리파이 CPU 시리얼 등 하드웨어 고정값. 기기를 눈으로 구분하는 용도.
  add column if not exists serial text,
  -- 장비에서 돌아가는 클라이언트 버전. 문제 생겼을 때 원인 추적용.
  add column if not exists firmware text,
  -- 마지막으로 수신한 원본 측정값 전체(JSON).
  -- 수질 기록에 저장하지 않는 값(전도도·TDS·ORP 등)도 여기에는 남아
  -- 기기가 실제로 무엇을 보내고 있는지 화면에서 확인할 수 있다.
  add column if not exists last_payload jsonb;

-- 같은 보드를 두 번 등록하는 실수를 잡기 위한 인덱스(유일성은 강제하지 않는다.
-- 보드를 교체하고 기존 기기 항목을 재사용하는 경우가 있기 때문).
create index if not exists idx_sensor_devices_serial
  on public.sensor_devices (serial)
  where serial is not null;


-- ==================== sensor_pairing.sql ====================
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


-- ==================== sensor_agent_update.sql ====================
-- ============================================================
-- 센서 장비 원격 소프트웨어 업데이트
-- Supabase SQL Editor 에서 실행하세요.
--
-- 승인제입니다. 기기는 스스로 최신 버전을 받아가지 않고,
-- 계정 주인이 웹에서 "업데이트" 를 누른 기기만 다음 확인 때 받아 갑니다.
--
-- 꾸러미의 진짜 여부는 이 표가 아니라 **서명**이 보장합니다.
-- 이 표는 "어느 기기에 어느 버전을 허용했는가" 만 담습니다.
-- 그래서 이 DB 가 통째로 털려도 남의 장비에서 코드를 실행할 수는 없습니다.
-- ============================================================

ALTER TABLE public.sensor_devices
  -- 기기가 보고한 현재 버전
  ADD COLUMN IF NOT EXISTS agent_version     TEXT,
  ADD COLUMN IF NOT EXISTS agent_version_at  TIMESTAMPTZ,

  -- 주인이 승인한 목표 버전. NULL 이면 "업데이트하지 말 것".
  ADD COLUMN IF NOT EXISTS update_to         TEXT,
  ADD COLUMN IF NOT EXISTS update_requested_at TIMESTAMPTZ,

  -- 기기가 되보고하는 진행 상황
  ADD COLUMN IF NOT EXISTS update_status     TEXT,
  ADD COLUMN IF NOT EXISTS update_message    TEXT,
  ADD COLUMN IF NOT EXISTS update_status_at  TIMESTAMPTZ;

-- 버전 문자열은 기기가 내려받을 주소의 일부가 된다.
-- 형식을 DB 에서 한 번, 기기에서 한 번 더 막는다.
DO $$ BEGIN
  ALTER TABLE public.sensor_devices
    ADD CONSTRAINT sensor_devices_update_to_format
    CHECK (update_to IS NULL OR update_to ~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.sensor_devices
    ADD CONSTRAINT sensor_devices_agent_version_format
    CHECK (agent_version IS NULL OR agent_version ~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.sensor_devices
    ADD CONSTRAINT sensor_devices_update_status_valid
    CHECK (update_status IS NULL OR update_status IN
      ('requested','downloading','applied','failed','rolled_back'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 업데이트를 기다리는 기기만 훑을 때 쓴다.
CREATE INDEX IF NOT EXISTS idx_sensor_devices_update_pending
  ON public.sensor_devices(update_to)
  WHERE update_to IS NOT NULL;

DO $$ BEGIN
  RAISE NOTICE '원격 업데이트 컬럼이 추가되었습니다.';
END $$;


-- ==================== farm_coordinates.sql ====================
-- ============================================================
-- 양식장 좌표
-- Supabase SQL Editor 에서 실행하세요.
--
-- 지도 표시와 기상 연동(폭우·태풍 경보)에 쓰입니다.
-- 라즈베리파이에 GPS 를 달 필요는 없습니다 — 장비는 수조 옆에 고정되어
-- 움직이지 않으므로, 농장 좌표만 있으면 장비 위치도 정해집니다.
-- 오히려 GPS 는 창고 안에서 위성이 안 잡혀 측위가 되지 않습니다.
-- ============================================================

ALTER TABLE public.farms
  ADD COLUMN IF NOT EXISTS latitude   DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude  DOUBLE PRECISION;

-- 좌표 범위를 벗어난 값이 들어오면 지도가 엉뚱한 곳을 가리키고
-- 기상 예보도 다른 지역 것을 끌어온다.
DO $$ BEGIN
  ALTER TABLE public.farms
    ADD CONSTRAINT farms_latitude_range
    CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.farms
    ADD CONSTRAINT farms_longitude_range
    CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 좌표가 있는 농장만 지도·기상에 태운다.
CREATE INDEX IF NOT EXISTS idx_farms_coords
  ON public.farms(latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

DO $$ BEGIN
  RAISE NOTICE '양식장 좌표 컬럼이 추가되었습니다.';
END $$;


-- ==================== control_center.sql ====================
-- ============================================================
-- 관제센터 권한
-- Supabase SQL Editor 에서 실행하세요.
--
-- 권한은 두 단계다.
--   · 총 관리자(admin)  — kjs100184@gmail.com 하나로 고정. 매니저를 선임·해임한다.
--   · 매니저(manager)   — 총 관리자가 선임. 관제센터를 볼 수 있지만 선임은 못 한다.
--
-- 판별은 전부 서버에서 한다. 화면의 역할 표시는 편의일 뿐이고,
-- 실제 데이터는 API 가 세션으로 역할을 확인한 뒤에만 내준다.
-- 자기 role 을 스스로 바꾸는 길은 security_hardening_profiles.sql 에서
-- 이미 막혀 있다(authenticated 는 name 컬럼만 UPDATE 가능).
-- ============================================================

-- 1) role 값을 네 가지로 제한한다.
--    지금까지 제약이 없어 어떤 문자열이든 들어갈 수 있었다.
--
--    CHECK 를 걸기 전에 기존 데이터를 먼저 정리한다. 네 값 밖의 role 이
--    하나라도 있으면 제약 추가가 통째로 실패하기 때문이다. NULL 이나
--    예상 밖 값은 기본값인 operator 로 되돌린다(권한이 없는 쪽으로 안전하게).
UPDATE public.profiles
SET role = 'operator'
WHERE role IS NULL OR role NOT IN ('admin', 'manager', 'operator', 'viewer');

DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_role_valid
    CHECK (role IN ('admin', 'manager', 'operator', 'viewer'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CHECK 는 role IS NULL 을 통과시킨다. 신규 행이 role 없이 들어오는 것을 막고
-- 기본값을 operator(최소 권한)로 고정한다.
ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'operator';
DO $$ BEGIN
  ALTER TABLE public.profiles ALTER COLUMN role SET NOT NULL;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'role 을 NOT NULL 로 바꾸지 못했습니다(%). 기존 NULL 이 남아 있는지 확인하세요.', SQLERRM;
END $$;

-- 2) 총 관리자 지정.
--    이메일로 계정을 찾아 role 을 admin 으로 올린다. 아직 가입 전이면
--    아무 일도 하지 않으므로, 가입 후 이 파일을 다시 실행하면 된다.
UPDATE public.profiles
SET role = 'admin'
WHERE id = (SELECT id FROM auth.users WHERE email = 'kjs100184@gmail.com')
  AND role IS DISTINCT FROM 'admin';

DO $$
DECLARE
  found int;
BEGIN
  SELECT count(*) INTO found FROM auth.users WHERE email = 'kjs100184@gmail.com';
  IF found = 0 THEN
    RAISE NOTICE '아직 kjs100184@gmail.com 계정이 없습니다. 가입 후 이 파일을 다시 실행하세요.';
  ELSE
    RAISE NOTICE '총 관리자가 지정되었습니다: kjs100184@gmail.com';
  END IF;
END $$;

