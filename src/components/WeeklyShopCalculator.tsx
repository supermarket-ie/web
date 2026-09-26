'use client';

import { useState, type FormEvent } from 'react';
import { ArrowRight, RotateCcw, ShoppingBasket } from 'lucide-react';
import { trackEvent } from '@/lib/analytics';
import { saveAgentLandingHandoff } from '@/lib/agent-landing-handoff';
import {
  WEEKLY_SHOP_PATH, WEEKLY_STORES, WEEKLY_STORE_NAMES,
  weeklyShopPrompt, weeklyShopTotals, type WeeklyItem,
} from '@/lib/weekly-shop';

const money = (value: number) => `€${value.toFixed(2)}`;
const date = (value: string) => new Date(value).toLocaleDateString('en-IE', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const fieldClass = 'mt-1 w-full rounded-xl border border-[#d7e1d9] bg-white px-3 py-2.5 text-base text-[#172b20] focus:outline-2 focus:outline-offset-2 focus:outline-[#287246]';

export function WeeklyShopCalculator({ items }: { items: WeeklyItem[] }) {
  const initialQuantities = Object.fromEntries(items.map(item => [item.id, item.quantity]));
  const [quantities, setQuantities] = useState(initialQuantities);
  const [adults, setAdults] = useState('2');
  const [children, setChildren] = useState('0');
  const [budget, setBudget] = useState('');
  const [needs, setNeeds] = useState('');
  const [useExample, setUseExample] = useState(true);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const totals = weeklyShopTotals(items, quantities);
  const selectedCount = totals[0].selectedCount;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const prompt = weeklyShopPrompt({ adults: Number(adults), children: Number(children), budget, needs, useExample, items, quantities });
    try {
      saveAgentLandingHandoff(prompt, WEEKLY_SHOP_PATH);
    } catch {
      setError('Your browser could not keep the shopping details for the next step. Please allow session storage and try again.');
      return;
    }
    setStarting(true);
    trackEvent('landing_agent_started', {
      context: 'weekly_shop', landing_path: WEEKLY_SHOP_PATH,
      selected_item_count: useExample ? selectedCount : 0,
      has_budget: Boolean(budget), uses_example: useExample,
    });
    window.location.assign('/?agent_draft=weekly-shop');
  }

  return (
    <>
      <section id="personalise" aria-labelledby="personalise-title" className="mb-10 grid overflow-hidden rounded-3xl border border-[#dce6de] bg-[#edf7ef] lg:grid-cols-[0.85fr_1.15fr]">
        <div className="p-6 sm:p-8">
          <ShoppingBasket className="mb-4 size-7 text-[#287246]" aria-hidden="true" />
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#397250]">Your household, your shop</p>
          <h2 id="personalise-title" className="text-2xl font-semibold tracking-tight text-[#173525] sm:text-3xl">Work out what your week needs.</h2>
          <p className="mt-4 text-sm leading-6 text-[#53675a]">Adjust the example below, or bring your own list. Your agent will use your household size, budget and preferences to prepare a proposed shop with quantities and current matched prices.</p>
          <p className="mt-4 text-sm leading-6 text-[#53675a]">You can review the proposal before registering. Register to save your shop and continue with your agent.</p>
          <a href="#example-basket" className="mt-5 inline-block text-sm font-semibold text-[#21603b] underline underline-offset-4">Edit the example basket ↓</a>
        </div>
        <form onSubmit={submit} className="border-t border-[#dce6de] bg-white/70 p-6 sm:p-8 lg:border-l lg:border-t-0">
          <div className="grid grid-cols-2 gap-4">
            <label className="text-sm font-medium text-[#354a3b]">Adults
              <input className={fieldClass} type="number" min="1" max="20" step="1" required value={adults} onChange={event => setAdults(event.target.value)} />
            </label>
            <label className="text-sm font-medium text-[#354a3b]">Children
              <input className={fieldClass} type="number" min="0" max="20" step="1" required value={children} onChange={event => setChildren(event.target.value)} />
            </label>
          </div>
          <label className="mt-4 block text-sm font-medium text-[#354a3b]">Weekly budget (€) <span className="font-normal text-[#6d7c71]">— optional</span>
            <input className={fieldClass} type="number" min="1" max="10000" step="0.01" placeholder="e.g. 120" value={budget} onChange={event => setBudget(event.target.value)} />
          </label>
          <label className="mt-4 block text-sm font-medium text-[#354a3b]">What do you need this week?
            <textarea className={`${fieldClass} min-h-28 resize-y`} maxLength={2000} value={needs} onChange={event => setNeeds(event.target.value)} placeholder="Paste your list, or tell us about meals, school lunches, dietary needs and things you already have." />
          </label>
          <label className="mt-4 flex items-start gap-3 text-sm leading-5 text-[#53675a]">
            <input className="mt-0.5 size-4 shrink-0 accent-[#287246]" type="checkbox" checked={useExample} onChange={event => setUseExample(event.target.checked)} />
            Use my selected example items as a starting list ({selectedCount} products)
          </label>
          {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
          <button type="submit" disabled={starting} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#173525] px-5 py-3.5 text-sm font-semibold text-white hover:bg-[#28553a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#287246] disabled:opacity-60">
            {starting ? 'Opening your agent…' : 'Plan my household shop'} <ArrowRight className="size-4" aria-hidden="true" />
          </button>
          <p className="mt-3 text-center text-xs text-[#6d7c71]">Continue with your shopping agent. No registration needed to start.</p>
        </form>
      </section>

      <section id="example-basket" aria-labelledby="example-title" className="scroll-mt-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="example-title" className="text-2xl font-semibold tracking-tight text-[#173525]">Build on this example shop</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#607065]">{items.length} everyday products, with the quantities shown below. Change the number of packs or choose 0 to leave something out. This is a starting basket, not a complete week of meals or an average Irish household spend.</p>
          </div>
          <button type="button" onClick={() => setQuantities(initialQuantities)} className="inline-flex items-center gap-2 rounded-lg border border-[#dce3dd] bg-white px-3 py-2 text-sm text-[#45604d] hover:bg-[#f0f5f1]">
            <RotateCcw className="size-3.5" aria-hidden="true" /> Reset example
          </button>
        </div>

        <div aria-live="polite" aria-atomic="true" className="mb-4 grid gap-3 sm:grid-cols-3">
          {totals.map(total => (
            <div key={total.store} className="rounded-2xl border border-[#dce3dd] bg-white p-5">
              <h3 className="text-sm font-semibold text-[#354a3b]">{WEEKLY_STORE_NAMES[total.store]}</h3>
              <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight text-[#173525]">{total.subtotal === null ? '—' : money(total.subtotal)}</p>
              <p className="mt-1 text-xs font-semibold text-[#52665a]">{total.total !== null ? 'Total for selected products' : total.pricedCount ? 'Priced items subtotal' : 'No priced items selected'}</p>
              <p className="mt-3 text-xs leading-5 text-[#6d7c71]">{total.pricedCount} of {total.selectedCount} selected products priced{total.missingCount > 0 ? ` · ${total.missingCount} missing prices` : ''}</p>
            </div>
          ))}
        </div>
        <p className="mb-5 text-sm leading-6 text-[#607065]">Subtotals can cover different products, so a lower subtotal does not mean a cheaper complete shop. A missing price means we cannot currently price that product; it does not mean the retailer is out of stock.</p>

        <div className="overflow-x-auto rounded-2xl border border-[#dce3dd] bg-white" role="region" aria-label="Editable example basket prices" tabIndex={0}>
          <table className="w-full min-w-[740px] border-collapse text-left text-sm">
            <caption className="sr-only">Example basket products, quantities, retailer product names, observed prices and observation dates</caption>
            <thead className="bg-[#f0f5f1] text-[#354a3b]">
              <tr><th scope="col" className="w-[25%] p-4">Product</th><th scope="col" className="w-20 p-4">Packs / items</th>{WEEKLY_STORES.map(store => <th scope="col" key={store} className="p-4">{WEEKLY_STORE_NAMES[store]}</th>)}</tr>
            </thead>
            <tbody>
              {items.map(item => <tr key={item.id} className={`border-t border-[#edf0ed] ${quantities[item.id] === 0 ? 'bg-[#f8faf8]' : ''}`}>
                <th scope="row" className="p-4 align-top font-medium text-[#354a3b]">{item.name}</th>
                <td className="p-4 align-top">
                  <select aria-label={`Quantity for ${item.name}`} value={quantities[item.id]} onChange={event => setQuantities(previous => ({ ...previous, [item.id]: Number(event.target.value) }))} className="rounded-lg border border-[#ccd8ce] bg-white px-2 py-2 text-base focus:outline-2 focus:outline-[#287246]">
                    {Array.from({ length: 21 }, (_, quantity) => <option key={quantity} value={quantity}>{quantity}</option>)}
                  </select>
                </td>
                {WEEKLY_STORES.map(store => {
                  const offer = item.offers[store];
                  return <td key={store} className="p-4 align-top">
                    {offer ? <>
                      <span className="block font-semibold tabular-nums text-[#173525]">{quantities[item.id] > 0 ? money(Math.round(offer.price * 100) * quantities[item.id] / 100) : 'Not included'}</span>
                      <span className="mt-1 block text-xs leading-5 text-[#607065]">{offer.name}</span>
                      <span className="mt-1 block text-[11px] leading-4 text-[#718076]">{money(offer.price)} each · checked {date(offer.observedAt)}</span>
                    </> : <span className="text-xs text-[#718076]">Price unavailable</span>}
                  </td>;
                })}
              </tr>)}
            </tbody>
          </table>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-xs leading-5 text-[#607065]">Retailer brands and specifications can differ. Check the product names above. Prices shown exclude delivery, vouchers and any loyalty discount we cannot verify.</p>
          <a href="#personalise" className="rounded-xl bg-[#173525] px-5 py-3 text-sm font-semibold text-white hover:bg-[#28553a]">Use this to plan my week ↑</a>
        </div>
      </section>
    </>
  );
}
