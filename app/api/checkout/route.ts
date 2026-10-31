
import { NextResponse } from "next/server";
import { createCheckoutOrder } from "@/lib/paypal";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function POST() {
  try {
    // 1. Create PayPal order
    const requestId = crypto.randomUUID();
    const order = await createCheckoutOrder(requestId);

    // 2. Save the order in Supabase
    const { error } = await supabaseAdmin
      .from("checkout_payments")
      .insert({
        paypal_order_id: order.id,
        amount: 10.00,
        currency: "USD",
        status: "pending",
      });

    // 3. Handle database failure
    if (error) {
      console.error("Payment tracking insert failed:", {
        orderId: order.id,
        error: error.message,
      });

      return NextResponse.json(
        {
          error: "Order tracking could not be saved",
          paymentStatus: "unknown",
        },
        { status: 503 }
      );
    }

    // 4. Return the order to frontend
    return NextResponse.json(order);
  } catch (error) {
    console.error("Create checkout order error:", error);

    return NextResponse.json(
      { error: "Failed to create PayPal order" },
      { status: 500 }
    );
  }
}
