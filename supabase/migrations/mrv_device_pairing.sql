-- ---------------------------------------------------------------------------
-- MRV 현장 장비 페어링 — 라즈베리파이를 전력 수기 입력 단말로 붙인다.
--
-- ── 왜 ───────────────────────────────────────────────────────────────────────
-- 전력(kWh)은 사람이 수기로 넣는다. 그런데 계량기는 기계실에 있고 작업자는 그 앞에
-- 서 있는데, 입력 창구는 사무실 PC 의 웹 화면뿐이었다 — 지침을 종이에 적어 와서 다시
-- 옮겨 적는 일이 생긴다. 옮겨 적는 단계마다 오기가 끼고, 그 값이 되돌릴 수 없는
-- 기준선의 근거가 된다. 현장 장비에서 바로 넣게 하는 것이 그 단계를 없앤다.
--
-- ── 왜 수질 쪽 페어링을 그대로 쓰지 않는가 ───────────────────────────────────
-- 파이에는 이미 검증된 6자리 코드 페어링이 있다(`sensor_pairings` → `sensor_devices`).
-- 그 UX 는 그대로 가져오지만 **테이블을 따로 둔다.** 두 체계의 객체 그래프가 다르기
-- 때문이다 — 수질은 `farms → tanks → sensor_devices` 에 `auth.users.id` 로 묶이고,
-- MRV 는 `mrv_organizations → mrv_sites` 에 `mrv_users` 로 묶인다. 한 테이블에 섞으면
-- 수질 장치 키가 탄소 증빙 창구를 열 수 있게 되고, 그건 두 지원사업(성장사다리 ·
-- 스프링캠프)의 분리를 깨는 일이다.
--
-- 발급되는 것은 기존 `mrv_api_keys` 행이다(새 키 체계를 만들지 않는다). 지금까지 그
-- 행은 SQL 로만 넣을 수 있었다 — 발급 화면도 API 도 없었다. 이 페어링이 그 구멍을 메운다.
--
-- ── 설계 ────────────────────────────────────────────────────────────────────
--   1) 장비가 코드를 요청한다 → 6자리 `code` + 장비만 아는 `pairing_secret`.
--   2) 장비가 코드를 화면에 띄운다. 운영자가 웹에서 그 코드와 **사이트**를 지정해 승인.
--   3) 승인 시 `mrv_api_keys` 행이 생기고, 장비가 `pairing_secret` 으로 폴링해 원문 키를
--      받는다. **코드만 알아낸 제3자는 키를 가져갈 수 없다**(secret 이 있어야 한다).
--
-- 원문 키는 `mrv_api_keys` 에 해시로만 저장되므로(기존 규약), 승인 시점에 만든 원문을
-- 장비가 가져갈 때까지 이 표에 잠깐 들고 있어야 한다. 그 자리가 `issued_key` 이고,
-- 장비가 받아 가면 비운다. 15분 만료도 그래서 짧게 둔다.
--
-- 멱등이다. 여러 번 실행해도 안전하다.
-- ---------------------------------------------------------------------------

create table if not exists public.mrv_device_pairings (
  id              text primary key,

  -- 장비 화면에 띄우는 6자리. 사람이 눈으로 옮기는 값이라 짧게 유지한다.
  code            text not null check (code ~ '^[0-9]{6}$'),

  -- 코드를 요청한 장비만 아는 값. 원문 키는 이것을 제시해야 받을 수 있다.
  pairing_secret  text not null unique,

  -- 장비 자기소개. 승인 화면에서 "어느 기기인가" 를 보여 준다.
  serial          text,
  firmware        text,

  -- 승인되면 채워진다. 어느 org·site 에 붙었는지, 누가 승인했는지.
  org_id          text references public.mrv_organizations(id) on delete cascade,
  site_id         text references public.mrv_sites(id) on delete cascade,
  api_key_id      text references public.mrv_api_keys(id) on delete cascade,
  claimed_by      text references public.mrv_users(id) on delete set null,
  claimed_at      timestamptz,

  -- 장비가 가져갈 원문 키. 가져가면 null 로 비운다.
  -- ★ 이 열에 값이 남아 있는 시간을 짧게 유지하는 것이 이 설계의 전부다.
  issued_key      text,

  -- 코드를 오래 열어 두면 추측 공격의 여지가 커진다. 6자리는 100만 가지뿐이다.
  expires_at      timestamptz not null default (now() + interval '15 minutes'),
  created_at      timestamptz not null default now()
);

-- 아직 승인되지 않은 코드는 서로 겹치면 안 된다(승인이 끝난 코드는 재사용 가능).
create unique index if not exists ux_mrv_device_pairings_active_code
  on public.mrv_device_pairings (code)
  where claimed_at is null;

create index if not exists ix_mrv_device_pairings_site_id
  on public.mrv_device_pairings (site_id);

-- 만료된 미승인 행 청소. 장비가 코드를 새로 요청할 때 함께 불린다.
create or replace function public.purge_expired_mrv_device_pairings()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.mrv_device_pairings
   where claimed_at is null
     and expires_at < now();
$$;

comment on column public.mrv_device_pairings.issued_key is
  '장비가 한 번 가져가면 비우는 원문 API 키. mrv_api_keys 에는 해시만 저장되므로 '
  '승인 시점과 장비 수령 사이에만 존재한다.';
