import assert from "node:assert/strict";
import test from "node:test";
import { PayPalApiError, paypalApiErrorDiagnostics } from "../lib/paypal";

test("OAuth diagnostics contain only safe operation metadata", () => {
  const error = new PayPalApiError(
    401,
    "/v1/oauth2/token",
    JSON.stringify({ debug_id: "SAFE_DEBUG_123", description: "private response details" }),
    "oauth_token_acquisition",
  );
  const diagnostics = paypalApiErrorDiagnostics(error, "correlation-123");

  assert.deepEqual(diagnostics, {
    operation: "oauth_token_acquisition",
    status: 401,
    path: "/v1/oauth2/token",
    debugId: "SAFE_DEBUG_123",
    correlationId: "correlation-123",
  });
  assert.equal(JSON.stringify(diagnostics).includes("private response details"), false);
});

test("Checkout Order diagnostics redact order IDs and never include response bodies", () => {
  const error = new PayPalApiError(
    403,
    "/v2/checkout/orders/ORDERPRIVATE123",
    JSON.stringify({ debug_id: "DEBUG-456", message: "private details" }),
    "checkout_order_lookup",
  );
  const diagnostics = paypalApiErrorDiagnostics(error, "correlation-456");
  const serialized = JSON.stringify(diagnostics);

  assert.deepEqual(diagnostics, {
    operation: "checkout_order_lookup",
    status: 403,
    path: "/v2/checkout/orders/:orderId",
    debugId: "DEBUG-456",
    correlationId: "correlation-456",
  });
  assert.equal(serialized.includes("ORDERPRIVATE123"), false);
  assert.equal(serialized.includes("private details"), false);
});

test("invalid PayPal debug IDs are omitted", () => {
  const error = new PayPalApiError(
    500,
    "/v2/checkout/orders/ORDERPRIVATE123",
    JSON.stringify({ debug_id: "private value with spaces" }),
    "checkout_order_lookup",
  );
  assert.equal(paypalApiErrorDiagnostics(error, "correlation-789").debugId, null);
});
