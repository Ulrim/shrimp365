-- ============================================================
-- 농업(수경재배) 데모 데이터 시드
--
-- 무엇을 하는가
--   배포된 /daumlabs 농업 화면을 "데이터가 채워진 상태"로 보여 주기 위한
--   더미 데이터를 한 계정에 넣는다. 넣는 것은 다음 다섯 가지뿐이다.
--
--     · 농장 1개   farms                    (farm_type = 'agriculture')
--     · 베드 2개   tanks                    (tank_type = '실내', 양액 레시피 설정)
--     · 기기 2대   sensor_devices           (베드당 1대, last_payload 에 양액 상태)
--     · 측정 2,018행 water_quality_readings (최근 7일 · 10분 간격 · 베드당 1,009행)
--     · 알림 2건   alerts                   (해결됨 1 + 열림 1)
--
--   전부 아래에서 만든 **데모 농장 하나에 매달린 데이터**다. 실제 사용자
--   데이터는 건드리지 않는다(삭제 범위도 이 농장 id 로만 한정한다).
--
-- 어떻게 실행하는가
--   Supabase Dashboard → SQL Editor 에 이 파일 전체를 붙여 넣고 실행한다.
--   DB 쓰기에는 service_role 권한이 필요하므로 사람이 직접 실행해야 한다.
--
--   선행 조건: agriculture_mode.sql 이 먼저 실행돼 있어야 한다.
--   (안 돼 있으면 아래에서 무엇이 없는지 알려 주며 멈춘다.)
--
-- 몇 번을 실행해도 되는가
--   된다. 같은 이름의 데모 농장이 이미 있으면 지우고 다시 넣는다(멱등).
--   측정값에 잡음이 섞이므로 그래프 모양은 실행할 때마다 조금씩 달라진다.
--
-- 어떻게 지우는가
--   이 파일 맨 아래 "되돌리기" 절의 주석을 풀어 실행한다. 데모 농장만
--   지우며, FK cascade 로 베드·기기·측정값·알림이 함께 정리된다.
-- ============================================================

DO $seed$
DECLARE
  -- ── 사람이 고치는 곳 ─────────────────────────────────────
  -- 데모 데이터를 넣을 계정. 다른 계정에 넣고 싶으면 여기만 고친다.
  -- 이 이메일로 **이미 회원가입이 되어 있어야** 한다(auth.users 조회).
  v_email     TEXT := 'daumlabs@gmail.com';

  -- 데모 농장 이름. 재실행·되돌리기의 기준 키다.
  -- 고칠 거면 맨 아래 되돌리기 스크립트의 이름도 같이 고쳐야 한다.
  v_farm_name TEXT := '다움랩스 쪽파 수경재배 시험포';
  -- ────────────────────────────────────────────────────────

  v_user  UUID;
  v_farm  UUID;
  v_tank1 UUID;
  v_tank2 UUID;
  v_dev1  UUID;
  v_dev2  UUID;

  v_now   TIMESTAMPTZ;
  v_start TIMESTAMPTZ;
  v_rows  BIGINT;

  -- 나중에 추가된 컬럼들 — 없는 DB 에서도 죽지 않도록 있는지 먼저 본다.
  v_has_payload  BOOLEAN;   -- sensor_device_identity.sql (serial/firmware/last_payload)
  v_has_agentver BOOLEAN;   -- sensor_agent_update.sql    (agent_version)
  v_has_coords   BOOLEAN;   -- farm_coordinates.sql       (latitude/longitude)
