-- 생산 이벤트 원장(production_events) 신설 — 수조 간 분조를 기록할 자리를 만든다
--
-- 배경: 우리 production_cycles(production_management.sql)는 stocking_* 과
--   actual_harvest_* 로 **입식과 출하만** 표현한다. 수조 사이로 새우를 나눠
--   옮기는 분조(transfer_in / transfer_out) 개념이 아예 없다.
--   천황수산 실데이터의 생산 이벤트 70건 중 **40건(57%)이 분조**라서,
--   지금 스키마에는 그 절반이 들어갈 칸이 없다.
--   (근거: docs/plans/tips-2026-dataset-assessment.md 4절·6절 F-1)
--
--   이 테이블은 "실데이터를 넣기 위한" 것이 아니다. 분조를 기록할 자리가 없으면
--   우리 서비스를 쓰는 농가도 분조를 입력하지 못하고, 그러면 우리 운영 DB 에서도
--   회차 경계를 복원할 수 없어 생존율·FCR·수확량의 정답이 영원히 만들어지지
--   않는다(평가서 6-1). 앞으로 쌓일 데이터가 학습 데이터가 되게 하는 작업이다.
--
-- 설계 원칙 — 원장(ledger)이다:
--   이벤트는 **일어난 사실**이고, 회차(cycle)는 그 사실들을 묶는 **해석**이다.
--   그래서 cycle_id 는 nullable 이고, 사이클을 지워도 이벤트는 남는다.
--   사실을 해석보다 오래 살려 둔다.
--
-- 실행 순서: 이 배치의 1번. 전제는 schema.sql + production_management.sql.
--   2~6번(cycle_harvests_channel / wq_biofloc / wq_salinity_unit /
--   growth_samples_relax_notnull / cycle_feed_total)과는 서로 독립이다.
-- 전부 재실행 안전(멱등)이다. Supabase SQL Editor 에서 실행한다(사람 몫).

-- ── 1) 테이블 ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.production_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 이벤트가 일어난 수조. 수조가 사라지면 이벤트도 뜻을 잃으므로 CASCADE
  -- (저장소의 모든 수조 하위 테이블과 같은 규칙).
  tank_id             uuid NOT NULL REFERENCES public.tanks(id) ON DELETE CASCADE,

  -- 회차. **nullable 이 설계다** — 회차 경계가 확정되지 않은 데이터를 먼저
  -- 받아야 하기 때문이다(평가서 4절: 분조 경로를 추적할 개체 식별 정보가 없는
  -- 상태에서 회차 ID 를 붙이면 그건 데이터가 아니라 가정이다).
  -- 사이클을 지울 때 이벤트를 따라 지우지 않는다 — 물리적 사실은 남기고
  -- 회차 귀속만 떼어낸다. 그래서 CASCADE 가 아니라 SET NULL 이다.
  cycle_id            uuid REFERENCES public.production_cycles(id) ON DELETE SET NULL,

  event_date          date NOT NULL,

  -- 실데이터의 이벤트 종류를 그대로 받는다(평가서 4-1). 이름을 번역하거나
  -- 묶지 않는다 — 원본 어휘를 보존해야 나중에 원본과 대조할 수 있다.
  event_type          text NOT NULL CHECK (event_type IN (
                        'initial_stocking',
                        'transfer_in',
                        'transfer_out',
                        'shipment_out',
                        'transfer_to_freezer',
                        'mortality_reported_or_estimated',
                        'inventory_adjustment',
                        'sale_out_period_aggregate'
                      )),

  -- ── 부호 있는 수량 ──
  -- 세 칸 모두 자릿수를 고정하지 않은 numeric 이다. 의도된 선택이다:
  -- 실데이터의 개체수에는 소수점이 있고(생체량 ÷ 개체중으로 역산된 값),
  -- 개체중에는 28.571429 처럼 소수 6자리가 있다. 스케일을 못 박으면 그
  -- 자리에서 조용히 반올림되고, 반올림된 값은 원본과 대조해도 안 걸린다.
  -- 이 데이터셋의 미덕(보간·가상관측 없음, 평가서 1-2)을 DB 가 깨지 않게 한다.
  count_signed        numeric,
  biomass_kg_signed   numeric,
  weight_g_per_shrimp numeric,

  -- 분조의 상대 수조. 상대를 모르는 분조도 있으므로 nullable.
  counterpart_tank_id uuid REFERENCES public.tanks(id) ON DELETE SET NULL,

  -- 라벨 검증 상태. 실데이터 70건은 **전부** not_validated_outcome_label 이다
  -- (평가서 4-3). 기본값을 '검증 안 됨'으로 두는 이유 — 검증은 사람이 한 일만
  -- 참이고, 입력되지 않은 검증을 참으로 가정하면 안 된다.
  -- validated_outcome_label 은 사람이 회차 경계를 복원해 준 경우에만 쓴다
  -- (평가서 8-2 ③).
  label_status        text NOT NULL DEFAULT 'not_validated_outcome_label'
                        CHECK (label_status IN (
                          'not_validated_outcome_label',
                          'validated_outcome_label'
                        )),

  notes               text,
  -- 원본 추적용. 어느 파일·시트·행에서 왔는지 적는다(예: 'ProductionEvents!A37').
  -- 이 칸이 비면 값이 틀렸을 때 원본으로 되짚을 길이 없다.
  source_ref          text,

  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ── 2) 칸 설명 ───────────────────────────────────────────────
