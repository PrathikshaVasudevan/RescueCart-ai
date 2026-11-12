-- Apply manually after reviewing the existing checkout_payments schema.
-- This migration is not executed by the application.

BEGIN;

-- The existing checkout_payments table already has the required unique order ID index,
-- unique capture ID index, amount check, and six-state status check. Do not recreate or
-- replace those constraints here. Confirm the order ID index is a valid, non-partial unique
-- index so the application's upsert(onConflict: paypal_order_id) remains supported.
DO $$
DECLARE
  order_id_attnum smallint;
BEGIN
  SELECT attnum
    INTO order_id_attnum
    FROM pg_attribute
   WHERE attrelid = 'public.checkout_payments'::regclass
     AND attname = 'paypal_order_id'
     AND NOT attisdropped;

  IF order_id_attnum IS NULL THEN
    RAISE EXCEPTION 'checkout_payments.paypal_order_id column was not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_index AS i
     WHERE i.indrelid = 'public.checkout_payments'::regclass
       AND i.indisunique
       AND i.indisvalid
       AND i.indisready
       AND i.indpred IS NULL
       AND i.indexprs IS NULL
       AND i.indnkeyatts = 1
       AND i.indkey[0] = order_id_attnum
  ) THEN
    RAISE EXCEPTION 'A valid, non-partial unique index on checkout_payments(paypal_order_id) is required';
  END IF;
END $$;

-- Durable idempotency mapping. The UUID is also sent as PayPal-Request-Id.
CREATE TABLE IF NOT EXISTS public.checkout_order_idempotency (
  idempotency_key uuid CONSTRAINT checkout_order_idempotency_pkey PRIMARY KEY,
  paypal_order_id text CONSTRAINT checkout_order_idempotency_paypal_order_id_key UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Only the server-side service role may read or write this table.
ALTER TABLE public.checkout_order_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.checkout_order_idempotency FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.checkout_order_idempotency TO service_role;

COMMIT;
