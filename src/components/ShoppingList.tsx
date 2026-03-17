'use client';

import { useState, useEffect, useCallback } from 'react';
import type { ListItem } from '@/lib/list-generator';

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(price: number) {
  return `€${price.toFixed(2)}`;
}

function storeDisplayName(store: string) {
  const s = store.toLowerCase();
  if (s.includes('tesco'))     return 'Tesco';
  if (s.includes('dunnes'))    return 'Dunnes';
  if (s.includes('supervalu')) return 'SuperValu';
  return store;
}

function storeStyle(store: string) {
  const s = store.toLowerCase();
  if (s.includes('tesco'))     return { bg: '#003A8C', text: '#fff', light: '#EEF3FB' };
  if (s.includes('dunnes'))    return { bg: '#7B0017', text: '#fff', light: '#FAEAEC' };
  if (s.includes('supervalu')) return { bg: '#D4400F', text: '#fff', light: '#FEF0E8' };
  return { bg: '#636E72', text: '#fff', light: '#F5F5F5' };
}

const STORAGE_KEY = 'sm_removed_items';

function loadRemoved(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveRemoved(ids: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch { /* noop */ }
}

// ── sub-components ────────────────────────────────────────────────────────────

function NutritionPill({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="flex flex-col items-center bg-[#F7F3EF] rounded-lg px-2 py-1.5 min-w-[52px]">
      <span className="text-[10px] text-[#B2BEC3] font-medium leading-none mb-0.5">{label}</span>
      <span className="text-xs font-bold text-[#1D2324] leading-none">{value}</span>
      <span className="text-[9px] text-[#B2BEC3] leading-none">{unit}</span>
    </div>
  );
}

function ProductCard({
  item,
  removed,
  onRemove,
  onRestore,
}: {
  item: ListItem;
  removed: boolean;
  onRemove: (id: string) => void;
  onRestore: (id: string) => void;
}) {
  const [showNutrition, setShowNutrition] = useState(false);
  const style = storeStyle(item.best_store);

  if (removed) {
    return (
      <div className="py-3 border-b border-[#F0ECE8] last:border-0 opacity-50">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-[#636E72] line-through">{item.canonical_name}</span>
          <button
            onClick={() => onRestore(item.product_id)}
            className="text-xs text-[#E17055] font-semibold hover:underline flex-shrink-0"
          >
            Restore
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="py-3 border-b border-[#F0ECE8] last:border-0">
      {/* Main row */}
      <div className="flex items-start gap-2">
        {/* Remove button */}
        <button
          onClick={() => onRemove(item.product_id)}
          className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full border-2 border-[#DDD8D2] hover:border-[#E17055] hover:bg-[#FFF0EE] transition flex items-center justify-center group"
          title="Remove from list"
        >
          <svg className="w-2.5 h-2.5 text-[#DDD8D2] group-hover:text-[#E17055]" fill="none" viewBox="0 0 10 10">
            <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>

        <div className="flex-1 min-w-0">
          {/* Product name */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-[#1D2324] text-sm leading-snug">
                {item.canonical_name}
                {item.quantity > 1 && (
                  <span className="text-[#636E72] font-normal ml-1">×{item.quantity}</span>
                )}
              </p>
              {/* Store product name (actual product at cheapest store) */}
              {item.best_store_product_name && item.best_store_product_name !== item.canonical_name && (
                <p className="text-[11px] text-[#B2BEC3] mt-0.5 leading-snug truncate">
                  {item.best_store_product_name}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                style={{ background: style.bg, color: style.text }}
              >
                {storeDisplayName(item.best_store)}
              </span>
              <span className="font-bold text-[#1D2324] text-sm">
                {item.quantity > 1
                  ? `${fmt(item.best_price_total)}`
                  : fmt(item.best_price)}
              </span>
            </div>
          </div>

          {/* Price comparison row */}
          {item.all_prices.length > 1 && (
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
              {item.all_prices.map((sp) => {
                const isBest = sp.store === item.best_store;
                const name = storeDisplayName(sp.store);
                const abbr = name === 'SuperValu' ? 'SV' : name.slice(0, 1);
                const spStyle = storeStyle(sp.store);
                return (
                  <span key={sp.store} className="text-[11px] text-[#636E72] flex items-center gap-0.5">
                    <span className="font-semibold" style={{ color: spStyle.bg }}>{abbr}</span>
                    {sp.store_url ? (
                      <a
                        href={sp.store_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                        title={sp.store_product_name}
                      >
                        {fmt(sp.price)}
                      </a>
                    ) : (
                      <span>{fmt(sp.price)}</span>
                    )}
                    {isBest && <span className="text-[#5D9B8F]">✓</span>}
                  </span>
                );
              })}
            </div>
          )}

          {/* Nutrition toggle + panel */}
          {item.nutrition && (
            <div className="mt-2">
              <button
                onClick={() => setShowNutrition(v => !v)}
                className="text-[10px] text-[#B2BEC3] hover:text-[#636E72] transition flex items-center gap-1"
              >
                <span>{showNutrition ? '▲' : '▼'}</span>
                <span>Nutrition per 100g</span>
              </button>
              {showNutrition && (
                <div className="mt-2 flex gap-1.5 flex-wrap">
                  <NutritionPill label="Cal" value={item.nutrition.calories} unit="kcal" />
                  <NutritionPill label="Protein" value={item.nutrition.protein} unit="g" />
                  <NutritionPill label="Carbs" value={item.nutrition.carbs} unit="g" />
                  <NutritionPill label="Fat" value={item.nutrition.fat} unit="g" />
                  <NutritionPill label="Sugar" value={item.nutrition.sugar} unit="g" />
                  {item.nutrition.fibre != null && (
                    <NutritionPill label="Fibre" value={item.nutrition.fibre} unit="g" />
                  )}
                  {item.nutrition.salt != null && item.nutrition.salt < 20 && (
                    <NutritionPill label="Salt" value={item.nutrition.salt} unit="g" />
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── main export ───────────────────────────────────────────────────────────────

export function ShoppingList({
  items,
  grouped,
}: {
  items: ListItem[];
  grouped: [string, ListItem[]][];
}) {
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);

  // Load removed state from localStorage on mount
  useEffect(() => {
    setRemoved(loadRemoved());
    setHydrated(true);
  }, []);

  const handleRemove = useCallback((id: string) => {
    setRemoved(prev => {
      const next = new Set(prev);
      next.add(id);
      saveRemoved(next);
      return next;
    });
  }, []);

  const handleRestore = useCallback((id: string) => {
    setRemoved(prev => {
      const next = new Set(prev);
      next.delete(id);
      saveRemoved(next);
      return next;
    });
  }, []);

  const removedCount = removed.size;
  const activeItems = items.filter(i => !removed.has(i.product_id));

  // Category jump nav
  const categories = grouped.map(([cat]) => cat);

  if (!hydrated) {
    // SSR skeleton — just render static
    return (
      <div className="space-y-6">
        {grouped.map(([category, catItems]) => (
          <div key={category} id={`cat-${category.replace(/\s+/g, '-').toLowerCase()}`}>
            <h3 className="text-xs font-bold text-[#636E72] uppercase tracking-wider mb-2">{category}</h3>
            <div className="bg-white rounded-xl border border-[#E8E2DC] px-4">
              {catItems.map(item => (
                <ProductCard
                  key={item.product_id}
                  item={item}
                  removed={false}
                  onRemove={() => {}}
                  onRestore={() => {}}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      {/* Category jump nav */}
      {categories.length > 1 && (
        <div className="flex gap-2 flex-wrap mb-5">
          {categories.map(cat => (
            <a
              key={cat}
              href={`#cat-${cat.replace(/\s+/g, '-').toLowerCase()}`}
              className="text-xs font-medium px-3 py-1.5 rounded-full bg-white border border-[#E8E2DC] text-[#636E72] hover:border-[#E17055] hover:text-[#E17055] transition"
            >
              {cat}
            </a>
          ))}
        </div>
      )}

      {/* Removed items notice */}
      {removedCount > 0 && (
        <div className="mb-4 bg-[#FFF8F6] border border-[#FDDDD8] rounded-xl px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-sm text-[#636E72]">
            {removedCount} item{removedCount > 1 ? 's' : ''} removed from your list
          </p>
          <button
            onClick={() => {
              setRemoved(new Set());
              saveRemoved(new Set());
            }}
            className="text-xs text-[#E17055] font-semibold hover:underline flex-shrink-0"
          >
            Restore all
          </button>
        </div>
      )}

      {/* Product list by category */}
      <div className="space-y-6">
        {grouped.map(([category, catItems]) => (
          <div key={category} id={`cat-${category.replace(/\s+/g, '-').toLowerCase()}`}>
            <h3 className="text-xs font-bold text-[#636E72] uppercase tracking-wider mb-2">
              {category}
              {catItems.every(i => removed.has(i.product_id)) && (
                <span className="ml-2 font-normal normal-case text-[#B2BEC3]">(all removed)</span>
              )}
            </h3>
            <div className="bg-white rounded-xl border border-[#E8E2DC] px-4">
              {catItems.map(item => (
                <ProductCard
                  key={item.product_id}
                  item={item}
                  removed={removed.has(item.product_id)}
                  onRemove={handleRemove}
                  onRestore={handleRestore}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Item count */}
      <p className="text-center text-xs text-[#B2BEC3] mt-6">
        {activeItems.length} of {items.length} items · {grouped.length} categories
      </p>
    </>
  );
}
