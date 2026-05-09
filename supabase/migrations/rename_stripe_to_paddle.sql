-- Rename Stripe columns to Paddle equivalents
ALTER TABLE public.profiles
  RENAME COLUMN stripe_customer_id     TO paddle_customer_id;

ALTER TABLE public.profiles
  RENAME COLUMN stripe_subscription_id TO paddle_subscription_id;

-- Update the unique index to reference the renamed column
DROP INDEX IF EXISTS idx_profiles_stripe_customer_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_paddle_customer_unique
  ON public.profiles(paddle_customer_id)
  WHERE paddle_customer_id IS NOT NULL;
