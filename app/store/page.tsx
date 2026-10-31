
import Link from 'next/link';
import CheckoutButton from './checkout-button';

export default function StorePage() {
  return (
    <main className="min-h-screen bg-gray-50 px-6 py-12">
      <div className="mx-auto max-w-5xl">
        <header className="mb-10">
          <Link
            href="/"
            className="text-sm text-blue-700 hover:underline"
          >
            ← Back to home
          </Link>

          <p className="mt-6 text-sm font-semibold uppercase tracking-widest text-blue-700">
            RescueCart
          </p>

          <h1 className="mt-2 text-4xl font-bold text-gray-900">
            Simple checkout. Smarter recovery.
          </h1>

          <p className="mt-4 max-w-2xl text-gray-600">
            Experience a sample checkout powered by PayPal
            Sandbox.
          </p>
        </header>

        <CheckoutButton />
      </div>
    </main>
  );
}
