-- ---------------------------------------------------------------------------
-- mrv_harvest_logs 의 산정 근거 — 그 생체량을 **저울이 쟀는가, 산식이 냈는가**.
--
-- ── 왜 ───────────────────────────────────────────────────────────────────────
-- EI·폭기 EI·FCR·OEI 의 **분모**는 이 표의 기간 양 끝 생체량 차이(Δbiomass)다
-- (lib/mrv/kpi-service.ts::pickBiomassBounds). 즉 이 표의 한 칸이 네 지표 전부의
-- 성질을 결정한다.
--
-- 그 구멍이 구체적으로 어떻게 터지는가. 실제로 받은 MRV 계산표는 생산량에 대해 이렇게
-- 적어 두었다:
--
--     생산량_산정유형      입식수×최종체중 계산생체량(실측 출하량 아님)
--     생존율보정_적용여부   미적용
--     입식수_미            100000
--     최종평균개체중_g      35
--
-- 즉 그 3,500 kg 은 **저울에 올린 출하량이 아니라 입식수 × 평균체중으로 계산한 값**이고,
-- 폐사를 반영하는 생존율 보정도 하지 않았다. 분모가 그런 값이면 EI 전체가 그 성질을
-- 물려받는다 — EI 가 낮게 나오는 것이 전기를 덜 쓴 결과인지 생산량을 넉넉히 가정한
-- 결과인지 **플랫폼이 답할 수 없다.** 전력 쪽에 `mrv_readings.measurement_basis` 를 둔 것과
-- 정확히 같은 구멍이고, 같은 모양으로 메운다.
--
-- ── 열 ──────────────────────────────────────────────────────────────────────
--   production_basis       measured  : 실측 출하·계측량(저울·계수기에 올린 값).
--                          calculated: 산식으로 계산(입식수 × 평균체중 등).
--                          estimated : 어림값(기억·경험, 다른 기간에서 미룬 수).
--   production_basis_note  **무엇으로 계산했는지** 사람이 적는 칸(자유 기입).
--   survival_adjusted      생존율 보정을 적용했는가.
--
-- `mrv_readings_measurement_basis.sql` 선례와 같은 모양의 CHECK 하나로 값 집합을
-- 못박는다. 집합 밖의 값은 들어오지 않으므로, 읽는 쪽은 "모르는 문자열" 분기를 가정하지
-- 않아도 된다.
--
-- ── 왜 메모 칸을 따로 두는가 (판단) ─────────────────────────────────────────
-- `calculated` 라벨만 있고 근거가 없으면 **검산할 수 없는 주장**이다. 심사자는 "계산값
-- 이라는데 무엇을 어떻게 곱한 값인가" 를 물을 수밖에 없고, 그 답이 플랫폼에 없으면 라벨은
-- 라벨이 없는 것보다 나쁘다 — 적어 두었으니 확인됐다는 인상만 준다. 그래서 라우트는
-- calculated·estimated 에 이 칸을 **필수로** 요구한다(app/api/mrv/sites/[siteId]/harvests).
-- DB 제약으로 걸지 않은 이유: 이 열이 생기기 전의 행은 전부 null 이므로 NOT VALID 없는
-- CHECK 는 붙지 않고, 붙여 두면 뒤에서 보정 UPDATE 를 막는다. 판정은 쓰기 창구에 둔다.
--
-- ── 왜 생존율 보정이 불리언인가 (판단) ──────────────────────────────────────
-- 보정 계수(예: 0.92)를 숫자로 받고 싶은 유혹이 있지만, 받은 계산표가 적은 사실은
-- "미적용" 하나뿐이다. 없는 숫자를 받을 칸을 만들면 그 칸이 비어 있는 것이 "보정을 안
-- 했다" 인지 "계수를 안 적었다" 인지 갈리지 않는다. 적용 여부만 못박고, 계수를 적어야 할
-- 현장은 `production_basis_note` 에 적는다(그 칸이 자유 기입인 이유 중 하나다).
--
-- ── 기존 행은 null 로 남는다 (판단) ────────────────────────────────────────
-- **셋 다 nullable 이고 default 가 없다.** 이미 쌓인 행은 null 그대로 둔다.
--
-- `measured` 로 채우고 싶은 유혹이 있다 — 수확 기록이라는 이름이 실측을 연상시키니까.
-- 하지만 그 행들이 실측이었다는 **기록은 어디에도 없고**, 없는 사실을 만들어 적는 것은
-- 이 플랫폼에서 빈 칸보다 나쁘다. 같은 판단을 이 저장소가 이미 세 번 적어 두었다 —
-- `mrv_api_key_revocation.sql` 의 `revoked_at`, `mrv_kpi_config_org_scope.sql` 의
-- `created_at`, `mrv_readings_measurement_basis.sql` 의 `measurement_basis`.
--
-- 그래서 **null = 미기재**다. 화면과 리포트가 그것을 "미기재" 로 적고, 실측으로 세지
-- 않으며, 실측이 아니라고도 단정하지 않는다.
--
-- ── 색인을 만들지 않는다 (판단) ────────────────────────────────────────────
-- 이 열로 거르는 질의가 없다. 분모로 쓰인 두 점의 산정 근거는 기간 질의로 이미 읽어 온
-- 행에서 그대로 읽는다(lib/mrv/kpi-service.ts). 쓰이지 않는 색인은 비용만 더한다.
--
-- ⚠ 실행 순서. 이 마이그레이션을 **배포 전에** 돌리는 것이 정상 경로다. 다만 새 코드는
-- 열이 없는 DB 를 만나도 멈추지 않는다 — 수확 기록 조회는 KPI·리포트·알림·기준선 판정
-- 전부의 질의이고, 메타데이터 칸이 없는 것이 증빙 산출을 멈출 이유가 되어서는 안 된다
-- (lib/mrv/production-basis-column.ts, 선례 커밋 632b2a6). 그 상태에서는 산정 근거가
-- 전부 미기재로 집계되고 로그가 10분마다 그 사실을 알린다.
--
-- 멱등이다. 여러 번 실행해도 안전하다.
-- 되돌리기:
--   alter table public.mrv_harvest_logs drop column if exists production_basis;
--   alter table public.mrv_harvest_logs drop column if exists production_basis_note;
--   alter table public.mrv_harvest_logs drop column if exists survival_adjusted;
-- (열을 지우면 그때까지 기록한 산정 근거가 사라진다.)
-- ---------------------------------------------------------------------------

