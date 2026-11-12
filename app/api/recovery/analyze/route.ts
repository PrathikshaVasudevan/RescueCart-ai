import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { isValidPayPalOrderId } from "@/lib/checkout-lifecycle";
import { checkoutRepository } from "@/lib/checkout-store";
import { analyzeVerifiedPayPalOrder, geminiConfiguration, PaymentAnalysisError, paymentAnalysisErrorDiagnostics, requestGeminiPaymentAnalysisDraft } from "@/lib/payment-analysis";
import { getCheckoutOrder, PayPalApiError, paypalApiErrorDiagnostics } from "@/lib/paypal";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 1024;

async function readOrderId(request: Request): Promise<{ orderId?: string; error?: "invalid" | "too_large" }> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) return { error: "too_large" };
  if (!request.body) return { error: "invalid" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_REQUEST_BYTES) {
      await reader.cancel();
      return { error: "too_large" };
    }
    chunks.push(value);
  }

  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "invalid" };
    const record = body as Record<string, unknown>;
    if (Object.keys(record).length !== 1 || typeof record.orderId !== "string" || !isValidPayPalOrderId(record.orderId)) {
      return { error: "invalid" };
    }
    return { orderId: record.orderId };
  } catch {
    return { error: "invalid" };
  }
}

export async function POST(request: Request) {
  let input: Awaited<ReturnType<typeof readOrderId>>;
  try {
    input = await readOrderId(request);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (input.error === "too_large") {
    return NextResponse.json({ error: "Request body is too large" }, { status: 413, headers: { "Cache-Control": "no-store" } });
  }
  if (!input.orderId) {
    return NextResponse.json({ error: "A valid tracked PayPal order ID is required" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const { apiKey, model } = geminiConfiguration();
  if (!apiKey) {
    return NextResponse.json(
      { code: "AI_NOT_CONFIGURED", error: "Payment analysis is unavailable. Configure GEMINI_API_KEY on the server." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const correlationId = randomUUID();

  try {
    const payment = await checkoutRepository.findPayment(input.orderId);
    if (!payment) return NextResponse.json({ error: "Tracked payment not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });

    const order = await getCheckoutOrder(input.orderId);
    const result = await analyzeVerifiedPayPalOrder(
      input.orderId,
      payment,
      order,
      (verifiedFacts) => requestGeminiPaymentAnalysisDraft(verifiedFacts, apiKey, model),
    );
    if (result.kind === "order_mismatch") {
      return NextResponse.json({ error: "PayPal could not verify this tracked payment against the expected product and amount" }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    if (result.kind === "amount_missing") {
      return NextResponse.json({ error: "PayPal payment amount could not be verified" }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ analysis: result.analysis }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PayPalApiError) {
      console.error("Payment analysis PayPal request failed", paypalApiErrorDiagnostics(error, randomUUID()));
      return NextResponse.json(
        { error: "Payment analysis could not be completed. Try again later." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (error instanceof PaymentAnalysisError) {
      if (error.code === "upstream") {
        console.error("Payment analysis unavailable", paymentAnalysisErrorDiagnostics(error, correlationId));
      } else {
        console.error("Payment analysis unavailable", { errorType: error.code });
      }
      return NextResponse.json(
        { code: "AI_ANALYSIS_UNAVAILABLE", error: "Payment analysis could not be completed. Try again later." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    console.error("Payment analysis request failed", { errorType: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json(
      { error: "Payment analysis could not be completed. Try again later." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
