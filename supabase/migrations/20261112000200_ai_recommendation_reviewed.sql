-- Extend the existing recovery action history for merchant-confirmed AI reviews.
-- This does not modify checkout_payments or existing recovery action rows.

BEGIN;

ALTER TABLE public.checkout_recovery_actions
  DROP CONSTRAINT IF EXISTS checkout_recovery_actions_action_type_check;

ALTER TABLE public.checkout_recovery_actions
  ADD CONSTRAINT checkout_recovery_actions_action_type_check
  CHECK (action_type IN ('marked_for_review', 'ai_recommendation_reviewed'));

COMMIT;
