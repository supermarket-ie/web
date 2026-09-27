'use client';

import { useState, type ReactNode } from 'react';
import { Check, ChevronDown, CircleAlert, ReceiptText, ShoppingBasket } from 'lucide-react';
import { ShopReceiptFrame } from './ShopReceiptFrame';
import type { HouseholdShopContract } from '@/lib/shopping/household-shop-contract';
import { shopRevisionSummary } from '@/lib/guest-shop-journey';

const euro = (value: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(value);
const storeName = (value: string) => ({ tesco: 'Tesco', dunnes: 'Dunnes Stores', supervalu: 'SuperValu' })[value.toLowerCase()] ?? value;

export function GuestShopReceipt({ shop, previous, busy, error, revisionAvailable, signup }: {
  shop: HouseholdShopContract | null;
  previous: HouseholdShopContract | null;
  busy: boolean;
  error: boolean;
  revisionAvailable: boolean;
  signup: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [saveExpanded, setSaveExpanded] = useState(false);
  const priced = Boolean(shop && shop.totals.priced_lines > 0);
  const incomplete = Boolean(shop && shop.totals.priced_lines < shop.totals.total_lines);
  const changes = shop ? shopRevisionSummary(previous, shop) : null;
  const status = busy ? shop ? 'Updating your shop…' : 'Preparing your shop…'
    : error ? shop ? 'Your previous shop is still here' : 'Your shop is not ready yet'
      : shop ? incomplete ? 'Some prices still need checking' : 'Ready for you to review'
        : 'Waiting for your details';

  return (
    <ShopReceiptFrame id="guest-shop-receipt" className="flex min-h-0 flex-col rounded-none border-x-0 border-b-0 shadow-none lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:rounded-none lg:border-b-0 lg:border-l lg:border-t-0">
      <header className="shrink-0 border-b border-dashed border-[#cfd6d0] px-4 py-3 lg:px-5 lg:py-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="hidden text-[10px] font-bold uppercase tracking-[0.14em] text-[#168049] lg:block">Living receipt</p>
            <h2 className="font-bold tracking-[-0.035em] text-[#1d2921] lg:mt-1 lg:text-xl">Your shop</h2>
          </div>
          <ReceiptText aria-hidden="true" className="hidden size-5 text-[#839087] lg:block" />
          <button type="button" aria-expanded={expanded} aria-controls="guest-shop-details" onClick={() => setExpanded(value => !value)} className="flex min-h-11 items-center gap-2 rounded-lg px-2 text-xs font-semibold text-[#346046] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#168049] lg:hidden">
            {expanded ? 'Hide shop' : 'View shop'} <ChevronDown aria-hidden="true" className={`size-4 ${expanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2 lg:mt-4">
          <p role="status" className="text-xs text-[#607367]">{status}</p>
          {priced && shop && <p className="text-right font-mono text-lg font-bold text-[#24392b]">{euro(shop.totals.selected_total)}<span className="ml-2 font-sans text-[10px] font-normal text-[#718076]">{incomplete ? 'priced subtotal' : 'selected total'}</span></p>}
        </div>
      </header>

      <div id="guest-shop-details" className={`${expanded ? 'flex' : 'hidden'} min-h-0 max-h-[35svh] flex-col overflow-y-auto overscroll-contain lg:flex lg:max-h-none lg:flex-1`}>
        {shop ? <div className="px-4 py-4 lg:px-5">
          <p className="text-xs leading-5 text-[#607367]">{shop.household.adults} {shop.household.adults === 1 ? 'adult' : 'adults'}{shop.household.children ? `, ${shop.household.children} ${shop.household.children === 1 ? 'child' : 'children'}` : ''} · {shop.household.planning_period.label}{shop.household.budget ? ` · ${euro(shop.household.budget)} budget` : ''}</p>
          {shop.household.dietary_requirements.length > 0 && <p className="mt-1 text-xs text-[#526b5c]">{shop.household.dietary_requirements.join(', ')}</p>}
          {changes && <p className="mt-3 rounded-lg bg-[#eaf6ee] px-3 py-2 text-xs text-[#27643d]">{changes}</p>}
          {busy && <p className="mt-3 text-xs text-[#718076]">The last checked proposal stays here while your agent works.</p>}
          {shop.sections.map(section => {
            const items = shop.items.filter(item => item.section_id === section.id);
            return items.length ? <section key={section.id} className="mt-5">
              <h3 className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#7a847d]">{section.label}</h3>
              {items.map(item => <div key={item.line_id} className="flex items-start gap-2 border-b border-dashed border-[#d9ddd8] py-3 last:border-0">
                {item.selected_offer ? <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-[#168049]" /> : <CircleAlert aria-hidden="true" className="mt-1 size-4 shrink-0 text-[#9a5b00]" />}
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold leading-5 text-[#263229]">{item.display_label}</p>
                  <p className="text-[11px] leading-4 text-[#718076]">{item.quantity} × {item.unit_or_pack_expectation}</p>
                  {!item.selected_offer && <p className="mt-1 text-[11px] text-[#94662b]">{item.coverage_note || 'Price still needs checking'}</p>}
                </div>
                {item.selected_offer && item.line_total != null && <div className="shrink-0 text-right"><p className="font-mono text-xs font-semibold">{euro(item.line_total)}</p><p className="mt-1 text-[10px] text-[#718076]">{storeName(item.selected_offer.retailer)}</p></div>}
              </div>)}
            </section> : null;
          })}
          <div className="mt-4 rounded-xl bg-[#edf7f0] px-3 py-3 text-xs leading-5 text-[#385443]">
            {!priced ? 'Current prices still need checking. No total is available yet.' : incomplete ? 'This subtotal includes priced items only. It is not the full cost of your shop.' : 'This total adds the selected products at the retailers shown.'}
            {priced && shop.totals.by_selected_retailer.length > 1 && <p className="mt-1 font-semibold">Selected prices span multiple supermarkets.</p>}
          </div>
          <details className="mt-3 text-xs text-[#526b5c]"><summary className="cursor-pointer py-2 font-semibold">One-store options</summary><div className="space-y-2 py-2">{shop.store_coverage.map(store => <p key={store.retailer} className="flex justify-between gap-3"><span>{storeName(store.retailer)}</span><strong>{store.complete && store.basket_total != null ? euro(store.basket_total) : 'Incomplete shop'}</strong></p>)}</div></details>
          {shop.household.assumptions_made.length > 0 && <details className="mt-1 text-xs text-[#526b5c]"><summary className="cursor-pointer py-2 font-semibold">Assumptions used</summary><ul className="list-disc space-y-1 pb-2 pl-4">{shop.household.assumptions_made.map(value => <li key={value}>{value}</li>)}</ul></details>}
          <p className="mt-3 text-[10px] leading-4 text-[#7c8980]">A proposed shop. Nothing has been ordered.</p>
        </div> : <div className="flex flex-1 flex-col items-center justify-center px-5 py-8 text-center lg:min-h-52">
          <ShoppingBasket aria-hidden="true" className="size-7 text-[#168049]" />
          <p className="mt-3 text-sm font-semibold text-[#263229]">Your shop will take shape here</p>
          <p className="mt-2 max-w-60 text-xs leading-5 text-[#718076]">Products and checked prices will appear when your agent has prepared your proposal.</p>
        </div>}
      </div>
      {shop && <div className="shrink-0 border-t border-dashed border-[#cfd6d0] px-4 py-3 lg:px-5 lg:py-4">
        {revisionAvailable && <p className="mb-3 hidden lg:block text-xs leading-5 text-[#526b5c]">Try a change with your agent, or save this shop to keep working on it.</p>}
        <button type="button" aria-expanded={saveExpanded} aria-controls="guest-shop-signup" onClick={() => setSaveExpanded(value => !value)} className="min-h-11 w-full rounded-xl bg-[#122018] px-4 py-3 text-xs font-bold text-white lg:hidden">{saveExpanded ? 'Close save form' : 'Save this shop — free account'}</button>
        <div id="guest-shop-signup" className={`${saveExpanded ? 'mt-3 block' : 'hidden'} lg:mt-0 lg:block`}>{signup}</div>
      </div>}
    </ShopReceiptFrame>
  );
}
