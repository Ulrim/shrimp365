-- 무안군 담당자 계정(suho@gmail.com)에 무안군 양식장의 수질 열람 권한(읽기 전용) 부여
--
-- 방식: 농장 소유자는 그대로 두고, "이 사용자가 이 농장을 읽을 수 있다"는
--       연결표(farm_viewers)만 추가한다. 소유권을 옮기면 농가가 자기 농장을
--       잃으므로 옮기지 않는다. 연결된 사용자는 SELECT 만 가능하다 —
--       수정·삭제·기기 등록은 정책이 없어 막힌다.
--
-- 열람 범위: 농장, 수조, 수질 기록(센서별 포함), 알림.
-- 제외: sensor_devices(기기 목록). 그 표에는 기기 인증 키(api_key)가 들어
--       있어 읽기 권한을 주면 가짜 데이터를 올릴 수 있다. 그래서 화면의
--       "기기 이름" 목록은 담당자에게 비어 보일 수 있고, 수질값과 그래프는 나온다.
--
-- 실행 순서 (Supabase SQL Editor, 사람 몫):
--   0) suho@gmail.com 계정이 먼저 만들어져 있어야 한다(grant_official_access.sql 참고).
--   1) 맨 아래 [미리보기] SELECT 를 먼저 실행해 "무안군"으로 잡힌 농장이 맞는지 본다.
--   2) 이 파일 전체를 실행한다.
--   3) [확인] SELECT 로 연결된 농장을 본다.

CREATE TABLE IF NOT EXISTS public.farm_viewers (
  farm_id    uuid NOT NULL REFERENCES public.farms(id)  ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id)    ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (farm_id, user_id)
);

ALTER TABLE public.farm_viewers ENABLE ROW LEVEL SECURITY;

-- 자기에게 연결된 행만 읽을 수 있다(아래 정책들의 하위 조회가 이걸 쓴다).
-- 쓰기 정책은 두지 않는다 — 연결은 service_role(SQL Editor)로만 한다.
DROP POLICY IF EXISTS "farm_viewers_select_self" ON public.farm_viewers;
CREATE POLICY "farm_viewers_select_self" ON public.farm_viewers FOR SELECT
  USING (user_id = auth.uid());

-- 읽기 전용 정책 (기존 소유자 정책 "..._all_own" 은 건드리지 않는다)
DROP POLICY IF EXISTS "farms_select_viewer" ON public.farms;
CREATE POLICY "farms_select_viewer" ON public.farms FOR SELECT
  USING (id IN (SELECT farm_id FROM public.farm_viewers WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "tanks_select_viewer" ON public.tanks;
CREATE POLICY "tanks_select_viewer" ON public.tanks FOR SELECT
  USING (farm_id IN (SELECT farm_id FROM public.farm_viewers WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "wqr_select_viewer" ON public.water_quality_readings;
CREATE POLICY "wqr_select_viewer" ON public.water_quality_readings FOR SELECT
  USING (tank_id IN (
    SELECT t.id FROM public.tanks t
    JOIN public.farm_viewers v ON v.farm_id = t.farm_id
    WHERE v.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "alerts_select_viewer" ON public.alerts;
CREATE POLICY "alerts_select_viewer" ON public.alerts FOR SELECT
  USING (tank_id IN (
    SELECT t.id FROM public.tanks t
    JOIN public.farm_viewers v ON v.farm_id = t.farm_id
    WHERE v.user_id = auth.uid()
  ));

-- 무안군 농장을 suho@gmail.com 에 연결 (재실행해도 중복되지 않는다)
INSERT INTO public.farm_viewers (farm_id, user_id)
SELECT f.id, u.id
FROM public.farms f
JOIN auth.users u ON lower(u.email) = 'suho@gmail.com'
WHERE f.location ILIKE '%무안%'
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- [미리보기] 위 INSERT 가 잡을 농장 — 실행 전에 먼저 돌려 본다.
--   SELECT f.id, f.name, f.location, p.name AS owner
--   FROM public.farms f LEFT JOIN public.profiles p ON p.id = f.user_id
--   WHERE f.location ILIKE '%무안%';
--   (수호수산이 빠져 있으면 주소 표기가 다른 것이다 — 위 INSERT 의 조건을
--    f.name ILIKE '%수호수산%' 등으로 바꾼다.)

-- [확인] 연결 결과
--   SELECT f.name, f.location, u.email
--   FROM public.farm_viewers v
--   JOIN public.farms f ON f.id = v.farm_id
--   JOIN auth.users u ON u.id = v.user_id;

-- [회수] 열람 종료
--   DELETE FROM public.farm_viewers
--   WHERE user_id = (SELECT id FROM auth.users WHERE lower(email) = 'suho@gmail.com');
