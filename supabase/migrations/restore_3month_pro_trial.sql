-- Pro 플랜이면서 plan_expires_at이 NULL인 기존 사용자에게
-- 현재부터 3개월의 체험 기간을 부여합니다.
UPDATE public.profiles
SET plan_expires_at = NOW() + INTERVAL '3 months'
WHERE plan = 'pro'
  AND plan_expires_at IS NULL;
