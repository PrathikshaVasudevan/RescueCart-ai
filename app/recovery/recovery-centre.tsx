'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

type Payment = {
  id: string;
  paypal_order_id: string;
  amount: string | number;
  currency: string;
  status: string;
  paypal_capture_id: string | null;
  created_at: string;
  updated_at: string;
  captured_at: string | null;
};
type Action = {
  id: string;
  paypal_order_id: string;
  action_type: 'marked_for_review' | 'ai_recommendation_reviewed';
  note: string | null;
  created_at: string;
};
type DashboardData = { payments: Payment[]; actions: Action[] };
type PaymentAnalysis = {
  status: string;
  statusSummary: string;
  knownFailureReason: string | null;
  possibleCauseInference: string | null;
  confidence: 'low' | 'medium' | 'high';
  missingInformation: string[];
  recommendedRecoveryAction: string;
  interventionRequired: boolean;
  interventionOwner: 'merchant' | 'customer' | 'both' | 'none';
};
type Filter = 'all' | 'needs-attention' | 'pending' | 'completed' | 'approved' | 'failed' | 'unknown';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All payments' },
  { id: 'needs-attention', label: 'Needs attention' },
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'completed', label: 'Completed' },
  { id: 'failed', label: 'Failed' },
  { id: 'unknown', label: 'Unknown' },
];

const STATUS_COPY: Record<string, { title: string; description: string; tone: string }> = {
  pending: { title: 'Pending', description: 'Checkout has not been confirmed as approved or captured. A customer may have closed checkout; that alone is not a failure.', tone: 'blue' },
  approved: { title: 'Approved', description: 'PayPal reports approval, but the payment has not been confirmed as captured.', tone: 'violet' },
  capture_pending: { title: 'Capture processing', description: 'PayPal reports that capture is still processing. Verify again before taking any action.', tone: 'amber' },
  completed: { title: 'Completed', description: 'PayPal confirmed a completed capture for the expected product, amount and currency.', tone: 'green' },
  failed: { title: 'Failed', description: 'PayPal confirmed a terminal capture failure. No failure reason is inferred by this dashboard.', tone: 'red' },
  unknown: { title: 'Unknown', description: 'The current payment state could not be confirmed. Check PayPal status before making a decision.', tone: 'gray' },
};

