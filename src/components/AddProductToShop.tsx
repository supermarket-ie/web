'use client';

import { useState, type FormEvent } from 'react';
import { trackEvent } from '@/lib/analytics';
import { addProductToDraft, readShopDraft, SHOP_BUILDER_PATH, SHOP_DRAFT_KEY } from '@/lib/shop-builder';

export function AddProductToShop({ id, name, slug }: { id: string; name: string; slug: string }) {
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);

  function add(event: FormEvent) {
    event.preventDefault();
    if (adding) return;
    setError('');
    const landingPath = `/browse/${slug}`;
    try {
      const previous = readShopDraft(sessionStorage.getItem(SHOP_DRAFT_KEY));
      const draft = addProductToDraft(previous, { id, name, quantity }, landingPath);
      sessionStorage.setItem(SHOP_DRAFT_KEY, JSON.stringify({ ...draft, createdAt: Date.now() }));
      setAdding(true);
      try {
        trackEvent('product_added_to_shop', { landing_path: landingPath, selected_item_count: draft.items.length });
      } catch { /* Tracking cannot interrupt adding a product. */ }
      window.location.assign(`${SHOP_BUILDER_PATH}#build-your-shop`);
    } catch (cause) {
      setError(cause instanceof RangeError ? cause.message : 'Your browser could not keep this item. Allow session storage and try again.');
    }
  }

  return <form onSubmit={add} className="rounded-2xl border border-[#cbe0d1] bg-[#edf7ef] p-5">
    <h2 className="text-lg font-semibold text-[#173525]">Add this to your household shop</h2>
    <p className="mt-2 text-sm leading-6 text-[#526c5b]">Choose a quantity, add the rest of your list, then review it with your agent. Register when you’re ready to save your shop.</p>
    <div className="mt-4 flex flex-wrap items-end gap-3">
      <label className="text-sm font-medium text-[#354a3b]">Quantity
        <select value={quantity} onChange={event => setQuantity(Number(event.target.value))} className="mt-1 block rounded-xl border border-[#c3d6c9] bg-white px-3 py-2.5 text-base">
          {Array.from({ length: 20 }, (_, i) => i + 1).map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <button disabled={adding} className="rounded-xl bg-[#21603b] px-5 py-3 text-sm font-semibold text-white hover:bg-[#174b2c] disabled:opacity-60">{adding ? 'Opening your shop…' : 'Add to my shop →'}</button>
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
  </form>;
}
