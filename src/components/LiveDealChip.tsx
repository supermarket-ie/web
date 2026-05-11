'use client';

import { useState, useEffect } from 'react';
import { storeDisplayName } from '@/lib/store-utils';

interface PromotionDeal {
  product_name: string;
  store: string;
  price: number;
  was_price: number;
  saving: number;
  category?: string;
}

// Categories that make sense as a hero deal on a grocery site
const HERO_CATEGORIES = new Set([
  'Dairy', 'Meat', 'Vegetables', 'Fruit', 'Bakery', 'Snacks',
  'Beverages', 'Breakfast', 'Tinned', 'Frozen', 'Fish',
  'Pasta & Rice', 'Chilled',
]);

// Fallback: keywords that suggest a relatable grocery deal
const GROCERY_KEYWORDS = [
  'milk', 'butter', 'cheese', 'bread', 'chicken', 'beef', 'pork', 'lamb',
  'rice', 'pasta', 'cereal', 'juice', 'coffee', 'tea', 'yogurt', 'yoghurt',
  'eggs', 'bacon', 'sausage', 'ham', 'fish', 'salmon', 'cod', 'pizza',
  'chips', 'biscuit', 'chocolate', 'crisp', 'bean', 'tomato', 'soup',
  'apple', 'banana', 'orange', 'strawberry', 'potato', 'onion', 'carrot',
];

function isGroceryDeal(deal: PromotionDeal): boolean {
  if (deal.category && HERO_CATEGORIES.has(deal.category)) return true;
  const name = deal.product_name.toLowerCase();
  return GROCERY_KEYWORDS.some(kw => name.includes(kw));
}

export function LiveDealChip() {
  const [bestDeal, setBestDeal] = useState<PromotionDeal | null>(null);

  useEffect(() => {
    fetch('/api/promotions')
      .then(res => res.json())
      .then((deals: PromotionDeal[]) => {
        if (!Array.isArray(deals) || deals.length === 0) return;

        // Filter to grocery-relevant deals only
        const groceryDeals = deals.filter(isGroceryDeal);
        const pool = groceryDeals.length > 0 ? groceryDeals : deals;

        // Pick the deal with the highest percentage saving (more relatable than absolute)
        const topDeal = pool.reduce((best, current) => {
          const bestPct = best.was_price > 0 ? best.saving / best.was_price : 0;
          const currPct = current.was_price > 0 ? current.saving / current.was_price : 0;
          return currPct > bestPct ? current : best;
        });

        setBestDeal(topDeal);
      })
      .catch(() => {});
  }, []);

  if (!bestDeal) return null;

  const percentageSaving = Math.round((bestDeal.saving / bestDeal.was_price) * 100);

  // Clean up product name — strip brand prefixes like "Dunnes Stores" for brevity
  let displayName = bestDeal.product_name
    .replace(/^Dunnes Stores\s+/i, '')
    .replace(/^Tesco\s+/i, '')
    .replace(/^SuperValu\s+/i, '');

  // Truncate if too long
  if (displayName.length > 40) {
    displayName = displayName.slice(0, 37) + '...';
  }

  return (
    <div
      className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold"
      style={{
        background: 'var(--primary-fixed)',
        color: 'var(--on-primary-container)'
      }}
    >
      <span className="animate-pulse">🔥</span>
      <span>
        {displayName} down {percentageSaving}% at {storeDisplayName(bestDeal.store)} this week
      </span>
    </div>
  );
}
