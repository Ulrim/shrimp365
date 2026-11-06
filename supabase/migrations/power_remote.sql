-- ============================================================
-- 웹에서 전력 회로 켜고 끄기·예약 — 명령함과 장비 제어 상태
--
-- 웹은 장비에 직접 닿지 못한다(장비는 농장 공유기 뒤에 있다). 그래서
--   1) 웹이 명령을 power_commands 에 넣고(/api/power/command — 농장 주인만)
--   2) 장비가 15초마다 /api/sensors/power 로 가져가 실행한 뒤 결과를 돌려준다.
-- 장비는 같은 길로 회로 규칙·손 조작 상태(power_control.py snapshot)를
-- power_control_state 에 올린다 — 웹 카드가 이것으로 버튼과 예약을 그린다.
--
-- 안전 규칙은 장비가 지킨다: 인입 회로 제어 금지, 과열 중 켜기 금지,
-- 산소 부족 강제 켜기(산소공급기) — 웹에서 꺼도 산소가 낮으면 장비가 다시 켠다.
-- 2분 안에 장비가 가져가지 않은 명령은 버린다(늦게 도착한 '켜기' 가 엉뚱한 때 실행되지 않게).
--
-- 쓰기는 서버(service_role)만 한다. 읽기는 농장 주인과 열람자(farm_viewers)만.
-- 재실행 안전(멱등). 실행 전에는 웹 카드에 버튼이 나오지 않을 뿐 다른 기능은 그대로다.
--
-- 실행 위치: Supabase Dashboard → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS public.power_control_state (
  device_id   uuid PRIMARY KEY REFERENCES public.sensor_devices(id) ON DELETE CASCADE,
  tank_id     uuid NOT NULL REFERENCES public.tanks(id) ON DELETE CASCADE,
  control     jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS power_control_state_tank ON public.power_control_state (tank_id);

CREATE TABLE IF NOT EXISTS public.power_commands (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id   uuid NOT NULL REFERENCES public.sensor_devices(id) ON DELETE CASCADE,
  tank_id     uuid NOT NULL REFERENCES public.tanks(id) ON DELETE CASCADE,
  circuit_id  text NOT NULL CHECK (circuit_id ~ '^[A-Za-z0-9_.-]{1,32}$'),
  action      text NOT NULL CHECK (action IN ('set', 'auto', 'rule')),
  body        jsonb NOT NULL DEFAULT '{}'::jsonb,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'done', 'failed', 'expired')),
  result      text,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  picked_at   timestamptz,
  done_at     timestamptz
);
CREATE INDEX IF NOT EXISTS power_commands_device_pending ON public.power_commands (device_id, created_at)
  WHERE status IN ('pending', 'sent');
CREATE INDEX IF NOT EXISTS power_commands_tank_time ON public.power_commands (tank_id, created_at DESC);

ALTER TABLE public.power_control_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.power_commands ENABLE ROW LEVEL SECURITY;

-- 주인: 자기 농장의 수조·베드만 읽는다. 쓰기 정책은 두지 않는다(service_role 만 쓴다).
DROP POLICY IF EXISTS "pcs_select_owner" ON public.power_control_state;
CREATE POLICY "pcs_select_owner" ON public.power_control_state FOR SELECT
  USING (tank_id IN (
    SELECT t.id FROM public.tanks t
    JOIN public.farms f ON f.id = t.farm_id
    WHERE f.user_id = auth.uid()
  ));
DROP POLICY IF EXISTS "pcmd_select_owner" ON public.power_commands;
CREATE POLICY "pcmd_select_owner" ON public.power_commands FOR SELECT
  USING (tank_id IN (
    SELECT t.id FROM public.tanks t
    JOIN public.farms f ON f.id = t.farm_id
    WHERE f.user_id = auth.uid()
  ));

-- 열람자(farm_viewers): 상태만 본다(버튼은 서버가 주인에게만 허락한다).
DROP POLICY IF EXISTS "pcs_select_viewer" ON public.power_control_state;
DO $$ BEGIN
  IF to_regclass('public.farm_viewers') IS NOT NULL THEN
    EXECUTE $p$
      CREATE POLICY "pcs_select_viewer" ON public.power_control_state FOR SELECT
        USING (tank_id IN (
          SELECT t.id FROM public.tanks t
          JOIN public.farm_viewers v ON v.farm_id = t.farm_id
          WHERE v.user_id = auth.uid()
        ))
    $p$;
  END IF;
END $$;

GRANT SELECT ON public.power_control_state TO authenticated;
GRANT SELECT ON public.power_commands TO authenticated;

-- API 스키마 캐시 갱신
NOTIFY pgrst, 'reload schema';
