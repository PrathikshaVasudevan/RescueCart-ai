import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function GET() {
  const { error } = await supabaseAdmin
    .from("checkout_payments")
    .select("id")
    .limit(1);

  if (error) {
    // Keep database details in server logs; do not return them to anonymous callers.
    console.error("Supabase health check failed:", error.message);

    return NextResponse.json(
      { ok: false, message: "Supabase is unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  return NextResponse.json(
    { ok: true, message: "Supabase is reachable" },
    { headers: { "Cache-Control": "no-store" } }
  );
}
