'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { ListItem, FamilySize } from '@/lib/list-generator';
import { storeStyle, storeDisplayName } from '@/lib/store-utils';
import { ProductCard } from './ProductCard';

function fmt(price: number) { return `€${price.toFixed(2)}`; }

const STORAGE_KEY           = 'sm_removed_items';
const STORAGE_ADDED_KEY     = 'sm_added_items';
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

// ── Add Items Panel ────────────────────────────────────────────────────────────
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
      <div className="relative rounded-t-2xl sm:rounded-2xl w-full max-w-sm z-10 flex flex-col max-h-[85vh] shadow-2xl"
        style={{ background: 'var(--surface-container-lowest)' }}>
        <div className="flex items-center justify-between p-5 pb-3 flex-shrink-0">
          <h2 className="type-title-md text-on-background">Add items</h2>
          <button onClick={onClose} aria-label="Close" style={{ color: 'var(--on-surface-variant)' }}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-5 pb-3 flex-shrink-0">
          <input ref={inputRef} type="text" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search products…"
            className="w-full px-4 py-2.5 rounded-xl text-sm focus:outline-none transition-all"
            style={{ background: 'var(--surface-container-high)', color: 'var(--on-background)' }}
            onFocus={e => { e.currentTarget.style.background = 'var(--surface-container-lowest)'; e.currentTarget.style.outline = '2px solid rgba(0,106,53,0.4)'; e.currentTarget.style.outlineOffset = '-2px'; }}
            onBlur={e =>  { e.currentTarget.style.background = 'var(--surface-container-high)'; e.currentTarget.style.outline = 'none'; }} />
        </div>
        <div className="overflow-y-auto flex-1 px-5 pb-5">
          {filtered.length === 0 && (
            <p className="text-sm text-center py-8" style={{ color: 'var(--on-surface-variant)' }}>No products found</p>
          )}
          <div className="space-y-1">
            {filtered.map(p => {
              const onList = currentProductIds.has(p.product_id);
              return (
                <button key={p.product_id} onClick={() => { if (!onList) onAdd(p.product_id); }}
                  disabled={onList}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition"
                  style={onList
                    ? { opacity: 0.4, cursor: 'not-allowed' }
                    : { background: 'transparent' }}
                  onMouseEnter={e => { if (!onList) e.currentTarget.style.background = 'var(--surface-container-low)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                  <div>
                    <div className="text-sm font-medium" style={{ color: 'var(--on-background)' }}>{p.canonical_name}</div>
                    {p.category && <div className="text-[11px]" style={{ color: 'var(--on-surface-variant)' }}>{p.category}</div>}
                  </div>
                  {onList
                    ? <span className="text-[11px] font-semibold flex-shrink-0" style={{ color: 'var(--primary)' }}>On list ✓</span>
                    : <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: 'var(--primary)' }}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                      </svg>}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Preferences Panel ──────────────────────────────────────────────────────────
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
    } catch (err) {
      console.error('[PreferencesPanel] Failed to save preferences:', err);
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative rounded-2xl shadow-2xl w-full max-w-sm p-6 z-10"
        style={{ background: 'var(--surface-container-lowest)' }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="type-title-md text-on-background">Your household</h2>
          <button onClick={onClose} aria-label="Close" style={{ color: 'var(--on-surface-variant)' }}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="text-sm mb-4" style={{ color: 'var(--on-surface)' }}>
          Update your household size to regenerate your list with the right quantities.
        </p>
        <div className="grid grid-cols-2 gap-2 mb-5">
          {FAMILY_OPTIONS.map(opt => (
            <button key={opt.value} onClick={() => setSelected(opt.value as FamilySize)}
              className="p-3 rounded-xl text-center transition-all"
              style={selected === opt.value
                ? { background: 'var(--primary)', outline: 'none' }
                : { background: 'var(--surface-container)' }}>
              <div className="text-2xl mb-1">{opt.icon}</div>
              <div className="text-xs font-semibold"
                style={{ color: selected === opt.value ? 'var(--on-primary)' : 'var(--on-surface)' }}>
                {opt.label}
              </div>
            </button>
          ))}
        </div>
        <button onClick={handleSave} disabled={saving || saved} className="btn-primary w-full py-3">
          {saved ? '✓ Saved! Reloading…' : saving ? 'Saving…' : selected === currentFamilySize ? 'Close' : 'Save & update list'}
        </button>
      </div>
    </div>
  );
}

// ── Main Export ────────────────────────────────────────────────────────────────
export function ShoppingList({
  items, grouped, token, familySize, savedRemovedItems, savedAddedItems, savedStoreOverrides, allProducts, storeTotals, generatedAt,
}: {
  items: ListItem[];
  grouped: [string, ListItem[]][];
  token?: string;
  familySize?: FamilySize;
  savedRemovedItems?: string[];
  savedAddedItems?: string[];
  savedStoreOverrides?: Record<string, string>;
  allProducts?: { product_id: string; canonical_name: string; category: string | null }[];
  storeTotals?: { store: string; total: number }[];
  generatedAt?: string;
}) {
  const [removed, setRemoved]         = useState<Set<string>>(new Set());
  const [added, setAdded]             = useState<string[]>([]);
  const [storeOverrides, setStoreOverrides] = useState<Record<string, string>>({});
  const [hydrated, setHydrated]       = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [showAddItems, setShowAddItems]       = useState(false);
  const [sharing, setSharing]         = useState(false);
  const [shareUrl, setShareUrl]       = useState<string | null>(null);
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
      } catch (err) {
        console.error('[ShoppingList] Failed to sync preferences:', err);
      }
    }, 1500);
  }, [token]);

  const handleRemove = useCallback((id: string) => {
    setRemoved(prev => { const next = new Set(prev); next.add(id); saveLocal(STORAGE_KEY, [...next]); syncToDb({ removedItems: [...next] }); return next; });
  }, [syncToDb]);

  const handleRestore = useCallback((id: string) => {
    setRemoved(prev => { const next = new Set(prev); next.delete(id); saveLocal(STORAGE_KEY, [...next]); syncToDb({ removedItems: [...next] }); return next; });
  }, [syncToDb]);

  const handleRestoreAll = useCallback(() => {
    setRemoved(new Set()); saveLocal(STORAGE_KEY, []); syncToDb({ removedItems: [] });
  }, [syncToDb]);

  const handleAdd = useCallback((productId: string) => {
    setAdded(prev => {
      if (prev.includes(productId)) return prev;
      const next = [...prev, productId];
      saveLocal(STORAGE_ADDED_KEY, next);
      syncToDb({ addedItems: next });
      setTimeout(() => window.location.reload(), 400);
      return next;
    });
  }, [syncToDb]);

  const handleShare = useCallback(async () => {
    if (shareUrl) {
      await navigator.clipboard.writeText(window.location.origin + shareUrl).catch(() => {});
      return;
    }
    setSharing(true);
    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map(i => ({
            canonical_name: i.canonical_name, category: i.category,
            best_store: i.best_store, best_price: i.best_price, all_prices: i.all_prices,
          })),
          store_totals: storeTotals ?? [],
          family_size: familySize ?? '2',
          generated_at: generatedAt,
        }),
      });
      const data = await res.json();
      if (data.url) {
        setShareUrl(data.url);
        await navigator.clipboard.writeText(window.location.origin + data.url).catch(() => {});
      }
    } catch (err) {
      console.error('[ShoppingList] Failed to create share link:', err);
    }
    setSharing(false);
  }, [items, storeTotals, familySize, generatedAt, shareUrl]);

  const handleStoreSwap = useCallback((productId: string, store: string) => {
    setStoreOverrides(prev => {
      const item = items.find(i => i.product_id === productId);
      const cheapest = item?.all_prices[0]?.store;
      const next = { ...prev };
      if (store === cheapest) { delete next[productId]; } else { next[productId] = store; }
      saveLocal(STORAGE_OVERRIDES_KEY, next);
      syncToDb({ storeOverrides: next });
      setTimeout(() => window.location.reload(), 400);
      return next;
    });
  }, [syncToDb, items]);

  const currentProductIds = new Set(items.map(i => i.product_id));
  const removedCount = removed.size;
  const activeItems = items.filter(i => !removed.has(i.product_id));
  const categories = grouped.map(([cat]) => cat);

  // Pre-hydration skeleton — same structure, no interactivity
  if (!hydrated) {
    return (
      <div className="space-y-6">
        {grouped.map(([category, catItems]) => (
          <div key={category} id={`cat-${category.replace(/\s+/g, '-').toLowerCase()}`}>
            <h3 className="type-label mb-3" style={{ color: 'var(--on-surface)' }}>{category}</h3>
            <div className="rounded-xl px-4" style={{ background: 'var(--surface-container-lowest)' }}>
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
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        {/* Category jump links */}
        <div className="flex gap-2 flex-wrap flex-1">
          {categories.map(cat => (
            <a key={cat} href={`#cat-${cat.replace(/\s+/g, '-').toLowerCase()}`}
              className="text-xs font-medium px-3 py-1.5 rounded-full transition-colors"
              style={{ background: 'var(--surface-container)', color: 'var(--on-surface)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--primary)'; e.currentTarget.style.color = 'var(--on-primary)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface-container)'; e.currentTarget.style.color = 'var(--on-surface)'; }}>
              {cat}
            </a>
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-2 flex-shrink-0">
          <button onClick={() => setShowAddItems(true)}
            className="btn-primary flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full"
            title="Add items to list">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add
          </button>

          <button onClick={handleShare} disabled={sharing}
            className="flex items-center gap-1.5 text-xs font-semibold transition-all px-3 py-1.5 rounded-full"
            style={shareUrl
              ? { background: 'var(--primary)', color: 'var(--on-primary)' }
              : { background: 'var(--surface-container)', color: 'var(--on-surface)' }}
            title={shareUrl ? 'Link copied!' : 'Share this list'}>
            {shareUrl ? (
              <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>Copied!</>
            ) : sharing ? 'Sharing…' : (
              <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/></svg>Share</>
            )}
          </button>

          {token && familySize && (
            <button onClick={() => setShowPreferences(true)}
              className="flex items-center gap-1.5 text-xs font-semibold transition-all px-3 py-1.5 rounded-full"
              style={{ background: 'var(--surface-container)', color: 'var(--on-surface)' }}
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

      {/* Removed items banner */}
      {removedCount > 0 && (
        <div className="mb-4 rounded-xl px-4 py-3 flex items-center justify-between gap-3"
          style={{ background: 'var(--surface-container-low)' }}>
          <p className="text-sm" style={{ color: 'var(--on-surface)' }}>
            {removedCount} item{removedCount > 1 ? 's' : ''} removed
          </p>
          <button onClick={handleRestoreAll} className="text-xs font-semibold hover:underline flex-shrink-0"
            style={{ color: 'var(--primary)' }}>
            Restore all
          </button>
        </div>
      )}

      {/* Category groups */}
      <div className="space-y-6">
        {grouped.map(([category, catItems]) => (
          <div key={category} id={`cat-${category.replace(/\s+/g, '-').toLowerCase()}`}>
            <h3 className="type-label mb-3" style={{ color: 'var(--on-surface)' }}>
              {category}
              {catItems.every(i => removed.has(i.product_id)) && (
                <span className="ml-2 font-normal normal-case" style={{ color: 'var(--on-surface-variant)' }}>(all removed)</span>
              )}
            </h3>
            <div className="rounded-xl px-4" style={{ background: 'var(--surface-container-lowest)' }}>
              {catItems.map((item, idx) => (
                <div key={item.product_id}>
                  <ProductCard item={item}
                    removed={removed.has(item.product_id)}
                    onRemove={handleRemove}
                    onRestore={handleRestore}
                    onStoreSwap={handleStoreSwap} />
                  {idx < catItems.length - 1 && (
                    <div className="h-px mx-0" style={{ background: 'var(--surface-container-low)' }} />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="text-center text-xs mt-8" style={{ color: 'var(--on-surface-variant)' }}>
        {activeItems.length} of {items.length} items · {grouped.length} categories
      </p>
    </>
  );
}