BEGIN
  -- ── 0) 대상 계정 확인 ───────────────────────────────────
  -- 못 찾으면 여기서 멈춘다. 엉뚱한 계정에 데모 데이터가 들어가는 것보다
  -- 아무것도 안 들어가는 편이 낫다.
  SELECT id INTO v_user FROM auth.users WHERE email = v_email;
  IF v_user IS NULL THEN
    RAISE EXCEPTION
      '대상 계정을 찾지 못했습니다: %  —  이 이메일로 먼저 회원가입(로그인 1회)해야 합니다. 이미 가입돼 있다면 파일 맨 위 v_email 의 오타를 확인하세요.',
      v_email;
  END IF;

  -- ── 0-1) 선행 마이그레이션 확인 ─────────────────────────
  -- 농업 모드 컬럼이 없으면 데이터를 넣어도 화면이 비어 보인다. 먼저 막는다.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'farms' AND column_name = 'farm_type'
  ) THEN
    RAISE EXCEPTION 'farms.farm_type 이 없습니다 — supabase/migrations/agriculture_mode.sql 을 먼저 실행하세요.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tanks' AND column_name = 'target_ec'
  ) THEN
    RAISE EXCEPTION 'tanks.target_ec 이 없습니다 — supabase/migrations/agriculture_mode.sql 을 먼저 실행하세요.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'water_quality_readings' AND column_name = 'flow_rate'
  ) THEN
    RAISE EXCEPTION 'water_quality_readings.flow_rate 가 없습니다 — supabase/migrations/agriculture_mode.sql 을 먼저 실행하세요.';
  END IF;

  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='sensor_devices' AND column_name='last_payload')
    INTO v_has_payload;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='sensor_devices' AND column_name='agent_version')
    INTO v_has_agentver;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='farms' AND column_name='latitude')
    INTO v_has_coords;

  -- ── 1) 재실행 안전 — 기존 데모 농장 제거 ────────────────
  -- 이 계정의, 이 이름의 농장만 지운다. tanks → water_quality_readings /
  -- alerts / sensor_devices 가 전부 ON DELETE CASCADE 라 함께 정리된다.
  DELETE FROM public.farms WHERE user_id = v_user AND name = v_farm_name;

  -- ── 2) 농장 ─────────────────────────────────────────────
  INSERT INTO public.farms (user_id, name, location, owner_name, area, farm_type)
  VALUES (
    v_user,
    v_farm_name,
    '전라남도 나주시 남평읍',
    '노현승',
    330,                       -- ㎡ (약 100평 규모 시험포)
    'agriculture'
  )
  RETURNING id INTO v_farm;

  -- 좌표 — 지도 카드가 뜨도록. 남평읍 소재지 부근 근사값이다.
  -- (정확한 시험포 좌표를 알면 화면의 농장 편집에서 고치면 된다.)
  IF v_has_coords THEN
    EXECUTE 'UPDATE public.farms SET latitude = $1, longitude = $2 WHERE id = $3'
      USING 35.0292::float8, 126.8483::float8, v_farm;
  END IF;

  -- ── 3) 베드 2개 ─────────────────────────────────────────
  -- 새우 전용 칸(stocking_density / shrimp_count / cycle_day / 입식·출하일)은
  -- 0·NULL 로 둔다. 농업 문맥에 뜻이 없는 값이다.
  --
  -- EC 는 µS/cm 로 저장한다(agriculture_mode.sql 의 단위 원칙).
  --   1번 베드 목표 1800 µS/cm = 1.80 mS/cm, 허용 ±100 µS/cm = ±0.1 dS/m
  --   2번 베드 목표 2000 µS/cm = 2.00 mS/cm, 허용 ±150 µS/cm
  INSERT INTO public.tanks (
    farm_id, name, volume, status, tank_type,
    stocking_density, shrimp_count, cycle_day, stocking_date, harvest_date,
    target_ec, ec_tolerance, target_ph, ph_tolerance
  ) VALUES (
    v_farm, '1번 베드 (NFT-A)', 900, 'active', '실내',
    0, 0, 0, NULL, NULL,
    1800, 100, 6.0, 0.5
  ) RETURNING id INTO v_tank1;

  -- 2번 베드는 목표값을 다르게 둬 화면에서 베드별 차이가 보이게 한다.
  -- status 는 'warning' — 아래에서 넣는 열린 EC 이탈 알림과 짝이 맞는다.
  INSERT INTO public.tanks (
    farm_id, name, volume, status, tank_type,
    stocking_density, shrimp_count, cycle_day, stocking_date, harvest_date,
    target_ec, ec_tolerance, target_ph, ph_tolerance
  ) VALUES (
    v_farm, '2번 베드 (NFT-B)', 750, 'warning', '실내',
    0, 0, 0, NULL, NULL,
    2000, 150, 6.2, 0.4
  ) RETURNING id INTO v_tank2;

  -- ── 4) 센서 기기 (베드당 1대) ───────────────────────────
  -- api_key 는 컬럼 기본값(랜덤 48자 hex)에 맡긴다. 실물 장비를 붙일 게
  -- 아니므로 값을 알 필요가 없고, 고정 키를 SQL 에 적어 두면 그게 곧
  -- 유출 가능한 자격증명이 된다.
  v_now := date_trunc('minute', now());

  INSERT INTO public.sensor_devices (tank_id, name, device_type, active, last_seen_at)
  VALUES (v_tank1, 'NFT-A 수집기', 'multi', TRUE, v_now - interval '3 minutes')
  RETURNING id INTO v_dev1;

  INSERT INTO public.sensor_devices (tank_id, name, device_type, active, last_seen_at)
  VALUES (v_tank2, 'NFT-B 수집기', 'multi', TRUE, v_now - interval '6 minutes')
  RETURNING id INTO v_dev2;

  -- 식별 정보 + 마지막 원본 payload.
  -- last_payload 의 nut_* 키가 대시보드 "양액 상태" 카드를 띄운다
  -- (components/sensors/nutrient-status-card.tsx — nut_percent 가 숫자여야 렌더).
  -- 두 베드를 각각 ok / low 로 둬 판정 두 가지를 다 보이게 한다.
  --
  -- 아래 원본 측정값은 5)에서 만드는 측정 이력의 **마지막 점과 같은 값**이다
  -- (기기가 방금 올린 값이 곧 마지막 기록이므로). 이력에는 잡음이 섞이므로
  -- 실행할 때마다 EC 는 ±15 µS/cm, pH 는 ±0.02 만큼 어긋날 수 있다.
  IF v_has_payload THEN
    EXECUTE 'UPDATE public.sensor_devices SET serial = $1, firmware = $2, last_payload = $3 WHERE id = $4'
      USING
        'DEMO-NFT-A-0001',
        '1.7.0',
        jsonb_build_object(
          -- 원본 측정값 — "센서 현재값" 카드가 이 키들을 읽는다.
          'temperature',   22.3,
          'ph',            5.88,
          'do_level',      7.42,
          'conductivity',  1800,     -- µS/cm — 목표와 같다
          'tds',           900,      -- ppm
          'flow_rate',     12.0,     -- L/min
          'diff_pressure', 29.9,     -- kPa
          -- 양액 상태(장비의 nutrient_plan 결과). 웹은 계산하지 않고 표시만 한다.
          'nut_percent',    100,
          'nut_verdict',    'ok',
          'nut_target_ec',  1800,    -- µS/cm
          'nut_dose_a_ml',  0,
          'nut_dose_b_ml',  0,
          'nut_exchange_l', 0,
          'nut_calibrated', true
        ),
        v_dev1;

    EXECUTE 'UPDATE public.sensor_devices SET serial = $1, firmware = $2, last_payload = $3 WHERE id = $4'
      USING
        'DEMO-NFT-B-0002',
        '1.7.0',
        jsonb_build_object(
          'temperature',   22.2,
          'ph',            6.19,
          'do_level',      6.70,
          'conductivity',  1773,     -- 목표 2000 보다 낮다 → 보충 필요
          'tds',           887,
          'flow_rate',     10.7,
          'diff_pressure', 18.0,
          'nut_percent',    89,      -- 1773 / 2000
          'nut_verdict',    'low',
          'nut_target_ec',  2000,
          'nut_dose_a_ml',  240,     -- A액 보충량 (mL)
          'nut_dose_b_ml',  240,     -- B액 보충량 (mL)
          'nut_exchange_l', 0,       -- 'high' 판정에서만 쓰인다
          -- false 로 두면 카드에 "미교정" 배지가 뜬다. 배지 없이 보고 싶으면
          -- 이 값을 true 로 바꾸면 된다.
          'nut_calibrated', false
        ),
        v_dev2;
  ELSE
    RAISE NOTICE 'sensor_devices.last_payload 컬럼이 없어 양액 상태 카드용 값은 넣지 못했습니다 — sensor_device_identity.sql 실행 후 이 파일을 다시 실행하세요.';
  END IF;

  IF v_has_agentver THEN
    EXECUTE 'UPDATE public.sensor_devices SET agent_version = $1, agent_version_at = $2 WHERE id IN ($3, $4)'
      USING '1.7.0', v_now - interval '3 minutes', v_dev1, v_dev2;
  END IF;

  -- ── 5) 측정 이력 — 최근 7일 · 10분 간격 ─────────────────
  -- 베드당 7×24×6 + 1 = 1,009행, 합계 2,018행.
  --
  -- 값의 성격(전부 route.ts VALID_RANGE 와 DB CHECK 범위 안):
  --   conductivity  목표 근처 일주기 진동 + 3일 전 이탈 산(1번 베드, 목표+250)
  --                 + 2번 베드는 최근 8시간 하향 드리프트(→ 열린 알림과 일치)
  --   ph            목표 근처, 이틀 주기로 완만히 내려갔다가 보정으로 복귀
  --   temperature   칠러 가동 22.1~23.9℃ (외기 영향으로 낮에 소폭 상승)
  --   do_level      6.4~7.6 ppm
  --   flow_rate     12 / 10.5 L/min 근처, 1.5일 전 90분간 급감(펌프 이상 흉내)
  --   diff_pressure 8 kPa 에서 서서히 상승 — 1번 30, 2번 18 kPa (필터 막힘 진행)
  --   새우 전용 칸  salinity·ammonia·nitrite·nitrate·alkalinity·turbidity 는
  --                 전부 NULL. 농업 문맥에 없는 값이라 그래프에 선을 만들면 안 된다.
  --
  -- device_id 를 채워 기기별 필터(wq_series 의 p_device)가 동작하게 한다.
  v_start := v_now - interval '7 days';

  INSERT INTO public.water_quality_readings (
    tank_id, device_id, recorded_at,
    temperature, ph, do_level, conductivity, flow_rate, diff_pressure,
    salinity, ammonia, nitrite, nitrate, alkalinity, turbidity
  )
  SELECT
    b.tank_id,
    b.device_id,
    g.ts,
    -- 수온 — 칠러가 잡아 주되 낮(정오 무렵)에 살짝 올라간다. 22~24℃ 안에 든다.
    round((22.9
           + 0.8 * sin(2 * pi() * (x.h + b.phase - 9.0) / 24.0)
           + (random() - 0.5) * 0.25
          )::numeric, 2),
    -- pH — 이틀 주기로 서서히 내려갔다가 보정으로 되돌아온다.
    round((b.target_ph
           + 0.12 * sin(2 * pi() * (x.h + b.phase) / 24.0)
           - 0.25 * ((x.h - 48.0 * floor(x.h / 48.0)) / 48.0)
           + (random() - 0.5) * 0.04
          )::numeric, 2),
    -- 용존산소
    round((7.0
           + 0.6 * sin(2 * pi() * (x.h + b.phase - 15.0) / 24.0)
           + (random() - 0.5) * 0.3
          )::numeric, 2),
    -- EC — 목표 근처 진동 + 이탈 산(3일 전 ±3시간) + 최근 하향 드리프트
    round((b.target_ec
           + 55.0 * sin(2 * pi() * (x.h + b.phase) / 24.0)
           + b.exc_amp * greatest(0.0, 1.0 - abs(x.age_h - 75.0) / 3.0)
           - b.tail_drop * greatest(0.0, (8.0 - x.age_h) / 8.0)
           + (random() - 0.5) * 30.0
          )::numeric, 1),
    -- 순환 유량 — 1.5일 전 90분간 급감
    round(greatest(0.0,
          b.flow_base
           + 0.25 * sin(2 * pi() * (x.h + b.phase) / 24.0)
           - 7.5 * (CASE WHEN x.age_h >= 36.0 AND x.age_h <= 37.5 THEN 1.0 ELSE 0.0 END)
           + (random() - 0.5) * 0.2
          )::numeric, 2),
    -- 차압 — 필터가 막혀 가며 단조 상승
    round((8.0
           + (b.dp_end - 8.0) * power(x.h / 168.0, 1.3)
           + (random() - 0.5) * 0.4
          )::numeric, 2),
    -- 새우 전용 칸 — 농업 문맥에 없는 값이라 비운다.
    NULL, NULL, NULL, NULL, NULL, NULL
  FROM (VALUES
      -- exc_amp 290 은 이탈 산의 꼭대기가 목표+250 근처(≈2050 µS/cm)에 오도록 맞춘 값이다.
      -- 그 시각의 일주기 진동이 마침 골(-39)이라 그만큼을 더 얹어야 한다.
      -- 아래 "해결됨" 알림의 value 2050 이 이 꼭대기와 같은 값이다 — 같이 고쳐야 한다.
      --  베드      기기      target_ec   target_ph   phase   flow_base   dp_end   exc_amp   tail_drop
      (v_tank1, v_dev1, 1800.0::float8, 6.00::float8, 0.0::float8, 12.0::float8, 30.0::float8, 290.0::float8,   0.0::float8),
      (v_tank2, v_dev2, 2000.0::float8, 6.20::float8, 5.0::float8, 10.5::float8, 18.0::float8,   0.0::float8, 280.0::float8)
    ) AS b(tank_id, device_id, target_ec, target_ph, phase, flow_base, dp_end, exc_amp, tail_drop)
  CROSS JOIN generate_series(v_start, v_now, interval '10 minutes') AS g(ts)
  CROSS JOIN LATERAL (
    SELECT
      (EXTRACT(epoch FROM (g.ts - v_start)) / 3600.0)::float8 AS h,      -- 시작부터 경과 시간(h)
      (EXTRACT(epoch FROM (v_now  - g.ts))  / 3600.0)::float8 AS age_h   -- 지금으로부터 몇 시간 전인가
  ) AS x;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- ── 6) 알림 2건 ─────────────────────────────────────────
  -- 실제 알림은 센서 수신 라우트(app/api/sensors/data/route.ts)가 만든다.
  -- 여기서는 알림 패널이 비지 않도록 같은 형식으로 직접 넣는다.
  -- 문구·parameter·threshold 는 lib/thresholds.ts 의 checkRecipe 출력과 같은 형식이다.

  -- (해결됨) 1번 베드 — 3일 전 EC 이탈. 위 측정 이력의 이탈 산과 시각이 맞다.
  --   |2050 - 1800| = 250 > 2 × 100 → danger, 경계값 1800 + 100 = 1900
  INSERT INTO public.alerts (tank_id, type, parameter, value, threshold, message, resolved, created_at)
  VALUES (
    v_tank1, 'danger', 'EC', 2050, 1900,
    'EC 2.05 mS/cm — 목표 1.80±0.10 이탈',
    TRUE,
    v_now - interval '3 days 4 hours'
  );

  -- (열림) 2번 베드 — 지금 EC 가 목표보다 낮다. 기기 payload 의 'low' 판정,
  --   tanks.status = 'warning', 최근 하향 드리프트와 모두 짝이 맞는다.
  --   |1773 - 2000| = 227 > 150 이고 2 × 150 = 300 보다는 작아 warning
  INSERT INTO public.alerts (tank_id, type, parameter, value, threshold, message, resolved, created_at)
  VALUES (
    v_tank2, 'warning', 'EC', 1773, 1850,
    'EC 1.77 mS/cm — 목표 2.00±0.15 이탈',
    FALSE,
    v_now - interval '2 hours'
  );

  RAISE NOTICE '농업 데모 데이터 완료 — 계정 %, 농장 "%"(id %), 베드 2, 기기 2, 측정 %행, 알림 2건',
    v_email, v_farm_name, v_farm, v_rows;
  RAISE NOTICE '확인: 로그인 후 /daumlabs 로 들어가면 됩니다.';
