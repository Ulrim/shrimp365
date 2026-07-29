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
