-- 수질 기록에 출처(source) 추가 — 수기 입력과 센서 수신을 구분한다
--
-- 배경: 관리자 콘솔에서 회원의 수기 수질 기록을 따로 보고 싶다는 요청. 지금까지
-- water_quality_readings 에는 출처 칸이 없어 device_id 유무로만 짐작했다. 그런데
-- device_id 는 sensor_readings_device_id.sql 이후에 생긴 칸이라, 그 전에 들어온
-- 센서 기록도 device_id 가 NULL 이다 — 수기와 구분이 안 된다.
--
-- 이 파일은 Supabase SQL Editor 에서 실행한다(사람 몫).
--
-- 실행 전에도 웹은 동작한다:
--   · 수기 입력(lib/db.ts insertWaterQuality)은 source='manual' 을 넣되, 칸이 없어
--     실패하면 source 를 빼고 한 번 더 넣는다.
--   · 관리자 화면(/admin/readings)은 칸이 없으면 device_id 유무로만 판정한다.
-- 실행 후 판정 규칙(lib/wq-source.ts):
--   · source = 'manual'                    → 수기
--   · source = 'sensor' 또는 device_id 있음 → 센서
--   · source NULL 이고 device_id NULL       → "수기(추정)" — 수기이거나, device_id
--     마이그레이션 전의 옛 센서 기록. 둘을 가를 정보가 DB 에 없어 소급하지 않는다.
-- 센서 수신 라우트(app/api/sensors/data)는 고치지 않는다. 새 센서 기록은 device_id 로
-- 센서로 판정되고, 아래 UPDATE 가 과거분을 sensor 로 채운다.

ALTER TABLE public.water_quality_readings ADD COLUMN IF NOT EXISTS source text;

DO $$ BEGIN
  ALTER TABLE public.water_quality_readings ADD CONSTRAINT wqr_source_check
    CHECK (source IS NULL OR source IN ('manual','sensor'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 장비가 남긴 기록은 sensor 로 소급
UPDATE public.water_quality_readings SET source = 'sensor' WHERE source IS NULL AND device_id IS NOT NULL;

-- 관리자 콘솔 "수질 기록" 화면용 인덱스.
-- 기존 인덱스는 (tank_id, recorded_at)·(device_id, recorded_at) 뿐이라, 사용자·농장
-- 필터 없이 "최근 30일 전체"를 보면 표 전체를 훑는다. 센서가 1분마다 쌓으므로
-- 표가 커질수록 느려진다. 시각 단독 인덱스와, 수기(장비 없음) 기록만 담은 작은
-- 부분 인덱스를 둔다. 기록이 많으면 생성에 수십 초 걸릴 수 있다(한 번만).
CREATE INDEX IF NOT EXISTS idx_wqr_recorded_at
  ON public.water_quality_readings(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_wqr_manual_recorded_at
  ON public.water_quality_readings(recorded_at DESC)
  WHERE device_id IS NULL;

NOTIFY pgrst, 'reload schema';
