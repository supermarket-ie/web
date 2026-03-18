'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { ListItem, FamilySize } from '@/lib/list-generator';

function fmt(price: number) { return `€${price.toFixed(2)}`; }

function storeDisplayName(store: string) {
  const s = store.toLowerCase();
  if (s.includes('tesco')) return 'Tesco';
  if (s.includes('dunnes')) return 'Dunnes';
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
const STORAGE_ADDED_KEY = 'sm_added_items';
const STORAGE_OVERRIDES_KEY = 'sm_store_overrides';

function loadLocal<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; } catch { return fallback; }
}
function saveLocal(key: string, val: unknown) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

const FAMILY_OPTIONS = [
  { value: '1',   label: 'Just me',    icon: '👤' },
  { value: '2',   label: 'Couple',     icon: '👥' },
  { value: '3-4', label: '3–4 people', icon: '👨‍👩‍👧' },
  { value: '5+',  label: '5+ people',  icon: '👨‍👩‍👧‍👦' },
];

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
  item, removed, onRemove, onRestore, onStoreSwap,
}: {
  item: ListItem; removed: boolean;
  onRemove: (id: string) => void; onRestore: (id: string) => void;
  onStoreSwap: (productId: string, store: string) => void;
}) {
  const [showNutrition, setShowNutrition] = useState(false);
  const style = storeStyle(item.best_store);

  if (removed) {
    return (
      <div className="py-3 border-b border-[#F0ECE8] last:border-0 opacity-50">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-[#636E72] line-through">{item.canonical_name}</span>
          <button onClick={() => onRestore(item.product_id)} className="text-xs text-[#E17055] font-semibold hover:underline flex-shrink-0">Restore</button>
        </div>
      </div>
    );
  }

  return (
    <div className="py-3 border-b border-[#F0ECE8] last:border-0">
      <div className="flex items-start gap-2">
        <button onClick={() => onRemove(item.product_id)}
          className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full border-2 border-[#DDD8D2] hover:border-[#E17055] hover:bg-[#FFF0EE] transition flex items-center justify-center group" title="Remove">
          <svg className="w-2.5 h-2.5 text-[#DDD8D2] group-hover:text-[#E17055]" fill="none" viewBox="0 0 10 10">
            <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-[#1D2324] text-sm leading-snug">
                {item.canonical_name}
                {item.quantity > 1 && <span className="text-[#636E72] font-normal ml-1">×{item.quantity}</span>}
              </p>
              {item.best_store_product_name && item.best_store_product_name !== item.canonical_name && (
                <p className="text-[11px] text-[#B2BEC3] mt-0.5 leading-snug truncate">{item.best_store_product_name}</p>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {/* Tappable store badge — cycles through stores */}
              <button
                onClick={() => {
                  const stores = item.all_prices.map(p => p.store);
                  const curr = stores.indexOf(item.best_store);
                  const next = stores[(curr + 1) % stores.length];
                  onStoreSwap(item.product_id, next);
                }}
                className="text-[10px] font-bold px-1.5 py-0.5 rounded transition hover:opacity-80 active:scale-95"
                style={{ background: style.bg, color: style.text }}
                title={item.store_overridden ? 'Your choice (tap to change)' : 'Cheapest store (tap to change)'}
              >
                {storeDisplayName(item.best_store)}{item.store_overridden ? ' ✎' : ''}
              </button>
              <span className="font-bold text-[#1D2324] text-sm">
                {item.quantity > 1 ? fmt(item.best_price_total) : fmt(item.best_price)}
              </span>
            </div>
          </div>
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
                    {sp.store_url
                      ? <a href={sp.store_url} target="_blank" rel="noopener noreferrer" className="hover:underline" title={sp.store_product_name}>{fmt(sp.price)}</a>
                      : <span>{fmt(sp.price)}</span>}
                    {isBest && <span className="text-[#5D9B8F]">✓</span>}
                  </span>
                );
              })}
            </div>
          )}
          {item.nutrition && (
            <div className="mt-2">
              <button onClick={() => setShowNutrition(v => !v)} className="text-[10px] text-[#B2BEC3] hover:text-[#636E72] transition flex items-center gap-1">
                <span>{showNutrition ? '▲' : '▼'}</span><span>Nutrition per 100g</span>
              </button>
              {showNutrition && (
                <div className="mt-2 flex gap-1.5 flex-wrap">
                  <NutritionPill label="Cal" value={item.nutrition.calories} unit="kcal" />
                  <NutritionPill label="Protein" value={item.nutrition.protein} unit="g" />
                  <NutritionPill label="Carbs" value={item.nutrition.carbs} unit="g" />
                  <NutritionPill label="Fat" value={item.nutrition.fat} unit="g" />
                  <NutritionPill label="Sugar" value={item.nutrition.sugar} unit="g" />
                  {item.nutrition.fibre != null && <NutritionPill label="Fibre" value={item.nutrition.fibre} unit="g" />}
                  {item.nutrition.salt != null && item.nutrition.salt < 20 && <NutritionPill label="Salt" value={item.nutrition.salt} unit="g" />}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Add Items Panel ───────────────────────────────────────────────────────────
function AddItemsPanel({
  allProducts, currentProductIds, onAdd, onClose,
}: {
  allProducts: { product_id: string; canonical_name: string; category: string | null }[];
  currentProductIds: Set<string>;
  onAdd: (productId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 100); }, []);

  const filtered = allProducts.filter(p =>
    p.canonical_name.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-0 sm:pb-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-sm z-10 flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between p-5 pb-3 flex-shrink-0">
          <h2 className="text-lg font-bold text-[#1D2324]">Add items</h2>
          <button onClick={onClose} className="text-[#B2BEC3] hover:text-[#636E72] transition">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-5 pb-3 flex-shrink-0">
          <input ref={inputRef} type="text" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search products…"
            className="w-full px-4 py-2.5 rounded-xl border-2 border-[#E8E2DC] focus:border-[#5D9B8F] focus:outline-none text-sm text-[#1D2324] placeholder:text-[#B2BEC3]" />
        </div>
        <div className="overflow-y-auto flex-1 px-5 pb-5">
          {filtered.length === 0 && (
            <p className="text-sm text-[#B2BEC3] text-center py-8">No products found</p>
          )}
          <div className="space-y-1">
            {filtered.map(p => {
              const onList = currentProductIds.has(p.product_id);
              return (
                <button key={p.product_id} onClick={() => { if (!onList) { onAdd(p.product_id); } }}
                  disabled={onList}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition ${
                    onList ? 'opacity-40 cursor-not-allowed' : 'hover:bg-[#F5F0EB] active:bg-[#EDE8E3]'
                  }`}>
                  <div>
                    <div className="text-sm font-medium text-[#1D2324]">{p.canonical_name}</div>
                    {p.category && <div className="text-[11px] text-[#B2BEC3]">{p.category}</div>}
                  </div>
                  {onList
                    ? <span className="text-[11px] text-[#5D9B8F] font-semibold flex-shrink-0">On list ✓</span>
                    : <span className="text-[#E17055] flex-shrink-0">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                        </svg>
                      </span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Preferences Panel ─────────────────────────────────────────────────────────
function PreferencesPanel({ token, currentFamilySize, onClose }: {
  token: string; currentFamilySize: FamilySize; onClose: () => void;
}) {
  const [selected, setSelected] = useState<FamilySize>(currentFamilySize);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    if (selected === currentFamilySize) { onClose(); return; }
    setSaving(true);
    try {
      await fetch('/api/list/preferences', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, familySize: selected }),
      });
      setSaved(true);
      setTimeout(() => window.location.reload(), 800);
    } catch { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 z-10">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-[#1D2324]">Your household</h2>
          <button onClick={onClose} className="text-[#B2BEC3] hover:text-[#636E72] transition">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="text-sm text-[#636E72] mb-4">Update your household size to regenerate your list with the right quantities.</p>
        <div className="grid grid-cols-2 gap-2 mb-5">
          {FAMILY_OPTIONS.map(opt => (
            <button key={opt.value} onClick={() => setSelected(opt.value as FamilySize)}
              className={`p-3 rounded-xl text-center transition-all border-2 ${selected === opt.value ? 'border-[#E17055] bg-[#FEF3E2]' : 'border-[#E8E2DC] hover:border-[#E17055]/50'}`}>
              <div className="text-2xl mb-1">{opt.icon}</div>
              <div className={`text-xs font-semibold ${selected === opt.value ? 'text-[#E17055]' : 'text-[#636E72]'}`}>{opt.label}</div>
            </button>
          ))}
        </div>
        <button onClick={handleSave} disabled={saving || saved}
          className="w-full bg-gradient-to-b from-[#E17055] to-[#D4604A] text-white py-3 rounded-xl font-semibold hover:from-[#D4604A] hover:to-[#C5533D] transition-all disabled:opacity-70">
          {saved ? '✓ Saved! Reloading…' : saving ? 'Saving…' : selected === currentFamilySize ? 'Close' : 'Save & update list'}
        </button>
      </div>
    </div>
  );
}

// ── Main Export ───────────────────────────────────────────────────────────────
export function ShoppingList({
  items, grouped, token, familySize, savedRemovedItems, savedAddedItems, savedStoreOverrides, allProducts,
}: {
  items: ListItem[];
  grouped: [string, ListItem[]][];
  token?: string;
  familySize?: FamilySize;
  savedRemovedItems?: string[];
  savedAddedItems?: string[];
  savedStoreOverrides?: Record<string, string>;
  allProducts?: { product_id: string; canonical_name: string; category: string | null }[];
}) {
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<string[]>([]);
  const [storeOverrides, setStoreOverrides] = useState<Record<string, string>>({});
  const [hydrated, setHydrated] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [showAddItems, setShowAddItems] = useState(false);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setRemoved(new Set([...(savedRemovedItems ?? []), ...loadLocal<string[]>(STORAGE_KEY, [])]));
    setAdded([...(savedAddedItems ?? []), ...loadLocal<string[]>(STORAGE_ADDED_KEY, [])].filter((v, i, a) => a.indexOf(v) === i));
    setStoreOverrides({ ...loadLocal<Record<string,string>>(STORAGE_OVERRIDES_KEY, {}), ...(savedStoreOverrides ?? {}) });
    setHydrated(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const syncToDb = useCallback((patch: { removedItems?: string[]; addedItems?: string[]; storeOverrides?: Record<string,string> }) => {
    if (!token) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(async () => {
      try {
        await fetch('/api/list/preferences', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, ...patch }),
        });
      } catch {}
    }, 1500);
  }, [token]);

  const handleRemove = useCallback((id: string) => {
    setRemoved(prev => {
      const next = new Set(prev); next.add(id);
      saveLocal(STORAGE_KEY, [...next]);
      syncToDb({ removedItems: [...next] });
      return next;
    });
  }, [syncToDb]);

  const handleRestore = useCallback((id: string) => {
    setRemoved(prev => {
      const next = new Set(prev); next.delete(id);
      saveLocal(STORAGE_KEY, [...next]);
      syncToDb({ removedItems: [...next] });
      return next;
    });
  }, [syncToDb]);

  const handleRestoreAll = useCallback(() => {
    const next = new Set<string>();
    setRemoved(next);
    saveLocal(STORAGE_KEY, []);
    syncToDb({ removedItems: [] });
  }, [syncToDb]);

  const handleAdd = useCallback((productId: string) => {
    setAdded(prev => {
      if (prev.includes(productId)) return prev;
      const next = [...prev, productId];
      saveLocal(STORAGE_ADDED_KEY, next);
      syncToDb({ addedItems: next });
      // Reload to regenerate list with new item included
      setTimeout(() => window.location.reload(), 400);
      return next;
    });
  }, [syncToDb]);

  const handleStoreSwap = useCallback((productId: string, store: string) => {
    setStoreOverrides(prev => {
      // If swapping back to cheapest, remove override
      const item = items.find(i => i.product_id === productId);
      const cheapest = item?.all_prices[0]?.store;
      const next = { ...prev };
      if (store === cheapest) { delete next[productId]; }
      else { next[productId] = store; }
      saveLocal(STORAGE_OVERRIDES_KEY, next);
      syncToDb({ storeOverrides: next });
      // Reload to re-render with new store selection
      setTimeout(() => window.location.reload(), 400);
      return next;
    });
  }, [syncToDb, items]);

  const currentProductIds = new Set(items.map(i => i.product_id));
  const removedCount = removed.size;
  const activeItems = items.filter(i => !removed.has(i.product_id));
  const categories = grouped.map(([cat]) => cat);

  if (!hydrated) {
    return (
      <div className="space-y-6">
        {grouped.map(([category, catItems]) => (
          <div key={category} id={`cat-${category.replace(/\s+/g, '-').toLowerCase()}`}>
            <h3 className="text-xs font-bold text-[#636E72] uppercase tracking-wider mb-2">{category}</h3>
            <div className="bg-white rounded-xl border border-[#E8E2DC] px-4">
              {catItems.map(item => (
                <ProductCard key={item.product_id} item={item} removed={false}
                  onRemove={() => {}} onRestore={() => {}} onStoreSwap={() => {}} />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      {showPreferences && token && familySize && (
        <PreferencesPanel token={token} currentFamilySize={familySize} onClose={() => setShowPreferences(false)} />
      )}
      {showAddItems && (
        <AddItemsPanel
          allProducts={allProducts ?? []}
          currentProductIds={currentProductIds}
          onAdd={handleAdd}
          onClose={() => setShowAddItems(false)}
        />
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="flex gap-2 flex-wrap flex-1">
          {categories.map(cat => (
            <a key={cat} href={`#cat-${cat.replace(/\s+/g, '-').toLowerCase()}`}
              className="text-xs font-medium px-3 py-1.5 rounded-full bg-white border border-[#E8E2DC] text-[#636E72] hover:border-[#E17055] hover:text-[#E17055] transition">
              {cat}
            </a>
          ))}
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {/* Add items */}
          <button onClick={() => setShowAddItems(true)}
            className="flex items-center gap-1.5 text-xs font-semibold text-white bg-[#5D9B8F] hover:bg-[#4A8A7E] transition px-3 py-1.5 rounded-full"
            title="Add items to list">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add
          </button>
          {/* Edit household */}
          {token && familySize && (
            <button onClick={() => setShowPreferences(true)}
              className="flex items-center gap-1.5 text-xs font-semibold text-[#636E72] hover:text-[#1D2324] transition px-3 py-1.5 rounded-full bg-white border border-[#E8E2DC] hover:border-[#1D2324]"
              title="Edit household size">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Household
            </button>
          )}
        </div>
      </div>

      {removedCount > 0 && (
        <div className="mb-4 bg-[#FFF8F6] border border-[#FDDDD8] rounded-xl px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-sm text-[#636E72]">{removedCount} item{removedCount > 1 ? 's' : ''} removed</p>
          <button onClick={handleRestoreAll} className="text-xs text-[#E17055] font-semibold hover:underline flex-shrink-0">Restore all</button>
        </div>
      )}

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
                <ProductCard key={item.product_id} item={item}
                  removed={removed.has(item.product_id)}
                  onRemove={handleRemove} onRestore={handleRestore} onStoreSwap={handleStoreSwap} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="text-center text-xs text-[#B2BEC3] mt-6">
        {activeItems.length} of {items.length} items · {grouped.length} categories
      </p>
    </>
  );
}