alter table public.mrv_harvest_logs
  add column if not exists production_basis text;

alter table public.mrv_harvest_logs
  add column if not exists production_basis_note text;

alter table public.mrv_harvest_logs
  add column if not exists survival_adjusted boolean;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ck_mrv_harvest_logs_production_basis'
  ) then
    alter table public.mrv_harvest_logs
      add constraint ck_mrv_harvest_logs_production_basis
      check (production_basis in ('measured', 'calculated', 'estimated'));
  end if;
end $$;

comment on column public.mrv_harvest_logs.production_basis is
  '이 생체량을 어떻게 얻었는가. measured=실측 출하·계측량(저울·계수기), '
  'calculated=산식으로 계산(입식수 × 최종평균개체중 등), estimated=어림값. '
  '**null 은 「미기재」이며 실측을 뜻하지 않는다** — 이 열이 생기기 전에 저장된 행이 전부 '
  'null 이고, 그 행들이 실측이었다는 기록은 없으므로 추정으로 메우지 않았다. 이 표의 '
  '기간 양 끝 생체량 차이가 EI·폭기 EI·FCR·OEI 의 분모이므로, 이 칸이 네 지표 전부의 '
  '성질을 결정한다(mrv_readings.measurement_basis 와 같은 자리의 열이다).';

comment on column public.mrv_harvest_logs.production_basis_note is
  '계산·어림의 근거를 사람이 적는 칸(자유 기입). 예: "입식 100,000미 × 최종평균 35g, '
  '생존율 보정 미적용". 근거 없는 calculated 라벨은 검산할 수 없는 주장이라 라벨이 없는 '
  '것보다 나쁘므로, 쓰기 창구가 calculated·estimated 에 이 칸을 필수로 요구한다. '
  'DB 제약으로 걸지 않은 이유는 마이그레이션 머리말에 적었다.';

comment on column public.mrv_harvest_logs.survival_adjusted is
  '생존율 보정을 적용했는가. 계산생체량에서 폐사를 반영하지 않으면 생산량이 과대해지고 '
  '그만큼 EI 가 과소해진다. **null 은 「미기재」다** — false(미적용)와 다른 사실이다.';
