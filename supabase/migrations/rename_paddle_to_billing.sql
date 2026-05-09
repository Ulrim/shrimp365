-- Rename payment provider columns to provider-agnostic names
-- Run this on your Supabase database after deploying the DODO Payments integration

ALTER TABLE public.profiles RENAME COLUMN paddle_customer_id TO billing_customer_id;
ALTER TABLE public.profiles RENAME COLUMN paddle_subscription_id TO billing_subscription_id;

DROP INDEX IF EXISTS idx_profiles_paddle_customer_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_billing_customer_unique
  ON public.profiles(billing_customer_id)
  WHERE billing_customer_id IS NOT NULL;
