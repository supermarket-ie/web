'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, Check, Plus, Search, ShoppingBasket, Trash2 } from 'lucide-react';
import { trackEvent } from '@/lib/analytics';
import { saveAgentLandingHandoff } from '@/lib/agent-landing-handoff';
import { readShopDraft, shopBuilderPrompt, SHOP_BUILDER_LIMIT, SHOP_BUILDER_PATH, SHOP_DRAFT_KEY, type ShopDraft, type ShopProduct } from '@/lib/shop-builder';
import { weeklyShopTotals, WEEKLY_STORES, WEEKLY_STORE_NAMES } from '@/lib/weekly-shop';

const money = (value: number) => `€${value.toFixed(2)}`;
const field = 'w-full rounded-xl border border-[#d9e3db] bg-white px-3 py-2.5 text-base text-[#173525] focus:outline-2 focus:outline-offset-2 focus:outline-[#287246]';

function recordEdit(action: string, count: number) {
  try {
    trackEvent('shop_builder_edited', { landing_path: SHOP_BUILDER_PATH, action, selected_item_count: count });
  } catch { /* Analytics must not interrupt editing when browser storage is blocked. */ }
}

function ProductOption({ product, selected, full, onAdd }: { product: ShopProduct; selected: boolean; full: boolean; onAdd: () => void }) {
  return <article className="rounded-2xl border border-[#e0e7e1] bg-white p-4">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#748478]">{product.category}</p>
        <h3 className="mt-1 text-sm font-semibold leading-5 text-[#263e2e]">{product.name}</h3>
      </div>
      <button type="button" onClick={onAdd} disabled={selected || full} aria-label={`${selected ? 'Added' : 'Add'} ${product.name}`} className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#e8f4eb] text-[#21603b] hover:bg-[#cce8d4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#287246] disabled:opacity-50">
        {selected ? <Check className="size-4" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
      </button>
    </div>
    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#607065]">
      {WEEKLY_STORES.map(store => <span key={store}>{WEEKLY_STORE_NAMES[store].split(' ')[0]} <strong className="text-[#263e2e]">{product.offers[store] ? money(product.offers[store]!.price) : '—'}</strong></span>)}
    </div>
    <details className="mt-2 text-[11px] leading-5 text-[#607065]">
      <summary className="cursor-pointer underline decoration-[#b4c7ba] underline-offset-2">Retailer products and price dates</summary>
      <ul className="mt-2 space-y-2">
        {WEEKLY_STORES.map(store => {
          const offer = product.offers[store];
          return <li key={store}><strong>{WEEKLY_STORE_NAMES[store]}:</strong> {offer ? `${offer.name} · ${money(offer.price)} each · checked ${new Date(offer.observedAt).toLocaleDateString('en-IE', { day: 'numeric', month: 'short', timeZone: 'UTC' })}` : 'Price unavailable'}</li>;
        })}
      </ul>
    </details>
  </article>;
}

export function ShopBuilder({ suggestions }: { suggestions: ShopProduct[] }) {
  const [items, setItems] = useState<ShopProduct[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ShopProduct[]>(suggestions);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [adults, setAdults] = useState('2');
  const [children, setChildren] = useState('0');
  const [budget, setBudget] = useState('');
  const [needs, setNeeds] = useState('');
  const [completeWeek, setCompleteWeek] = useState(false);
  const [entryPath, setEntryPath] = useState<string | undefined>();
  const [restored, setRestored] = useState(false);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const quantities = Object.fromEntries(items.map(item => [item.id, item.quantity]));
  const totals = weeklyShopTotals(items, quantities);

  useEffect(() => {
    const controller = new AbortController();
    let draft: ShopDraft | null = null;
    try { draft = readShopDraft(sessionStorage.getItem(SHOP_DRAFT_KEY)); } catch { /* Editing works without storage. */ }
    if (draft) {
      setItems(draft.items.map(item => ({ ...item, category: '', offers: {} })));
      setAdults(draft.adults); setChildren(draft.children); setBudget(draft.budget); setNeeds(draft.needs); setCompleteWeek(draft.completeWeek);
      setEntryPath(draft.entryPath);
      if (draft.items.length) {
        const params = new URLSearchParams({ ids: draft.items.map(item => item.id).join(',') });
        fetch(`/api/shop-builder?${params}`, { signal: controller.signal })
          .then(async response => {
            if (!response.ok) throw new Error('Price refresh failed');
            const data = await response.json() as { products: ShopProduct[] };
            const fresh = new Map(data.products.map(product => [product.id, product]));
            setItems(current => current.map(item => fresh.has(item.id) ? { ...fresh.get(item.id)!, quantity: item.quantity } : item));
          }).catch(() => { if (!controller.signal.aborted) setError('Your list is restored. Prices could not be refreshed; the agent will check them when you continue.'); });
      }
    }
    setRestored(true);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      sessionStorage.setItem(SHOP_DRAFT_KEY, JSON.stringify({
        items: items.map(({ id, name, quantity }) => ({ id, name, quantity })),
        adults, children, budget, needs, completeWeek, entryPath, createdAt: Date.now(),
      }));
    } catch { /* The final handoff provides an actionable error if storage is unavailable. */ }
  }, [items, adults, children, budget, needs, completeWeek, entryPath, restored]);

  useEffect(() => {
    const controller = new AbortController();
    const term = query.trim();
    if (term.length < 2) {
      setResults(suggestions); setSearching(false); setSearchError('');
      return () => controller.abort();
    }
    setSearching(true); setSearchError('');
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/shop-builder?${new URLSearchParams({ q: term })}`, { signal: controller.signal });
        if (!response.ok) throw new Error('Search failed');
        const data = await response.json() as { products: ShopProduct[] };
        if (!controller.signal.aborted) setResults(data.products);
      } catch {
        if (!controller.signal.aborted) { setResults([]); setSearchError('We couldn’t load product prices. Try another search, or describe what you need below.'); }
      } finally { if (!controller.signal.aborted) setSearching(false); }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, suggestions]);

  function add(product: ShopProduct) {
    if (items.length >= SHOP_BUILDER_LIMIT || items.some(item => item.id === product.id)) return;
    setItems(current => [...current, { ...product, quantity: 1 }]);
    recordEdit('add', items.length + 1);
  }

  function changeQuantity(id: string, quantity: number) {
    if (quantity === 0) setItems(current => current.filter(item => item.id !== id));
    else setItems(current => current.map(item => item.id === id ? { ...item, quantity } : item));
    recordEdit(quantity === 0 ? 'remove' : 'quantity', items.length - (quantity === 0 ? 1 : 0));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (starting || (!items.length && !needs.trim())) return;
    setError('');
    try {
      saveAgentLandingHandoff(shopBuilderPrompt({ items, adults, children, budget, needs, completeWeek }), entryPath ?? SHOP_BUILDER_PATH);
    } catch {
      setError('Your browser could not keep this shop for the next step. Please allow session storage and try again.');
      return;
    }
    setStarting(true);
    try {
      trackEvent('landing_agent_started', { context: entryPath ? 'product' : 'comparison', experience: 'shop_builder', landing_path: entryPath ?? SHOP_BUILDER_PATH, workspace_path: SHOP_BUILDER_PATH, selected_item_count: items.length, has_budget: Boolean(budget), complete_week: completeWeek });
    } catch { /* A tracking failure must not block the shop. */ }
    window.location.assign('/?agent_draft=shop-builder');
  }

  return <section id="build-your-shop" aria-labelledby="shop-builder-title" className="scroll-mt-6 rounded-3xl border border-[#dce6de] bg-white p-5 shadow-[0_20px_70px_rgba(25,57,38,0.06)] sm:p-7">
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#397250]">Start your shop here</p>
        <h2 id="shop-builder-title" className="text-2xl font-semibold tracking-tight text-[#173525] sm:text-3xl">What’s on your shopping list?</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#607065]">Add products and adjust quantities. See current matched prices, then ask your agent to prepare the shop around you.</p>
      </div>
      <a href="#your-shop" className="rounded-full bg-[#e8f4eb] px-4 py-2 text-sm font-semibold text-[#21603b] lg:hidden">Your shop ({items.length}) ↓</a>
    </div>
    <form onSubmit={submit} className="grid gap-7 lg:grid-cols-[1.1fr_0.9fr]">
      <div>
        <label htmlFor="shop-product-search" className="mb-2 block text-sm font-semibold text-[#354a3b]">Find a product</label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3.5 size-5 text-[#76877b]" aria-hidden="true" />
          <input id="shop-product-search" type="search" value={query} maxLength={80} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} placeholder="Search milk, bread, detergent…" className={`${field} pl-10`} />
        </div>
        <p role="status" className="my-3 min-h-5 text-xs text-[#748478]">{searching ? 'Finding current prices…' : searchError || (query.trim().length >= 2 ? `${results.length} matching products shown` : 'Everyday products to get started — add only what you need.')}</p>
        <div className={`grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 ${searching ? 'opacity-50' : ''}`} aria-busy={searching}>
          {!searching && results.map(product => <ProductOption key={product.id} product={product} selected={items.some(item => item.id === product.id)} full={items.length >= SHOP_BUILDER_LIMIT} onAdd={() => add(product)} />)}
        </div>
        {!searching && !searchError && !results.length && <p className="rounded-2xl bg-[#f5f8f5] p-5 text-sm leading-6 text-[#607065]">No current priced match found. Try a shorter product name, or add the need in the box below so your agent can help.</p>}
        <label htmlFor="shop-needs" className="mb-2 mt-6 block text-sm font-semibold text-[#354a3b]">Or describe what you need</label>
        <textarea id="shop-needs" className={`${field} min-h-28 resize-y`} maxLength={2000} value={needs} onChange={event => setNeeds(event.target.value)} placeholder="Paste your list, or ask for meals and household essentials. Include dietary needs and things you already have." />
        <p className="mt-2 text-xs leading-5 text-[#748478]">You can start with a description, selected products, or both.</p>
      </div>
      <aside id="your-shop" aria-labelledby="your-shop-title" className="scroll-mt-6 self-start rounded-2xl border border-[#dce6de] bg-[#f0f7f2] p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 id="your-shop-title" className="flex items-center gap-2 text-lg font-semibold text-[#173525]"><ShoppingBasket className="size-5" aria-hidden="true" /> Your shop</h3>
          <span className="text-xs text-[#607065]" aria-live="polite">{items.length} {items.length === 1 ? 'product' : 'products'}</span>
        </div>
        {!items.length ? <p className="rounded-xl border border-dashed border-[#becfc3] bg-white/60 p-5 text-sm leading-6 text-[#607065]">Add your first product to see what your list costs at each supermarket. No registration needed.</p> : <ul className="max-h-80 space-y-3 overflow-y-auto pr-1">
          {items.map(item => <li key={item.id} className="rounded-xl bg-white p-3">
            <p className="text-sm font-medium leading-5 text-[#354a3b]">{item.name}</p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs text-[#607065]">Packs / items
                <select aria-label={`Quantity for ${item.name}`} value={item.quantity} onChange={event => changeQuantity(item.id, Number(event.target.value))} className="rounded-lg border border-[#d9e3db] bg-white px-2 py-1.5 text-base text-[#354a3b]">
                  {Array.from({ length: 20 }, (_, i) => i + 1).map(quantity => <option key={quantity} value={quantity}>{quantity}</option>)}
                </select>
              </label>
              <button type="button" onClick={() => changeQuantity(item.id, 0)} aria-label={`Remove ${item.name}`} className="flex size-9 items-center justify-center rounded-lg text-[#748478] hover:bg-[#f2f5f2] hover:text-[#173525]"><Trash2 className="size-4" aria-hidden="true" /></button>
            </div>
          </li>)}
        </ul>}
        {items.length >= SHOP_BUILDER_LIMIT && <p className="mt-2 text-xs text-[#607065]">This draft holds up to {SHOP_BUILDER_LIMIT} products. Add other needs in your description.</p>}
        <div aria-live="polite" aria-atomic="true" className="mt-4 grid grid-cols-3 gap-2">
          {totals.map(total => <div key={total.store} className="rounded-xl border border-[#dce6de] bg-white p-2.5">
            <p className="text-[11px] font-medium text-[#607065]">{WEEKLY_STORE_NAMES[total.store].split(' ')[0]}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight text-[#173525]">{total.subtotal === null ? '—' : money(total.subtotal)}</p>
            <p className="mt-1 text-[10px] leading-4 text-[#607065]">{total.selectedCount ? `${total.pricedCount}/${total.selectedCount} priced` : 'Add products'}<br />{total.total !== null ? 'Selected list total' : total.selectedCount ? 'Partial subtotal' : 'to see prices'}</p>
          </div>)}
        </div>
        <p className="mt-3 text-[11px] leading-5 text-[#607065]">Missing prices are excluded. Subtotals can cover different products, so a lower subtotal does not mean a cheaper complete shop. Retailer brands and specifications can differ.</p>
        <fieldset className="mt-5 border-t border-[#dce6de] pt-4">
          <legend className="px-1 text-sm font-semibold text-[#354a3b]">Make it work for your household</legend>
          <div className="grid grid-cols-3 gap-2">
            <label className="text-xs text-[#607065]">Adults<input className={`${field} mt-1`} type="number" min="1" max="20" step="1" required value={adults} onChange={event => setAdults(event.target.value)} /></label>
            <label className="text-xs text-[#607065]">Children<input className={`${field} mt-1`} type="number" min="0" max="20" step="1" required value={children} onChange={event => setChildren(event.target.value)} /></label>
            <label className="text-xs text-[#607065]">Budget (€)<input className={`${field} mt-1`} type="number" min="1" max="10000" step="0.01" placeholder="Optional" value={budget} onChange={event => setBudget(event.target.value)} /></label>
          </div>
          <label className="mt-4 flex items-start gap-2 text-xs leading-5 text-[#53675a]"><input type="checkbox" checked={completeWeek} onChange={event => setCompleteWeek(event.target.checked)} className="mt-1 size-4 shrink-0 accent-[#287246]" /> Also fill out the rest of my weekly shop</label>
        </fieldset>
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        <button type="submit" disabled={starting || (!items.length && !needs.trim())} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[#173525] px-4 py-3.5 text-sm font-semibold text-white hover:bg-[#28553a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#287246] disabled:opacity-50">
          {starting ? 'Opening your shop…' : items.length ? 'Review my shop with the agent' : 'Plan my shop with the agent'} <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
        </button>
        <p className="mt-3 text-center text-xs leading-5 text-[#607065]">Review your proposed shop first. Register to save it and keep working with your agent.</p>
      </aside>
    </form>
  </section>;
}
