'use client';

import { useState, useEffect, useCallback } from 'react';
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

function formatDeal(deal: PromotionDeal) {
  const pct = Math.round((deal.saving / deal.was_price) * 100);
  let name = deal.product_name
    .replace(/^Dunnes Stores\s+/i, '')
    .replace(/^Tesco\s+/i, '')
    .replace(/^SuperValu\s+/i, '');
  if (name.length > 40) name = name.slice(0, 37) + '...';
  return { name, pct, store: storeDisplayName(deal.store) };
}

export function LiveDealChip() {
  const [deals, setDeals] = useState<PromotionDeal[]>([]);
  const [index, setIndex] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    fetch('/api/promotions')
      .then(res => res.json())
      .then((data: PromotionDeal[]) => {
        if (!Array.isArray(data) || data.length === 0) return;

        const groceryDeals = data.filter(isGroceryDeal);
        const pool = groceryDeals.length > 0 ? groceryDeals : data;

        // Sort by % saving descending, take top 5 for rotation
        const sorted = [...pool]
          .filter(d => d.was_price > 0 && d.saving > 0)
          .sort((a, b) => (b.saving / b.was_price) - (a.saving / a.was_price))
          .slice(0, 5);

        if (sorted.length > 0) {
          // Random start position so each page load shows a different deal
          setIndex(Math.floor(Math.random() * sorted.length));
          setDeals(sorted);
        }
      })
      .catch(() => {});
  }, []);

  // Rotate every 5 seconds
  const rotate = useCallback(() => {
    if (deals.length <= 1) return;
    setFading(true);
    setTimeout(() => {
      setIndex(i => (i + 1) % deals.length);
      setFading(false);
    }, 300);
  }, [deals.length]);

  useEffect(() => {
    if (deals.length <= 1) return;
    const iv = setInterval(rotate, 5000);
    return () => clearInterval(iv);
  }, [deals.length, rotate]);

  if (deals.length === 0) return null;

  const deal = deals[index];
  const { name, pct, store } = formatDeal(deal);

  return (
    <div
      className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-opacity duration-300"
      style={{
        background: 'var(--primary-fixed)',
        color: 'var(--on-primary-container)',
        opacity: fading ? 0 : 1,
      }}
    >
      <span className="animate-pulse">🔥</span>
      <span>
        {name} down {pct}% at {store} this week
      </span>
    </div>
  );
}
