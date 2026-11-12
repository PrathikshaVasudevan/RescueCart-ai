import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isValidPayPalOrderId } from "@/lib/checkout-lifecycle";

export type RecoveryPayment = {
  id: string;
  paypal_order_id: string;
  amount: string | number;
  currency: string;
  status: string;
  paypal_capture_id: string | null;
  created_at: string;
  updated_at: string;
  captured_at: string | null;
};

export type RecoveryAction = {
  id: string;
  paypal_order_id: string;
  action_type: "marked_for_review" | "ai_recommendation_reviewed";
  note: string | null;
  created_at: string;
};

export async function listRecoveryPayments(): Promise<{ payments: RecoveryPayment[]; actions: RecoveryAction[] }> {
  async function allRows<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
    const rows: T[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await query(from, from + 999);
      if (error) throw error;
      const page = data ?? [];
      rows.push(...page);
      if (page.length < 1000) return rows;
    }
  }

  const [payments, actions] = await Promise.all([
    allRows<RecoveryPayment>((from, to) => supabaseAdmin
      .from("checkout_payments")
      .select("id, paypal_order_id, amount, currency, status, paypal_capture_id, created_at, updated_at, captured_at")
      .order("created_at", { ascending: false })
      .order("paypal_order_id", { ascending: true })
      .range(from, to)),
    allRows<RecoveryAction>((from, to) => supabaseAdmin
      .from("checkout_recovery_actions")
      .select("id, paypal_order_id, action_type, note, created_at")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to)),
  ]);
  return {
    payments,
    actions,
  };
}

export async function recordRecoveryAction(
  orderId: string,
  actionType: RecoveryAction["action_type"],
  note: string | null,
): Promise<RecoveryAction> {
  if (!isValidPayPalOrderId(orderId)) throw new Error("invalid_order_id");
  if (actionType !== "marked_for_review" && actionType !== "ai_recommendation_reviewed") throw new Error("invalid_action_type");

  // Only a payment already tracked in checkout_payments can receive an action.
  const tracked = await supabaseAdmin
    .from("checkout_payments")
    .select("paypal_order_id")
    .eq("paypal_order_id", orderId)
    .maybeSingle();
  if (tracked.error) throw tracked.error;
  if (!tracked.data) throw new Error("payment_not_found");

  const { data, error } = await supabaseAdmin
    .from("checkout_recovery_actions")
    .insert({ paypal_order_id: orderId, action_type: actionType, note })
    .select("id, paypal_order_id, action_type, note, created_at")
    .single();
  if (error) throw error;
  return data as RecoveryAction;
}

export function markPaymentForReview(orderId: string, note: string | null): Promise<RecoveryAction> {
  return recordRecoveryAction(orderId, "marked_for_review", note);
}
