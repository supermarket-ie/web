'use client';
import { useState, useEffect } from 'react';
import { storeDisplayName } from '@/lib/store-utils';
import type { RepriceResult } from '@/app/api/plan/reprice/route';

// ─── Types ──────────────────────────────────────────────────────────────

export interface StoreTotalInput {
  store: string;
  total: number;
  items?: number;
}

// ─── Store badge colours ─────────────────────────────────────────────────────

function getStoreBadgeStyle(store: string) {
  switch (store.toLowerCase()) {
    case 'tesco': return { backgroundColor: 'rgb(30 58 138)', color: 'white' };
    case 'dunnes': return { backgroundColor: 'rgb(185 28 28)', color: 'white' };
    case 'supervalu': return { backgroundColor: 'rgb(22 101 52)', color: 'white' };
    case 'aldi': return { backgroundColor: 'rgb(30 64 175)', color: 'white' };
    case 'lidl': return { backgroundColor: 'rgb(30 64 175)', color: 'white' };
    default: return { backgroundColor: 'rgb(107 114 128)', color: 'white' };
  }
}

// ─── Main component ──────────────────────────────────────────────────────────

interface StoreComparisonCardProps {
  token: string | null;
  listId?: string | null;
  storeTotals?: StoreTotalInput[]; // kept for prop-compat, ignored internally
}

export function StoreComparisonCard({ token, listId }: StoreComparisonCardProps) {
  const [result, setResult] = useState<RepriceResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate client-only state after mount
    setLoading(true);
    fetch('/api/plan/reprice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, list_id: listId ?? null }),
    })
      .then(r => r.json())
      .then(data => { if (!data.error) setResult(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token, listId]);

  if (loading) {
    return (
      <div className="rounded-xl p-4 mb-4 border" style={{ background: 'var(--surface-container-low)', borderColor: 'var(--outline-variant)' }}>
        <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--on-surface-variant)' }}>
          <span className="animate-pulse">🏪</span>
          <span>Comparing store prices…</span>
        </div>
      </div>
    );
  }

  if (!result) return null;

  const { bestSplitTotal, splitBreakdown, bestSingleStore, savings } = result;
  const worthSplitting = savings >= 3 && splitBreakdown.length > 1;

  return (
    <div className="rounded-xl p-4 mb-4 border" style={{
      background: 'var(--surface-container-low)',
      borderColor: worthSplitting ? 'rgba(234,179,8,0.3)' : 'rgba(34,197,94,0.25)',
    }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base">🏪</span>
        <span className="text-sm font-semibold" style={{ color: 'var(--on-surface)' }}>
          {worthSplitting ? 'Split shop saves you money' : 'Best store for your shop'}
        </span>
        {worthSplitting && (
          <span className="ml-auto px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
            Save €{Math.abs(savings).toFixed(2)}
          </span>
        )}
      </div>

      {worthSplitting ? (
        <>
          {/* Optimised split */}
          <div className="mb-3">
            <p className="text-xs mb-1.5" style={{ color: 'var(--on-surface-variant)', opacity: 0.7 }}>Your optimised split</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {splitBreakdown.map(s => (
                <div key={s.store} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium"
                  style={{ background: 'var(--surface-container)', color: 'var(--on-surface)' }}>
                  <span className="w-2 h-2 rounded-full inline-block" style={{ background: getStoreBadgeStyle(s.store).backgroundColor }} />
                  {storeDisplayName(s.store)}
                  <span className="font-bold">€{s.total.toFixed(2)}</span>
                  <span style={{ opacity: 0.6 }}>({s.items} items)</span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold" style={{ color: 'var(--on-surface)' }}>Total: €{bestSplitTotal.toFixed(2)}</span>
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Best value</span>
            </div>
          </div>

          {/* Single store alternative */}
          {bestSingleStore && (
            <div className="pt-2.5 border-t" style={{ borderColor: 'var(--outline-variant)' }}>
              <p className="text-xs mb-1.5" style={{ color: 'var(--on-surface-variant)', opacity: 0.7 }}>One stop only</p>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-full text-xs font-semibold" style={getStoreBadgeStyle(bestSingleStore.store)}>
                  {storeDisplayName(bestSingleStore.store)}
                </span>
                <span className="text-sm font-medium" style={{ color: 'var(--on-surface)' }}>€{bestSingleStore.total.toFixed(2)}</span>
                <span className="text-xs" style={{ color: 'var(--on-surface-variant)', opacity: 0.65 }}>€{Math.abs(savings).toFixed(2)} more than split</span>
              </div>
            </div>
          )}
        </>
      ) : (
        /* Single store — not worth splitting */
        <>
          {bestSingleStore && (
            <div className="flex items-center gap-3 mb-2">
              <span className="px-3 py-1 rounded-full text-sm font-semibold" style={getStoreBadgeStyle(bestSingleStore.store)}>
                {storeDisplayName(bestSingleStore.store)}
              </span>
              <span className="font-bold text-lg" style={{ color: 'var(--on-surface)' }}>€{bestSingleStore.total.toFixed(2)}</span>
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Cheapest</span>
            </div>
          )}
          <p className="text-xs" style={{ color: 'var(--on-surface-variant)', opacity: 0.75 }}>
            {savings > 0 && savings < 3
              ? `Splitting saves less than €3 — not worth the extra trip`
              : `Items already at their cheapest stores`}
          </p>
        </>
      )}
    </div>
  );
}
