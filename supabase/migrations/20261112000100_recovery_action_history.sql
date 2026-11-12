-- Apply manually after confirming checkout_payments.paypal_order_id is unique.
-- This migration does not modify or delete existing payment rows or indexes.

BEGIN;

CREATE TABLE IF NOT EXISTS public.checkout_recovery_actions (
  id uuid CONSTRAINT checkout_recovery_actions_pkey PRIMARY KEY DEFAULT gen_random_uuid(),
  paypal_order_id text NOT NULL
    CONSTRAINT checkout_recovery_actions_payment_fkey
    REFERENCES public.checkout_payments (paypal_order_id),
  action_type text NOT NULL
    CONSTRAINT checkout_recovery_actions_action_type_check
    CHECK (action_type IN ('marked_for_review')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS checkout_recovery_actions_order_created_idx
  ON public.checkout_recovery_actions (paypal_order_id, created_at DESC);

ALTER TABLE public.checkout_recovery_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.checkout_recovery_actions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.checkout_recovery_actions TO service_role;

COMMIT;
