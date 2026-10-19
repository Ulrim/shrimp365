-- ---------------------------------------------------------------------------
-- 2023년도 전력 배출계수(0.4173)의 **출처를 1차 자료로 확정한다.**
--
-- ── 왜 지금인가 ─────────────────────────────────────────────────────────────
-- `mrv_emission_factor_2023.sql` 이 이 행을 넣을 때 source 에 이렇게 적어 두었다:
--
--     [원문 PDF 대조 전 — GIR 공표 문서명·URL 보강 필요]
--
-- 값·연도·공표일은 맞지만 **어느 문서의 몇 쪽인지**를 적지 못한 상태였다. 배출계수는
-- Scope 2 배출량 전체를 곱으로 결정하는 단 하나의 숫자이고, 검증기관이 가장 먼저 묻는
-- 것이 "그 숫자를 어디서 가져왔는가" 다. 출처가 비어 있으면 숫자가 맞아도 증빙이 되지
-- 않는다.
--
-- 사람이 작성한 MRV 계산표(2026-08-01~10-16, 브로워 2대)의 「지표정의」 시트가 그
-- 대조를 끝내 두었다. 같은 값을 세 경로로 확인한 기록이다:
--
--   S02  GIR 「2025년 승인 국가 온실가스 배출·흡수계수」 1쪽
--        CO2e 0.4173 t/MWh · CO2 0.4149 t/MWh · 2023년 소비단 · 2025-12-18 공표
--        https://www.gir.go.kr/home/board/read.do?boardId=86&boardMasterId=2&menuId=36
--   S03  한국에너지공단 계수표 (확인일 2026-10-18)
--        https://tips.energy.or.kr/carbon/Ggas_tatistics03.do
--   S04  공표 보도자료 (2025-12-18)
--        https://mcee.go.kr/home/web/board/read.do?boardId=1829260&boardMasterId=1&menuId=10357
--
-- ── 무엇을 바꾸고 무엇을 안 바꾸는가 ────────────────────────────────────────
-- **값(factor_tco2e_per_mwh)·연도·version·effective_from 은 건드리지 않는다.** 이
-- 마이그레이션이 채우는 것은 비어 있던 출처 열뿐이다(document_name·issuing_body·
-- source_url·published_on). 숫자가 바뀌면 이미 발행된 리포트의 근거가 사후에 달라진다.
--
-- 이미 발행된 리포트는 영향을 받지 않는다 — 리포트는 발행 시점의 계수 출처를
-- `boundary_json.emission_factor` 에 **얼려서** 들고 있다. 그래서 이 보강 이후에
-- 발행되는 리포트부터 1차 출처가 인쇄된다. 그것이 맞다: 발행 당시 알고 있던 것을
-- 발행물이 말해야 한다.
--
-- ── CO2 단독 계수(0.4149)를 여기 넣지 않은 이유 ─────────────────────────────
-- 같은 자료가 CO2 단독 0.4149 kgCO2/kWh 도 함께 공표한다. 넣고 싶지만 **지금 넣으면
-- 안 된다** — `mrv-report-service.ts` 의 활성 계수 자동 선택이
--
--     .is("deprecated_at", null).order("effective_from", desc).limit(1)
--
-- 이고 **gas_scope 를 보지 않는다.** 같은 effective_from 으로 CO2 단독 행을 넣으면
-- 정렬이 모호해져 **리포트가 0.4149 를 Scope 2 CO2e 로 집어 쓸 수 있다.** 계산표의
-- 지표정의 시트도 같은 함정을 경고한다 — "CO2e 안에 포함되는 CO2 성분입니다.
-- CO2e와 CO2를 더하면 중복 계산입니다."
--
-- CO2 단독 행은 자동 선택에 `gas_scope = 'CO2e'` 조건을 더하는 변경과 **한 묶음으로**
-- 넣는다. 그 전까지는 넣지 않는 것이 안전하다.
--
-- 멱등이다. 여러 번 실행해도 안전하다.
-- ---------------------------------------------------------------------------

update public.mrv_emission_factors
   set document_name = '2025년 승인 국가 온실가스 배출·흡수계수',
       issuing_body  = '온실가스종합정보센터(GIR)',
       source_url    = 'https://www.gir.go.kr/home/board/read.do'
                       || '?boardId=86&boardMasterId=2&menuId=36',
       published_on  = date '2025-12-18',
       -- source 에 남아 있던 "원문 PDF 대조 전" 꼬리표를 떼고, 대조에 쓴 경로를 적는다.
       source = '기후에너지환경부 국가 온실가스 통계 관리위원회 확정 2023년도 국가 '
                || '전력배출계수 (2025-12-17 확정 · 2025-12-18 공표) · CO2e 기준 · '
                || '단년도 평균 · GIR 「2025년 승인 국가 온실가스 배출·흡수계수」 1쪽 '
                || '(한국에너지공단 계수표 tips.energy.or.kr 및 공표 보도자료로 교차 확인, '
                || '확인일 2026-10-18)'
 where version = 'KR-GRID-2023'
   -- 이미 채워진 행은 건드리지 않는다. 사람이 더 정확한 쪽수를 적어 넣었을 수 있다.
   and (source_url is null or source_url = '');

-- 확인용. 비어 있으면 위 update 가 아무 행도 못 찾은 것이다(version 이 다르거나
-- 이미 채워져 있다는 뜻). 조용히 지나가지 않도록 알린다.
do $$
declare
  filled integer;
begin
  select count(*) into filled
    from public.mrv_emission_factors
   where version = 'KR-GRID-2023'
     and source_url is not null
     and source_url <> '';
  if filled = 0 then
    raise warning 'KR-GRID-2023 계수의 출처가 비어 있습니다 — 이 마이그레이션이 '
                  '대상을 찾지 못했을 수 있습니다. version 값을 확인하세요.';
  end if;
end $$;
