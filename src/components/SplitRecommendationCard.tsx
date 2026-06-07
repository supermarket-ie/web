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
  const [selectedMode, setSelectedMode] = useState<'split' | 'single'>('split');

  if (!recommendation) return null;

  // Single store recommendation
  if (recommendation.type === 'single') {
    return (
      <div className="rounded-xl p-4 mb-4 border border-green-200" style={{ background: 'var(--surface-container-low)' }}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-green-600 font-semibold">✓</span>
          <span className="text-sm font-medium" style={{ color: 'var(--on-surface)' }}>
            Best value: one stop shopping
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span
              className="px-3 py-1 rounded-full text-sm font-semibold"
              style={getStoreBadgeStyle(recommendation.store)}
            >
              {storeDisplayName(recommendation.store)}
            </span>
            <span className="font-bold text-lg" style={{ color: 'var(--on-surface)' }}>
              €{recommendation.total.toFixed(2)}
            </span>
          </div>
        </div>

        {recommendation.reason && (
          <p className="text-xs mt-2 opacity-70" style={{ color: 'var(--on-surface-variant)' }}>
            {recommendation.reason}
          </p>
        )}
      </div>
    );
  }

  // Split shop recommendation
  return (
    <div className="rounded-xl p-4 mb-4 border border-orange-200" style={{ background: 'var(--surface-container-low)' }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-orange-600 font-semibold">💡</span>
        <span className="text-sm font-medium" style={{ color: 'var(--on-surface)' }}>
          Smart split shopping
        </span>
        <span className="ml-auto px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
          Save €{recommendation.savings.toFixed(2)}
        </span>
      </div>

      {/* Main store */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium opacity-70" style={{ color: 'var(--on-surface-variant)' }}>
            Main shop
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span
            className="px-3 py-1 rounded-full text-sm font-semibold"
            style={getStoreBadgeStyle(recommendation.mainStore)}
          >
            {storeDisplayName(recommendation.mainStore)}
          </span>
          <span className="font-bold" style={{ color: 'var(--on-surface)' }}>
            €{recommendation.mainTotal.toFixed(2)}
          </span>
          <span className="text-sm opacity-70" style={{ color: 'var(--on-surface-variant)' }}>
            {recommendation.mainItems} items
          </span>
        </div>
      </div>

      {/* Split store */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium opacity-70" style={{ color: 'var(--on-surface-variant)' }}>
            Quick pickup
          </span>
        </div>
        <div className="flex items-center gap-3 mb-2">
          <span
            className="px-3 py-1 rounded-full text-sm font-semibold"
            style={getStoreBadgeStyle(recommendation.splitStore)}
          >
            {storeDisplayName(recommendation.splitStore)}
          </span>
          <span className="font-bold" style={{ color: 'var(--on-surface)' }}>
            €{recommendation.splitTotal.toFixed(2)}
          </span>
        </div>
        {recommendation.splitItems.length > 0 && (
          <div className="text-xs opacity-70" style={{ color: 'var(--on-surface-variant)' }}>
            {recommendation.splitItems.join(', ')}
          </div>
        )}
      </div>

      {/* Toggle buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => setSelectedMode('single')}
          className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
            selectedMode === 'single'
              ? 'bg-gray-200 text-gray-800'
              : 'bg-transparent border border-gray-300 text-gray-600 hover:bg-gray-50'
          }`}
        >
          One stop
        </button>
        <button
          onClick={() => setSelectedMode('split')}
          className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
            selectedMode === 'split'
              ? 'bg-orange-100 text-orange-800 border border-orange-300'
              : 'bg-transparent border border-gray-300 text-gray-600 hover:bg-gray-50'
          }`}
        >
          Split ✓
        </button>
      </div>
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
