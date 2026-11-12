import { RESCUE_PRODUCT, type CheckoutOrder, type Money } from "./paypal";

export type PaymentState =
  | "pending"
  | "approved"
  | "capture_pending"
  | "completed"
  | "failed"
  | "unknown";

export type TrackedPayment = {
  paypal_order_id: string;
  amount: string | number;
  currency: string;
  status: PaymentState | string;
  paypal_capture_id?: string | null;
};

export type OrderRequestRecord = {
  idempotency_key: string;
  paypal_order_id: string | null;
  created_at: string;
};

export type PaymentUpdate = {
  status: PaymentState;
  paypal_capture_id?: string;
  captured_at?: string;
  updated_at: string;
};

export interface CheckoutRepository {
  claimOrderRequest(key: string): Promise<OrderRequestRecord>;
  saveOrderId(key: string, orderId: string): Promise<string>;
  ensurePayment(orderId: string): Promise<void>;
  findPayment(orderId: string): Promise<TrackedPayment | null>;
  updatePayment(orderId: string, update: PaymentUpdate): Promise<PaymentState | string | null>;
}

export interface PayPalCheckoutGateway {
  createOrder(requestId: string): Promise<CheckoutOrder>;
  getOrder(orderId: string): Promise<CheckoutOrder>;
  captureOrder(orderId: string, requestId: string): Promise<CheckoutOrder>;
}

export class CheckoutLifecycleError extends Error {
  constructor(readonly code: "not_found" | "invalid_order" | "idempotency_expired") {
    super(code);
    this.name = "CheckoutLifecycleError";
  }
}

const PAYPAL_REQUEST_ID_RETENTION_MS = 6 * 60 * 60 * 1000;
const PAYPAL_ORDER_ID_PATTERN = /^[A-Z0-9]{1,36}$/;

export function isValidPayPalOrderId(value: unknown): value is string {
  return typeof value === "string" && PAYPAL_ORDER_ID_PATTERN.test(value);
}

export function isValidIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function cents(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(result) ? result : null;
}

function moneyMatches(actual: Money | undefined, expected: { value: string; currency: string }): boolean {
  return !!actual && actual.currency_code === expected.currency && cents(actual.value) !== null &&
    cents(actual.value) === cents(expected.value);
}

function paymentMatchesProduct(payment: TrackedPayment): boolean {
  return payment.currency === RESCUE_PRODUCT.currency &&
    cents(payment.amount) !== null && cents(payment.amount) === cents(RESCUE_PRODUCT.price);
}

export function orderMatchesProduct(order: CheckoutOrder, orderId: string, payment: TrackedPayment): boolean {
  if (order.id !== orderId || !paymentMatchesProduct(payment)) return false;
  const units = order.purchase_units ?? [];
  if (units.length !== 1) return false;
  const unit = units[0];
  return unit.reference_id === RESCUE_PRODUCT.id &&
    moneyMatches(unit.amount, { value: RESCUE_PRODUCT.price, currency: RESCUE_PRODUCT.currency });
}

export async function createIdempotentCheckoutOrder(
  key: string,
  repository: CheckoutRepository,
  paypal: Pick<PayPalCheckoutGateway, "createOrder" | "getOrder">,
  now = Date.now(),
): Promise<CheckoutOrder> {
  const request = await repository.claimOrderRequest(key);

  if (request.paypal_order_id) {
    await repository.ensurePayment(request.paypal_order_id);
    const existing = await paypal.getOrder(request.paypal_order_id);
    if (existing.id !== request.paypal_order_id) throw new CheckoutLifecycleError("invalid_order");
    return existing;
  }

  const createdAt = Date.parse(request.created_at);
  const age = now - createdAt;
  // PayPal retains Orders API request IDs for six hours. After that window, fail closed:
  // repeating the call could create a second order if PayPal has expired its idempotency record.
  if (!Number.isFinite(createdAt) || age < 0 || age >= PAYPAL_REQUEST_ID_RETENTION_MS) {
    throw new CheckoutLifecycleError("idempotency_expired");
  }

  // The same client key is persisted in Supabase and sent to PayPal. Concurrent callers may
  // issue the same create request, but PayPal's request ID deduplicates the external operation.
  const order = await paypal.createOrder(key);
  if (!isValidPayPalOrderId(order.id)) throw new CheckoutLifecycleError("invalid_order");

  const savedOrderId = await repository.saveOrderId(key, order.id);
  await repository.ensurePayment(savedOrderId);
  return order;
}

export type OrderAssessment = {
  status: PaymentState;
  captureId?: string;
};

