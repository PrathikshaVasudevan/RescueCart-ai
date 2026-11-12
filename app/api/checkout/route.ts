import { NextResponse } from "next/server";
import { CheckoutLifecycleError, createIdempotentCheckoutOrder, isValidIdempotencyKey } from "@/lib/checkout-lifecycle";
import { checkoutRepository } from "@/lib/checkout-store";
import { createCheckoutOrder, getCheckoutOrder } from "@/lib/paypal";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const idempotencyKey = request.headers.get("Idempotency-Key");
  if (!isValidIdempotencyKey(idempotencyKey)) {
    return NextResponse.json(
      { error: "A valid Idempotency-Key UUID is required" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const order = await createIdempotentCheckoutOrder(
      idempotencyKey,
      checkoutRepository,
      { createOrder: createCheckoutOrder, getOrder: getCheckoutOrder },
    );
    return NextResponse.json(order, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof CheckoutLifecycleError && error.code === "idempotency_expired") {
      return NextResponse.json(
        { code: "IDEMPOTENCY_WINDOW_EXPIRED", error: "Checkout creation status needs merchant review before a new order is created", status: "unknown" },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    // Log only an error class, never upstream response bodies, credentials, or access tokens.
    console.error("Checkout order creation failed", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json(
      { error: "Checkout could not be confirmed. Retry with the same checkout attempt." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
