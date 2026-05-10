'use client';

import { useState, useEffect } from 'react';
import { storeDisplayName } from '@/lib/store-utils';

interface PromotionDeal {
  product_name: string;
  store: string;
  price: number;
  was_price: number;
  saving: number;
}

export function LiveDealChip() {
  const [bestDeal, setBestDeal] = useState<PromotionDeal | null>(null);

  useEffect(() => {
    // Fetch promotions and find the biggest saving
    fetch('/api/promotions')
      .then(res => res.json())
      .then((deals: PromotionDeal[]) => {
        if (Array.isArray(deals) && deals.length > 0) {
          // Find the deal with the highest absolute saving
          const topDeal = deals.reduce((best, current) =>
            current.saving > best.saving ? current : best
          );
          setBestDeal(topDeal);
        }
      })
      .catch(() => {
        // Fail silently if promotions can't be fetched
      });
  }, []);

  if (!bestDeal) {
    return null;
  }

  // Calculate percentage savings
  const percentageSaving = Math.round((bestDeal.saving / bestDeal.was_price) * 100);

  return (
    <div
      className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold"
      style={{
        background: 'var(--primary-fixed)',
        color: 'var(--on-primary-container)'
      }}
    >
      <span
        className="animate-pulse"
        style={{
          animation: 'pulse 2s infinite'
        }}
      >
        🔥
      </span>
      <span>
        {bestDeal.product_name} down {percentageSaving}% at {storeDisplayName(bestDeal.store)} this week
      </span>
    </div>
  );
}