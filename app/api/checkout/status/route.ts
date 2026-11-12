import { NextResponse } from "next/server";
import {
  CheckoutLifecycleError,
  isValidPayPalOrderId,
  reconcileTrackedOrder,
} from "@/lib/checkout-lifecycle";
import { checkoutRepository } from "@/lib/checkout-store";
import { getCheckoutOrder } from "@/lib/paypal";

export const runtime = "nodejs";

const paypal = {
  getOrder: getCheckoutOrder,
};

export async function GET(request: Request) {
  const orderId = new URL(request.url).searchParams.get("orderId");
  if (!isValidPayPalOrderId(orderId)) {
    return NextResponse.json(
      { error: "Missing or invalid PayPal order ID", status: "unknown" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const result = await reconcileTrackedOrder(orderId, checkoutRepository, paypal);
    return NextResponse.json(
      { orderId, status: result.status, databaseSync: result.databaseSync },
      {
        status: result.databaseSync === "required" ? 503 : 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    if (error instanceof CheckoutLifecycleError) {
      const status = error.code === "not_found" ? 404 : 409;
      return NextResponse.json(
        { orderId, status: "unknown", error: error.code === "not_found" ? "Payment record not found" : "Order verification failed" },
        { status, headers: { "Cache-Control": "no-store" } },
      );
    }

    console.error("Checkout status reconciliation failed", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json(
      { orderId, status: "unknown", message: "Payment status could not be verified" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