COMMENT ON TABLE public.production_events IS
  '생산 이벤트 원장. 입식·분조·출하·폐사·재고조정을 부호 있는 수량으로 기록한다. cycle_id 는 nullable — 회차는 이벤트의 해석이고 이벤트가 사실이다.';

COMMENT ON COLUMN public.production_events.cycle_id IS
  '회차 귀속. nullable 이 정상 상태다 — 회차 경계가 확정되지 않은 데이터를 먼저 받기 위한 설계(평가서 4절). 비어 있다고 결손이 아니다.';

COMMENT ON COLUMN public.production_events.count_signed IS
  '개체수(부호 있음). 들어오면 +, 나가면 −(예: transfer_out −200000). 소수점이 있을 수 있다 — 원본에서 생체량/개체중으로 역산된 값이기 때문이다. 정수로 반올림하지 말 것.';

COMMENT ON COLUMN public.production_events.biomass_kg_signed IS
  '생체량 kg(부호 있음). 들어오면 +, 나가면 −.';

COMMENT ON COLUMN public.production_events.weight_g_per_shrimp IS
  '⚠ 성장 데이터로 쓰지 말 것. 실측 개체중이 아니라 유통 규격(마리수/kg)에서 역산된 값일 수 있다 — 28.571429 = 1000/35, 14.285714 = 1000/70 (평가서 3-3). 35미·70미 두 계단에만 몰려 있어서 성장곡선에 섞으면 곡선이 그 계단으로 끌려가고, R² 는 떨어지지 않으므로 지표만 봐서는 오염이 발견되지 않는다. 성장은 growth_samples.abw_g(실측)만 쓴다.';

COMMENT ON COLUMN public.production_events.counterpart_tank_id IS
  '분조의 상대 수조. 상대를 알 수 없는 분조가 있어 nullable.';

COMMENT ON COLUMN public.production_events.label_status IS
  '결과 라벨의 검증 상태. 천황수산 실데이터 70건은 전부 not_validated_outcome_label — 이 값인 행은 엔진 2·4·5 의 정답 라벨로 쓸 수 없다.';

COMMENT ON COLUMN public.production_events.source_ref IS
  '원본 추적 문자열(파일·시트·행). 값이 의심스러울 때 원본으로 되짚는 유일한 경로.';

-- ── 3) RLS ───────────────────────────────────────────────────
ALTER TABLE public.production_events ENABLE ROW LEVEL SECURITY;

