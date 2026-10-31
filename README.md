## RescueCart AI

**AI-Powered Checkout Reliability & Revenue Recovery Platform**

RescueCart AI aims to help businesses improve checkout reliability, identify payment issues, and recover potentially lost revenue through intelligent payment recovery workflows.

### Problem Statement

Checkout interruptions, payment failures, and unclear payment states can result in lost sales and a poor customer experience.

RescueCart aims to address these challenges with a reliable checkout experience and smarter payment recovery.

### Current Implementation

- Next.js application using React and TypeScript
- Tailwind CSS
- PayPal JavaScript SDK integration
- PayPal Sandbox checkout
- Backend API for order creation
- Backend API for payment capture
- Payment confirmation UI

### Tech Stack

- Next.js
- React
- TypeScript
- Tailwind CSS
- PayPal JavaScript SDK
- PayPal REST API

### Current Progress

- [x] Project setup
- [x] PayPal Sandbox configuration
- [x] PayPal checkout integration
- [x] Order creation API
- [x] Payment capture API
- [x] Sandbox payment verification
- [ ] Improve cancellation and payment state handling
- [ ] Implement duplicate-checkout protection
- [ ] Develop AI-powered recovery workflows
- [ ] Complete end-to-end testing

### Getting Started

1. Clone the repository.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Configure your local `.env.local` file with your own PayPal Sandbox credentials. Use the environment variable names expected by the application.

4. Start the development server:

   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000).

### Security

- Never commit `.env.local` or API secrets.
- Use Sandbox credentials for development.
- Do not store sensitive payment information in the frontend.

### Project Status

Currently under development for the PayPal AI Hackathon.