END
$seed$;


-- ============================================================
-- 되돌리기 (데모 데이터만 삭제)
--
-- 아래 블록의 주석을 풀고 실행하면 데모 농장 하나가 지워지고,
-- FK cascade 로 베드·기기·측정값·알림이 함께 정리된다.
-- 삭제 범위는 (이 계정, 이 농장 이름) 으로만 한정되므로 다른 농장·다른
-- 계정의 데이터는 절대 지워지지 않는다.
--
-- v_email / v_farm_name 을 위에서 고쳤다면 여기도 똑같이 고쳐야 한다.
-- ============================================================
--
-- DO $undo$
-- DECLARE
--   v_email     TEXT := 'daumlabs@gmail.com';
--   v_farm_name TEXT := '다움랩스 쪽파 수경재배 시험포';
--   v_user UUID;
--   v_n    BIGINT;
-- BEGIN
--   SELECT id INTO v_user FROM auth.users WHERE email = v_email;
--   IF v_user IS NULL THEN
--     RAISE EXCEPTION '계정을 찾지 못했습니다: % — 지울 것이 없습니다.', v_email;
--   END IF;
--
--   DELETE FROM public.farms WHERE user_id = v_user AND name = v_farm_name;
--   GET DIAGNOSTICS v_n = ROW_COUNT;
--   RAISE NOTICE '데모 농장 %개를 지웠습니다(베드·기기·측정값·알림 포함).', v_n;
-- END
-- $undo$;
--
-- 지워졌는지 확인:
--   SELECT count(*) FROM public.farms
--   WHERE name = '다움랩스 쪽파 수경재배 시험포';
