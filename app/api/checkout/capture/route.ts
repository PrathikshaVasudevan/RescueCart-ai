import { NextResponse } from "next/server";
import {
  captureTrackedOrder,
  CheckoutLifecycleError,
  isValidPayPalOrderId,
} from "@/lib/checkout-lifecycle";
import { checkoutRepository } from "@/lib/checkout-store";
import { captureCheckoutOrder, getCheckoutOrder } from "@/lib/paypal";

export const runtime = "nodejs";

const paypal = {
  getOrder: getCheckoutOrder,
  captureOrder: captureCheckoutOrder,
};

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 2048) {
    return NextResponse.json({ error: "Request body is too large" }, { status: 413 });
  }

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 2048) return NextResponse.json({ error: "Request body is too large" }, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const orderId =
    typeof body === "object" && body !== null && "orderId" in body
      ? (body as { orderId?: unknown }).orderId
      : undefined;
  if (!isValidPayPalOrderId(orderId)) {
    return NextResponse.json({ error: "Missing or invalid PayPal order ID" }, { status: 400 });
  }

  try {
    const result = await captureTrackedOrder(orderId, checkoutRepository, paypal);
    const statusCode = result.databaseSync === "required"
      ? 503
      : result.status === "pending" || result.status === "approved" || result.status === "capture_pending"
        ? 202
        : 200;

    return NextResponse.json(
      {
        id: orderId,
        status: result.status,
        databaseSync: result.databaseSync,
        ...(result.captureId && { captureId: result.captureId }),
      },
      { status: statusCode, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof CheckoutLifecycleError) {
      const status = error.code === "not_found" ? 404 : 409;
      return NextResponse.json(
        { status: "unknown", error: error.code === "not_found" ? "Payment record not found" : "Order verification failed" },
        { status, headers: { "Cache-Control": "no-store" } },
      );
    }

    console.error("PayPal capture reconciliation failed", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json(
      { status: "unknown", error: "Payment status could not be verified" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
