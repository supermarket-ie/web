'use client';

import { useState } from 'react';
import { NutritionPill } from './NutritionPill';
import { storeStyle, storeDisplayName } from '@/lib/store-utils';
import type { ListItem } from '@/lib/list-generator';

function fmt(price: number) { return `€${price.toFixed(2)}`; }

export function ProductCard({
  item, removed, onRemove, onRestore, onStoreSwap,
}: {
  item: ListItem;
  removed: boolean;
  onRemove: (id: string) => void;
  onRestore: (id: string) => void;
  onStoreSwap: (productId: string, store: string) => void;
}) {
  const [showNutrition, setShowNutrition] = useState(false);
  const style = storeStyle(item.best_store);

  if (removed) {
    return (
      <div className="py-3 last:pb-0" style={{ opacity: 0.45 }}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm line-through" style={{ color: 'var(--on-surface)' }}>{item.canonical_name}</span>
          <button onClick={() => onRestore(item.product_id)}
            className="text-xs font-semibold hover:underline flex-shrink-0"
            style={{ color: 'var(--primary)' }}>
            Restore
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="py-3 last:pb-0">
      <div className="flex items-start gap-2">
        {/* Remove button */}
        <button onClick={() => onRemove(item.product_id)}
          className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center transition-all group"
          style={{ border: '2px solid var(--surface-container-high)' }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
          onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--surface-container-high)')}
          aria-label={`Remove ${item.canonical_name}`}
          title="Remove item">
          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 10 10" style={{ color: 'var(--outline-variant)' }}>
            <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm leading-snug" style={{ color: 'var(--on-background)' }}>
                {item.canonical_name}
                {item.quantity > 1 && (
                  <span className="font-normal ml-1" style={{ color: 'var(--on-surface)' }}>×{item.quantity}</span>
                )}
              </p>
              {item.best_store_product_name && item.best_store_product_name !== item.canonical_name && (
                <p className="text-[11px] mt-0.5 leading-snug truncate" style={{ color: 'var(--on-surface-variant)' }}>
                  {item.best_store_product_name}
                </p>
              )}
            </div>

            <div className="flex items-center gap-1.5 flex-shrink-0">
              {/* Store badge — tappable to cycle stores */}
              <button
                onClick={() => {
                  const stores = item.all_prices.map(p => p.store);
                  const curr = stores.indexOf(item.best_store);
                  const next = stores[(curr + 1) % stores.length];
                  onStoreSwap(item.product_id, next);
                }}
                className="text-[10px] font-bold px-1.5 py-0.5 rounded transition hover:opacity-80 active:scale-95"
                style={{ background: style.bg, color: style.text }}
                title={item.store_overridden ? 'Your choice (tap to change)' : 'Cheapest store (tap to change)'}>
                {storeDisplayName(item.best_store)}{item.store_overridden ? ' ✎' : ''}
              </button>
              <span className="font-extrabold text-sm price" style={{ color: 'var(--on-background)' }}>
                {item.quantity > 1 ? fmt(item.best_price_total) : fmt(item.best_price)}
              </span>
            </div>
          </div>

          {/* Cross-store price comparison */}
          {item.all_prices.length > 1 && (
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
              {item.all_prices.map(sp => {
                const isBest = sp.store === item.best_store;
                const name = storeDisplayName(sp.store);
                const abbr = name === 'SuperValu' ? 'SV' : name.slice(0, 1);
                const spStyle = storeStyle(sp.store);
                return (
                  <span key={sp.store} className="text-[11px] flex items-center gap-0.5" style={{ color: 'var(--on-surface)' }}>
                    <span className="font-semibold" style={{ color: spStyle.bg }}>{abbr}</span>
                    {sp.store_url
                      ? <a href={sp.store_url} target="_blank" rel="noopener noreferrer" className="hover:underline" title={sp.store_product_name}>{fmt(sp.price)}</a>
                      : <span>{fmt(sp.price)}</span>}
                    {isBest && <span style={{ color: 'var(--primary)' }}>✓</span>}
                  </span>
                );
              })}
            </div>
          )}

          {/* Nutrition info */}
          {item.nutrition && (
            <div className="mt-2">
              <button onClick={() => setShowNutrition(v => !v)}
                className="text-[10px] flex items-center gap-1 transition-colors"
                style={{ color: 'var(--on-surface-variant)' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--on-surface)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--on-surface-variant)')}>
                <span>{showNutrition ? '▲' : '▼'}</span>
                <span>Nutrition per 100g</span>
              </button>
              {showNutrition && (
                <div className="mt-2 flex gap-1.5 flex-wrap">
                  <NutritionPill label="Cal"     value={item.nutrition.calories} unit="kcal" />
                  <NutritionPill label="Protein" value={item.nutrition.protein}  unit="g" />
                  <NutritionPill label="Carbs"   value={item.nutrition.carbs}    unit="g" />
                  <NutritionPill label="Fat"     value={item.nutrition.fat}      unit="g" />
                  <NutritionPill label="Sugar"   value={item.nutrition.sugar}    unit="g" />
                  {item.nutrition.fibre != null && <NutritionPill label="Fibre" value={item.nutrition.fibre} unit="g" />}
                  {item.nutrition.salt  != null && item.nutrition.salt < 20 && <NutritionPill label="Salt" value={item.nutrition.salt} unit="g" />}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
