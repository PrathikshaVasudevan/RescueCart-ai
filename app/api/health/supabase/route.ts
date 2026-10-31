
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function GET() {
  const testOrderId = `TEST-${crypto.randomUUID()}`;

  const { data, error } = await supabaseAdmin
    .from("checkout_payments")
    .insert({
      paypal_order_id: testOrderId,
      amount: 10.00,
      currency: "USD",
      status: "pending",
    })
    .select("id, paypal_order_id, status")
    .single();

  if (error) {
    console.error("Test insert failed:", error.message);

    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    message: "Test insert successful",
    payment: data,
  });
}
