import assert from "node:assert/strict";
import test from "node:test";
import {
  captureTrackedOrder,
  createIdempotentCheckoutOrder,
  reconcileTrackedOrder,
  type CheckoutRepository,
  type OrderRequestRecord,
  type PaymentState,
  type PaymentUpdate,
  type TrackedPayment,
} from "../lib/checkout-lifecycle";
import type { CheckoutOrder } from "../lib/paypal";

const KEY = "123e4567-e89b-42d3-a456-426614174000";
const ORDER_ID = "5O190127TN364715T";
const validUnit = {
  reference_id: "rescue-demo-product",
  amount: { value: "10.00", currency_code: "USD" },
};

function harness(options: { initialStatus?: string; captureMode?: "success" | "failed" | "pending" | "lost-response"; failCompletedUpdate?: boolean } = {}) {
  const orders = new Map<string, CheckoutOrder>();
  const requests = new Map<string, OrderRequestRecord>();
  const providerIdempotency = new Map<string, CheckoutOrder>();
  const payments = new Map<string, TrackedPayment>();
  const createRequestIds: string[] = [];
  const captureRequestIds: string[] = [];
  let paypalOrderCreations = 0;
  let failCompletedUpdate = options.failCompletedUpdate ?? false;

  orders.set(ORDER_ID, { id: ORDER_ID, status: options.initialStatus ?? "APPROVED", purchase_units: [{ ...validUnit }] });

  const repository: CheckoutRepository = {
    async claimOrderRequest(key) {
      let row = requests.get(key);
      if (!row) {
        row = { idempotency_key: key, paypal_order_id: null, created_at: new Date().toISOString() };
        requests.set(key, row);
      }
      return { ...row };
    },
    async saveOrderId(key, orderId) {
      const row = requests.get(key)!;
      if (row.paypal_order_id && row.paypal_order_id !== orderId) throw new Error("key conflict");
      row.paypal_order_id = orderId;
      return orderId;
    },
    async ensurePayment(orderId) {
      if (!payments.has(orderId)) {
        payments.set(orderId, { paypal_order_id: orderId, amount: 10, currency: "USD", status: "pending" });
      }
    },
    async findPayment(orderId) {
      const payment = payments.get(orderId);
      return payment ? { ...payment } : null;
    },
    async updatePayment(orderId, update: PaymentUpdate) {
      if (failCompletedUpdate && update.status === "completed") throw new Error("simulated database outage");
      const current = payments.get(orderId);
      if (!current) return null;
      if (current.status === "completed" && update.status !== "completed") return "completed";
      payments.set(orderId, { ...current, ...update });
      return update.status as PaymentState;
    },
  };

  const paypal = {
    async createOrder(requestId: string) {
      createRequestIds.push(requestId);
      const alreadyCreated = providerIdempotency.get(requestId);
      if (alreadyCreated) return structuredClone(alreadyCreated);
      paypalOrderCreations += 1;
      const order = { id: ORDER_ID, status: "CREATED", links: [], purchase_units: [{ ...validUnit }] };
      orders.set(ORDER_ID, order);
      providerIdempotency.set(requestId, order);
      return structuredClone(order);
    },
    async getOrder(orderId: string) {
      const order = orders.get(orderId);
      if (!order) throw new Error("missing order");
      return structuredClone(order);
    },
    async captureOrder(orderId: string, requestId: string) {
      captureRequestIds.push(requestId);
      const order = orders.get(orderId)!;
      if (options.captureMode === "failed") {
        order.purchase_units![0].payments = { captures: [{ id: "CAP-1", status: "DECLINED", amount: { value: "10.00", currency_code: "USD" } }] };
      } else if (options.captureMode === "pending") {
        order.purchase_units![0].payments = { captures: [{ id: "CAP-1", status: "PENDING", amount: { value: "10.00", currency_code: "USD" } }] };
      } else {
        order.status = "COMPLETED";
        order.purchase_units![0].payments = { captures: [{ id: "CAP-1", status: "COMPLETED", amount: { value: "10.00", currency_code: "USD" } }] };
      }
      if (options.captureMode === "lost-response") throw new Error("response lost after PayPal processed capture");
      return structuredClone(order);
    },
  };

  return {
    repository,
    paypal,
    orders,
    requests,
    payments,
    createRequestIds,
    captureRequestIds,
    get paypalOrderCreations() { return paypalOrderCreations; },
    setFailCompletedUpdate(value: boolean) { failCompletedUpdate = value; },
  };
}

