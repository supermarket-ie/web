'use client';

import { AlertCircle, CheckCircle2, ShoppingBasket, Store } from 'lucide-react';
import {
  type HouseholdShopContract,
} from '@/lib/shopping/household-shop-contract';
import { COMPARISON_EXPLANATIONS, COMPARISON_LABELS, verifiedClaimText } from '@/lib/comparison-policy';

const STORE_NAMES: Record<string, string> = {
  tesco: 'Tesco',
  dunnes: 'Dunnes Stores',
  supervalu: 'SuperValu',
};

function storeName(value: string) {
  return STORE_NAMES[value.toLowerCase()] ?? value;
}

function euro(value: number) {
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(value);
}

export function HouseholdShopCard({ shop }: { shop: HouseholdShopContract }) {
  const budget = shop.household.budget;
  const unresolvedCount = shop.missing_or_uncertain_items.filter(item =>
    item.status === 'unresolved' || item.status === 'unavailable',
  ).length;
  // A "cheapest verified" headline needs the recommended retailer's own coverage row to be verified_exact.
  const verifiedRows = shop.store_coverage.filter(c => c.comparison_basis === 'verified_exact' && c.verified_exact_total != null);
  // The claim names the verified stores (and any tie); other complete stores are named as indicative.
  const verifiedClaim = shop.recommended_retailer_strategy.kind === 'single_retailer' && verifiedRows.length >= 2 ? verifiedClaimText(verifiedRows.map(c => ({ store: c.retailer, total: c.verified_exact_total! })),
    shop.store_coverage.filter(c => c.complete && !verifiedRows.includes(c)).map(c => c.retailer)) : null;

  return (
    <section className="w-full overflow-hidden rounded-[1.4rem] border border-[#dce6df] bg-white text-[#243128] shadow-[0_12px_35px_rgba(31,64,43,0.08)]">
      <header className="border-b border-[#e5ebe7] bg-[#f5faf6] px-4 py-4 sm:px-5">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#dff3e5] text-[#0a773a]">
            <ShoppingBasket className="size-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold tracking-[-0.02em] text-[#152219]">Your household shop</h3>
            <p className="mt-1 text-xs leading-5 text-[#647168]">
              {shop.household.adults} {shop.household.adults === 1 ? 'adult' : 'adults'}
              {shop.household.children ? `, ${shop.household.children} ${shop.household.children === 1 ? 'child' : 'children'}` : ''}
              {' · '}{shop.household.planning_period.label}
              {budget ? ` · ${euro(budget)} budget` : ''}
            </p>
            {shop.household.dietary_requirements.length > 0 && (
              <p className="mt-1 text-xs text-[#476452]">Dietary: {shop.household.dietary_requirements.join(', ')}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold tracking-[-0.03em] text-[#152219]">{euro(shop.totals.selected_total)}</p>
            <p className="text-[10px] uppercase tracking-[0.07em] text-[#7c8980]">priced total</p>
          </div>
        </div>

        {shop.household.assumptions_made.length > 0 && (
          <details className="mt-3 text-xs text-[#657269]">
            <summary className="cursor-pointer font-medium text-[#425448]">Assumptions used</summary>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              {shop.household.assumptions_made.map(assumption => <li key={assumption}>{assumption}</li>)}
            </ul>
          </details>
        )}
      </header>

      <div className="divide-y divide-[#edf1ee]">
        {shop.sections.map(section => {
          const items = shop.items.filter(item => item.section_id === section.id);
          if (!items.length) return null;
          return (
            <div key={section.id} className="px-4 py-4 sm:px-5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h4 className="text-xs font-bold uppercase tracking-[0.07em] text-[#536359]">{section.label}</h4>
                <span className="text-[11px] text-[#8a948d]">{items.length} {items.length === 1 ? 'item' : 'items'}</span>
              </div>
              <div className="space-y-1">
                {items.map(item => (
                  <div key={item.line_id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-xl px-2 py-2.5 hover:bg-[#f8faf8]">
                    <div className="min-w-0">
                      <div className="flex items-start gap-2">
                        {item.selected_offer
                          ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-[#25824a]" />
                          : <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-[#b06b24]" />}
                        <div className="min-w-0">
                          <p className="text-sm font-medium leading-5 text-[#26342b]">{item.display_label}</p>
                          <p className="text-[11px] leading-4 text-[#7b867f]">
                            {item.quantity} × {item.unit_or_pack_expectation}
                            {item.purpose ? ` · ${item.purpose}` : ''}
                          </p>
                          {!item.selected_offer && item.coverage_note && (
                            <p className="mt-1 text-[11px] leading-4 text-[#9a672d]">{item.coverage_note}</p>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      {item.selected_offer && item.line_total != null ? (
                        <>
                          <p className="text-sm font-semibold text-[#26342b]">{euro(item.line_total)}</p>
                          <p className="text-[10px] text-[#7f8982]">{storeName(item.selected_offer.retailer)}</p>
                          <p className="max-w-[11rem] text-[10px] leading-4 text-[#7f8982]">
                            {item.selected_offer.retailer_product_name}
                            {item.selected_offer.unit_price ? ` · ${euro(item.selected_offer.unit_price.price)}/${item.selected_offer.unit_price.per}` : ''}
                          </p>
                          {item.selected_offer.comparison_status && item.candidate_offers.length > 1 && (
                            <p className="text-[10px] font-medium text-[#82591a]">{COMPARISON_LABELS[item.selected_offer.comparison_status]}</p>
                          )}
                          {item.candidate_offers.filter(o => o.retailer !== item.selected_offer!.retailer).length > 0 && (
                            <ul className="mt-1 max-w-[11rem] space-y-0.5 text-[10px] leading-4 text-[#5c675f]" aria-label={`Other retailers for ${item.display_label}`}>
                              {item.candidate_offers.filter(o => o.retailer !== item.selected_offer!.retailer).map(o => (
                                <li key={o.retailer_product_id}>
                                  {storeName(o.retailer)} {euro(o.current_price)} · {o.retailer_product_name}
                                  {o.unit_price ? ` · ${euro(o.unit_price.price)}/${o.unit_price.per}` : ''}
                                  {o.comparison_status ? ` · ${COMPARISON_LABELS[o.comparison_status]}` : ''}
                                </li>
                              ))}
                            </ul>
                          )}
                          {item.selected_offer.promotion.confirmed_monetary_saving ? (
                            <p className="text-[10px] font-medium text-[#08783b]">Save {euro(item.selected_offer.promotion.saving ?? 0)} each</p>
                          ) : item.selected_offer.promotion.retailer_marked ? (
                            <p className="text-[10px] font-medium text-[#8a6a25]">Retailer-marked offer</p>
                          ) : null}
                        </>
                      ) : (
                        <span className="rounded-full bg-[#fff5e8] px-2 py-1 text-[10px] font-medium text-[#8a5c24]">Needs resolving</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-[#e7ece8] bg-[#fbfcfb] px-4 py-4 sm:px-5">
        <div className="grid gap-2 sm:grid-cols-3">
          {shop.store_coverage.map(coverage => (
            <div key={coverage.retailer} className="rounded-xl border border-[#e2e8e4] bg-white px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[#334238]">
                <Store className="size-3.5 text-[#6d7d72]" />
                {storeName(coverage.retailer)}
              </div>
              <p className="mt-1 text-[11px] text-[#758078]">{coverage.covered_lines}/{coverage.total_lines} items</p>
              <p className="mt-0.5 text-sm font-semibold text-[#26342b]">
                {coverage.complete && coverage.basket_total != null ? euro(coverage.basket_total) : 'Partial coverage'}
              </p>
              {coverage.complete && coverage.basket_total != null && (
                <p className="text-[10px] text-[#82591a]">{coverage.comparison_basis === 'verified_exact' ? 'Verified exact matches' : 'Indicative total'}</p>
              )}
              {(coverage.different_product_line_ids?.length ?? 0) > 0 && (
                <p className="text-[10px] text-[#82591a]">{coverage.different_product_line_ids!.length} different product(s) excluded</p>
              )}
            </div>
          ))}
        </div>

        <div className="mt-3 rounded-xl bg-[#edf7f0] px-3.5 py-3 text-xs leading-5 text-[#385443]">
          <strong className="text-[#21452e]">
            {verifiedClaim
              ? verifiedClaim
              : shop.recommended_retailer_strategy.kind === 'single_retailer'
                // Legacy output (older image or saved chat): "single_retailer" then meant full coverage only.
                ? `${storeName(shop.recommended_retailer_strategy.retailer ?? '')} has a current offer for every line. Store totals are indicative.`
              : shop.recommended_retailer_strategy.kind === 'indicative_single_retailer'
                ? 'Store totals are indicative.'
                : shop.recommended_retailer_strategy.kind === 'mixed_retailer'
                  ? 'No single retailer has a comparable offer for every line.'
                  : 'Some items still need to be matched.'}
          </strong>{' '}
          {verifiedClaim ? COMPARISON_EXPLANATIONS.verified : shop.recommended_retailer_strategy.rationale}
        </div>

        {(unresolvedCount > 0 || shop.totals.priced_lines < shop.totals.total_lines) && (
          <p className="mt-3 text-[11px] leading-4 text-[#7c6a50]">
            The priced total covers {shop.totals.priced_lines} of {shop.totals.total_lines} lines. Unpriced or unresolved items are not included in the total.
          </p>
        )}
        <p className="mt-3 text-[10px] leading-4 text-[#929a94]">Current prices are validated by Supermarket.ie. This is a proposed shop, not a retailer trolley or completed order.</p>
      </div>
    </section>
  );
}
