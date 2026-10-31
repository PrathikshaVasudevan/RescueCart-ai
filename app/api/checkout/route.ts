import { NextResponse } from "next/server";
import { createCheckoutOrder } from "@/lib/paypal";

export async function POST(request: Request) {
  try {
    const requestId = crypto.randomUUID();

    const order = await createCheckoutOrder(requestId);

    return NextResponse.json(order);
  } catch (error) {
    console.error("Create checkout order error:", error);

    return NextResponse.json(
      { error: "Failed to create PayPal order" },
      { status: 500 }
    );
  }
}
