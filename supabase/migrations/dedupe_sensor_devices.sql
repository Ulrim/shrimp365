-- 같은 기기(같은 시리얼)가 재연결 때마다 새로 등록돼 쌓인 중복 정리
--
-- 배경: 예전 claim API 는 페어링마다 무조건 새 기기 행을 만들었다. 계정
-- 변경→재연결을 반복하면 같은 물리 기기가 여러 행으로 쌓였다. 코드는 이제
-- 시리얼로 기존 행을 재사용하도록 고쳤고, 이 SQL 은 이미 쌓인 중복을 지운다.
--
-- 원칙: 시리얼별로 가장 최근 행만 남긴다. 지우기 전에 예전 행에 연결된
-- 수질 기록(device_id)을 남는 행으로 이관해 센서별 이력을 보존한다.
-- (시리얼이 없는 기기는 같은 기기인지 알 수 없어 건드리지 않는다.)
--
-- Supabase SQL Editor 에서 실행한다(사람 몫).

-- 1) 수질 기록을 남길 행으로 이관
WITH ranked AS (
  SELECT id,
         first_value(id) OVER (PARTITION BY serial ORDER BY created_at DESC) AS keep_id
  FROM public.sensor_devices
  WHERE serial IS NOT NULL
)
UPDATE public.water_quality_readings w
SET device_id = r.keep_id
FROM ranked r
WHERE w.device_id = r.id AND r.id <> r.keep_id;

-- 2) 중복 행 삭제 (예전 페어링 기록은 FK cascade 로 함께 정리된다)
WITH ranked AS (
  SELECT id,
         first_value(id) OVER (PARTITION BY serial ORDER BY created_at DESC) AS keep_id
  FROM public.sensor_devices
  WHERE serial IS NOT NULL
)
DELETE FROM public.sensor_devices d
USING ranked r
WHERE d.id = r.id AND r.id <> r.keep_id;

-- 확인: 시리얼별 1행씩만 남았는지
--   SELECT serial, count(*) FROM public.sensor_devices
--   WHERE serial IS NOT NULL GROUP BY serial HAVING count(*) > 1;