function formatMoney(amount: number | string, currency: string) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_COPY[status]?.tone ?? 'gray';
  const tones: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-800 ring-blue-200', violet: 'bg-violet-50 text-violet-800 ring-violet-200',
    amber: 'bg-amber-50 text-amber-900 ring-amber-200', green: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
    red: 'bg-rose-50 text-rose-800 ring-rose-200', gray: 'bg-slate-100 text-slate-700 ring-slate-200',
  };
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ring-1 ring-inset ${tones[tone]}`}>{status.replaceAll('_', ' ')}</span>;
}

export default function RecoveryCentre() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [note, setNote] = useState('');
  const [analysis, setAnalysis] = useState<PaymentAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState('');
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [analysisReviewed, setAnalysisReviewed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/recovery/payments', { cache: 'no-store' });
      if (!response.ok) throw new Error('Recovery data is temporarily unavailable.');
      setData(await response.json() as DashboardData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Recovery data could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/recovery/payments', { cache: 'no-store' });
        if (!response.ok) throw new Error('Recovery data is temporarily unavailable.');
        const result = await response.json() as DashboardData;
        if (!cancelled) setData(result);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Recovery data could not be loaded.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const actionsByOrder = useMemo(() => {
    const grouped = new Map<string, Action[]>();
    for (const action of data?.actions ?? []) grouped.set(action.paypal_order_id, [...(grouped.get(action.paypal_order_id) ?? []), action]);
    return grouped;
  }, [data]);
  const selected = data?.payments.find((payment) => payment.paypal_order_id === selectedId) ?? null;
  const selectedActions = selected ? actionsByOrder.get(selected.paypal_order_id) ?? [] : [];
  const latestReviewedAnalysis = selectedActions.find((action) => action.action_type === 'ai_recommendation_reviewed');
  const reviewIds = new Set((data?.actions ?? []).filter((action) => action.action_type === 'marked_for_review').map((action) => action.paypal_order_id));
  const needsAttention = (payment: Payment) => ['approved', 'capture_pending', 'failed', 'unknown'].includes(payment.status) || reviewIds.has(payment.paypal_order_id);
  const visiblePayments = (data?.payments ?? []).filter((payment) => {
    if (filter === 'needs-attention') return needsAttention(payment);
    return filter === 'all' || payment.status === filter;
  });
  const completedCount = data?.payments.filter((payment) => payment.status === 'completed').length ?? 0;
  const pendingCount = data?.payments.filter((payment) => payment.status === 'pending' || payment.status === 'capture_pending').length ?? 0;
  const attentionCount = data?.payments.filter(needsAttention).length ?? 0;

  async function verify(payment: Payment) {
    setBusy(payment.paypal_order_id);
    setNotice('');
    try {
      const response = await fetch(`/api/checkout/status?orderId=${encodeURIComponent(payment.paypal_order_id)}`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok && result.status !== 'completed') throw new Error(result.message ?? result.error ?? 'Could not verify payment status.');
      setNotice(`PayPal status checked: ${String(result.status ?? 'unknown').replaceAll('_', ' ')}${result.databaseSync === 'required' ? '. Database reconciliation is still required.' : '.'}`);
      await load();
    } catch (verifyError) {
      setNotice(verifyError instanceof Error ? verifyError.message : 'Could not verify payment status.');
    } finally {
      setBusy(null);
    }
  }

  async function markForReview(payment: Payment) {
    setBusy(payment.paypal_order_id);
    setNotice('');
    try {
      const response = await fetch('/api/recovery/actions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'marked_for_review', orderId: payment.paypal_order_id, note }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not save review action.');
      setNote('');
      setNotice('Payment marked for review.');
      await load();
    } catch (actionError) {
      setNotice(actionError instanceof Error ? actionError.message : 'Could not save review action.');
    } finally {
      setBusy(null);
    }
  }

  async function analyzePayment(payment: Payment) {
    setAnalysis(null);
    setAnalysisError('');
    setAnalysisReviewed(false);
    setAnalysisBusy(true);
    try {
      const response = await fetch('/api/recovery/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: payment.paypal_order_id }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.code === 'AI_NOT_CONFIGURED') {
          setAnalysisError('Payment analyst unavailable. Configure GEMINI_API_KEY on the server.');
        } else {
          setAnalysisError(result.error ?? 'Payment analysis could not be completed. Try again later.');
        }
        return;
      }
      setAnalysis(result.analysis as PaymentAnalysis);
    } catch {
      setAnalysisError('Payment analysis could not be reached. Check the connection and try again.');
    } finally {
      setAnalysisBusy(false);
    }
  }

  async function markAnalysisReviewed(payment: Payment) {
    if (!analysis) return;
    setReviewBusy(true);
    setNotice('');
    try {
      const response = await fetch('/api/recovery/actions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'ai_recommendation_reviewed',
          orderId: payment.paypal_order_id,
          note: `Reviewed recommendation: ${analysis.recommendedRecoveryAction}`.slice(0, 1000),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not save review history.');
      setNotice('AI recommendation marked as reviewed.');
      setAnalysisReviewed(true);
      await load();
    } catch (reviewError) {
      setNotice(reviewError instanceof Error ? reviewError.message : 'Could not save review history.');
    } finally {
      setReviewBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f4f7fb] px-4 py-6 text-slate-900 sm:px-8 sm:py-9">
      <div className="mx-auto max-w-7xl">
        <header className="mb-7 flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link href="/" className="text-sm font-medium text-blue-700 hover:underline">← Home</Link>
            <p className="mt-5 text-xs font-bold uppercase tracking-[0.2em] text-blue-700">RescueCart AI</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Recovery Centre</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">Review tracked PayPal checkouts, verify authoritative status and keep a record of merchant follow-up.</p>
          </div>
          <div className="flex gap-2">
            <Link href="/store" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-slate-50">Open checkout</Link>
            <button onClick={() => void load()} disabled={loading} className="rounded-xl bg-[#003087] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#001f5c] disabled:opacity-60">{loading ? 'Refreshing…' : 'Refresh'}</button>
          </div>
        </header>

        {error && <div role="alert" className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error} <button className="ml-2 font-semibold underline" onClick={() => void load()}>Try again</button></div>}
        {notice && <div role="status" className="mb-6 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">{notice}</div>}

        <section aria-label="Payment summary" className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: 'Tracked payments', value: data?.payments.length ?? '—', note: 'Records in the current view' },
            { label: 'Completed', value: loading && !data ? '—' : completedCount, note: 'PayPal confirmed captures' },
            { label: 'Pending', value: loading && !data ? '—' : pendingCount, note: 'Pending checkout or capture' },
            { label: 'Needs attention', value: loading && !data ? '—' : attentionCount, note: 'Approved, failed, unknown or flagged' },
          ].map((card) => <article key={card.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-medium text-slate-600">{card.label}</p><p className="mt-3 text-3xl font-bold tracking-tight">{card.value}</p><p className="mt-1 text-xs text-slate-500">{card.note}</p></article>)}
          <p className="sm:col-span-2 xl:col-span-4 text-xs text-slate-500">Recovery rate is omitted because the tracked records do not establish which payments were recovered through a recovery action.</p>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-4 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div><h2 className="text-lg font-bold">Tracked transactions</h2><p className="mt-1 text-sm text-slate-500">All tracked checkout payment records.</p></div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter payments">
              {FILTERS.map((option) => <button key={option.id} onClick={() => setFilter(option.id)} aria-pressed={filter === option.id} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${filter === option.id ? 'bg-[#003087] text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>{option.label}</button>)}
            </div>
          </div>
          {loading && !data ? <div className="p-12 text-center text-sm text-slate-500">Loading tracked payments…</div> : !error && visiblePayments.length === 0 ? <div className="p-12 text-center"><p className="font-semibold">{data?.payments.length ? 'No payments match this filter' : 'No tracked payments yet'}</p><p className="mt-1 text-sm text-slate-500">Completed or pending checkout records will appear here.</p></div> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">PayPal order</th><th className="px-5 py-3">Amount</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Capture ID</th><th className="px-5 py-3">Created</th><th className="px-5 py-3">Updated</th><th className="px-5 py-3">Actions</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{visiblePayments.map((payment) => <tr key={payment.paypal_order_id} className="hover:bg-slate-50/70"><td className="px-5 py-4"><button onClick={() => { setSelectedId(payment.paypal_order_id); setNote(''); setAnalysis(null); setAnalysisError(''); }} className="font-mono text-xs font-semibold text-blue-800 hover:underline">{payment.paypal_order_id}</button>{reviewIds.has(payment.paypal_order_id) && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-900">Review</span>}</td><td className="whitespace-nowrap px-5 py-4 font-semibold">{formatMoney(payment.amount, payment.currency)}</td><td className="px-5 py-4"><StatusBadge status={payment.status} /></td><td className="px-5 py-4 font-mono text-xs text-slate-600">{payment.paypal_capture_id ?? '—'}</td><td className="whitespace-nowrap px-5 py-4 text-xs text-slate-600">{formatDate(payment.created_at)}</td><td className="whitespace-nowrap px-5 py-4 text-xs text-slate-600">{formatDate(payment.updated_at)}</td><td className="px-5 py-4"><button disabled={busy === payment.paypal_order_id} onClick={() => void verify(payment)} className="whitespace-nowrap rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold hover:bg-slate-100 disabled:opacity-50">{busy === payment.paypal_order_id ? 'Checking…' : 'Verify status'}</button></td></tr>)}</tbody>
              </table>
            </div>
          )}
        </section>
        <footer className="mt-5 flex flex-wrap justify-between gap-3 text-xs text-slate-500"><span>Statuses come from tracked records and PayPal verification.</span><Link className="font-semibold text-blue-700 hover:underline" href="/dashboard">Open PayPal reports and AG Studio →</Link></footer>
      </div>

      {selected && <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedId(null); }}>
        <aside role="dialog" aria-modal="true" aria-labelledby="payment-detail-title" className="h-full w-full max-w-xl overflow-y-auto bg-white p-5 shadow-2xl sm:p-8">
          <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-widest text-blue-700">Payment detail</p><h2 id="payment-detail-title" className="mt-2 break-all font-mono text-lg font-bold">{selected.paypal_order_id}</h2></div><button onClick={() => setSelectedId(null)} aria-label="Close details" className="rounded-full px-3 py-1 text-2xl leading-none text-slate-500 hover:bg-slate-100">×</button></div>
          <div className="mt-5 flex items-center gap-3"><StatusBadge status={selected.status} /><span className="text-xl font-bold">{formatMoney(selected.amount, selected.currency)}</span></div>
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4"><h3 className="text-sm font-bold">{(STATUS_COPY[selected.status] ?? STATUS_COPY.unknown).title}</h3><p className="mt-1 text-sm leading-6 text-slate-600">{STATUS_COPY[selected.status]?.description ?? STATUS_COPY.unknown.description}</p></div>
          <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">{[
            ['Record ID', selected.id], ['PayPal order ID', selected.paypal_order_id], ['Amount', formatMoney(selected.amount, selected.currency)], ['Currency', selected.currency], ['Payment status', selected.status], ['Capture ID', selected.paypal_capture_id ?? 'Not recorded'], ['Created', formatDate(selected.created_at)], ['Updated', formatDate(selected.updated_at)], ['Captured at', formatDate(selected.captured_at)],
          ].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 p-3"><dt className="text-xs font-medium text-slate-500">{label}</dt><dd className="mt-1 break-all text-sm font-semibold">{value}</dd></div>)}</dl>
          <div className="mt-6 flex flex-wrap gap-2"><button disabled={busy === selected.paypal_order_id} onClick={() => void verify(selected)} className="rounded-xl bg-[#003087] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#001f5c] disabled:opacity-50">{busy === selected.paypal_order_id ? 'Checking…' : 'Verify with PayPal'}</button><button disabled={busy === selected.paypal_order_id} onClick={() => void markForReview(selected)} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">Mark for review</button></div>
          <label className="mt-4 block text-xs font-semibold text-slate-600">Optional note for the review history<textarea value={note} onChange={(event) => setNote(event.target.value.slice(0, 500))} rows={3} maxLength={500} placeholder="Add context for the merchant team" className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" /></label>
          <section className="mt-7 rounded-2xl border border-blue-200 bg-blue-50/60 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="text-xs font-bold uppercase tracking-widest text-blue-800">RescueCart AI</p><h3 className="mt-1 text-lg font-bold">Payment Failure Analyst</h3><p className="mt-1 text-xs text-slate-600">Analysis uses the server-verified PayPal order and tracked payment. It never retries or charges.</p></div>
              {!analysis && <button disabled={analysisBusy} onClick={() => void analyzePayment(selected)} className="rounded-xl bg-[#003087] px-3 py-2 text-sm font-semibold text-white hover:bg-[#001f5c] disabled:opacity-50">{analysisBusy ? 'Analyzing…' : 'Analyze payment'}</button>}
            </div>
            {analysisError && <p role="alert" className="mt-4 rounded-xl border border-amber-200 bg-white p-3 text-sm text-amber-900">{analysisError}</p>}
            {analysis && <div className="mt-4 space-y-3">
              <div className="rounded-xl bg-white p-3"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Payment status · <span className="capitalize">{analysis.status.replaceAll('_', ' ')}</span></p><p className="mt-1 text-sm leading-6">{analysis.statusSummary}</p></div>
              <div className="rounded-xl bg-white p-3"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">PayPal-confirmed failure reason</p><p className="mt-1 text-sm">{analysis.knownFailureReason ?? 'PayPal did not provide a confirmed failure reason.'}</p></div>
              <div className="rounded-xl bg-white p-3"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Possible cause · AI inference</p><p className="mt-1 text-sm leading-6">{analysis.possibleCauseInference ?? 'No cause can be inferred from the available evidence.'}</p><p className="mt-2 text-xs text-slate-500">Confidence: <span className="font-semibold capitalize">{analysis.confidence}</span></p></div>
              <div className="rounded-xl bg-white p-3"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Recommended recovery action</p><p className="mt-1 text-sm leading-6">{analysis.recommendedRecoveryAction}</p><p className="mt-2 text-xs text-slate-600">Intervention required: <span className="font-semibold">{analysis.interventionRequired ? `Yes — ${analysis.interventionOwner}` : 'No'}</span></p></div>
              <div className="rounded-xl bg-white p-3"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Missing information</p>{analysis.missingInformation.length ? <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{analysis.missingInformation.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : <p className="mt-1 text-sm">No additional information identified.</p>}</div>
              <div className="flex flex-wrap items-center gap-3"><button disabled={reviewBusy || analysisReviewed} onClick={() => void markAnalysisReviewed(selected)} className="rounded-xl border border-blue-300 bg-white px-3 py-2 text-sm font-semibold text-blue-900 hover:bg-blue-100 disabled:opacity-50">{reviewBusy ? 'Saving review…' : analysisReviewed ? 'Recommendation reviewed' : 'Mark recommendation reviewed'}</button>{latestReviewedAnalysis && <span className="text-xs text-slate-600">Previous review {formatDate(latestReviewedAnalysis.created_at)}</span>}</div>
            </div>}
          </section>
          <section className="mt-8"><h3 className="text-base font-bold">Recovery action history</h3>{selectedActions.length === 0 ? <p className="mt-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No recovery actions have been recorded for this payment.</p> : <ol className="mt-3 space-y-3">{selectedActions.map((action) => <li key={action.id} className="border-l-2 border-amber-400 pl-4"><p className="text-sm font-semibold">{action.action_type === 'ai_recommendation_reviewed' ? 'AI recommendation reviewed' : 'Marked for review'}</p>{action.note && <p className="mt-1 text-sm text-slate-600">{action.note}</p>}<time className="mt-1 block text-xs text-slate-500">{formatDate(action.created_at)}</time></li>)}</ol>}</section>
        </aside>
      </div>}
    </main>
  );
}
