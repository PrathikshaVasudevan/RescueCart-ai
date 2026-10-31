
'use client';

import { useEffect, useRef, useState } from 'react';
import { loadScript } from '@paypal/paypal-js';

export default function CheckoutButton() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState('Loading PayPal checkout...');

  
useEffect(() => {
  let cancelled = false;
  let buttons:
    | { close: () => Promise<void> }
    | undefined;

  let rendered = false;

  async function closeButtons() {
    if (!buttons || !rendered) return;

    const instance = buttons;
    buttons = undefined;
    rendered = false;

    try {
      await instance.close();
    } catch (error) {
      console.warn("PayPal cleanup:", error);
    }
  }

  async function setup() {
    const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;

    if (!clientId) {
      setMessage("PayPal Client ID is not configured.");
      return;
    }

    try {
      const paypal = await loadScript({
        clientId,
        currency: "USD",
        intent: "capture",
        components: ["buttons"],
      });

      if (cancelled) return;

      if (!paypal || !paypal.Buttons) {
        throw new Error("PayPal Buttons SDK failed to load");
      }

      if (!containerRef.current) return;

      const instance = paypal.Buttons({
        style: {
          layout: "vertical",
          shape: "rect",
          label: "paypal",
        },

        async createOrder() {
          const response = await fetch("/api/checkout", {
            method: "POST",
          });

          const result = await response.json();

          if (!response.ok || !result.id) {
            throw new Error(
              result.error || "Could not create order."
            );
          }

          return result.id;
        },

        async onApprove(data) {
          setMessage("Confirming payment...");

          const response = await fetch("/api/checkout/capture", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              orderId: data.orderID,
            }),
          });

          const result = await response.json();

          if (!response.ok) {
            setMessage(
              result.error ||
                "Payment confirmation needs attention."
            );
            return;
          }

          setMessage(
            `Payment completed! Order: ${result.id ?? data.orderID}`
          );
        },

        onCancel() {
          setMessage("Checkout cancelled. You can try again.");
        },

        onError(error) {
          console.error("PayPal checkout error:", error);
          setMessage(
            "Checkout encountered an error. Please try again."
          );
        },
      });

      buttons = instance;

      await instance.render(containerRef.current);

      rendered = true;

      // If React cleaned up during rendering,
      // close only after rendering has finished.
      if (cancelled) {
        await closeButtons();
      }
    } catch (error) {
      console.error("PayPal setup failed:", error);

      // Don't update state after this effect is cancelled.
      if (!cancelled) {
        setMessage(
          "Could not load checkout. Please refresh and try again."
        );
      }
    }
  }

  void setup();

  return () => {
    cancelled = true;

    // Don't destroy Buttons while render() is still pending.
    if (rendered) {
      void closeButtons();
    }
  };
}, []);


  return (
    <section className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold text-gray-900">
        RescueCart Demo Product
      </h2>

      <p className="mt-2 text-sm text-gray-600">
        A sample product for our checkout demo.
      </p>

      <p className="mt-4 text-3xl font-bold text-gray-900">
        $10.00 USD
      </p>

      <div className="mt-6 min-h-12" ref={containerRef} />

      <p
        className="mt-4 text-sm text-gray-600"
        aria-live="polite"
      >
        {message}
      </p>

      <p className="mt-3 text-xs text-gray-500">
        Sandbox demo. No real payment is intended.
      </p>
    </section>
  );
}
