-- 농장 주소 지오코딩 캐시 — docs/plans/control-map-farms.md 2-2.
--
-- **사람이 Supabase SQL Editor 에서 실행한다.** 이 파일을 돌리기 전에도 관제센터
-- (GET /api/control/overview)는 200 으로 정상 응답한다 — 테이블이 없으면
-- 지오코딩만 조용히 건너뛰고, 농장 위치는 농가 입력 좌표·장비 좌표 평균
-- (1·2단계)으로만 찍힌다.
--
-- 무엇이 들어오나: 좌표가 없는 농장의 주소(farms.location)를 카카오 로컬 또는
--   OpenStreetMap Nominatim 으로 찾은 결과. 농장 1곳 = 1행(farm_id 가 PK).
--   찾지 못해도 latitude/longitude 를 NULL 로 남겨 기록한다(실패 캐시) — 같은 주소를
--   매번 다시 묻지 않고, 7일 뒤에 다시 시도한다. 주소가 바뀌면 query 가 달라져
--   다시 찾는다.
--
-- 왜 farms 에 쓰지 않나: farms.latitude/longitude 는 농가가 직접 넣는 값이다.
--   추정 좌표가 섞이면 "정확한 위치" 와 "주소 기준 대략 위치" 를 구분할 수 없다.
--
-- 누가 쓰고 읽나: overview 라우트가 service_role 로만. 화면·일반 사용자는 이
--   테이블을 직접 보지 않는다 — RLS 를 켜고 정책을 두지 않아 anon/authenticated
--   로는 읽기·쓰기 모두 막힌다. 전체가 재실행 안전하다.

CREATE TABLE IF NOT EXISTS public.farm_geocodes (
  farm_id     uuid PRIMARY KEY REFERENCES public.farms(id) ON DELETE CASCADE,
  query       text NOT NULL,           -- 지오코딩에 쓴 주소 문자열(바뀌면 다시 찾는다)
  latitude    double precision,        -- 실패면 NULL
  longitude   double precision,
  precision   text,                    -- 'address' | 'region'(읍면동·시군 수준으로 줄여서 찾음)
  provider    text,                    -- 'kakao' | 'nominatim'
  geocoded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.farm_geocodes ENABLE ROW LEVEL SECURITY;  -- 정책 없음: service_role 전용

NOTIFY pgrst, 'reload schema';

-- [확인] 최근 지오코딩 — 관제센터를 한 번 연 뒤 몇 초 지나면 행이 생긴다.
--   SELECT g.geocoded_at, f.name, g.query, g.latitude, g.longitude, g.precision, g.provider
--   FROM public.farm_geocodes g JOIN public.farms f ON f.id = g.farm_id
--   ORDER BY g.geocoded_at DESC LIMIT 20;
--
-- [재시도] 실패 캐시를 지워 다음 새로고침에 다시 찾게 하려면:
--   DELETE FROM public.farm_geocodes WHERE latitude IS NULL;
