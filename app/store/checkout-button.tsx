'use client';

import { useEffect, useRef, useState } from 'react';
import { loadScript } from '@paypal/paypal-js';

// Share the PayPal SDK loading promise
// between component effect initializations.
let paypalSdkPromise:
  | ReturnType<typeof loadScript>
  | null = null;

function getPayPalSDK(clientId: string) {
  if (!paypalSdkPromise) {
    paypalSdkPromise = loadScript({
      clientId,
      currency: 'USD',
      intent: 'capture',
      components: ['buttons'],
    }).catch((error) => {
      // Allow a later attempt if loading fails.
      paypalSdkPromise = null;
      throw error;
    });
  }

  return paypalSdkPromise;
}

export default function CheckoutButton() {
  const containerRef = useRef<HTMLDivElement>(null);
  const checkoutLockRef = useRef(false);
  const currentOrderIdRef = useRef<string | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);

  const [message, setMessage] = useState(
    'Loading PayPal checkout...'
  );

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
        console.warn('PayPal cleanup:', error);
      }
    }

    async function setup() {
      const clientId =
        process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;

      if (!clientId) {
        setMessage(
          'PayPal Client ID is not configured.'
        );
        return;
      }

      try {
        const paypal = await getPayPalSDK(clientId);

        if (cancelled) return;

        if (!paypal || !paypal.Buttons) {
          throw new Error(
            'PayPal Buttons SDK failed to load'
          );
        }

        if (!containerRef.current) return;

        const instance = paypal.Buttons({
          style: {
            layout: 'vertical',
            shape: 'rect',
            label: 'paypal',
          },

          async createOrder() {
            if (checkoutLockRef.current) {
              throw new Error(
                'Checkout is already in progress.'
              );
            }

            checkoutLockRef.current = true;
            currentOrderIdRef.current = null;
            const idempotencyKey = idempotencyKeyRef.current ?? crypto.randomUUID();
            idempotencyKeyRef.current = idempotencyKey;

            setMessage('Creating your checkout...');

            try {
              const response = await fetch(
                '/api/checkout',
                {
                  method: 'POST',
                  headers: { 'Idempotency-Key': idempotencyKey },
                }
              );

              const result = await response.json();

              if (!response.ok || !result.id) {
                if (result.code === 'IDEMPOTENCY_WINDOW_EXPIRED') {
                  throw new Error('IDEMPOTENCY_WINDOW_EXPIRED');
                }
                throw new Error(
                  result.error ||
                    'Could not create order.'
                );
              }

              // Remember the order for cancellation
              // and status verification.
              currentOrderIdRef.current = result.id;

              return result.id;
            } catch (error) {
              checkoutLockRef.current = false;

              setMessage(
                error instanceof Error && error.message === 'IDEMPOTENCY_WINDOW_EXPIRED'
                  ? 'Checkout status is uncertain. Contact the merchant before starting another payment.'
                  : 'Could not start checkout. Please check payment status before retrying.'
              );

              throw error;
            }
          },

          async onApprove(data) {
            console.log("CALLBACK: onApprove", data.orderID);

            const orderId = data.orderID;

            if (!orderId) {
              setMessage(
                'Payment status needs verification.'
              );
              checkoutLockRef.current = false;
              return;
            }

            setMessage('Confirming payment...');

            try {
              const response = await fetch(
                '/api/checkout/capture',
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    orderId,
                  }),
                }
              );

              const result = await response.json();

              if (
                result.status === 'completed' &&
                result.databaseSync === 'completed'
              ) {
                idempotencyKeyRef.current = null;
                setMessage(
                  `Payment completed! Order: ${result.id}`
                );
              } else if (
                result.status === 'completed' &&
                result.databaseSync === 'required'
              ) {
                setMessage(
                  'Payment succeeded at PayPal, ' +
                    'but payment record needs reconciliation.'
                );
              } else if (result.status === 'failed') {
                idempotencyKeyRef.current = null;
                setMessage('PayPal confirmed that this payment failed.');
              } else if (result.status === 'capture_pending') {
                setMessage('Payment is still processing. Check its status before trying again.');
              } else if (response.status === 202) {
                setMessage(
                  'Payment is not confirmed as completed yet. ' +
                    'Please check its status.'
                );
              } else {
                setMessage(
                  result.error ||
                    'Payment status needs verification.'
                );
              }
            } catch (error) {
              console.error(
                'Capture request error:',
                error
              );

              setMessage(
                'Payment status needs verification ' +
                  'before retrying.'
              );
            } finally {
              checkoutLockRef.current = false;
            }
          },

          async onCancel() {
            console.log(
    "CALLBACK: onCancel",
    currentOrderIdRef.current
  );
            const orderId =
              currentOrderIdRef.current;

            setMessage(
              'Checkout closed. Checking payment status...'
            );

            try {
              if (!orderId) {
                setMessage(
                  'Checkout closed. Payment status needs verification.'
                );
                return;
              }

              const response = await fetch(
                `/api/checkout/status?orderId=${encodeURIComponent(
                  orderId
                )}`,
                {
                  cache: 'no-store',
                }
              );

              const result = await response.json();

              if (!response.ok && result.status !== 'completed') {
                setMessage(
                  'Checkout closed. Payment status needs verification.'
                );
                return;
              }

              switch (result.status) {
                case 'completed':
                  idempotencyKeyRef.current = null;
                  setMessage(
                    `Payment completed! Order: ${orderId}`
                  );
                  break;

                case 'approved':
                  setMessage(
                    'Payment approved but not completed. ' +
                      'Please wait for verification.'
                  );
                  break;

                case 'capture_pending':
                  setMessage('Payment is still processing. Please check again shortly.');
                  break;

                case 'failed':
                  setMessage('PayPal confirmed that this payment failed.');
                  idempotencyKeyRef.current = null;
                  break;

                case 'pending':
                  setMessage(
                    'Checkout closed. No completed payment ' +
                      'was confirmed.'
                  );
                  break;

                default:
                  setMessage(
                    'Payment status is unknown. ' +
                      'Please check before retrying.'
                  );
              }
            } catch (error) {
              console.error(
                'Cancellation status check failed:',
                error
              );

              setMessage(
                'Checkout closed. Payment status needs verification.'
              );
            } finally {
              checkoutLockRef.current = false;
            }
          },

          onError(error) {
            console.error("CALLBACK: onError", error);
            
            console.error(
              'PayPal checkout error:',
              error
            );

            checkoutLockRef.current = false;

            setMessage(
              'Checkout encountered an error. ' +
                'Payment status may need verification ' +
                'before retrying.'
            );
          },
        });

        buttons = instance;

        await instance.render(containerRef.current);

        rendered = true;

        if (cancelled) {
          await closeButtons();
        }
      } catch (error) {
        console.error(
          'PayPal setup failed:',
          error
        );

        if (!cancelled) {
          setMessage(
            'Could not load checkout. ' +
              'Please refresh and try again.'
          );
        }
      }
    }

    void setup();

    return () => {
      cancelled = true;

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

      <div
        className="mt-6 min-h-12"
        ref={containerRef}
      />

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
