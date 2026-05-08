-- 성능 최적화 인덱스
-- farms.user_id: 사용자별 양식장 조회 (RLS 경로)
CREATE INDEX IF NOT EXISTS idx_farms_user_id
  ON public.farms(user_id);

-- tanks.farm_id: 양식장별 수조 조회
CREATE INDEX IF NOT EXISTS idx_tanks_farm_id
  ON public.tanks(farm_id);

-- diagnosis_results: 수조별 최신 진단 조회
CREATE INDEX IF NOT EXISTS idx_diagnosis_tank_date
  ON public.diagnosis_results(tank_id, tested_at DESC);

-- journal_entries: 수조별 날짜 정렬 조회
CREATE INDEX IF NOT EXISTS idx_je_tank_date
  ON public.journal_entries(tank_id, date DESC);

-- alerts: 수조별 미해결 알림 조회
CREATE INDEX IF NOT EXISTS idx_alerts_tank_resolved
  ON public.alerts(tank_id, resolved, created_at DESC);

-- sensor_devices: api_key 조회 (IoT 인증 경로)
CREATE INDEX IF NOT EXISTS idx_sensor_devices_api_key
  ON public.sensor_devices(api_key);
