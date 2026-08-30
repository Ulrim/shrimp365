-- ============================================================
-- 센서 기기 식별 정보
--
-- 라즈베리파이가 스스로를 알릴 수 있게 한다. API 키는 등록 직후 한 번만
-- 보여 주고 다시 확인할 수 없으므로, 화면에서 "이 카드가 어느 장비인지"를
-- 구분할 수단이 없었다. 라즈베리파이 CPU 시리얼(보드마다 고정)을 받아
-- 기기 카드에 표시한다.
--
-- 실행 조건: add_sensor_devices.sql 을 먼저 실행해야 한다.
-- 실행 위치: Supabase Dashboard → SQL Editor
-- ============================================================

alter table public.sensor_devices
  -- 라즈베리파이 CPU 시리얼 등 하드웨어 고정값. 기기를 눈으로 구분하는 용도.
  add column if not exists serial text,
  -- 장비에서 돌아가는 클라이언트 버전. 문제 생겼을 때 원인 추적용.
  add column if not exists firmware text,
  -- 마지막으로 수신한 원본 측정값 전체(JSON).
  -- 수질 기록에 저장하지 않는 값(전도도·TDS·ORP 등)도 여기에는 남아
  -- 기기가 실제로 무엇을 보내고 있는지 화면에서 확인할 수 있다.
  add column if not exists last_payload jsonb;

-- 같은 보드를 두 번 등록하는 실수를 잡기 위한 인덱스(유일성은 강제하지 않는다.
-- 보드를 교체하고 기존 기기 항목을 재사용하는 경우가 있기 때문).
create index if not exists idx_sensor_devices_serial
  on public.sensor_devices (serial)
  where serial is not null;
