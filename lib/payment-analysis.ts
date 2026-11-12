import { ApiError, GoogleGenAI } from "@google/genai";
import { assessPayPalOrder, orderMatchesProduct, type TrackedPayment } from "./checkout-lifecycle";
import type { CheckoutOrder } from "./paypal";

export type AnalysisPaymentStatus = "pending" | "approved" | "capture_pending" | "completed" | "failed" | "unknown";
export type AnalysisConfidence = "low" | "medium" | "high";
export type InterventionOwner = "merchant" | "customer" | "both" | "none";

export type PaymentAnalysisFacts = {
  status: AnalysisPaymentStatus;
  trackedStatus: string;
  paypalOrderStatus: string;
  amount: string;
  currency: string;
  captureStatuses: string[];
  paypalCaptureCompleted: boolean;
  confirmedFailureReason: string | null;
};

export type PaymentAnalysisDraft = {
  possibleCauseInference: string | null;
  confidence: AnalysisConfidence;
  missingInformation: string[];
  recommendedRecoveryAction: string;
  interventionRequired: boolean;
  interventionOwner: InterventionOwner;
};

export type PaymentAnalysis = PaymentAnalysisDraft & {
  status: AnalysisPaymentStatus;
  statusSummary: string;
  knownFailureReason: string | null;
};

export type PaymentAnalysisUpstreamDiagnostics = {
  failureType: "network_failure" | "request_timeout" | "http_error";
  httpStatus?: number;
  errorCategory?: string;
  providerMessage?: string;
  upstreamRequestId?: string;
};

export class PaymentAnalysisError extends Error {
  constructor(
    readonly code: "upstream" | "invalid_response",
    readonly upstreamDiagnostics?: PaymentAnalysisUpstreamDiagnostics,
  ) {
    super(code);
    this.name = "PaymentAnalysisError";
  }
}

/** Safe fields for server logs. This intentionally excludes response bodies and request data. */
export function paymentAnalysisErrorDiagnostics(error: PaymentAnalysisError, correlationId: string) {
  return {
    provider: "gemini",
    failureType: error.upstreamDiagnostics?.failureType ?? "network_failure",
    ...(error.upstreamDiagnostics?.httpStatus !== undefined && { httpStatus: error.upstreamDiagnostics.httpStatus }),
    ...(error.upstreamDiagnostics?.errorCategory && { errorCategory: error.upstreamDiagnostics.errorCategory }),
    ...(error.upstreamDiagnostics?.providerMessage && { providerMessage: error.upstreamDiagnostics.providerMessage }),
    ...(error.upstreamDiagnostics?.upstreamRequestId && { upstreamRequestId: error.upstreamDiagnostics.upstreamRequestId }),
    correlationId,
  };
}

function httpErrorCategory(status: number): string {
  if (status === 401) return "authentication_error";
  if (status === 403) return "permission_error";
  if (status === 404) return "model_or_endpoint_not_found";
  if (status === 408) return "request_timeout";
  if (status === 429) return "rate_limit_or_quota";
  if (status >= 400 && status < 500) return "invalid_request";
  if (status >= 500) return "provider_server_error";
  return "http_error";
}

export function geminiConfiguration(environment: Record<string, string | undefined> = process.env) {
  return {
    apiKey: environment.GEMINI_API_KEY?.trim() || undefined,
    model: environment.GEMINI_MODEL?.trim() || "gemini-2.5-flash",
  };
}

const RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    possibleCauseInference: { type: ["string", "null"] },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    missingInformation: { type: "array", items: { type: "string" }, maxItems: 8 },
    recommendedRecoveryAction: { type: "string" },
    interventionRequired: { type: "boolean" },
    interventionOwner: { type: "string", enum: ["merchant", "customer", "both", "none"] },
  },
  required: [
    "possibleCauseInference",
    "confidence",
    "missingInformation",
    "recommendedRecoveryAction",
    "interventionRequired",
    "interventionOwner",
  ],
} as const;

const ANALYST_INSTRUCTIONS = `You are RescueCart AI's payment failure analyst. Analyze only the supplied server-verified facts. Do not infer a PayPal failure reason: a confirmed reason is supplied separately by the application and is the only source for one. Possible causes are hypotheses and must be cautious. If evidence is insufficient, return null for possibleCauseInference and explain what is missing. Never describe a pending, approved, capture-pending, unknown, or completed payment as failed. Never recommend an automatic retry or charge. Recommendations are informational and require explicit merchant/customer action. Do not request or invent customer personal data. Return only the requested structured output.`;

function statusSummary(facts: PaymentAnalysisFacts): string {
  if (facts.status === "completed") {
    if (facts.paypalCaptureCompleted) return "PayPal confirms a completed capture for this tracked payment.";
    return "The tracked record is completed from a prior confirmed capture, but the current PayPal response does not confirm a completed capture. This is not evidence of failure.";
  }
  switch (facts.status) {
    case "pending": return "PayPal reports that checkout is pending; no completed capture or terminal failure is confirmed.";
    case "approved": return "PayPal reports approval, but no completed capture is confirmed.";
    case "capture_pending": return "PayPal reports that capture is still processing; no terminal failure is confirmed.";
    case "failed": return "PayPal confirms a terminal failed or declined capture.";
    default: return "The latest PayPal response does not establish a reliable payment outcome.";
  }
}

