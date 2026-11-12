import assert from "node:assert/strict";
import test from "node:test";
import { getDashboardData, type DashboardLoaders } from "../lib/dashboard-data";
import { PayPalApiError } from "../lib/paypal";

function loaders(overrides: Partial<DashboardLoaders> = {}): DashboardLoaders {
  return {
    async listProducts() {
      return [{ id: "PROD-1", name: "Test product", create_time: "2026-01-01T00:00:00Z" }];
    },
    async listPlans() {
      return [];
    },
    async listInvoices() {
      return [];
    },
    async searchTransactions() {
      return [{ transaction_info: { transaction_id: "TX-1", transaction_amount: { value: "12.00", currency_code: "USD" } } }];
    },
    async getBalances() {
      return { balances: [{ currency: "USD", total_balance: { value: "20.00", currency_code: "USD" } }] };
    },
    ...overrides,
  };
}

test("invoice 403 is isolated while the other dashboard sections load", async () => {
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args);
  try {
    const data = await getDashboardData(
      new Date("2026-11-12T12:00:00.000Z"),
      loaders({
        async listInvoices() {
          throw new PayPalApiError(403, "/v2/invoicing/invoices?total_required=true", "NOT_AUTHORIZED private upstream details");
        },
      }),
    );

    assert.equal(data.invoiceAvailability, "permission-unavailable");
    assert.deepEqual(data.invoices, []);
    assert.deepEqual(data.invoiceItems, []);
    assert.deepEqual(data.invoicePayments, []);
    assert.equal(data.products[0]?.name, "Test product");
    assert.equal(data.transactions[0]?.id, "TX-1");
    assert.equal(data.balances[0]?.total, 20);
    assert.equal(warnings.length, 1);
    assert.equal(JSON.stringify(warnings[0]).includes("private upstream details"), false);
  } finally {
    console.warn = originalWarn;
  }
});

test("non-403 invoice errors remain visible to the dashboard error boundary", async () => {
  const failure = new PayPalApiError(500, "/v2/invoicing/invoices", "temporary PayPal failure");
  await assert.rejects(
    getDashboardData(new Date("2026-11-12T12:00:00.000Z"), loaders({
      async listInvoices() {
        throw failure;
      },
    })),
    (error: unknown) => error === failure,
  );
});
