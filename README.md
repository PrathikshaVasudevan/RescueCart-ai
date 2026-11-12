# RescueCart AI

RescueCart AI is a hackathon demo combining a PayPal Sandbox checkout with payment tracking in Supabase and a PayPal reporting dashboard built with AG Grid and AG Studio.

## Features

- `/store` — sample $10.00 USD checkout using PayPal JavaScript Buttons and PayPal Sandbox.
- `/api/checkout` — creates the server-priced PayPal order and records it as pending in Supabase.
- `/api/checkout/capture` — captures an approved order, verifies the completed capture and amount with PayPal, then updates its Supabase record.
- `/api/checkout/status` — checks the latest PayPal order status and reconciles verified completed payments to Supabase.
- `/recovery` — merchant Recovery Centre for tracked checkout payments, manual PayPal status verification, review history, and the Gemini-powered Payment Failure Analyst.
- `/api/health/supabase` — read-only Supabase connectivity check.
- `/dashboard` — live PayPal data in an AG Studio dashboard. Reports are saved in the current browser's local storage.
- `/products`, `/plans`, `/invoices`, `/transactions`, and `/balances` — live PayPal endpoint data in AG Grid.
- The optional AG Studio assistant uses the OpenAI Responses API through `/api/ai/responses`. It can help explore and edit dashboard reports; it does not currently recover failed payments or initiate payment actions.

This project is a sandbox demo. Recovery Centre uses HTTP Basic Auth configured with `RECOVERY_CENTRE_USERNAME` and `RECOVERY_CENTRE_PASSWORD`; set unique values and serve the merchant dashboard over HTTPS outside localhost. It does not automatically charge customers or retry payments.

## Requirements

- Node.js 20.9 or later
- A PayPal Sandbox REST app with checkout credentials
- A Supabase project with the `checkout_payments` table and columns used by the checkout routes
- A Gemini API key for Payment Failure Analyst
- Optional: an AG Studio licence key and an OpenAI API key for the AG Studio assistant

The PayPal products, plans, invoices, transactions, and balances pages require corresponding Sandbox account data and API permissions. Transaction and balance reporting also depends on the PayPal app/account's reporting access.

## Local setup

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Copy the example environment file and fill in the values in `.env.local`:

   ```powershell
   Copy-Item env.example .env.local
   ```

3. Set `PAYPAL_CLIENT_ID` and `PAYPAL_SECRET` to your PayPal Sandbox app credentials. Set `NEXT_PUBLIC_PAYPAL_CLIENT_ID` to the same Sandbox client ID; it is public and is used only to load the browser PayPal SDK.

