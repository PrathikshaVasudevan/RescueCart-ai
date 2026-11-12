import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "@google/genai";
import {
  analyzeVerifiedPayPalOrder,
  createPaymentAnalysis,
  geminiConfiguration,
  PaymentAnalysisError,
  paymentAnalysisErrorDiagnostics,
  requestGeminiPaymentAnalysisDraft,
  type PaymentAnalysisDraft,
  type PaymentAnalysisFacts,
} from "../lib/payment-analysis";
import { isRecoveryProtectedPath, isValidRecoveryAuthorization } from "../lib/recovery-auth";

const baseFacts: PaymentAnalysisFacts = {
  status: "unknown",
  trackedStatus: "unknown",
  paypalOrderStatus: "UNKNOWN",
  amount: "10.00",
  currency: "USD",
  captureStatuses: [],
  paypalCaptureCompleted: false,
  confirmedFailureReason: null,
};

const draft: PaymentAnalysisDraft = {
  possibleCauseInference: "The available status does not identify the cause.",
  confidence: "high",
  missingInformation: [],
  recommendedRecoveryAction: "Check the authoritative payment status before taking action.",
  interventionRequired: true,
  interventionOwner: "merchant",
};

test("completed payments remain completed and never call the model", async () => {
  const result = await createPaymentAnalysis({
    ...baseFacts,
    status: "completed",
    trackedStatus: "completed",
    paypalOrderStatus: "COMPLETED",
    paypalCaptureCompleted: true,
  }, async () => { throw new Error("completed payments must not be sent to the model"); });

  assert.equal(result.status, "completed");
  assert.equal(result.knownFailureReason, null);
  assert.equal(result.possibleCauseInference, null);
  assert.equal(result.interventionRequired, false);
  assert.match(result.statusSummary, /PayPal confirms a completed capture/);
});

test("pending payments are not described as failed or given an inferred cause", async () => {
  const result = await createPaymentAnalysis({ ...baseFacts, status: "pending", trackedStatus: "pending", paypalOrderStatus: "CREATED" }, async () => draft);
  assert.equal(result.status, "pending");
  assert.equal(result.knownFailureReason, null);
  assert.equal(result.possibleCauseInference, null);
  assert.equal(result.confidence, "low");
  assert.ok(result.missingInformation.some((item) => /terminal capture outcome/i.test(item)));
  assert.doesNotMatch(result.statusSummary, /failed/i);
});

test("confirmed PayPal failure keeps its exact reason separate from the AI inference", async () => {
  const result = await createPaymentAnalysis({
    ...baseFacts,
    status: "failed",
    trackedStatus: "failed",
    paypalOrderStatus: "APPROVED",
    captureStatuses: ["DECLINED"],
    confirmedFailureReason: "DECLINED_BY_RISK_FRAUD_FILTERS",
  }, async () => draft);

  assert.equal(result.status, "failed");
  assert.equal(result.knownFailureReason, "DECLINED_BY_RISK_FRAUD_FILTERS");
  assert.equal(result.possibleCauseInference, "Inference: The available status does not identify the cause.");
  assert.equal(result.confidence, "high");
});

test("insufficient evidence forces a low-confidence unknown analysis", async () => {
  const result = await createPaymentAnalysis(baseFacts, async () => draft);
  assert.equal(result.status, "unknown");
  assert.equal(result.knownFailureReason, null);
  assert.equal(result.possibleCauseInference, null);
  assert.equal(result.confidence, "low");
});

test("Gemini configuration requires its key and defaults the model", () => {
  assert.deepEqual(geminiConfiguration({}), { apiKey: undefined, model: "gemini-2.5-flash" });
  assert.deepEqual(geminiConfiguration({ GEMINI_API_KEY: " test-key ", GEMINI_MODEL: "gemini-custom" }), {
    apiKey: "test-key",
    model: "gemini-custom",
  });
});

test("Gemini network failures are classified without exposing error text", async () => {
  await assert.rejects(
    requestGeminiPaymentAnalysisDraft(baseFacts, "unit-test-key", "test-model", async () => {
      throw new TypeError("private network details");
    }),
    (error: unknown) => {
      assert.ok(error instanceof PaymentAnalysisError);
      assert.equal(error.code, "upstream");
      const diagnostics = paymentAnalysisErrorDiagnostics(error, "correlation-network");
      assert.deepEqual(diagnostics, { provider: "gemini", failureType: "network_failure", correlationId: "correlation-network" });
      assert.equal(JSON.stringify(diagnostics).includes("private network details"), false);
      return true;
    },
  );
});

