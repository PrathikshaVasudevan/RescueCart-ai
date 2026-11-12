import { NextResponse } from "next/server";
import { recordRecoveryAction } from "@/lib/recovery-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  if ((input.action !== "marked_for_review" && input.action !== "ai_recommendation_reviewed") || typeof input.orderId !== "string") {
    return NextResponse.json({ error: "Unsupported recovery action" }, { status: 400 });
  }
  const maxNoteLength = input.action === "ai_recommendation_reviewed" ? 1000 : 500;
  if (input.note !== undefined && input.note !== null && (typeof input.note !== "string" || input.note.length > maxNoteLength)) {
    return NextResponse.json({ error: `Review note must be ${maxNoteLength} characters or fewer` }, { status: 400 });
  }
  if (input.action === "ai_recommendation_reviewed" && typeof input.note !== "string") {
    return NextResponse.json({ error: "Reviewed recommendation text is required" }, { status: 400 });
  }

  try {
    const action = await recordRecoveryAction(
      input.orderId,
      input.action,
      typeof input.note === "string" ? input.note.trim() || null : null,
    );
    return NextResponse.json({ action }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_order_id") {
      return NextResponse.json({ error: "Invalid PayPal order ID" }, { status: 400 });
    }
    if (error instanceof Error && error.message === "payment_not_found") {
      return NextResponse.json({ error: "Tracked payment not found" }, { status: 404 });
    }
    console.error("Recovery review action failed", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json({ error: "Review action could not be saved" }, { status: 503 });
  }
}
