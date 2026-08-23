-- ============================================================
-- 웹푸시 구독 (앱을 닫아도 오는 알림)
--
-- 지금까지 기기 알림은 브라우저 탭 안에서 new Notification() 으로 띄웠다.
-- 그건 탭이 살아 있어야만 뜬다. 새벽 세 시에 DO 가 무너지는 순간이 정확히
-- 이 알림이 필요한 때인데, 그때 앱은 닫혀 있다. 게다가 안드로이드 크롬은
-- 그 생성자를 아예 막아서 양식장 운영자 주력 단말에서는 한 건도 안 온다.
--
-- 해결은 서비스워커 + 서버 푸시다. 브라우저가 푸시 서비스(FCM·Mozilla·Apple)
-- 에서 받아 온 구독 정보를 여기에 저장해 두면, 센서 API 가 이상을 감지할 때
-- 서버가 그 주소로 밀어 준다.
--
-- 저장하는 값은 브라우저가 만들어 준 PushSubscription 그대로다.
--   endpoint — 푸시 서비스가 발급한 이 기기 전용 주소. 사실상 기본키다.
--   p256dh·auth — 본문을 암호화해 보낼 때 쓰는 공개키와 인증 비밀값.
--                 서버는 이 값으로 암호화만 하고 복호화는 브라우저가 한다.
--
-- 실행 위치: Supabase Dashboard → SQL Editor
-- 재실행 안전(멱등)하다.
-- ============================================================

create table if not exists public.push_subscriptions (
  -- 푸시 서비스가 발급한 주소가 곧 기기 식별자다. 같은 주소가 두 줄이면
  -- 같은 알림이 두 번 가므로 기본키로 못 박는다.
  endpoint     text primary key,

  user_id      uuid not null references auth.users(id) on delete cascade,

  p256dh       text not null,
  auth         text not null,

  -- 어느 기기인지 사람이 알아볼 단서. 나중에 "이 기기 알림 끄기" 화면을
  -- 만들 때 필요하다. 없어도 발송에는 지장이 없다.
  user_agent   text,

  created_at   timestamptz not null default now(),
  -- 마지막으로 이 구독에 실제로 밀어 넣은 시각. 오래 안 쓰인 구독을
  -- 골라내는 근거가 된다(만료 구독은 410 응답을 받는 즉시 서버가 지운다).
  last_used_at timestamptz
);

-- 발송할 때는 항상 "이 사용자의 모든 기기"로 조회한다. 그 경로에 인덱스를 둔다.
create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

-- ─── RLS: 본인 구독만 다룰 수 있다 ────────────────────────────────────────
-- service_role 은 RLS 를 우회하므로 서버가 발송 시 전체를 조회할 수 있다.
-- 정책은 브라우저(anon 키)에서 직접 접근하는 경우를 위한 것이다.
alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions_select_own" on public.push_subscriptions;
create policy "push_subscriptions_select_own" on public.push_subscriptions
  for select using (auth.uid() = user_id);

drop policy if exists "push_subscriptions_insert_own" on public.push_subscriptions;
create policy "push_subscriptions_insert_own" on public.push_subscriptions
  for insert with check (auth.uid() = user_id);

drop policy if exists "push_subscriptions_update_own" on public.push_subscriptions;
create policy "push_subscriptions_update_own" on public.push_subscriptions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "push_subscriptions_delete_own" on public.push_subscriptions;
create policy "push_subscriptions_delete_own" on public.push_subscriptions
  for delete using (auth.uid() = user_id);

-- ─── 구독 저장 함수 ───────────────────────────────────────────────────────
-- 그냥 upsert 로 두면 안 되는 경우가 하나 있다.
--
-- 창고에 놓인 태블릿 한 대를 두 사람이 번갈아 쓰면, 앞사람이 로그아웃하고
-- 뒷사람이 로그인해도 브라우저의 푸시 endpoint 는 그대로다. 이때 뒷사람의
-- upsert 는 앞사람 소유의 행을 건드리게 되는데, RLS 가 그것을 막는다.
-- 막히면 알림은 계속 **앞사람에게** 간다 — 오작동이자 사생활 문제다.
--
-- 그래서 이 한 동작만 security definer 로 처리한다. 소유자를 옮기는 일은
-- 정책 문법으로 표현할 수 없는 종류의 조작이라, service_role 키를 API 에서
-- 쓰는 대신 검토 가능한 DB 함수 안에 가둔다. 신원은 auth.uid() 로만 잡고
-- 클라이언트가 보낸 user_id 는 아예 받지 않는다.
create or replace function public.save_push_subscription(
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;
  if p_endpoint is null or p_p256dh is null or p_auth is null then
    raise exception '구독 정보가 불완전합니다.' using errcode = '22023';
  end if;

  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth, user_agent)
  values (p_endpoint, uid, p_p256dh, p_auth, p_user_agent)
  on conflict (endpoint) do update
    set user_id    = excluded.user_id,
        p256dh     = excluded.p256dh,
        auth       = excluded.auth,
        user_agent = coalesce(excluded.user_agent, public.push_subscriptions.user_agent);
end;
$$;

revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
