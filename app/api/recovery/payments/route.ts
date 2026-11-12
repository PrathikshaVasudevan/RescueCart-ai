import { NextResponse } from "next/server";
import { listRecoveryPayments } from "@/lib/recovery-store";

export const runtime = "nodejs";

export async function GET() {
  try {
    const data = await listRecoveryPayments();
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Recovery payment listing failed", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json(
      { error: "Recovery data could not be loaded" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
