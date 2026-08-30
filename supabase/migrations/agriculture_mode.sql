-- 농업 모드(쪽파 스마트 수경재배) — 스키마 확장
--
-- 배경: 기존 Shrimp365 계정으로 수경재배(NFT 베드) 농가도 쓸 수 있게 한다.
--   1) farms.farm_type          — 농장 단위 유형. 기본 shrimp 라 기존 계정 무변화.
--   2) tanks 레시피 4칸          — 베드별 목표 EC/pH 와 허용 오차. NULL = 미설정.
--   3) 유량·차압 측정 칸         — 순환 유량(L/min), UV 살균기·필터 차압(kPa).
--   4) wq_series 재정의          — 반환 칸이 늘어 DROP 후 CREATE.
--
-- 단위 원칙: EC 는 µS/cm 로 저장한다(wq_conductivity.sql 원칙). mS/cm 표시는
-- 화면에서 나눈다. 사업 목표 ±0.1 dS/m = ±0.1 mS/cm = ±100 µS/cm.
--
-- 전부 재실행 안전(멱등)이다. Supabase SQL Editor 에서 실행한다(사람 몫).
-- 선행 권장: sensor_readings_device_id.sql, wq_conductivity.sql — 안 돌린 DB 를
-- 만나도 되도록 아래에서 해당 칸을 방어적으로 함께 만든다.

-- ── 1) 농장 유형 ─────────────────────────────────────────────
-- 기존 행은 DEFAULT 로 전부 shrimp (기존 계정 무변화)
ALTER TABLE public.farms
  ADD COLUMN IF NOT EXISTS farm_type TEXT NOT NULL DEFAULT 'shrimp';
DO $$ BEGIN
  ALTER TABLE public.farms ADD CONSTRAINT farms_farm_type_check
    CHECK (farm_type IN ('shrimp', 'agriculture'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2) 베드별 양액 레시피 ────────────────────────────────────
-- target_* 이 NULL 이면 레시피 미설정 — 알림을 만들지 않는다.
ALTER TABLE public.tanks
  ADD COLUMN IF NOT EXISTS target_ec    double precision,
  ADD COLUMN IF NOT EXISTS ec_tolerance double precision NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS target_ph    double precision,
  ADD COLUMN IF NOT EXISTS ph_tolerance double precision NOT NULL DEFAULT 0.5;

-- 값 범위 — wqr_conductivity_range 와 같은 패턴.
-- 목표 EC 는 측정 칸과 같은 상한(200,000 µS/cm), 폼은 0.1~10 mS/cm 로 더 좁게 받는다.
DO $$ BEGIN
  ALTER TABLE public.tanks ADD CONSTRAINT tanks_target_ec_range
    CHECK (target_ec IS NULL OR (target_ec > 0 AND target_ec <= 200000));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.tanks ADD CONSTRAINT tanks_ec_tolerance_range
    CHECK (ec_tolerance > 0 AND ec_tolerance <= 10000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.tanks ADD CONSTRAINT tanks_target_ph_range
    CHECK (target_ph IS NULL OR (target_ph >= 0 AND target_ph <= 14));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.tanks ADD CONSTRAINT tanks_ph_tolerance_range
    CHECK (ph_tolerance > 0 AND ph_tolerance <= 7);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3) 유량·차압 측정 칸 ─────────────────────────────────────
-- 선행 마이그레이션을 안 돌린 DB 방어 — 아래 wq_series 가 이 칸들을 참조한다.
ALTER TABLE public.water_quality_readings
  ADD COLUMN IF NOT EXISTS device_id UUID
    REFERENCES public.sensor_devices(id) ON DELETE SET NULL;
ALTER TABLE public.water_quality_readings
  ADD COLUMN IF NOT EXISTS conductivity double precision;

ALTER TABLE public.water_quality_readings
  ADD COLUMN IF NOT EXISTS flow_rate     double precision,
  ADD COLUMN IF NOT EXISTS diff_pressure double precision;

-- 값 범위 — 서버 수신 화이트리스트(route.ts VALID_RANGE)와 같은 값.
DO $$ BEGIN
  ALTER TABLE public.water_quality_readings
    ADD CONSTRAINT wqr_flow_rate_range
    CHECK (flow_rate IS NULL OR (flow_rate >= 0 AND flow_rate <= 1000));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.water_quality_readings
    ADD CONSTRAINT wqr_diff_pressure_range
    CHECK (diff_pressure IS NULL OR (diff_pressure >= 0 AND diff_pressure <= 1000));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 4) wq_series 재정의 ─────────────────────────────────────
-- 그래프용 구간 평균 함수(wq_conductivity.sql 갱신판)에 유량·차압을 더한다.
-- 돌려주는 칸이 늘었으므로 CREATE OR REPLACE 로는 안 된다(42P13).
-- 먼저 지우고 새로 만든다. 지운 잠깐 사이에는 웹이 폴백 경로(최신 1,000행)로
-- 그리므로 화면이 멈추지는 않는다.
DROP FUNCTION IF EXISTS public.wq_series(uuid, int, uuid, int);

CREATE FUNCTION public.wq_series(
  p_tank uuid,
  p_hours int,
  p_device uuid DEFAULT NULL,
  p_max_points int DEFAULT 240
)
RETURNS TABLE (
  recorded_at timestamptz,
  device_id uuid,
  temperature float8, ph float8, do_level float8, salinity float8,
  ammonia float8, nitrite float8, nitrate float8, alkalinity float8, turbidity float8,
  conductivity float8,
  flow_rate float8,
  diff_pressure float8,
  sample_count int
)
LANGUAGE sql STABLE AS $$
  WITH w AS (
    SELECT GREATEST(60, CEIL(p_hours * 3600.0 / GREATEST(LEAST(p_max_points, 500), 50))::int) AS sec
  )
  SELECT
    to_timestamp(FLOOR(EXTRACT(epoch FROM r.recorded_at) / w.sec) * w.sec) AS recorded_at,
    r.device_id,
    AVG(r.temperature)::float8, AVG(r.ph)::float8, AVG(r.do_level)::float8, AVG(r.salinity)::float8,
    AVG(r.ammonia)::float8, AVG(r.nitrite)::float8, AVG(r.nitrate)::float8,
    AVG(r.alkalinity)::float8, AVG(r.turbidity)::float8,
    AVG(r.conductivity)::float8,
    AVG(r.flow_rate)::float8,
    AVG(r.diff_pressure)::float8,
    COUNT(*)::int
  FROM public.water_quality_readings r, w
  WHERE r.tank_id = p_tank
    AND r.recorded_at > now() - make_interval(hours => LEAST(GREATEST(p_hours, 1), 24 * 60))
    AND (p_device IS NULL OR r.device_id = p_device)
  GROUP BY 1, 2, w.sec
  ORDER BY 1 ASC
$$;

REVOKE ALL ON FUNCTION public.wq_series(uuid, int, uuid, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.wq_series(uuid, int, uuid, int) TO authenticated;

-- API 스키마 캐시 갱신 (이걸 빼먹으면 웹이 새 칸을 못 본다)
NOTIFY pgrst, 'reload schema';
