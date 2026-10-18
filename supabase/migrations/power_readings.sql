-- ============================================================
-- 분전반 전력 회로 기록 — 양식장(Shrimp365)·스마트팜(Farm365) 공통
--
-- 장비(raspberry-pi/field_env.py)가 Zigbee 계측 차단기·클램프 전력계 값을 회로마다
-- /api/sensors/data 의 power 배열로 올린다(5분마다, 차단기 과열 중에는 매 측정).
-- 회로 수가 농장마다 달라(현장에서 고른다 — 설계서 farm365-main-panel.md 4-1)
-- 수질 기록의 칸으로 두지 않고 회로 한 줄 = 한 행으로 둔다.
--
-- 쓰기는 서버(service_role)만 한다. 읽기는 농장 주인과 열람자(farm_viewers)만.
-- 실행 전에도 장비·수질 수신은 멈추지 않는다 — 서버가 전력 기록만 건너뛴다.
-- 재실행 안전(멱등).
--
-- 실행 위치: Supabase Dashboard → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS public.power_readings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tank_id          uuid NOT NULL REFERENCES public.tanks(id) ON DELETE CASCADE,
  device_id        uuid REFERENCES public.sensor_devices(id) ON DELETE SET NULL,
  circuit_id       text NOT NULL CHECK (circuit_id ~ '^[A-Za-z0-9_.-]{1,32}$'),
  circuit_type     text NOT NULL DEFAULT 'other' CHECK (circuit_type IN (
                     'main','aerator','circulation_pump','irrigation_pump','heater','ventilation',
                     'cooling','lighting','uv','dosing','feeder','other')),
  state            smallint CHECK (state IS NULL OR state IN (0, 1)),
  power_w          double precision CHECK (power_w IS NULL OR power_w BETWEEN 0 AND 100000),
  current_a        double precision CHECK (current_a IS NULL OR current_a BETWEEN 0 AND 1000),
  voltage_v        double precision CHECK (voltage_v IS NULL OR voltage_v BETWEEN 0 AND 500),
  energy_today_kwh double precision CHECK (energy_today_kwh IS NULL OR energy_today_kwh BETWEEN 0 AND 10000),
  device_temp      double precision CHECK (device_temp IS NULL OR device_temp BETWEEN -40 AND 150),
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- 웹 카드는 "베드의 최근 24시간" 을 읽는다.
CREATE INDEX IF NOT EXISTS power_readings_tank_time ON public.power_readings (tank_id, recorded_at DESC);

ALTER TABLE public.power_readings ENABLE ROW LEVEL SECURITY;

-- 주인: 자기 농장의 베드만 읽는다. 쓰기 정책은 두지 않는다(service_role 만 쓴다).
DROP POLICY IF EXISTS "pwr_select_owner" ON public.power_readings;
CREATE POLICY "pwr_select_owner" ON public.power_readings FOR SELECT
  USING (tank_id IN (
    SELECT t.id FROM public.tanks t
    JOIN public.farms f ON f.id = t.farm_id
    WHERE f.user_id = auth.uid()
  ));

-- 열람자(farm_viewers): 연결된 농장의 베드만. farm_viewers 가 없는 DB 에서도 오류 없이 지나간다.
DROP POLICY IF EXISTS "pwr_select_viewer" ON public.power_readings;
DO $$ BEGIN
  IF to_regclass('public.farm_viewers') IS NOT NULL THEN
    EXECUTE $p$
      CREATE POLICY "pwr_select_viewer" ON public.power_readings FOR SELECT
        USING (tank_id IN (
          SELECT t.id FROM public.tanks t
          JOIN public.farm_viewers v ON v.farm_id = t.farm_id
          WHERE v.user_id = auth.uid()
        ))
    $p$;
  END IF;
END $$;

GRANT SELECT ON public.power_readings TO authenticated;

-- API 스키마 캐시 갱신
NOTIFY pgrst, 'reload schema';