-- 본인 수조의 이벤트만 조회·수정·삭제 가능.
-- cycle_id 가 nullable 이라 cycle_costs 처럼 cycle_id 로 소유권을 볼 수 없다.
-- 그래서 tanks → farms → user_id 경로로 확인한다(devices_all_own 와 같은 패턴).
--
-- 저장소의 다른 정책과 달리 WITH CHECK 를 따로 적는다. 이 테이블에만
-- 남의 행을 가리킬 수 있는 nullable 참조가 셋(cycle_id, counterpart_tank_id)
-- 있기 때문이다. USING 만 두면 쓰기 때 그 두 칸은 검사되지 않아, 남의 수조·
-- 사이클 id 를 적어 넣을 수 있다. 읽기 권한이 새지는 않지만 원장에 남의 id 가
-- 섞이는 것 자체가 나중에 회차 복원을 망친다. 막아 둔다.
-- (USING 쪽 조건은 기존 정책들과 동일하므로 기존 동작은 바뀌지 않는다.)
DROP POLICY IF EXISTS "pe_all_own" ON public.production_events;
CREATE POLICY "pe_all_own" ON public.production_events FOR ALL
  USING (tank_id IN (
    SELECT t.id FROM public.tanks t
    JOIN public.farms f ON f.id = t.farm_id
    WHERE f.user_id = auth.uid()
  ))
  WITH CHECK (
    tank_id IN (
      SELECT t.id FROM public.tanks t
      JOIN public.farms f ON f.id = t.farm_id
      WHERE f.user_id = auth.uid()
    )
    AND (counterpart_tank_id IS NULL OR counterpart_tank_id IN (
      SELECT t.id FROM public.tanks t
      JOIN public.farms f ON f.id = t.farm_id
      WHERE f.user_id = auth.uid()
    ))
    AND (cycle_id IS NULL OR cycle_id IN (
      SELECT c.id FROM public.production_cycles c WHERE c.user_id = auth.uid()
    ))
  );

-- ── 4) 인덱스 ────────────────────────────────────────────────
-- 수조별 시계열 조회가 기본 질의다(이력 화면·원장 재생).
CREATE INDEX IF NOT EXISTS idx_production_events_tank_date
  ON public.production_events(tank_id, event_date);

-- cycle_id 는 당분간 대부분 NULL 이다(회차 경계 미확정). NULL 행을 인덱스에
-- 넣을 이유가 없어 부분 인덱스로 둔다 — add_perf_constraints.sql 의 패턴.
CREATE INDEX IF NOT EXISTS idx_production_events_cycle
  ON public.production_events(cycle_id)
  WHERE cycle_id IS NOT NULL;

-- API 스키마 캐시 갱신 (이걸 빼먹으면 웹이 새 테이블을 못 본다)
NOTIFY pgrst, 'reload schema';

DO $$ BEGIN
  RAISE NOTICE 'production_events table ready.';
END $$;

-- ── 5) 반입 멱등성 키 ────────────────────────────────────────
-- 파일 자체는 몇 번을 돌려도 안전하지만, 그것과 **데이터 반입이 안전한가**는
-- 다른 문제다. 사람이 반입 SQL 을 두 번 돌리면 70건이 140건이 되고, 그 중복은
-- 생체량 합계를 두 배로 만들면서 화면에는 정상적인 숫자로 보인다.
--
-- source_ref('ProductionEvents!A37' 처럼 원본 파일·시트·행)가 바로 그 자연키다.
-- 원본 한 행은 이벤트 하나에 대응하므로 유일해야 한다. source_ref 를 적지 않은
-- 수기 입력 행까지 막을 이유는 없으므로 NULL 은 제외한다.
CREATE UNIQUE INDEX IF NOT EXISTS uq_production_events_source_ref
  ON public.production_events(source_ref)
  WHERE source_ref IS NOT NULL;
