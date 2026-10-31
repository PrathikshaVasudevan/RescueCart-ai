
import { NextResponse } from "next/server";
import { captureCheckoutOrder } from "@/lib/paypal";

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

    const requestId = crypto.randomUUID();

    const result = await captureCheckoutOrder(
      orderId,
      requestId
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error("PayPal capture error:", error);

    return NextResponse.json(
      { error: "Failed to capture PayPal payment" },
      { status: 500 }
    );
  }
}
