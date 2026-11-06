-- ============================================================
-- 환경 센서별 값 — 같은 칸에 센서가 여러 대일 때 한 대 한 대의 값
--
-- 스마트팜 장비(raspberry-pi/field_env.py payload_each)는 기온·습도·토양수분 등 칸마다
-- 센서 평균을 수질 값과 같은 줄로 올린다(environment_readings.sql). 같은 칸에 센서가
-- 2대 이상이면 센서별 지금 값도 함께 올린다. 웹 "환경·기상" 카드는 평균을 보이고,
-- 칸을 누르면 이 값을 펼친다. 모양:
--   {"air_temp": [{"id": "TH-01", "v": 23.1}, {"id": "TH-02", "v": 24.0}], ...}
-- 서버(lib/env-params.ts parseEnvEach)가 칸 이름·센서 이름·값 범위를 검증한 뒤에만 쓴다.
--
-- 읽기 권한은 water_quality_readings 의 기존 정책을 그대로 따른다(새 정책 없음).
-- 실행 전에도 장비는 멈추지 않는다 — 서버가 이 칸만 빼고 저장한다.
-- 재실행 안전(멱등). environment_readings.sql 다음에 실행한다.
--
-- 실행 위치: Supabase Dashboard → SQL Editor
-- ============================================================

ALTER TABLE public.water_quality_readings
  ADD COLUMN IF NOT EXISTS env_sensors jsonb;  -- 칸 → [{id, v}] (2대 이상인 칸만)

-- 모양과 크기 상한 — 칸 6개 × 16대면 넉넉히 4KB 안쪽이다.
DO $$ BEGIN
  ALTER TABLE public.water_quality_readings ADD CONSTRAINT wqr_env_sensors_shape CHECK (
    env_sensors IS NULL
    OR (jsonb_typeof(env_sensors) = 'object' AND pg_column_size(env_sensors) <= 8192)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- API 스키마 캐시 갱신 (이걸 빼먹으면 서버가 새 칸을 못 본다)
NOTIFY pgrst, 'reload schema';
