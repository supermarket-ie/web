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

export function CheckoutRuntimePreview({ retailer, listId }: { retailer: string; listId: string }) {
  const [plan, setPlan] = useState<RuntimePlan | null>(null);
  const [unmatchedItems, setUnmatchedItems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

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
        <button
          type="button"
          disabled={!plan.launchEnabled}
          className="mt-4 w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          Shop this basket
        </button>
      </div>
    </div>
  );
}
