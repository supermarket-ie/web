'use client';

import { useEffect, useState } from 'react';
import { trackEvent } from '@/lib/analytics';

type RuntimePlan = {
  retailer: string;
  state: 'prepared';
  mappedItemCount: number;
  totalItemCount: number;
  approximateValue: number;
  launchEnabled: boolean;
  launchBlocker: 'provider_not_configured' | 'retailer_runtime_unproven' | null;
  items: Array<{ retailerProductId: string; retailerProductName: string; quantity: number; price: number }>;
};

type RuntimeSession = {
  id: string;
  retailer: string;
  state: 'awaiting_shopper_auth' | 'awaiting_store_context' | 'populating_trolley' | 'trolley_ready' | 'failed' | 'expired';
  expires_at: string;
  verified_item_count: number | null;
  failure_code: string | null;
};

export function CheckoutRuntimePreview({ retailer, listId }: { retailer: string; listId: string }) {
  const [plan, setPlan] = useState<RuntimePlan | null>(null);
  const [unmatchedItems, setUnmatchedItems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<RuntimeSession | null>(null);
  const [launching, setLaunching] = useState(false);
  const [advancing, setAdvancing] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/checkout/runtime/prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list_id: listId, retailer }),
      signal: controller.signal,
    })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Could not prepare checkout');
        return body as { plan: RuntimePlan; unmatchedItems: string[] };
      })
      .then(result => {
        setPlan(result.plan);
        setUnmatchedItems(result.unmatchedItems);
        trackEvent('handoff_items_mapped', {
          retailer,
          mapped_item_count: result.plan.mappedItemCount,
          total_item_count: result.plan.totalItemCount,
          approximate_value: result.plan.approximateValue,
          execution_method: 'controlled_browser',
        }, '__cookie__');
      })
      .catch(fetchError => {
        if (fetchError instanceof DOMException && fetchError.name === 'AbortError') return;
        setError(fetchError instanceof Error ? fetchError.message : 'Could not prepare checkout');
      });

    return () => controller.abort();
  }, [listId, retailer]);

  useEffect(() => {
    if (!session || ['trolley_ready', 'failed', 'expired'].includes(session.state)) return;
    const timer = window.setInterval(() => {
      fetch(`/api/checkout/runtime/session/${encodeURIComponent(session.id)}`, { cache: 'no-store' })
        .then(response => response.ok ? response.json() : null)
        .then(result => result?.session && setSession(result.session))
        .catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [session]);

  async function launchSession() {
    setLaunching(true);
    setError(null);
    try {
      const response = await fetch('/api/checkout/runtime/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ list_id: listId, retailer }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Could not open retailer session');
      setSession(body.session);
    } catch (launchError) {
      setError(launchError instanceof Error ? launchError.message : 'Could not open retailer session');
    } finally {
      setLaunching(false);
    }
  }

  async function advanceSession() {
    if (!session) return;
    setAdvancing(true);
    setError(null);
    try {
      let current = session;
      for (let step = 0; step < plan!.mappedItemCount + 2; step += 1) {
        const response = await fetch(`/api/checkout/runtime/session/${encodeURIComponent(current.id)}`, { method: 'POST' });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Could not prepare retailer trolley');
        current = body.session;
        setSession(current);
        if (current.state !== 'populating_trolley') break;
      }
    } catch (advanceError) {
      setError(advanceError instanceof Error ? advanceError.message : 'Could not prepare retailer trolley');
    } finally {
      setAdvancing(false);
    }
  }

  async function closeSession() {
    if (!session) return;
    await fetch(`/api/checkout/runtime/session/${encodeURIComponent(session.id)}`, { method: 'DELETE' }).catch(() => undefined);
    setSession(null);
  }

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!plan) return <p className="text-sm text-slate-600">Preparing your retailer basket…</p>;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">Your SuperValu basket is mapped</p>
            <p className="mt-1 text-sm text-slate-600">
              {plan.mappedItemCount}/{plan.totalItemCount} items · approximately €{plan.approximateValue.toFixed(2)}
            </p>
          </div>
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">Prepared</span>
        </div>

        <ul className="mt-4 divide-y divide-slate-100">
          {plan.items.map(item => (
            <li key={item.retailerProductId} className="flex justify-between gap-4 py-3 text-sm">
              <span className="text-slate-800">{item.quantity} × {item.retailerProductName}</span>
              <span className="font-medium text-slate-900">€{(item.price * item.quantity).toFixed(2)}</span>
            </li>
          ))}
        </ul>
      </div>

      {unmatchedItems.length > 0 && (
        <p className="text-sm text-amber-800">{unmatchedItems.length} item{unmatchedItems.length === 1 ? '' : 's'} could not yet be mapped to SuperValu.</p>
      )}

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <p className="font-semibold text-slate-900">
          {plan.launchEnabled ? 'Ready to open SuperValu' : 'Checkout runtime pilot'}
        </p>
        <p className="mt-1 text-sm text-slate-600">
          {plan.launchBlocker === 'provider_not_configured'
            ? 'Authenticated trolley preparation is proven. The temporary interactive-browser provider still needs to be connected before this can be offered to shoppers.'
            : plan.launchBlocker === 'retailer_runtime_unproven'
              ? 'This retailer does not yet have a proven controlled-browser runtime.'
              : 'You will sign in directly with SuperValu, then we will prepare and verify the trolley.'}
        </p>
        {!session && (
          <button
            type="button"
            disabled={!plan.launchEnabled || launching}
            onClick={launchSession}
            className="mt-4 w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {launching ? 'Opening secure retailer session…' : 'Shop this basket'}
          </button>
        )}
      </div>

      {session && (
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-slate-900">
                {session.state === 'trolley_ready' ? 'SuperValu trolley verified' : 'Secure SuperValu session'}
              </p>
              <p className="text-xs text-slate-500">This temporary browser expires at {new Date(session.expires_at).toLocaleTimeString()}.</p>
            </div>
            <button type="button" onClick={closeSession} className="text-sm font-semibold text-slate-600">Close</button>
          </div>

          {!['trolley_ready', 'failed', 'expired'].includes(session.state) && (
            <iframe
              title="Secure SuperValu checkout session"
              src={`/api/checkout/runtime/session/${encodeURIComponent(session.id)}/view`}
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
              allow="clipboard-read; clipboard-write"
              referrerPolicy="no-referrer"
              className="h-[620px] w-full rounded-xl border border-slate-200"
            />
          )}

          {(session.state === 'awaiting_shopper_auth' || session.state === 'awaiting_store_context') && (
            <button
              type="button"
              disabled={advancing}
              onClick={advanceSession}
              className="w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white disabled:bg-slate-300"
            >
              {advancing ? 'Checking and preparing…' : 'I have signed in — prepare my trolley'}
            </button>
          )}

          {session.state === 'populating_trolley' && (
            <p className="text-sm text-slate-600">Preparing and verifying the retailer trolley…</p>
          )}
          {session.state === 'trolley_ready' && (
            <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">
              <p className="font-semibold">{session.verified_item_count} products were verified in the live SuperValu trolley.</p>
              <a
                href={`/api/checkout/runtime/session/${encodeURIComponent(session.id)}/view`}
                target="_blank"
                rel="noreferrer"
                onClick={() => trackEvent('retailer_checkout_opened', {
                  retailer,
                  checkout_runtime_session_id: session.id,
                  execution_method: 'controlled_browser',
                }, '__cookie__')}
                className="mt-3 inline-flex rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white"
              >
                Continue with SuperValu
              </a>
            </div>
          )}
          {session.state === 'failed' && (
            <p className="rounded-xl bg-red-50 p-4 text-sm text-red-800">The trolley could not be verified. The temporary session has been closed.</p>
          )}
          {session.state === 'expired' && (
            <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">The temporary retailer session expired and was closed.</p>
          )}
        </div>
      )}
    </div>
  );
}
