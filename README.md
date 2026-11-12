# RescueCart AI
### Intelligent Payment Recovery & Payment Reliability Platform

RescueCart AI is an AI-powered payment reliability and recovery platform built to help merchants monitor payment transactions, understand payment failures, and make informed recovery decisions.

It combines PayPal payment processing, transaction lifecycle tracking, a merchant-facing Recovery Centre, and AI-assisted payment failure analysis into one platform.

## The Problem

Failed and uncertain online payments create friction for both merchants and customers.

Merchants need to understand:
- Which transactions are pending, completed, or failed.
- Whether a payment was successfully captured by the payment provider.
- Why a transaction may have failed.
- What action should be considered next.
- Whether recovery actions have been reviewed and recorded.

Without reliable transaction tracking and actionable insights, payment failures can lead to lost revenue, poor customer experiences, and manual investigation.

## Our Solution

RescueCart AI provides a unified platform for payment monitoring and recovery decision support.

The platform focuses on three key areas:

1. **Reliable Payment Processing** – PayPal Sandbox checkout with idempotency, capture verification, and payment lifecycle tracking.
2. **Merchant Recovery Centre** – A central dashboard to monitor transactions, inspect payment details, verify payment status, and maintain recovery action history.
3. **AI Payment Failure Analyst** – Uses Google Gemini to analyse verified payment information and generate structured explanations and recovery recommendations.

## Key Features

### 1. PayPal Checkout & Payment Reliability
- PayPal Sandbox integration.
- Server-side order creation and capture.
- Idempotency protection to reduce duplicate order creation.
- Verification of authoritative PayPal capture results.
- Amount, currency, and product-reference validation.
- Payment lifecycle states including pending, approved, capture pending, completed, failed, and unknown.
- Reconciliation support for uncertain payment outcomes.

### 2. Merchant Recovery Centre
- Merchant-facing transaction dashboard.
- Payment summary and transaction monitoring.
- Paginated payment records.
- Transaction filtering and detail inspection.
- Manual PayPal status verification.
- Mark transactions for review.
- Persistent recovery action history using Supabase.

### 3. AI Payment Failure Analyst
- Google Gemini API integration.
- Structured JSON analysis.
- Analysis based on verified payment information.
- Identification of possible payment failure causes.
- Actionable recovery recommendations.
- Distinction between provider-confirmed failure information and AI-inferred explanations.
- Recommendation review tracking.

AI analysis is intended to support merchant decisions. It does not automatically retry, capture, or charge payments.

### 4. Operational Reliability
- Server-side API credential handling.
- Recovery Centre authentication.
- Input validation.
- Safe error handling and diagnostic logging.
- Automated tests for important payment and analysis scenarios.

## System Architecture

```text
                 CUSTOMER
                    |
                    v
             RESCUECART STORE
                    |
                    v
             NEXT.JS BACKEND
                    |
                    v
              PAYPAL SANDBOX
                    |
                    v
          PAYMENT VERIFICATION
                    |
                    v
               SUPABASE
                    |
          +---------+---------+
          |                   |
          v                   v
    PAYMENT RECORDS      RECOVERY HISTORY
          |
          v
      RECOVERY CENTRE
          |
          v
    PAYMENT FAILURE ANALYST
          |
          v
       GOOGLE GEMINI
          |
          v
  STRUCTURED AI ANALYSIS
          |
          v
  MERCHANT RECOVERY DECISION
```

## Technology Stack

| Layer | Technologies |
|---|---|
| Frontend | Next.js, React, TypeScript |
| Styling | Tailwind CSS |
| Payment Processing | PayPal Sandbox |
| Database | Supabase PostgreSQL |
| AI Integration | Google Gemini API |
| AG Studio Integration | OpenAI-powered AG Studio functionality |
| Testing | Project test suite, TypeScript, ESLint |
| Development | Node.js, npm, Git |

## Project Structure

```text
RescueCart-ai/
│
├── app/
│   ├── api/
│   │   ├── checkout/
│   │   ├── health/
│   │   └── recovery/
│   │       ├── analyze/
│   │       └── ...
│   │
│   ├── recovery/
│   ├── store/
│   └── ...
│
├── lib/
│   ├── paypal.ts
│   └── payment-analysis.ts
│
├── supabase/
│   └── migrations/
│
├── tests/
│
├── scripts/
│
├── proxy.ts
├── env.example
├── package.json
└── README.md
```

## Getting Started

### Prerequisites

- Node.js
- npm
- PayPal Developer Sandbox account
- Supabase project
- Google AI Studio API key

### 1. Clone the repository

```bash
git clone https://github.com/PrathikshaVasudevan/RescueCart-ai.git

cd RescueCart-ai
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env.local` file in the project root using `env.example` as a reference.

Configure the required credentials:

- PayPal Sandbox client ID and secret.
- Supabase project URL and server-side secret key.
- Public PayPal client ID.
- Recovery Centre username and password.
- Gemini API key and model.
- Other integration settings required by the project.

Example Gemini configuration:

```env
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
```

Never commit `.env.local` or expose API credentials in source code.

### 4. Configure Supabase

- Create a Supabase project.
- Configure the required environment variables.
- Apply the SQL migrations in `supabase/migrations/` in chronological order.
- Ensure the required tables, constraints, and access policies are configured.

### 5. Run the development server

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Testing

Run the automated test suite:

```bash
npm test
```

Run TypeScript validation:

```bash
npx tsc --noEmit
```

Run lint:

```bash
npm run lint
```

Create a production build:

```bash
npm run build
```

## Security & Reliability

RescueCart AI follows several important security and reliability principles:

- Sensitive credentials are stored in server-side environment variables.
- Payment status is verified against PayPal rather than trusting browser responses.
- Idempotency mechanisms help prevent duplicate order creation.
- Payment capture outcomes are validated before updating transaction status.
- Uncertain payment outcomes are not incorrectly marked as failed.
- AI analysis is performed only after payment verification.
- AI-generated recommendations do not directly trigger financial operations.
- Recovery Centre access is protected by authentication.

## Current Scope & Limitations

- Payment processing is configured for PayPal Sandbox.
- Live production payment processing requires separate production configuration and validation.
- AI analysis depends on the availability, access permissions, and usage limits of the configured Gemini API.
- AI recommendations are decision-support outputs and should be reviewed by the merchant.
- PayPal reporting APIs may require additional permissions beyond standard checkout access.

## Future Enhancements

- Automated recovery workflows with merchant approval.
- Payment failure trend analytics.
- Recovery success-rate measurement based on recorded outcomes.
- Intelligent payment retry scheduling.
- Multi-payment-provider support.
- Advanced merchant revenue recovery insights.

## Hackathon Project

**Project:** RescueCart AI  
**Category:** AI-Powered Payment Reliability & Revenue Recovery  
**Payment Provider:** PayPal  
**AI Provider:** Google Gemini

Built to make payment failures more understandable, payment operations more reliable, and merchant recovery decisions more informed.

---

**Repository:** https://github.com/PrathikshaVasudevan/RescueCart-ai