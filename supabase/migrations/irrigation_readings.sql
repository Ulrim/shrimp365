-- ============================================================
-- 관수 밸브·유량계 기록 — 지그비 투야 스마트 워터밸브 + 유량계
--
-- 장비(raspberry-pi/field_env.py read_irrigation)가 밸브마다 열림·닫힘, 순간 유량(L/min),
-- 오늘 사용량(L)을 /api/sensors/data 의 irrigation 배열로 올린다(5분마다, 열고 닫힐 때 바로).
-- 켤 때만 흐르는 관수 라인이라 유량 0 은 고장이 아니다 — 수질의 유량(flow_rate, 0 이면 순환 멈춤
-- 경보) 칸에 넣지 않고 밸브 한 개 = 한 행으로 따로 둔다. 경보는 만들지 않는다.
--
-- 쓰기는 서버(service_role)만 한다. 읽기는 농장 주인과 열람자(farm_viewers)만.
-- 실행 전에도 장비·수질 수신은 멈추지 않는다 — 서버가 관수 기록만 건너뛴다. 재실행 안전(멱등).
--
-- 실행 위치: Supabase Dashboard → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS public.irrigation_readings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tank_id          uuid NOT NULL REFERENCES public.tanks(id) ON DELETE CASCADE,
  device_id        uuid REFERENCES public.sensor_devices(id) ON DELETE SET NULL,
  valve_id         text NOT NULL CHECK (valve_id ~ '^[A-Za-z0-9_.-]{1,32}$'),
  state            smallint CHECK (state IS NULL OR state IN (0, 1)),
  flow_lpm         double precision CHECK (flow_lpm IS NULL OR flow_lpm BETWEEN 0 AND 1000),
  volume_today_l   double precision CHECK (volume_today_l IS NULL OR volume_today_l BETWEEN 0 AND 1000000),
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS irrigation_readings_tank_time ON public.irrigation_readings (tank_id, recorded_at DESC);

ALTER TABLE public.irrigation_readings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "irr_select_owner" ON public.irrigation_readings;
CREATE POLICY "irr_select_owner" ON public.irrigation_readings FOR SELECT
  USING (tank_id IN (
    SELECT t.id FROM public.tanks t
    JOIN public.farms f ON f.id = t.farm_id
    WHERE f.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "irr_select_viewer" ON public.irrigation_readings;
DO $$ BEGIN
  IF to_regclass('public.farm_viewers') IS NOT NULL THEN
    EXECUTE $p$
      CREATE POLICY "irr_select_viewer" ON public.irrigation_readings FOR SELECT
        USING (tank_id IN (
          SELECT t.id FROM public.tanks t
          JOIN public.farm_viewers v ON v.farm_id = t.farm_id
          WHERE v.user_id = auth.uid()
        ))
    $p$;
  END IF;
END $$;

GRANT SELECT ON public.irrigation_readings TO authenticated;

-- API 스키마 캐시 갱신
NOTIFY pgrst, 'reload schema';