4. Set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` for the Supabase project containing the existing `checkout_payments` table. The secret key is server-only and must never use a `NEXT_PUBLIC_` prefix.

5. Set `GEMINI_API_KEY` for the Recovery Centre Payment Failure Analyst. `GEMINI_MODEL` is optional and defaults to `gemini-2.5-flash`.

6. Set `RECOVERY_CENTRE_USERNAME` and `RECOVERY_CENTRE_PASSWORD` to protect the merchant Recovery Centre.

7. Start the development server:

   ```powershell
   npm run dev
   ```

8. Open [http://localhost:3000](http://localhost:3000), then choose the store, Recovery Centre, dashboard, or a data page.

`.env.local` is excluded from Git. Never paste credentials into source code, documentation, terminal output, or browser-visible variables.

## Environment variables

See [`env.example`](env.example) for every variable name used by the application.

Required for checkout and payment tracking:

- `PAYPAL_CLIENT_ID` and `PAYPAL_SECRET` — PayPal Sandbox REST credentials, used on the server.
- `NEXT_PUBLIC_PAYPAL_CLIENT_ID` — matching Sandbox client ID for the PayPal browser SDK. This ID is intended to be public; do not put a secret here.
- `SUPABASE_URL` and `SUPABASE_SECRET_KEY` — server-side Supabase connection and secret key.
- `RECOVERY_CENTRE_USERNAME` and `RECOVERY_CENTRE_PASSWORD` — required server-only credentials protecting `/recovery` and `/api/recovery/*`.
- `GEMINI_API_KEY` — required server-only credential for the Payment Failure Analyst.
- `GEMINI_MODEL` — optional Gemini model ID for analysis; defaults to `gemini-2.5-flash`.

Optional:

- `AG_STUDIO` — AG Studio licence key for the dashboard.
- `AG_STUDIO_OPENAI_API_KEY` — preferred OpenAI key for the AG Studio dashboard assistant. If it is unset, the server also accepts `OPENAI_API_KEY` from its environment.
- `OPENAI_MODELS` — comma-separated OpenAI model IDs allowed by the AG Studio assistant. The first is the default. If unset, the code defaults to `gpt-5.4-mini`.

The Payment Failure Analyst requires Recovery Centre HTTP Basic Auth but has no rate limiting. Use unique credentials and protect public deployments with appropriate usage controls.

## Useful commands

```powershell
npm run dev
npm run lint
npx tsc --noEmit
npm run build
npm run start
```

## Payment flow notes

The checkout amount and currency are defined on the server in `lib/paypal.ts`; the browser cannot set them. The capture route verifies PayPal's completed order and captured amount before marking the Supabase row completed. If PayPal capture succeeds but the database update fails, the response reports that reconciliation is needed; the status route can repair the record after checking PayPal.

The Supabase health route performs a read-only check and does not add test payment rows. The database schema is managed outside this repository, so configure the existing table in Supabase before running checkout.

The Recovery Centre reads tracked rows from `checkout_payments` and requires its review-history migration, `supabase/migrations/20261112000100_recovery_action_history.sql`. The AI analyst's reviewed-action history additionally requires `supabase/migrations/20261112000200_ai_recommendation_reviewed.sql`, applied after the review-history migration. Review and apply SQL manually in Supabase; the application never runs migrations. The action table references the existing unique `checkout_payments.paypal_order_id` key and grants access only to `service_role` while enabling RLS. Recovery and review activity is limited to payment orders already present in `checkout_payments`.

The Recovery Centre Payment Failure Analyst uses Gemini through the official `@google/genai` SDK, configured with `GEMINI_API_KEY` and optional `GEMINI_MODEL`. It sends server-verified order status, amount/currency, capture statuses, and a PayPal-reported failure reason when present; it does not send payer details or order identifiers. Analysis uses structured JSON output and is advisory. Completed payments are summarized deterministically without a Gemini request, and the server never triggers retries or charges. AG Studio continues to use its separate OpenAI integration.

## Project layout

- `app/store/` — PayPal checkout UI.
- `app/api/checkout/` — order creation, capture, and status routes.
- `app/api/recovery/` — protected merchant recovery data and review actions.
- `app/recovery/` — Recovery Centre interface.
- `app/api/health/supabase/` — read-only database health route.
- `app/(endpoints)/` — AG Grid PayPal endpoint pages.
- `app/dashboard/` — AG Studio dashboard, report editor, and optional assistant.
- `lib/paypal.ts` — server-side PayPal REST client and fixed demo product.
- `lib/supabase-admin.ts` — server-only Supabase client.
- `lib/dashboard-data.ts` — reporting data shaping.
- `lib/recovery-store.ts` — server-only Recovery Centre queries and tracked-payment action checks.

## Payment lifecycle migration

Before using the updated checkout routes, review and apply `supabase/migrations/20261111000100_payment_lifecycle_reliability.sql` manually with the Supabase SQL editor. It verifies the existing unique PayPal order ID index and creates the service-role-only idempotency table; it does not modify existing payment rows or recreate the existing amount, capture ID, or status constraints. The application does not apply migrations automatically.

The migration expects the existing `checkout_payments.paypal_order_id` column to have a valid, non-partial unique index. Review the existing schema before applying it. After applying the migration, restart the app and test with PayPal Sandbox.
