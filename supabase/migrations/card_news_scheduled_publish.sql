-- ============================================================
-- 카드뉴스 예약 발행 — 게시일이 지나야 읽히게 한다
--
-- 기존 정책은 published = true 만 봤다. 그래서 published_at 을 미래로
-- 잡아 미리 넣어 둔 글도 anon 키로 곧바로 읽혔다.
-- NEXT_PUBLIC_SUPABASE_ANON_KEY 는 브라우저에 노출되므로, 앱을 거치지
-- 않고 Supabase REST 를 직접 호출하면 발행 전 원고가 그대로 나온다.
--
-- 조회 계층(lib/card-news-server.ts)에도 같은 조건이 있지만, 그쪽은
-- 우리 앱을 통과하는 요청에만 적용된다. 여기서 한 번 더 막는다.
--
-- service_role 은 RLS 를 우회하므로 관리자 API(/api/cardnews)는 발행 전
-- 글도 그대로 읽고 쓴다.
--
-- 실행 조건: card_news.sql 을 먼저 실행해 테이블과 정책이 있어야 한다.
-- 재실행 안전: 정책을 지우고 다시 만든다.
-- ============================================================

drop policy if exists "card_news public read" on public.card_news;
create policy "card_news public read"
  on public.card_news for select
  to anon, authenticated
  using (published = true and published_at <= now());

-- 조회수 증가 함수도 발행 전 글에는 반응하지 않게 맞춰 둔다.
-- SECURITY DEFINER 라 RLS 를 우회하므로 함수 안에서 직접 걸러야 한다.
create or replace function public.increment_card_news_view(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.card_news
  set view_count = view_count + 1
  where id = p_id and published = true and published_at <= now();
$$;

grant execute on function public.increment_card_news_view(uuid) to anon, authenticated;
