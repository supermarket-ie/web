'use client';
import { useState } from 'react';
import { storeDisplayName } from '@/lib/store-utils';

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

// ─── Derived recommendation from store_totals ────────────────────────────────
//
// This is the reliable path: the agent always saves store_totals to the DB
// and embeds them in the list text. We compute the split recommendation
// from that data directly rather than relying on the LLM to emit markers.
//
// Logic:
//   1. Find the cheapest single store (lowest total)
//   2. Find the second store with the biggest gap vs cheapest
//   3. If gap > €5 and total basket > €40 → recommend split
//   4. Otherwise → recommend single store

export interface StoreTotalInput {
  store: string;
  total: number;
  items?: number;
}

export function deriveRecommendation(storeTotals: StoreTotalInput[]): StoreRecommendation {
  if (!storeTotals || storeTotals.length < 2) return null;

  const sorted = [...storeTotals].sort((a, b) => a.total - b.total);
  const cheapest = sorted[0];
  const total = sorted.reduce((sum, s) => sum + s.total, 0) / sorted.length; // approx basket size

  // Find the store with the second-largest total that has meaningful savings
  // The "split" scenario: buy most things at main store, divert a few items elsewhere
  // We approximate this as: cheapest store for bulk + one other store that's cheaper on subset
  // Since we don't have per-item breakdown in store_totals, we use the gap between stores

  const secondCheapest = sorted[1];
  const savings = secondCheapest.total - cheapest.total;

  // Not worth recommending if basket is tiny or savings are marginal
  if (cheapest.total < 40) return null;
  if (savings < 5) {
    return {
      type: 'single',
      store: cheapest.store,
      total: cheapest.total,
      reason: savings > 0 ? `${storeDisplayName(secondCheapest.store)} is only €${savings.toFixed(2)} more — not worth a second trip` : undefined,
    };
  }

  // Split recommendation: main shop at cheapest, note the savings vs next best
  return {
    type: 'split',
    mainStore: cheapest.store,
    mainTotal: cheapest.total,
    mainItems: cheapest.items ?? 0,
    splitStore: secondCheapest.store,
    splitItems: [], // we don't have per-item data here — shown as general saving
    splitTotal: secondCheapest.total,
    savings,
  };
}

// ─── Store Badge Colors ─────────────────────────────────────────────────

function getStoreBadgeStyle(store: string) {
  switch (store.toLowerCase()) {
    case 'tesco':
      return { backgroundColor: 'rgb(30 58 138)', color: 'white' }; // bg-blue-900
    case 'dunnes':
      return { backgroundColor: 'rgb(185 28 28)', color: 'white' }; // bg-red-700
    case 'supervalu':
      return { backgroundColor: 'rgb(22 101 52)', color: 'white' }; // bg-green-800
    case 'aldi':
      return { backgroundColor: 'rgb(30 64 175)', color: 'white' }; // bg-blue-800
    case 'lidl':
      return { backgroundColor: 'rgb(30 64 175)', color: 'white' }; // bg-blue-800
    default:
      return { backgroundColor: 'rgb(107 114 128)', color: 'white' }; // bg-gray-500
  }
}

// ─── Components ─────────────────────────────────────────────────────────

interface SplitRecommendationCardProps {
  recommendation: StoreRecommendation;
}

export function SplitRecommendationCard({ recommendation }: SplitRecommendationCardProps) {
  if (!recommendation) return null;

  // Single store — cleanest option, not worth splitting
  if (recommendation.type === 'single') {
    return (
      <div className="rounded-xl p-4 mb-4 border border-green-200" style={{ background: 'var(--surface-container-low)' }}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-green-600 font-semibold">✓</span>
          <span className="text-sm font-medium" style={{ color: 'var(--on-surface)' }}>
            Best value: one stop
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="px-3 py-1 rounded-full text-sm font-semibold" style={getStoreBadgeStyle(recommendation.store)}>
            {storeDisplayName(recommendation.store)}
          </span>
          <span className="font-bold text-lg" style={{ color: 'var(--on-surface)' }}>
            €{recommendation.total.toFixed(2)}
          </span>
        </div>
        {recommendation.reason && (
          <p className="text-xs mt-2" style={{ color: 'var(--on-surface-variant)', opacity: 0.75 }}>
            {recommendation.reason}
          </p>
        )}
      </div>
    );
  }

  // Split scenario — show cheapest vs next best with savings callout
  return (
    <div className="rounded-xl p-4 mb-4 border border-orange-200" style={{ background: 'var(--surface-container-low)' }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">🏪</span>
        <span className="text-sm font-semibold" style={{ color: 'var(--on-surface)' }}>
          Store comparison
        </span>
        <span className="ml-auto px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
          Save €{recommendation.savings.toFixed(2)}
        </span>
      </div>

      {/* Cheapest store */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="px-3 py-1 rounded-full text-sm font-semibold" style={getStoreBadgeStyle(recommendation.mainStore)}>
            {storeDisplayName(recommendation.mainStore)}
          </span>
          {recommendation.mainItems > 0 && (
            <span className="text-xs" style={{ color: 'var(--on-surface-variant)', opacity: 0.7 }}>
              {recommendation.mainItems} items
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="font-bold text-base" style={{ color: 'var(--on-surface)' }}>
            €{recommendation.mainTotal.toFixed(2)}
          </span>
          <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Cheapest</span>
        </div>
      </div>

      {/* Next store */}
      <div className="flex items-center justify-between mb-3 opacity-70">
        <div className="flex items-center gap-2">
          <span className="px-3 py-1 rounded-full text-sm font-semibold" style={getStoreBadgeStyle(recommendation.splitStore)}>
            {storeDisplayName(recommendation.splitStore)}
          </span>
        </div>
        <span className="font-medium text-base" style={{ color: 'var(--on-surface)' }}>
          €{recommendation.splitTotal.toFixed(2)}
        </span>
      </div>

      <p className="text-xs" style={{ color: 'var(--on-surface-variant)', opacity: 0.8 }}>
        Your list priced at each store's best available prices. Items are already assigned to the cheapest store above.
      </p>
    </div>
  );
}
// ─── Parser (exported for use in other components) ───────────────────────────

export function parseSplitRecommendation(content: string): StoreRecommendation {
  const splitMatch = content.match(/\[\[split\|([^\]]+)\]\]/);
  if (splitMatch) {
    const params = Object.fromEntries(
      splitMatch[1].split('|').map(p => p.split(':') as [string, string])
    );
    return {
      type: 'split',
      mainStore: params.mainStore,
      mainTotal: parseFloat(params.mainTotal),
      mainItems: parseInt(params.mainItems, 10),
      splitStore: params.splitStore,
      splitTotal: parseFloat(params.splitTotal),
      savings: parseFloat(params.savings),
      splitItems: params.splitItems ? params.splitItems.split(',').map(s => s.trim()) : [],
    };
  }
  const singleMatch = content.match(/\[\[single\|([^\]]+)\]\]/);
  if (singleMatch) {
    const params = Object.fromEntries(
      singleMatch[1].split('|').map(p => p.split(':') as [string, string])
    );
    return {
      type: 'single',
      store: params.store,
      total: parseFloat(params.total),
      reason: params.savings ? `Splitting only saves €${parseFloat(params.savings).toFixed(2)}, not worth the extra trip` : undefined,
    };
  }
  return null;
}
