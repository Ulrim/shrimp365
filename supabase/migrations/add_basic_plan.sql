-- Add 'basic' to the plan CHECK constraint
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_plan_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_plan_check
  CHECK (plan IN ('free', 'basic', 'pro', 'enterprise'));
