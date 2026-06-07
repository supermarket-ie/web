'use client';
import { useState, useEffect } from 'react';
import { storeDisplayName } from '@/lib/store-utils';
import type { RepriceResult } from '@/app/api/plan/reprice/route';

// ─── Types ──────────────────────────────────────────────────────────────

interface SplitRecommendation {
  type: 'split';
  mainStore: string;
  mainTotal: number;
  mainItems: number;
  splitStore: string;
  splitItems: string[];
  splitTotal: number;
  savings: number;
}

interface SingleRecommendation {
  type: 'single';
  store: string;
  total: number;
  reason?: string;
}

export type StoreRecommendation = SplitRecommendation | SingleRecommendation | null;

export interface StoreTotalInput {
  store: string;
  total: number;
  items?: number;
}

// ─── Legacy derived recommendation (fallback when no reprice data) ───────────

export function deriveRecommendation(storeTotals: StoreTotalInput[]): StoreRecommendation {
  if (!storeTotals || storeTotals.length < 2) return null;
  const sorted = [...storeTotals].sort((a, b) => a.total - b.total);
  const cheapest = sorted[0];
  const secondCheapest = sorted[1];
  const savings = secondCheapest.total - cheapest.total;
  if (cheapest.total < 40) return null;
  if (savings < 5) {
    return {
      type: 'single', store: cheapest.store, total: cheapest.total,
      reason: savings > 0 ? `${storeDisplayName(secondCheapest.store)} is only €${savings.toFixed(2)} more` : undefined,
    };
  }
  return {
    type: 'split', mainStore: cheapest.store, mainTotal: cheapest.total,
    mainItems: cheapest.items ?? 0, splitStore: secondCheapest.store,
    splitItems: [], splitTotal: secondCheapest.total, savings,
  };
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
  storeTotals?: StoreTotalInput[];
}

export function StoreComparisonCard({ token, listId, storeTotals }: StoreComparisonCardProps) {
  const [result, setResult] = useState<RepriceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!token) return;
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

  // Fallback to derived recommendation if reprice hasn't loaded
  if (!result) {
    if (!storeTotals || storeTotals.length < 2) return null;
    const fallback = deriveRecommendation(storeTotals);
    if (!fallback) return null;
    return <SplitRecommendationCard recommendation={fallback} />;
  }

  const { bestSplitTotal, splitBreakdown, singleStoreTotals, bestSingleStore, savings } = result;
  const worthSplitting = savings >= 3 && splitBreakdown.length > 1;

  return (
    <div className="rounded-xl p-4 mb-4 border" style={{
      background: 'var(--surface-container-low)',
      borderColor: worthSplitting ? 'rgba(234,179,8,0.3)' : 'rgba(34,197,94,0.25)',
    }}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base">🏪</span>
        <span className="text-sm font-semibold" style={{ color: 'var(--on-surface)' }}>
          {worthSplitting ? 'Split shop saves you money' : 'Best store for your shop'}
        </span>
        {worthSplitting && (
          <span className="ml-auto px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
            Save €{savings.toFixed(2)}
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
                <span className="text-xs" style={{ color: 'var(--on-surface-variant)', opacity: 0.65 }}>€{savings.toFixed(2)} more than split</span>
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
            {savings < 3 ? `Splitting across stores saves less than €3 — not worth the extra trip` : `Items already at their cheapest stores`}
          </p>
        </>
      )}

      {/* All stores toggle */}
      {singleStoreTotals.length > 1 && (
        <button onClick={() => setShowAll(v => !v)} className="mt-3 text-xs underline" style={{ color: 'var(--on-surface-variant)', opacity: 0.6 }}>
          {showAll ? 'Hide' : 'See all store prices'}
        </button>
      )}
      {showAll && (
        <div className="mt-2 space-y-1.5">
          {singleStoreTotals.map(s => (
            <div key={s.store} className="flex items-center justify-between text-xs" style={{ color: 'var(--on-surface-variant)' }}>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={getStoreBadgeStyle(s.store)}>
                  {storeDisplayName(s.store)}
                </span>
                {s.itemsMissing > 0 && <span className="opacity-60">{s.itemsMissing} items not stocked</span>}
              </div>
              <span className="font-medium">€{s.total.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Legacy card (backwards compat) ─────────────────────────────────────────

export function SplitRecommendationCard({ recommendation }: { recommendation: StoreRecommendation }) {
  if (!recommendation) return null;
  if (recommendation.type === 'single') {
    return (
      <div className="rounded-xl p-4 mb-4 border border-green-200" style={{ background: 'var(--surface-container-low)' }}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-green-600 font-semibold">✓</span>
          <span className="text-sm font-medium" style={{ color: 'var(--on-surface)' }}>Best value: one stop</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="px-3 py-1 rounded-full text-sm font-semibold" style={getStoreBadgeStyle(recommendation.store)}>
            {storeDisplayName(recommendation.store)}
          </span>
          <span className="font-bold text-lg" style={{ color: 'var(--on-surface)' }}>€{recommendation.total.toFixed(2)}</span>
        </div>
        {recommendation.reason && <p className="text-xs mt-2" style={{ color: 'var(--on-surface-variant)', opacity: 0.75 }}>{recommendation.reason}</p>}
      </div>
    );
  }
  return (
    <div className="rounded-xl p-4 mb-4 border border-orange-200" style={{ background: 'var(--surface-container-low)' }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">🏪</span>
        <span className="text-sm font-semibold" style={{ color: 'var(--on-surface)' }}>Store comparison</span>
        <span className="ml-auto px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">Save €{recommendation.savings.toFixed(2)}</span>
      </div>
      <div className="flex items-center justify-between mb-2">
        <span className="px-3 py-1 rounded-full text-sm font-semibold" style={getStoreBadgeStyle(recommendation.mainStore)}>{storeDisplayName(recommendation.mainStore)}</span>
        <div className="flex items-center gap-2">
          <span className="font-bold text-base" style={{ color: 'var(--on-surface)' }}>€{recommendation.mainTotal.toFixed(2)}</span>
          <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Cheapest</span>
        </div>
      </div>
      <div className="flex items-center justify-between opacity-70">
        <span className="px-3 py-1 rounded-full text-sm font-semibold" style={getStoreBadgeStyle(recommendation.splitStore)}>{storeDisplayName(recommendation.splitStore)}</span>
        <span className="font-medium text-base" style={{ color: 'var(--on-surface)' }}>€{recommendation.splitTotal.toFixed(2)}</span>
      </div>
    </div>
  );
}

// ─── Parser (backwards compat) ───────────────────────────────────────────────

export function parseSplitRecommendation(content: string): StoreRecommendation {
  const splitMatch = content.match(/\[\[split\|([^\]]+)\]\]/);
  if (splitMatch) {
    const params = Object.fromEntries(splitMatch[1].split('|').map(p => p.split(':') as [string, string]));
    return {
      type: 'split', mainStore: params.mainStore, mainTotal: parseFloat(params.mainTotal),
      mainItems: parseInt(params.mainItems, 10), splitStore: params.splitStore,
      splitTotal: parseFloat(params.splitTotal), savings: parseFloat(params.savings),
      splitItems: params.splitItems ? params.splitItems.split(',').map(s => s.trim()) : [],
    };
  }
  const singleMatch = content.match(/\[\[single\|([^\]]+)\]\]/);
  if (singleMatch) {
    const params = Object.fromEntries(singleMatch[1].split('|').map(p => p.split(':') as [string, string]));
    return { type: 'single', store: params.store, total: parseFloat(params.total) };
  }
  return null;
}
