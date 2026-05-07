-- ============================================================
-- Sensor Devices Table
-- Supabase SQL Editor에서 실행하세요
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sensor_devices (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tank_id      UUID NOT NULL REFERENCES public.tanks(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  device_type  TEXT NOT NULL DEFAULT 'multi'
                 CHECK (device_type IN ('multi','temperature','ph','do')),
  api_key      TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  active       BOOLEAN DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sensor_devices_tank
  ON public.sensor_devices(tank_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sensor_devices_api_key
  ON public.sensor_devices(api_key);

ALTER TABLE public.sensor_devices ENABLE ROW LEVEL SECURITY;

-- 본인 수조의 기기만 조회·수정·삭제 가능
CREATE POLICY "devices_all_own" ON public.sensor_devices FOR ALL
  USING (tank_id IN (
    SELECT t.id FROM public.tanks t
    JOIN public.farms f ON f.id = t.farm_id
    WHERE f.user_id = auth.uid()
  ));

DO $$ BEGIN
  RAISE NOTICE 'sensor_devices table created successfully!';
END $$;
