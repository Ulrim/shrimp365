-- ---------------------------------------------------------------------------
-- mrv_emission_factors 출처 구조화 — 제3자 검증 대응.
--
-- ── 왜 ───────────────────────────────────────────────────────────────────────
-- 지금 출처는 `source` 자유 문자열 하나에 전부 뭉쳐 있다. 운영자가 아무 문장이나 적을 수
-- 있고 그게 그대로 리포트에 인쇄된다. 검증기관(ISO 14064-1/-3, K-ETS 검증)은 "검증이
-- 가능하도록 산정 근거 문서를 보존하고 산정 접근법 선택을 정당화하라"를 요구하는데,
-- 자유 문장으로는 **무엇을 제시해야 하는지 운영자가 알 수 없다.** 칸을 나누면 비어 있는
-- 칸이 곧 "아직 못 댄 근거" 가 된다.
--
-- ── 특히 gas_scope 가 필요한 이유 ────────────────────────────────────────────
-- 같은 승인분이 **CO2e 판과 CO2 판으로 둘 다 공표된다.** 2023년도분은 CO2e 0.4173 /
-- CO2 만 0.4149 이고, 2021년 승인분은 CO2e 0.4781 / CO2 만 0.4747 이다(후자는
-- 「탄소중립포인트 제도 산정방법」 별표 7 에 수록된 값). 즉 **문서에 따라 어느 판이
-- 실리는지가 다르다.** 열이 없으면 두 판이 같은 칸에 섞여 들어가고, 섞인 뒤에는 어느
-- 쪽인지 되짚을 방법이 없다 — 검증기관이 가장 먼저 묻는 것이 이것이다.
--
-- ── basis_from_year / basis_to_year ──────────────────────────────────────────
-- 2025년 12월부터 갱신 주기가 3년 → 1년으로 바뀌어 **단년도 계수**를 공표하지만, 그 전
-- 값들은 **3년 평균**이다(2024년 승인분 = 2020~2022 평균 = 0.4541). "0.4541 의 연도" 를
-- 하나로 적을 수 없다는 뜻이다. 두 열로 나누면 단년도는 from=to 로, 3년 평균은
-- from≠to 로 **모호함 없이** 적힌다.
--
-- 기존 `year` 열은 그대로 둔다. 리포트가 인쇄하는 라벨이고(`version (source, year년)`),
-- 고치면 이미 발행된 리포트의 인쇄 내용이 바뀐다. `year` = 사람이 읽는 대표 연도,
-- `basis_*` = 기계가 읽는 기준 기간이다.
--
-- ── method ──────────────────────────────────────────────────────────────────
-- GHG Protocol Scope 2 는 location-based(계통 평균)와 market-based(REC·PPA 계약 반영)
-- **이중 보고**를 요구한다. 지금 플랫폼이 쓰는 계수는 전부 location-based 이므로 그렇게
-- 못박아 둔다. ⚠ **이 열이 market-based 산정을 구현하는 것은 아니다** — 그건 REC 수량·
-- 발급기관·소각 증빙·PPA 계약량을 담는 별도 테이블이 필요한 별건이다. 한국에는 공표된
-- residual mix 가 없어 보이므로(GHGP 교육자료는 "현재 EU 만"), 그때 잔여 전력에 국가
-- 평균을 쓰는 근사와 그 사실의 리포트 명기까지 함께 설계해야 한다.
--
-- ── 더하기만 한다 ───────────────────────────────────────────────────────────
-- 모든 열이 추가이고 기존 열(factor·source·year·version·effective_from)은 건드리지
-- 않는다. 리포트 PDF 가 계수 행을 활성 조인해 인쇄하므로 기존 열을 고치면 발행된
-- 리포트의 내용이 사후에 바뀐다.
--
-- 멱등이다. 여러 번 실행해도 안전하다.
-- ---------------------------------------------------------------------------

alter table public.mrv_emission_factors
  -- 온실가스 범위. CO2e(CH4·N2O 포함) 인지 CO2 만인지.
  add column if not exists gas_scope text not null default 'CO2e',
  -- 계수가 설명하는 기준 기간. 단년도는 from=to, 3년 평균은 from≠to.
  add column if not exists basis_from_year integer,
  add column if not exists basis_to_year integer,
  -- 공표 문서 자체를 가리키는 칸. 검증기관에 제시하는 것이 이것이다.
  add column if not exists document_name text,
  add column if not exists issuing_body text,
  add column if not exists published_on date,
  add column if not exists source_url text,
  -- GHG Protocol Scope 2 산정 방식.
  add column if not exists method text not null default 'location_based';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_mrv_emission_factors_gas_scope') then
    alter table public.mrv_emission_factors
      add constraint ck_mrv_emission_factors_gas_scope check (gas_scope in ('CO2e', 'CO2'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_mrv_emission_factors_method') then
    alter table public.mrv_emission_factors
      add constraint ck_mrv_emission_factors_method
      check (method in ('location_based', 'market_based'));
  end if;
  -- 기준 기간은 둘 다 있거나 둘 다 없어야 하고, 뒤집히면 안 된다. 한쪽만 적힌 기간은
  -- 단년도인지 평균인지 알 수 없어 적지 않은 것과 같다.
  if not exists (select 1 from pg_constraint where conname = 'ck_mrv_emission_factors_basis_years') then
    alter table public.mrv_emission_factors
      add constraint ck_mrv_emission_factors_basis_years check (
        (basis_from_year is null and basis_to_year is null)
        or (basis_from_year is not null and basis_to_year is not null
            and basis_from_year <= basis_to_year)
      );
  end if;
end $$;

comment on column public.mrv_emission_factors.gas_scope is
  'CO2e(CH4·N2O 포함) 또는 CO2 만. 같은 승인분이 두 판으로 공표되므로 반드시 구분한다.';
comment on column public.mrv_emission_factors.basis_from_year is
  '계수가 설명하는 기준 기간의 시작 연도. 단년도 계수는 basis_to_year 와 같다.';
comment on column public.mrv_emission_factors.method is
  'GHG Protocol Scope 2 산정 방식. 이 열은 분류만 하며 market-based 산정을 구현하지 않는다.';

-- 2023년도 계수 행에 **확인된 범위만** 채운다. 문서명·URL 은 사람이 GIR 원문을 열어
-- 확인한 뒤 채울 칸이라 비워 둔다 — 추측으로 채우면 검증에서 그게 가장 먼저 깨진다.
update public.mrv_emission_factors
   set gas_scope       = 'CO2e',
       basis_from_year = 2023,
       basis_to_year   = 2023,
       issuing_body    = '기후에너지환경부 국가 온실가스 통계 관리위원회',
       published_on    = date '2025-12-18',
       method          = 'location_based'
 where version = 'KR-GRID-2023'
   and basis_from_year is null;
