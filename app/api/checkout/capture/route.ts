
import { NextResponse } from "next/server";
import {
  captureCheckoutOrder,
  getCheckoutOrder,
  RESCUE_PRODUCT,
} from "@/lib/paypal";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const orderId = body.orderId;

    if (!orderId || typeof orderId !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid PayPal order ID" },
        { status: 400 }
      );
    }

    // Verify that this order belongs to our tracked checkout.
    const { data: payment, error: lookupError } =
      await supabaseAdmin
        .from("checkout_payments")
        .select("paypal_order_id, status")
        .eq("paypal_order_id", orderId)
        .maybeSingle();

    if (lookupError) {
      console.error("Payment lookup failed:", lookupError.message);

      return NextResponse.json(
        { error: "Could not verify payment record" },
        { status: 503 }
      );
    }

    if (!payment) {
      return NextResponse.json(
        { error: "Payment record not found" },
        { status: 404 }
      );
    }

    // Capture using your existing stable request ID.
    const requestId = `capture-${orderId}`;

    await captureCheckoutOrder(orderId, requestId);

    // Retrieve the latest order from PayPal.
    const order = await getCheckoutOrder(orderId);

    if (order.id !== orderId) {
      return NextResponse.json(
        { error: "PayPal order verification failed" },
        { status: 502 }
      );
    }

    const captures =
      order.purchase_units?.flatMap(
        (unit) => unit.payments?.captures ?? []
      ) ?? [];

    const completedCapture = captures.find(
      (capture) => capture.status === "COMPLETED"
    );

    // Do not mark an unverified or incomplete payment completed.
    if (order.status !== "COMPLETED" || !completedCapture) {
      return NextResponse.json(
        {
          id: order.id,
          status: order.status,
          message: "Payment is not confirmed as completed yet",
        },
        { status: 202 }
      );
    }

    // Verify the actual captured amount and currency.
    const capturedAmount = completedCapture.amount;

    if (
      !capturedAmount ||
      Number(capturedAmount.value) !== Number(RESCUE_PRODUCT.price) ||
      capturedAmount.currency_code !== RESCUE_PRODUCT.currency
    ) {
      console.error("Capture amount verification failed:", {
        orderId,
        captureId: completedCapture.id,
        capturedAmount,
      });

      return NextResponse.json(
        { error: "Captured payment amount requires review" },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();

    // Synchronise verified payment with Supabase.
    const { data: updatedPayment, error: updateError } =
      await supabaseAdmin
        .from("checkout_payments")
        .update({
          paypal_capture_id: completedCapture.id,
          status: "completed",
          captured_at: now,
          updated_at: now,
        })
        .eq("paypal_order_id", orderId)
        .select("paypal_order_id, paypal_capture_id, status")
        .maybeSingle();

    if (updateError || !updatedPayment) {
      console.error("Supabase payment update failed:", {
        orderId,
        captureId: completedCapture.id,
        error: updateError?.message ?? "No row updated",
      });

      return NextResponse.json(
        {
          id: orderId,
          status: "COMPLETED",
          databaseSync: "required",
          message:
            "PayPal capture succeeded. Payment record needs reconciliation.",
        },
        { status: 503 }
      );
    }

    return NextResponse.json({
      id: orderId,
      status: "COMPLETED",
      captureId: completedCapture.id,
      databaseSync: "completed",
      payment: updatedPayment,
    });
  } catch (error) {
    console.error("PayPal capture error:", error);

    return NextResponse.json(
      {
        error: "Payment status requires verification",
        message: "Check PayPal order status before retrying.",
      },
      { status: 500 }
    );
  }
}