function completedAnalysis(facts: PaymentAnalysisFacts): PaymentAnalysis {
  const statusText = facts.paypalCaptureCompleted
    ? "PayPal confirmed the capture is complete. No recovery action is needed."
    : "Keep the recorded completed state. Ask the merchant to verify the PayPal capture record before taking further action.";
  return {
    status: "completed",
    statusSummary: statusSummary(facts),
    knownFailureReason: null,
    possibleCauseInference: null,
    confidence: facts.paypalCaptureCompleted ? "high" : "low",
    missingInformation: facts.paypalCaptureCompleted ? [] : ["A matching completed capture was not present in the latest PayPal response."],
    recommendedRecoveryAction: statusText,
    interventionRequired: !facts.paypalCaptureCompleted,
    interventionOwner: facts.paypalCaptureCompleted ? "none" : "merchant",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDraft(value: unknown): PaymentAnalysisDraft {
  const expectedKeys = [
    "possibleCauseInference",
    "confidence",
    "missingInformation",
    "recommendedRecoveryAction",
    "interventionRequired",
    "interventionOwner",
  ];
  if (!isRecord(value) ||
      Object.keys(value).length !== expectedKeys.length ||
      Object.keys(value).some((key) => !expectedKeys.includes(key)) ||
      !(value.possibleCauseInference === null || typeof value.possibleCauseInference === "string") ||
      !["low", "medium", "high"].includes(String(value.confidence)) ||
      !Array.isArray(value.missingInformation) ||
      !value.missingInformation.every((item) => typeof item === "string") ||
      typeof value.recommendedRecoveryAction !== "string" ||
      typeof value.interventionRequired !== "boolean" ||
      !["merchant", "customer", "both", "none"].includes(String(value.interventionOwner))) {
    throw new PaymentAnalysisError("invalid_response");
  }

  return {
    possibleCauseInference: typeof value.possibleCauseInference === "string" ? value.possibleCauseInference.slice(0, 800).trim() || null : null,
    confidence: value.confidence as AnalysisConfidence,
    missingInformation: (value.missingInformation as string[]).slice(0, 8).map((item) => item.slice(0, 240).trim()).filter(Boolean),
    recommendedRecoveryAction: value.recommendedRecoveryAction.slice(0, 800).trim(),
    interventionRequired: value.interventionRequired,
    interventionOwner: value.interventionOwner as InterventionOwner,
  };
}

export async function createPaymentAnalysis(
  facts: PaymentAnalysisFacts,
  generateDraft: (facts: PaymentAnalysisFacts) => Promise<PaymentAnalysisDraft>,
): Promise<PaymentAnalysis> {
  if (facts.status === "completed") return completedAnalysis(facts);

  const draft = parseDraft(await generateDraft(facts));
  const hasFailureEvidence = facts.status === "failed" && facts.confirmedFailureReason !== null;
  const canHypothesize = facts.status === "failed";
  const possibleCause = canHypothesize ? draft.possibleCauseInference : null;
  const missingInformation = [...draft.missingInformation];

  if (facts.status === "failed" && !facts.confirmedFailureReason && !missingInformation.some((item) => /reason/i.test(item))) {
    missingInformation.unshift("PayPal did not provide a specific failure reason.");
  }
  if (["pending", "approved", "capture_pending", "unknown"].includes(facts.status) &&
      !missingInformation.some((item) => /terminal|capture outcome/i.test(item))) {
    missingInformation.unshift("A terminal capture outcome is not available yet.");
  }

  return {
    status: facts.status,
    statusSummary: statusSummary(facts),
    knownFailureReason: facts.status === "failed" ? facts.confirmedFailureReason : null,
    possibleCauseInference: possibleCause
      ? (possibleCause.startsWith("Inference:") ? possibleCause : `Inference: ${possibleCause}`)
      : null,
    confidence: hasFailureEvidence ? draft.confidence : "low",
    missingInformation: missingInformation.slice(0, 8),
    recommendedRecoveryAction: draft.recommendedRecoveryAction || "Review the PayPal status and take no payment action until the outcome is clear.",
    interventionRequired: draft.interventionRequired,
    interventionOwner: draft.interventionRequired ? draft.interventionOwner : "none",
  };
}

type GeminiGenerateRequest = {
  model: string;
  contents: string;
  config: {
    maxOutputTokens: number;
    responseMimeType: "application/json";
    responseJsonSchema: unknown;
  };
};

type GeminiGenerateContent = (request: GeminiGenerateRequest) => Promise<{ text?: string | null }>;

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && ["TimeoutError", "AbortError", "RequestTimeoutError"].includes(error.name);
}

function safeGoogleErrorMessage(
  message: string,
  apiKey: string,
  requestContents: string,
  facts: PaymentAnalysisFacts,
): string | undefined {
  let providerMessage: unknown;
  try {
    const parsed: unknown = JSON.parse(message);
    if (isRecord(parsed) && isRecord(parsed.error)) providerMessage = parsed.error.message;
  } catch {
    return undefined;
  }
  if (typeof providerMessage !== "string") return undefined;

  let safeMessage = providerMessage.replace(/[\r\n\t\u0000-\u001f\u007f]/g, " ");
  for (const privateValue of [
    apiKey,
    requestContents,
    facts.amount,
    facts.currency,
    facts.trackedStatus,
    facts.paypalOrderStatus,
    facts.confirmedFailureReason ?? "",
    ...facts.captureStatuses,
  ]) {
    if (privateValue) safeMessage = safeMessage.replaceAll(privateValue, "[redacted]");
  }
  safeMessage = safeMessage
    .replace(/AIza[\w-]{20,}/g, "[redacted]")
    .replace(/(key\s*[=:]\s*)[^\s,;]+/gi, "$1[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  return safeMessage || undefined;
}

export async function requestGeminiPaymentAnalysisDraft(
  facts: PaymentAnalysisFacts,
  apiKey: string,
  model: string,
  generateContent?: GeminiGenerateContent,
): Promise<PaymentAnalysisDraft> {
  const generate = generateContent ?? ((request: GeminiGenerateRequest) => {
    const client = new GoogleGenAI({
      apiKey,
      httpOptions: { timeout: 25_000, retryOptions: { attempts: 1 } },
    });
    return client.models.generateContent(request);
  });

  const requestContents = `${ANALYST_INSTRUCTIONS}\n\nAnalyze only these server-verified payment facts:\n${JSON.stringify({
    paymentStatus: facts.status,
    trackedStatus: facts.trackedStatus,
    paypalOrderStatus: facts.paypalOrderStatus,
    amount: facts.amount,
    currency: facts.currency,
    captureStatuses: facts.captureStatuses,
    paypalConfirmedFailureReason: facts.confirmedFailureReason,
  })}`;
  let text: string | null | undefined;
  try {
    const response = await generate({
      model,
      contents: requestContents,
      config: {
        maxOutputTokens: 900,
        responseMimeType: "application/json",
        responseJsonSchema: RESPONSE_JSON_SCHEMA,
      },
    });
    text = response.text;
  } catch (error) {
    if (error instanceof ApiError) {
      throw new PaymentAnalysisError("upstream", {
        failureType: "http_error",
        httpStatus: error.status,
        errorCategory: httpErrorCategory(error.status),
        providerMessage: safeGoogleErrorMessage(error.message, apiKey, requestContents, facts),
      });
    }
    throw new PaymentAnalysisError("upstream", {
      failureType: isTimeoutError(error) ? "request_timeout" : "network_failure",
    });
  }

  try {
    if (!text?.trim()) throw new PaymentAnalysisError("invalid_response");
    return parseDraft(JSON.parse(text) as unknown);
  } catch (error) {
    if (error instanceof PaymentAnalysisError) throw error;
    throw new PaymentAnalysisError("invalid_response");
  }
}

export type VerifiedPaymentAnalysisResult =
  | { kind: "order_mismatch" }
  | { kind: "amount_missing" }
  | { kind: "success"; analysis: PaymentAnalysis };

/** Build analysis facts only after the PayPal order matches this tracked product and payment. */
export async function analyzeVerifiedPayPalOrder(
  orderId: string,
  payment: TrackedPayment,
  order: CheckoutOrder,
  generateDraft: (facts: PaymentAnalysisFacts) => Promise<PaymentAnalysisDraft>,
): Promise<VerifiedPaymentAnalysisResult> {
  if (!orderMatchesProduct(order, orderId, payment)) return { kind: "order_mismatch" };

  const assessment = assessPayPalOrder(order);
  const captures = order.purchase_units?.flatMap((unit) => unit.payments?.captures ?? []) ?? [];
  const completedCapture = captures.some((capture) => capture.status === "COMPLETED");
  const terminalFailure = assessment.status === "failed"
    ? captures.find((capture) => capture.status === "FAILED" || capture.status === "DECLINED")
    : undefined;
  const verifiedAmount = order.purchase_units?.[0]?.amount;
  if (!verifiedAmount) return { kind: "amount_missing" };

  const facts: PaymentAnalysisFacts = {
    status: payment.status === "completed" || assessment.status === "completed" ? "completed" : assessment.status,
    trackedStatus: payment.status,
    paypalOrderStatus: order.status,
    amount: verifiedAmount.value,
    currency: verifiedAmount.currency_code,
    captureStatuses: captures.map((capture) => capture.status).slice(0, 4),
    paypalCaptureCompleted: completedCapture,
    confirmedFailureReason: terminalFailure?.status_details?.reason ?? null,
  };

  return { kind: "success", analysis: await createPaymentAnalysis(facts, generateDraft) };
}
