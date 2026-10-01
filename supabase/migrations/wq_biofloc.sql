-- 수질 기록에 바이오플락 지표 5종 추가 (플락·마그네슘·칼슘·경도·중탄산)
--
-- 배경: water_quality_readings 의 현재 칸은 수온·pH·DO·염도·암모니아·아질산·
--   질산·알칼리도·탁도·전도도·유량·차압이다. 천황수산 실데이터에는 있는데
--   우리에게 없는 항목이 다섯 개 있다 — **플락(floc)·마그네슘·칼슘·경도·중탄산**.
--   바이오플락 양식의 핵심 지표가 빠져 있다(평가서 6절 F-3).
--
--   이 다섯은 서로 묶여 움직인다. 알칼리도만 보고 중탄산·경도를 못 보면
--   탈피 장애의 원인을 가릴 수 없고, Mg:Ca 비를 못 보면 해수 희석 농가의
--   미네랄 보충 판단이 서지 않는다. 칸이 없으면 농가가 입력할 자리도 없다.
--
-- 단위 원칙: 플락은 cm(침전 높이), 나머지는 ppm 으로 저장한다. 실데이터의 단위를
--   그대로 쓴다 — 침전량을 mL/L 로 재는 농가도 있으니 환산하지 않고 받는다.
--   표시 단위 환산은 화면에서 한다(wq_conductivity.sql 원칙과 같다).
--
-- 전부 nullable 이다. 측정하지 않은 항목은 비워 둔다 — **0 으로 채우지 않는다.**
--   DO 0 과 DO 미측정이 완전히 다른 사건인 것과 같은 이유다(평가서 1-2).
--
-- 실행 순서: 이 배치의 3번. 다른 파일과 독립이다.
-- 전부 재실행 안전(멱등)이다. Supabase SQL Editor 에서 실행한다(사람 몫).
--
-- ⚠ 이 파일은 그래프용 함수 wq_series 를 건드리지 않는다. 함수의 반환 칸을
--   늘리면 DROP/CREATE 가 필요하고 웹 쪽 매핑(lib/db.ts)도 같이 고쳐야 하므로,
--   이번 스키마 작업의 범위를 넘는다. 새 다섯 칸은 저장·조회는 되지만 아직
--   수질 그래프에는 그려지지 않는다. 앱 작업은 별건으로 뺀다.
-- ⚠ 센서 수신 API(app/api/sensors/data/route.ts)의 FIELDS 화이트리스트에도
--   아직 없다. 즉 기기가 이 값을 올려도 저장되지 않는다. 같은 별건이다.

ALTER TABLE public.water_quality_readings
  ADD COLUMN IF NOT EXISTS floc_cm          double precision,
  ADD COLUMN IF NOT EXISTS magnesium_ppm    double precision,
  ADD COLUMN IF NOT EXISTS calcium_ppm      double precision,
  ADD COLUMN IF NOT EXISTS hardness_ppm     double precision,
  ADD COLUMN IF NOT EXISTS bicarbonate_ppm  double precision;

-- 값 범위 — wqr_conductivity_range·wqr_flow_rate_range 와 같은 패턴.
-- **일부러 느슨하게 잡는다.** 바이오플락 농가의 미네랄 보충 수준은 폭이 넓어서
-- 상한을 좁게 박으면 진짜 값이 거부된다. 여기 범위는 "말이 안 되는 값"만 막는
-- 선이고, 관리 적정 범위 판단은 lib/thresholds.ts 쪽 일이다.
DO $$ BEGIN
  ALTER TABLE public.water_quality_readings
    ADD CONSTRAINT wqr_floc_cm_range
    CHECK (floc_cm IS NULL OR (floc_cm >= 0 AND floc_cm <= 100));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 해수 Mg 가 약 1,300 ppm. 보충하는 농가가 있어 상한을 넉넉히 둔다.
DO $$ BEGIN
  ALTER TABLE public.water_quality_readings
    ADD CONSTRAINT wqr_magnesium_ppm_range
    CHECK (magnesium_ppm IS NULL OR (magnesium_ppm >= 0 AND magnesium_ppm <= 20000));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 해수 Ca 가 약 400 ppm.
DO $$ BEGIN
  ALTER TABLE public.water_quality_readings
    ADD CONSTRAINT wqr_calcium_ppm_range
    CHECK (calcium_ppm IS NULL OR (calcium_ppm >= 0 AND calcium_ppm <= 10000));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 총경도(CaCO3 환산). 해수가 약 6,500 ppm.
DO $$ BEGIN
  ALTER TABLE public.water_quality_readings
    ADD CONSTRAINT wqr_hardness_ppm_range
    CHECK (hardness_ppm IS NULL OR (hardness_ppm >= 0 AND hardness_ppm <= 50000));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.water_quality_readings
    ADD CONSTRAINT wqr_bicarbonate_ppm_range
    CHECK (bicarbonate_ppm IS NULL OR (bicarbonate_ppm >= 0 AND bicarbonate_ppm <= 10000));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 칸 설명 ──────────────────────────────────────────────────
COMMENT ON COLUMN public.water_quality_readings.floc_cm IS
  '플락 침전 높이(cm). 천황수산 원본의 단위를 그대로 쓴다 — 측정 방법(임호프 콘 눈금/침전관 높이)은 농가 확인이 필요하다. mL/L 로 재는 농가의 값을 이 칸에 섞지 말 것. NULL = 미측정이며 0 과 구분한다.';
COMMENT ON COLUMN public.water_quality_readings.magnesium_ppm IS
  '마그네슘(ppm). 해수가 약 1,300 ppm. Ca 와 함께 탈피·외피 경화 판단에 쓴다. NULL = 미측정.';
COMMENT ON COLUMN public.water_quality_readings.calcium_ppm IS
  '칼슘(ppm). 해수가 약 400 ppm. NULL = 미측정.';
COMMENT ON COLUMN public.water_quality_readings.hardness_ppm IS
  '총경도(ppm, CaCO3 환산). 알칼리도와 별개 항목이다 — 둘을 같은 칸에 넣지 않는다. NULL = 미측정.';
COMMENT ON COLUMN public.water_quality_readings.bicarbonate_ppm IS
  '중탄산(ppm, HCO3-). pH 일교차·완충능 판단에 쓴다. NULL = 미측정.';

-- API 스키마 캐시 갱신 (이걸 빼먹으면 웹이 새 칸을 못 본다)
NOTIFY pgrst, 'reload schema';