export function assessPayPalOrder(order: CheckoutOrder): OrderAssessment {
  const captures = order.purchase_units?.flatMap((unit) => unit.payments?.captures ?? []) ?? [];

  if (captures.some((capture) => capture.amount && !moneyMatches(capture.amount, {
    value: RESCUE_PRODUCT.price,
    currency: RESCUE_PRODUCT.currency,
  }))) return { status: "unknown" };

  const completed = captures.find((capture) => capture.status === "COMPLETED");
  if (completed) {
    if (!completed.id || !moneyMatches(completed.amount, {
      value: RESCUE_PRODUCT.price,
      currency: RESCUE_PRODUCT.currency,
    })) {
      return { status: "unknown" };
    }
    return { status: "completed", captureId: completed.id };
  }

  if (captures.some((capture) => capture.status === "PENDING")) {
    return { status: "capture_pending" };
  }

  if (captures.some((capture) => capture.status === "FAILED" || capture.status === "DECLINED")) {
    return { status: "failed" };
  }

  switch (order.status) {
    case "CREATED":
    case "SAVED":
    case "PAYER_ACTION_REQUIRED":
      return { status: "pending" };
    case "APPROVED":
      return { status: "approved" };
    // VOIDED may represent cancellation. Keep it out of failed unless PayPal reports a
    // terminal failed/declined capture explicitly.
    default:
      return { status: "unknown" };
  }
}

async function inspectOrder(
  orderId: string,
  payment: TrackedPayment,
  paypal: Pick<PayPalCheckoutGateway, "getOrder">,
): Promise<OrderAssessment> {
  const order = await paypal.getOrder(orderId);
  if (!orderMatchesProduct(order, orderId, payment)) throw new CheckoutLifecycleError("invalid_order");
  return assessPayPalOrder(order);
}

async function synchronize(
  orderId: string,
  assessment: OrderAssessment,
  repository: CheckoutRepository,
  now = new Date().toISOString(),
): Promise<{ status: PaymentState; databaseSync: "completed" | "required" }> {
  const update: PaymentUpdate = assessment.status === "completed" && assessment.captureId
    ? {
        status: "completed",
        paypal_capture_id: assessment.captureId,
        captured_at: now,
        updated_at: now,
      }
    : { status: assessment.status, updated_at: now };

  try {
    const storedState = await repository.updatePayment(orderId, update);
    if (storedState === null) return { status: "unknown", databaseSync: "required" };
    // A previously completed record is never downgraded by a stale or contradictory response.
    if (storedState === "completed" && assessment.status !== "completed") {
      return { status: "unknown", databaseSync: "completed" };
    }
    return { status: assessment.status, databaseSync: "completed" };
  } catch {
    return {
      status: assessment.status === "completed" ? "completed" : "unknown",
      databaseSync: "required",
    };
  }
}

export async function reconcileTrackedOrder(
  orderId: string,
  repository: CheckoutRepository,
  paypal: Pick<PayPalCheckoutGateway, "getOrder">,
  now?: string,
): Promise<{ status: PaymentState; databaseSync: "completed" | "required" }> {
  const payment = await repository.findPayment(orderId);
  if (!payment) throw new CheckoutLifecycleError("not_found");
  const assessment = await inspectOrder(orderId, payment, paypal);
  return synchronize(orderId, assessment, repository, now);
}

export async function captureTrackedOrder(
  orderId: string,
  repository: CheckoutRepository,
  paypal: Pick<PayPalCheckoutGateway, "getOrder" | "captureOrder">,
  now?: string,
): Promise<{ status: PaymentState; databaseSync: "completed" | "required"; captureId?: string }> {
  const payment = await repository.findPayment(orderId);
  if (!payment) throw new CheckoutLifecycleError("not_found");
  if (!paymentMatchesProduct(payment)) throw new CheckoutLifecycleError("invalid_order");

  let assessment = await inspectOrder(orderId, payment, paypal);
  if (assessment.status === "approved") {
    // Best-effort state update; PayPal remains authoritative if this write fails.
    try {
      await repository.updatePayment(orderId, {
        status: "capture_pending",
        updated_at: now ?? new Date().toISOString(),
      });
    } catch {
      // Continue to the user-approved capture and reconcile from PayPal afterward.
    }

    // Preserve the original stable request ID. Repeated user/API requests use the same PayPal key.
    try {
      await paypal.captureOrder(orderId, `capture-${orderId}`);
    } catch {
      // The response can be lost after PayPal captured. Always check authoritative order state.
    }

    try {
      assessment = await inspectOrder(orderId, payment, paypal);
    } catch {
      try {
        await repository.updatePayment(orderId, {
          status: "capture_pending",
          updated_at: now ?? new Date().toISOString(),
        });
      } catch {
        // Preserve the last known database state; the response below remains unknown.
      }
      return { status: "unknown", databaseSync: "required" };
    }
  }

  const result = await synchronize(orderId, assessment, repository, now);
  return { ...result, ...(assessment.captureId && { captureId: assessment.captureId }) };
}
