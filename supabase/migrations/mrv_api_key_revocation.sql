-- ---------------------------------------------------------------------------
-- MRV 장비 키 폐기 — 발급한 수집 키를 끊을 수 있게 한다.
--
-- ── 왜 ───────────────────────────────────────────────────────────────────────
-- `mrv_api_keys.revoked` 는 처음부터 있었고, 인증 경로가 실제로 그 값을 본다
-- (`lib/mrv/device-auth.ts` — 폐기된 키는 없는 키와 구분하지 않고 401 이다).
-- 발급 경로도 있다(`mrv_device_pairings` → 6자리 코드 승인, POST /api/mrv/pair/claim).
--
-- 그런데 **그 열을 true 로 바꾸는 경로가 화면에도 API 에도 없었다.** 기계실 터치스크린을
-- 분실하거나 교체하거나 반납해도 키를 끊는 방법이 DB 직접 수정뿐이었다는 뜻이다.
-- 이것이 상용화 전에 반드시 막혀야 하는 구멍인 이유는 그 키가 무엇을 할 수 있는지에
-- 있다 — 장비 키 하나로 **그 사이트의 전력 계측값을 넣을 수 있고**, 그 전력은 EI ·
-- Scope2 · 기준선의 근거가 된다. 분실한 단말을 끊지 못하면 탄소 증빙의 입력 경로가
-- 통제 밖에 남는다.
--
-- ── 이 마이그레이션이 더하는 것 ─────────────────────────────────────────────
-- 끊는 동작 자체는 기존 `revoked` 열로 된다. 여기서 더하는 세 열은 **증빙**이다.
--
--   last_used_at : 이 키가 마지막으로 인증을 통과한 시각.
--                  운영자가 "어느 키를 끊어도 되는가" 를 판단하는 유일한 단서다. 이 칸이
--                  없으면 목록에 라벨만 늘어서고, 그중 무엇이 아직 살아 있는 장비인지
--                  알 수 없어 **아무것도 못 끊는다.** 되돌릴 수 없는 동작이라 더 그렇다.
--   revoked_at   : 끊은 시각. 「그 장비가 넣은 계측값이 어디까지 유효한가」 를 되짚는
--                  기준이 된다. revoked=true 만으로는 그 선을 그을 수 없다.
--   revoked_by   : 끊은 사람(mrv_users.id). 감사 로그에도 남지만, 키 행 자체가 들고 있어야
--                  감사 로그 열람 권한(ENTERPRISE 플랜)이 없는 조직도 되짚을 수 있다.
--
-- ★ 세 열은 모두 **기록이고 게이트가 아니다.** 인증 게이트는 `revoked` 하나이며
--   (`lib/mrv/device-auth.ts`), 그 판정을 두 열로 나누지 않는다 — 조건이 둘로 갈리면
--   한쪽만 채워지는 날 폐기한 키가 통과한다. 그래서 `revoked_at is not null` 을
--   인증 조건에 넣지 않고, 그 일관성을 강제하는 제약도 걸지 않는다(아래 참조).
--
-- ── 기존 행은 어떻게 되는가 ─────────────────────────────────────────────────
-- 이미 revoked=true 인 행이 있다면 그 행의 `revoked_at` 은 **null 로 남는다.**
-- 비워 두는 것이 의도다 — 그 행들은 SQL 직접 수정으로 끊긴 것이고 언제 끊겼는지
-- 아는 기록이 없다. created_at 같은 값으로 메우면 **없는 사실을 만들어 내는 것**이고,
-- 증빙 시스템에서 그것은 빈 칸보다 나쁘다. 화면은 `revoked=true` 이면서
-- `revoked_at is null` 인 행을 "시각 미기록" 으로 적는다.
--
-- 같은 이유로 `check (revoked = (revoked_at is not null))` 같은 제약을 걸지 않는다 —
-- 기존 행이 그 제약을 위반하고, `not valid` 로 피해 가면 제약이 지키는 것이 없다.
--
-- 멱등이다. 여러 번 실행해도 안전하다.
-- ---------------------------------------------------------------------------

alter table public.mrv_api_keys
  add column if not exists last_used_at timestamptz;

alter table public.mrv_api_keys
  add column if not exists revoked_at   timestamptz;

alter table public.mrv_api_keys
  add column if not exists revoked_by   text;

-- 외래키는 따로 건다 — `add column if not exists` 에 references 를 붙이면 열이 이미
-- 있을 때 제약만 따로 붙일 길이 없다. 삭제된 사용자 때문에 키 행이 사라지면 안 되므로
-- on delete set null 이다(누가 끊었는지는 감사 로그에 남는다).
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'mrv_api_keys_revoked_by_fkey'
       and conrelid = 'public.mrv_api_keys'::regclass
  ) then
    alter table public.mrv_api_keys
      add constraint mrv_api_keys_revoked_by_fkey
      foreign key (revoked_by) references public.mrv_users(id) on delete set null;
  end if;
end
$$;

-- 설정 화면의 키 목록은 (site_id, 발급일 내림차순) 으로 읽는다.
create index if not exists ix_mrv_api_keys_site_created
  on public.mrv_api_keys (site_id, created_at desc);

comment on column public.mrv_api_keys.last_used_at is
  '이 키가 마지막으로 인증을 통과한 시각. 쓰기를 아끼려고 매 요청이 아니라 몇 분에 '
  '한 번만 갱신된다(lib/mrv/device-auth.ts 의 LAST_USED_REFRESH_MS). 따라서 분 단위 '
  '정확도를 가정하지 말 것 — "이 장비가 아직 살아 있는가" 를 묻는 칸이다.';

comment on column public.mrv_api_keys.revoked_at is
  '키를 끊은 시각. revoked=true 인데 이 칸이 비어 있으면 이 마이그레이션 이전에 '
  'SQL 직접 수정으로 끊긴 행이며, 끊긴 시각을 아는 기록이 없다는 뜻이다(추정값으로 '
  '메우지 않는다).';

comment on column public.mrv_api_keys.revoked_by is
  '키를 끊은 mrv_users.id. 인증 게이트는 revoked 열 하나이며 이 칸은 증빙이다.';
