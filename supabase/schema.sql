-- ============================================================
-- Shrimp365 Database Schema
-- Supabase SQL Editor에서 이 파일 전체를 실행하세요
-- ============================================================

-- ───────────────────────────────────────────────
-- 1. profiles (auth.users 확장)
-- ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id                     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name                   TEXT NOT NULL DEFAULT '',
  role                   TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('admin','operator','viewer')),
  plan                   TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'basic', 'pro', 'enterprise')),
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  subscription_status    TEXT DEFAULT 'inactive',
  plan_expires_at        TIMESTAMPTZ,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

-- 회원가입 시 profiles 자동 생성 (Pro 3개월 무료 체험 포함)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, role, plan, plan_expires_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    'operator',
    'pro',
    NOW() + INTERVAL '3 months'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ───────────────────────────────────────────────
-- 2. farms (양식장)
-- ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.farms (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  location   TEXT DEFAULT '',
  owner_name TEXT DEFAULT '',
  area       NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ───────────────────────────────────────────────
-- 3. tanks (수조)
-- ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tanks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id          UUID NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  volume           NUMERIC DEFAULT 0,
  status           TEXT DEFAULT 'active' CHECK (status IN ('active','warning','danger','inactive')),
  stocking_density NUMERIC DEFAULT 0,
  shrimp_count     INTEGER DEFAULT 0,
  cycle_day        INTEGER DEFAULT 0,
  stocking_date    DATE,
  harvest_date     DATE,
  tank_type        TEXT DEFAULT '노지' CHECK (tank_type IN ('노지', '실내', '반실내')),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ───────────────────────────────────────────────
-- 4. water_quality_readings (수질 측정값)
-- ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.water_quality_readings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tank_id     UUID NOT NULL REFERENCES public.tanks(id) ON DELETE CASCADE,
  temperature NUMERIC,
  ph          NUMERIC,
  do_level    NUMERIC,
  salinity    NUMERIC,
  ammonia     NUMERIC,
  nitrite     NUMERIC,
  nitrate     NUMERIC,
  alkalinity  NUMERIC,
  turbidity   NUMERIC,
  recorded_at TIMESTAMPTZ DEFAULT NOW(),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wqr_tank_recorded
  ON public.water_quality_readings(tank_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_farms_user_id
  ON public.farms(user_id);

CREATE INDEX IF NOT EXISTS idx_tanks_farm_id
  ON public.tanks(farm_id);

CREATE INDEX IF NOT EXISTS idx_diagnosis_tank_date
  ON public.diagnosis_results(tank_id, tested_at DESC);

CREATE INDEX IF NOT EXISTS idx_je_tank_date
  ON public.journal_entries(tank_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_tank_resolved
  ON public.alerts(tank_id, resolved, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sensor_devices_api_key
  ON public.sensor_devices(api_key);

-- ───────────────────────────────────────────────
-- 5. journal_entries (양식 일지)
-- ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.journal_entries (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tank_id               UUID NOT NULL REFERENCES public.tanks(id) ON DELETE CASCADE,
  date                  DATE NOT NULL,
  feeding_amount        NUMERIC DEFAULT 0,
  feed_type             TEXT DEFAULT '',
  feeding_times         INTEGER DEFAULT 0,
  mortality_count       INTEGER DEFAULT 0,
  water_exchange_rate   NUMERIC DEFAULT 0,
  microbial_input       BOOLEAN DEFAULT FALSE,
  microbial_type        TEXT,
  microbial_amount      NUMERIC,
  disinfection          BOOLEAN DEFAULT FALSE,
  disinfection_type     TEXT,
  check_aeration        BOOLEAN DEFAULT FALSE,
  check_filtration      BOOLEAN DEFAULT FALSE,
  check_circulation     BOOLEAN DEFAULT FALSE,
  check_feeding_check   BOOLEAN DEFAULT FALSE,
  notes                 TEXT,
  created_by            UUID REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_je_tank_date
  ON public.journal_entries(tank_id, date DESC);

-- ───────────────────────────────────────────────
-- 6. diagnosis_results (질병 진단)
-- ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.diagnosis_results (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tank_id          UUID NOT NULL REFERENCES public.tanks(id) ON DELETE CASCADE,
  test_type        TEXT NOT NULL,
  result           TEXT NOT NULL CHECK (result IN ('양성','음성','의심')),
  vibrio_count     NUMERIC DEFAULT 0,
  pathogenic_ratio NUMERIC DEFAULT 0,
  risk_level       TEXT DEFAULT 'low' CHECK (risk_level IN ('low','medium','high','critical')),
  tested_at        TIMESTAMPTZ DEFAULT NOW(),
  tested_by        UUID REFERENCES auth.users(id),
  action_taken     TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ───────────────────────────────────────────────
-- 7. alerts (알림)
-- ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.alerts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tank_id    UUID NOT NULL REFERENCES public.tanks(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('danger','warning','info')),
  parameter  TEXT,
  value      NUMERIC,
  threshold  NUMERIC,
  message    TEXT NOT NULL,
  resolved   BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_tank_resolved
  ON public.alerts(tank_id, resolved, created_at DESC);

-- ───────────────────────────────────────────────
-- 8. Row Level Security (RLS) 설정
-- ───────────────────────────────────────────────
ALTER TABLE public.profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.farms                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tanks                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.water_quality_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagnosis_results     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts                ENABLE ROW LEVEL SECURITY;

-- profiles: 본인만 조회/수정
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- farms: 본인 양식장만
CREATE POLICY "farms_all_own" ON public.farms FOR ALL USING (auth.uid() = user_id);

-- tanks: 본인 양식장의 수조만
CREATE POLICY "tanks_all_own" ON public.tanks FOR ALL
  USING (farm_id IN (SELECT id FROM public.farms WHERE user_id = auth.uid()));

-- water_quality_readings: 본인 수조 데이터만
CREATE POLICY "wqr_all_own" ON public.water_quality_readings FOR ALL
  USING (tank_id IN (
    SELECT t.id FROM public.tanks t
    JOIN public.farms f ON f.id = t.farm_id
    WHERE f.user_id = auth.uid()
  ));

-- journal_entries: 본인 수조 데이터만
CREATE POLICY "je_all_own" ON public.journal_entries FOR ALL
  USING (tank_id IN (
    SELECT t.id FROM public.tanks t
    JOIN public.farms f ON f.id = t.farm_id
    WHERE f.user_id = auth.uid()
  ));

-- diagnosis_results: 본인 수조 데이터만
CREATE POLICY "dr_all_own" ON public.diagnosis_results FOR ALL
  USING (tank_id IN (
    SELECT t.id FROM public.tanks t
    JOIN public.farms f ON f.id = t.farm_id
    WHERE f.user_id = auth.uid()
  ));

-- alerts: 본인 수조 알림만
CREATE POLICY "alerts_all_own" ON public.alerts FOR ALL
  USING (tank_id IN (
    SELECT t.id FROM public.tanks t
    JOIN public.farms f ON f.id = t.farm_id
    WHERE f.user_id = auth.uid()
  ));

-- ───────────────────────────────────────────────
-- 8-extra. sensor_devices (IoT 기기 연동)
-- ───────────────────────────────────────────────
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

ALTER TABLE public.sensor_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "devices_all_own" ON public.sensor_devices FOR ALL
  USING (tank_id IN (
    SELECT t.id FROM public.tanks t
    JOIN public.farms f ON f.id = t.farm_id
    WHERE f.user_id = auth.uid()
  ));

-- ───────────────────────────────────────────────
-- 완료 메시지
-- ───────────────────────────────────────────────
DO $$ BEGIN
  RAISE NOTICE 'Shrimp365 schema created successfully!';
END $$;