test("concurrent duplicate order requests resolve to one PayPal order", async () => {
  const h = harness();
  const [a, b] = await Promise.all([
    createIdempotentCheckoutOrder(KEY, h.repository, h.paypal),
    createIdempotentCheckoutOrder(KEY, h.repository, h.paypal),
  ]);
  assert.equal(a.id, b.id);
  assert.deepEqual(h.createRequestIds, [KEY, KEY]);
  assert.equal(h.paypalOrderCreations, 1);
  assert.equal(h.payments.size, 1);
});

test("approved order captures once and becomes completed", async () => {
  const h = harness();
  await h.repository.ensurePayment(ORDER_ID);
  const result = await captureTrackedOrder(ORDER_ID, h.repository, h.paypal, "2026-11-11T00:00:00.000Z");
  assert.equal(result.status, "completed");
  assert.equal(result.databaseSync, "completed");
  assert.equal(result.captureId, "CAP-1");
  assert.deepEqual(h.captureRequestIds, [`capture-${ORDER_ID}`]);
  assert.equal(h.payments.get(ORDER_ID)?.status, "completed");
});

test("repeated capture request does not issue another capture after PayPal confirms completion", async () => {
  const h = harness({ captureMode: "lost-response" });
  await h.repository.ensurePayment(ORDER_ID);
  const first = await captureTrackedOrder(ORDER_ID, h.repository, h.paypal);
  const second = await captureTrackedOrder(ORDER_ID, h.repository, h.paypal);
  assert.equal(first.status, "completed");
  assert.equal(second.status, "completed");
  assert.deepEqual(h.captureRequestIds, [`capture-${ORDER_ID}`]);
});

test("authoritative PayPal declined capture becomes failed", async () => {
  const h = harness({ captureMode: "failed" });
  await h.repository.ensurePayment(ORDER_ID);
  const result = await captureTrackedOrder(ORDER_ID, h.repository, h.paypal);
  assert.equal(result.status, "failed");
  assert.equal(h.payments.get(ORDER_ID)?.status, "failed");
});

test("customer cancellation or an unapproved order stays pending, not failed", async () => {
  const h = harness({ initialStatus: "CREATED" });
  await h.repository.ensurePayment(ORDER_ID);
  const result = await reconcileTrackedOrder(ORDER_ID, h.repository, h.paypal);
  assert.equal(result.status, "pending");
  assert.equal(h.payments.get(ORDER_ID)?.status, "pending");
  assert.equal(h.captureRequestIds.length, 0);
});

test("PayPal completion is reported when database sync fails, then status check repairs it", async () => {
  const h = harness({ failCompletedUpdate: true });
  await h.repository.ensurePayment(ORDER_ID);
  const capture = await captureTrackedOrder(ORDER_ID, h.repository, h.paypal);
  assert.equal(capture.status, "completed");
  assert.equal(capture.databaseSync, "required");
  assert.equal(h.payments.get(ORDER_ID)?.status, "capture_pending");

  h.setFailCompletedUpdate(false);
  const reconciled = await reconcileTrackedOrder(ORDER_ID, h.repository, h.paypal);
  assert.equal(reconciled.status, "completed");
  assert.equal(reconciled.databaseSync, "completed");
  assert.equal(h.payments.get(ORDER_ID)?.status, "completed");
  assert.equal(h.captureRequestIds.length, 1);
});

test("order product and amount verification blocks capture", async () => {
  const h = harness();
  await h.repository.ensurePayment(ORDER_ID);
  h.orders.get(ORDER_ID)!.purchase_units![0].reference_id = "other-product";
  await assert.rejects(() => captureTrackedOrder(ORDER_ID, h.repository, h.paypal), /invalid_order/);
  assert.equal(h.captureRequestIds.length, 0);
});