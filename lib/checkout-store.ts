import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { RESCUE_PRODUCT } from "@/lib/paypal";
import type {
  CheckoutRepository,
  OrderRequestRecord,
  PaymentState,
  PaymentUpdate,
  TrackedPayment,
} from "@/lib/checkout-lifecycle";

const IDEMPOTENCY_TABLE = "checkout_order_idempotency";

export const checkoutRepository: CheckoutRepository = {
  async claimOrderRequest(key: string): Promise<OrderRequestRecord> {
    const { data, error } = await supabaseAdmin
      .from(IDEMPOTENCY_TABLE)
      .insert({ idempotency_key: key })
      .select("idempotency_key, paypal_order_id, created_at")
      .maybeSingle();

    if (data) return data as OrderRequestRecord;

    // A uniqueness conflict means another request already owns this key.
    if (error?.code !== "23505") throw error ?? new Error("Could not claim checkout key");

    const existing = await supabaseAdmin
      .from(IDEMPOTENCY_TABLE)
      .select("idempotency_key, paypal_order_id, created_at")
      .eq("idempotency_key", key)
      .maybeSingle();
    if (existing.error || !existing.data) throw existing.error ?? new Error("Checkout key was not found");
    return existing.data as OrderRequestRecord;
  },

  async saveOrderId(key: string, orderId: string): Promise<string> {
    const { data, error } = await supabaseAdmin
      .from(IDEMPOTENCY_TABLE)
      .update({ paypal_order_id: orderId })
      .eq("idempotency_key", key)
      .is("paypal_order_id", null)
      .select("paypal_order_id")
      .maybeSingle();

    if (error) throw error;
    if (data?.paypal_order_id) return data.paypal_order_id as string;

    const existing = await supabaseAdmin
      .from(IDEMPOTENCY_TABLE)
      .select("paypal_order_id")
      .eq("idempotency_key", key)
      .maybeSingle();
    if (existing.error || !existing.data?.paypal_order_id) {
      throw existing.error ?? new Error("Checkout order could not be saved");
    }
    if (existing.data.paypal_order_id !== orderId) throw new Error("Idempotency key resolved to a different order");
    return existing.data.paypal_order_id as string;
  },

  async ensurePayment(orderId: string): Promise<void> {
    const { error } = await supabaseAdmin
      .from("checkout_payments")
      .upsert(
        {
          paypal_order_id: orderId,
          amount: Number(RESCUE_PRODUCT.price),
          currency: RESCUE_PRODUCT.currency,
          status: "pending",
        },
        { onConflict: "paypal_order_id", ignoreDuplicates: true },
      );
    if (error) throw error;
  },

  async findPayment(orderId: string): Promise<TrackedPayment | null> {
    const { data, error } = await supabaseAdmin
      .from("checkout_payments")
      .select("paypal_order_id, amount, currency, status, paypal_capture_id")
      .eq("paypal_order_id", orderId)
      .maybeSingle();
    if (error) throw error;
    return (data as TrackedPayment | null) ?? null;
  },

  async updatePayment(
    orderId: string,
    update: PaymentUpdate,
  ): Promise<PaymentState | string | null> {
    let query = supabaseAdmin.from("checkout_payments").update(update).eq("paypal_order_id", orderId);
    if (update.status !== "completed") query = query.neq("status", "completed");
    const { data, error } = await query.select("status").maybeSingle();
    if (error) throw error;
    if (data?.status) return data.status as string;

    // A completed row is immutable with respect to weaker/stale states.
    const current = await supabaseAdmin
      .from("checkout_payments")
      .select("status")
      .eq("paypal_order_id", orderId)
      .maybeSingle();
    if (current.error) throw current.error;
    return (current.data?.status as string | undefined) ?? null;
  },
};