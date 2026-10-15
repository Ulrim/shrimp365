-- 노지 재해위험 판단(OFDF) 저장 테이블 — docs/plans/openfield-merge.md 4-3.
--
-- **사람이 Supabase SQL Editor 에서 실행한다.** 이 파일을 돌리기 전에는
-- POST /api/field/device/judgements 가 503 으로 "이 파일을 실행하라"고 답하고,
-- Farm365 모니터링의 노지 카드는 조용히 숨는다(빈 배열).
--
-- 무엇이 들어오나: OFDF 엣지(라즈베리파이)가 5분마다 내는 판단 1건 = 1행.
--   (위험 유형 5종) × (1시간·3시간 전망) 이 한 번에 최대 10행.
--   evidence(근거 ≤5)·actions(권고 조치)·environment(그때의 기상 9항목)는 jsonb 로
--   그대로 둔다 — 환경값을 water_quality_readings 에 넣지 않는다(설계서 8장).
--
-- 누가 쓰나: 새 라우트가 service_role 로만 INSERT 한다. 사람·화면은 읽기만.
--   멱등: 장비가 끊겼다 붙어 같은 판단을 다시 올려도 (device_id, ts, risk, horizon_h)
--   유니크로 막혀 중복 행이 생기지 않는다(ON CONFLICT DO NOTHING).
--
-- 누가 읽나: 농장 소유자 + farm_viewers(읽기 열람자). 두 정책 모두 tanks → farms 조인.
--   water_quality_readings 의 정책(wqr_select_viewer, farm_viewers_muan.sql)과 같은 모양.

CREATE TABLE IF NOT EXISTS public.field_risk_judgements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tank_id        uuid NOT NULL REFERENCES public.tanks(id) ON DELETE CASCADE,
  device_id      uuid REFERENCES public.sensor_devices(id) ON DELETE SET NULL,
  ts             timestamptz NOT NULL,
  risk           text NOT NULL CHECK (risk IN ('heat_dry','rain_wet','disease','frost','compound')),
  horizon_h      smallint NOT NULL CHECK (horizon_h IN (1,3)),
  level          smallint NOT NULL CHECK (level BETWEEN 0 AND 3),
  level_name     text,
  confidence     double precision,
  model_version  text,
  expected_onset timestamptz,
  evidence       jsonb NOT NULL DEFAULT '[]',
  actions        jsonb NOT NULL DEFAULT '[]',
  environment    jsonb NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_id, ts, risk, horizon_h)
);

-- 화면은 "이 베드의 최근 판단" 만 묻는다(tank_id = ? ORDER BY ts DESC LIMIT 50).
CREATE INDEX IF NOT EXISTS idx_frj_tank_ts ON public.field_risk_judgements(tank_id, ts DESC);

ALTER TABLE public.field_risk_judgements ENABLE ROW LEVEL SECURITY;

-- 소유자: 내 농장의 베드에 달린 판단만 읽는다. 쓰기 정책은 두지 않는다 —
-- INSERT 는 service_role(새 라우트)만 하고, service_role 은 RLS 를 거치지 않는다.
DROP POLICY IF EXISTS "frj_select_owner" ON public.field_risk_judgements;
CREATE POLICY "frj_select_owner" ON public.field_risk_judgements FOR SELECT
  USING (tank_id IN (
    SELECT t.id FROM public.tanks t
    JOIN public.farms f ON f.id = t.farm_id
    WHERE f.user_id = auth.uid()
  ));

-- 열람자(farm_viewers): 연결된 농장의 베드만 읽는다. 담당자 계정이 노지 카드를
-- 수질 그래프와 똑같이 볼 수 있어야 한다.
DROP POLICY IF EXISTS "frj_select_viewer" ON public.field_risk_judgements;
CREATE POLICY "frj_select_viewer" ON public.field_risk_judgements FOR SELECT
  USING (tank_id IN (
    SELECT t.id FROM public.tanks t
    JOIN public.farm_viewers v ON v.farm_id = t.farm_id
    WHERE v.user_id = auth.uid()
  ));

NOTIFY pgrst, 'reload schema';

-- [확인] 최근 판단 — 라우트가 받은 것이 들어왔는지.
--   SELECT ts, risk, horizon_h, level, level_name, confidence
--   FROM public.field_risk_judgements ORDER BY ts DESC LIMIT 20;
