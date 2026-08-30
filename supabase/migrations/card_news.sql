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