test("Gemini request timeouts are classified without exposing error text", async () => {
  await assert.rejects(
    requestGeminiPaymentAnalysisDraft(baseFacts, "unit-test-key", "test-model", async () => {
      const error = new Error("private timeout details");
      error.name = "RequestTimeoutError";
      throw error;
    }),
    (error: unknown) => {
      assert.ok(error instanceof PaymentAnalysisError);
      const diagnostics = paymentAnalysisErrorDiagnostics(error, "correlation-timeout");
      assert.deepEqual(diagnostics, { provider: "gemini", failureType: "request_timeout", correlationId: "correlation-timeout" });
      assert.equal(JSON.stringify(diagnostics).includes("private timeout details"), false);
      return true;
    },
  );
});

test("Gemini 429 errors expose only safe provider diagnostics", async () => {
  await assert.rejects(
    requestGeminiPaymentAnalysisDraft(baseFacts, "unit-test-key", "test-model", async () => {
      throw new ApiError({ status: 429, message: "private response body" });
    }),
    (error: unknown) => {
      assert.ok(error instanceof PaymentAnalysisError);
      const diagnostics = paymentAnalysisErrorDiagnostics(error, "correlation-http");
      assert.deepEqual(diagnostics, {
        provider: "gemini",
        failureType: "http_error",
        httpStatus: 429,
        errorCategory: "rate_limit_or_quota",
        correlationId: "correlation-http",
      });
      assert.equal(JSON.stringify(diagnostics).includes("private response body"), false);
      return true;
    },
  );
});

test("Gemini request uses compatible JSON Schema and preserves every validated field", async () => {
  let captured: unknown;
  const response: PaymentAnalysisDraft = {
    possibleCauseInference: null,
    confidence: "low",
    missingInformation: [],
    recommendedRecoveryAction: "Wait for authoritative status.",
    interventionRequired: false,
    interventionOwner: "none",
  };
  await requestGeminiPaymentAnalysisDraft(baseFacts, "unit-test-key", "test-model", async (request) => {
    captured = request;
    return { text: JSON.stringify(response) };
  });

  assert.ok(captured && typeof captured === "object");
  const config = (captured as { config: Record<string, unknown> }).config;
  assert.equal(config.responseMimeType, "application/json");
  assert.equal("responseSchema" in config, false);
  const schema = config.responseJsonSchema as {
    type: string;
    properties: Record<string, { type: unknown; enum?: string[]; items?: unknown; maxItems?: number }>;
    required: string[];
  };
  assert.equal(schema.type, "object");
  assert.deepEqual(schema.properties.possibleCauseInference.type, ["string", "null"]);
  assert.deepEqual(schema.properties.confidence.enum, ["low", "medium", "high"]);
  assert.deepEqual(schema.properties.interventionOwner.enum, ["merchant", "customer", "both", "none"]);
  assert.equal(schema.properties.missingInformation.maxItems, 8);
  assert.deepEqual(schema.required, [
    "possibleCauseInference",
    "confidence",
    "missingInformation",
    "recommendedRecoveryAction",
    "interventionRequired",
    "interventionOwner",
  ]);
});

test("Gemini HTTP diagnostics expose only Google's sanitized message and status", async () => {
  const privateText = "DO NOT LOG PAYMENT FACTS";
  await assert.rejects(
    requestGeminiPaymentAnalysisDraft({ ...baseFacts, amount: privateText }, "unit-test-secret-key", "test-model", async () => {
      throw new ApiError({
        status: 400,
        message: JSON.stringify({ error: { code: 400, status: "INVALID_ARGUMENT", message: `Schema property nullable is unsupported; ${privateText} unit-test-secret-key` } }),
      });
    }),
    (error: unknown) => {
      assert.ok(error instanceof PaymentAnalysisError);
      const diagnostics = paymentAnalysisErrorDiagnostics(error, "safe-correlation");
      assert.deepEqual(diagnostics, {
        provider: "gemini",
        failureType: "http_error",
        httpStatus: 400,
        errorCategory: "invalid_request",
        providerMessage: "Schema property nullable is unsupported; [redacted] [redacted]",
        correlationId: "safe-correlation",
      });
      assert.equal(JSON.stringify(diagnostics).includes(privateText), false);
      assert.equal(JSON.stringify(diagnostics).includes("unit-test-secret-key"), false);
      return true;
    },
  );
});

