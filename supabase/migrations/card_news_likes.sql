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
