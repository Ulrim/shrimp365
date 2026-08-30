-- ============================================================
-- 센서 장비 원격 소프트웨어 업데이트
-- Supabase SQL Editor 에서 실행하세요.
--
-- 승인제입니다. 기기는 스스로 최신 버전을 받아가지 않고,
-- 계정 주인이 웹에서 "업데이트" 를 누른 기기만 다음 확인 때 받아 갑니다.
--
-- 꾸러미의 진짜 여부는 이 표가 아니라 **서명**이 보장합니다.
-- 이 표는 "어느 기기에 어느 버전을 허용했는가" 만 담습니다.
-- 그래서 이 DB 가 통째로 털려도 남의 장비에서 코드를 실행할 수는 없습니다.
-- ============================================================

ALTER TABLE public.sensor_devices
  -- 기기가 보고한 현재 버전
  ADD COLUMN IF NOT EXISTS agent_version     TEXT,
  ADD COLUMN IF NOT EXISTS agent_version_at  TIMESTAMPTZ,

  -- 주인이 승인한 목표 버전. NULL 이면 "업데이트하지 말 것".
  ADD COLUMN IF NOT EXISTS update_to         TEXT,
  ADD COLUMN IF NOT EXISTS update_requested_at TIMESTAMPTZ,

  -- 기기가 되보고하는 진행 상황
  ADD COLUMN IF NOT EXISTS update_status     TEXT,
  ADD COLUMN IF NOT EXISTS update_message    TEXT,
  ADD COLUMN IF NOT EXISTS update_status_at  TIMESTAMPTZ;

-- 버전 문자열은 기기가 내려받을 주소의 일부가 된다.
-- 형식을 DB 에서 한 번, 기기에서 한 번 더 막는다.
DO $$ BEGIN
  ALTER TABLE public.sensor_devices
    ADD CONSTRAINT sensor_devices_update_to_format
    CHECK (update_to IS NULL OR update_to ~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.sensor_devices
    ADD CONSTRAINT sensor_devices_agent_version_format
    CHECK (agent_version IS NULL OR agent_version ~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.sensor_devices
    ADD CONSTRAINT sensor_devices_update_status_valid
    CHECK (update_status IS NULL OR update_status IN
      ('requested','downloading','applied','failed','rolled_back'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 업데이트를 기다리는 기기만 훑을 때 쓴다.
CREATE INDEX IF NOT EXISTS idx_sensor_devices_update_pending
  ON public.sensor_devices(update_to)
  WHERE update_to IS NOT NULL;

DO $$ BEGIN
  RAISE NOTICE '원격 업데이트 컬럼이 추가되었습니다.';
END $$;
