
import { NextResponse } from "next/server";
import { getCheckoutOrder, RESCUE_PRODUCT } from "@/lib/paypal";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get("orderId");

    if (!orderId || orderId.length > 128) {
      return NextResponse.json(
        { error: "Missing or invalid order ID" },
        { status: 400 }
      );
    }

    // Find our tracked payment first.
    const { data: payment, error: lookupError } =
      await supabaseAdmin
        .from("checkout_payments")
        .select("paypal_order_id, status")
        .eq("paypal_order_id", orderId)
        .maybeSingle();

    if (lookupError) {
      return NextResponse.json(
        { error: "Payment lookup failed" },
        { status: 503 }
      );
    }

    if (!payment) {
      return NextResponse.json(
        { error: "Payment record not found" },
        { status: 404 }
      );
    }

    // Ask PayPal for the latest order state.
    const order = await getCheckoutOrder(orderId);

    if (order.id !== orderId) {
      return NextResponse.json(
        { error: "Order verification failed" },
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

    let displayedStatus = "unknown";

    if (order.status === "COMPLETED" && completedCapture) {
      const amount = completedCapture.amount;

      const amountValid =
        amount &&
        Number.isFinite(Number(amount.value)) &&
        Number(amount.value) === Number(RESCUE_PRODUCT.price) &&
        amount.currency_code === RESCUE_PRODUCT.currency;

      if (!amountValid) {
        return NextResponse.json(
          { error: "Payment requires manual review" },
          { status: 409 }
        );
      }

      // Recover/update the database from verified PayPal state.
      const now = new Date().toISOString();

      const { error: updateError } = await supabaseAdmin
        .from("checkout_payments")
        .update({
          paypal_capture_id: completedCapture.id,
          status: "completed",
          captured_at: now,
          updated_at: now,
        })
        .eq("paypal_order_id", orderId);

      if (updateError) {
        console.error("Payment reconciliation failed:", {
          orderId,
          error: updateError.message,
        });

        return NextResponse.json(
          {
            status: "unknown",
            message: "Payment record needs reconciliation",
          },
          { status: 503 }
        );
      }

      displayedStatus = "completed";
    } else if (order.status === "APPROVED") {
      // Approved is not the same as completed.
      const { error } = await supabaseAdmin
        .from("checkout_payments")
        .update({
          status: "approved",
          updated_at: new Date().toISOString(),
        })
        .eq("paypal_order_id", orderId)
        .in("status", ["pending", "approved"]);

      if (error) {
        return NextResponse.json(
          { status: "unknown", message: "Database sync failed" },
          { status: 503 }
        );
      }

      displayedStatus = "approved";
    } else if (order.status === "CREATED") {
      displayedStatus = "pending";
    }

    // Don't expose payer or payment details to the browser.
    return NextResponse.json({
      orderId,
      status: displayedStatus,
    });
  } catch (error) {
    console.error("Checkout status verification failed:", error);

    return NextResponse.json(
      {
        status: "unknown",
        message: "Payment status could not be verified",
      },
      { status: 503 }
    );
  }
}