test("Gemini authentication errors are classified without logging messages", async () => {
  await assert.rejects(
    requestGeminiPaymentAnalysisDraft(baseFacts, "unit-test-key", "test-model", async () => {
      throw new ApiError({ status: 401, message: "private authentication response" });
    }),
    (error: unknown) => {
      assert.ok(error instanceof PaymentAnalysisError);
      assert.deepEqual(paymentAnalysisErrorDiagnostics(error, "correlation-auth"), {
        provider: "gemini",
        failureType: "http_error",
        httpStatus: 401,
        errorCategory: "authentication_error",
        correlationId: "correlation-auth",
      });
      return true;
    },
  );
});

test("Gemini model lookup errors are classified without logging messages", async () => {
  await assert.rejects(
    requestGeminiPaymentAnalysisDraft(baseFacts, "unit-test-key", "test-model", async () => {
      throw new ApiError({ status: 404, message: "private model lookup response" });
    }),
    (error: unknown) => {
      assert.ok(error instanceof PaymentAnalysisError);
      assert.deepEqual(paymentAnalysisErrorDiagnostics(error, "correlation-model"), {
        provider: "gemini",
        failureType: "http_error",
        httpStatus: 404,
        errorCategory: "model_or_endpoint_not_found",
        correlationId: "correlation-model",
      });
      return true;
    },
  );
});

test("Gemini malformed JSON is rejected safely", async () => {
  await assert.rejects(
    requestGeminiPaymentAnalysisDraft(baseFacts, "unit-test-key", "test-model", async () => ({ text: "not json" })),
    (error: unknown) => error instanceof PaymentAnalysisError && error.code === "invalid_response",
  );
});

test("PayPal verification failure does not call Gemini", async () => {
  let calls = 0;
  const result = await analyzeVerifiedPayPalOrder(
    "ORDER123",
    { paypal_order_id: "ORDER123", amount: "10.00", currency: "USD", status: "pending" },
    {
      id: "ORDER123",
      status: "CREATED",
      purchase_units: [{ reference_id: "different-product", amount: { value: "10.00", currency_code: "USD" } }],
    },
    async () => { calls += 1; return draft; },
  );
  assert.equal(result.kind, "order_mismatch");
  assert.equal(calls, 0);
});

test("Gemini structured JSON request preserves the existing analysis response contract", async () => {
  let request: { model: string; contents: string; config: { responseMimeType: string; responseJsonSchema: unknown } } | undefined;
  const validDraft = JSON.stringify(draft);
  const facts = { ...baseFacts, status: "failed" as const, paypalOrderStatus: "APPROVED", confirmedFailureReason: "DECLINED" };
  const analysis = await createPaymentAnalysis(facts, (verifiedFacts) =>
    requestGeminiPaymentAnalysisDraft(verifiedFacts, "unit-test-key", "test-model", async (input) => {
      request = input;
      return { text: validDraft };
    }),
  );
  assert.equal(analysis.recommendedRecoveryAction, draft.recommendedRecoveryAction);
  assert.equal(request?.model, "test-model");
  assert.equal(request?.config.responseMimeType, "application/json");
  assert.ok(request?.config.responseJsonSchema);
  assert.equal(request?.contents.includes("ORDER123"), false);
  assert.equal(request?.contents.includes("email"), false);
  assert.deepEqual(Object.keys(analysis).sort(), [
    "confidence", "interventionOwner", "interventionRequired", "knownFailureReason", "missingInformation",
    "possibleCauseInference", "recommendedRecoveryAction", "status", "statusSummary",
  ]);
});

test("unauthorized or missing Recovery Centre credentials are rejected", () => {
  assert.equal(isValidRecoveryAuthorization(null, "merchant", "password"), false);
  assert.equal(isValidRecoveryAuthorization("Basic aW52YWxpZA==", "merchant", "password"), false);
  assert.equal(isValidRecoveryAuthorization(`Basic ${Buffer.from("merchant:password").toString("base64")}`, "merchant", "password"), true);
});

test("route protection is limited to Recovery Centre pages and APIs", () => {
  for (const path of ["/", "/store", "/api/checkout", "/api/checkout/capture", "/api/checkout/status", "/dashboard"]) {
    assert.equal(isRecoveryProtectedPath(path), false, `${path} should remain public`);
  }
  for (const path of ["/recovery", "/recovery/", "/recovery/payments/ORDER", "/api/recovery", "/api/recovery/analyze"]) {
    assert.equal(isRecoveryProtectedPath(path), true, `${path} should require Recovery Centre authentication`);
  }
  assert.equal(isRecoveryProtectedPath("/recovery-extra"), false);
  assert.equal(isRecoveryProtectedPath("/api/recovery-extra"), false);
});
