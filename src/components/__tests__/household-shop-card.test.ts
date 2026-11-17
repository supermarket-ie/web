import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HouseholdShopCard } from '../HouseholdShopCard';
import { groundHouseholdShop } from '@/lib/shopping/household-shop';
import { HOUSEHOLD_SHOP_SCHEMA_VERSION, type HouseholdShopContract } from '@/lib/shopping/household-shop-contract';
import type { PairReview } from '@/lib/comparison-policy';

// Customer-facing behaviour of the household-shop card for each comparison state, rendered to text.
const at = new Date(Date.now() - 3600_000).toISOString();
const review = (a: string, b: string, classification: PairReview['classification'] = 'exact_product'): PairReview => ({
  left_offer_id: a, right_offer_id: b, classification, left_source_hash: 'a'.repeat(64), right_source_hash: 'b'.repeat(64),
  left_captured_at: at, right_captured_at: at, reviewed_at: at, rationale: 'Independent direct-capture review.', reviewer: 'test' });

const catalogue = [
  { canonical_product_id: 'chilli', canonical_name: 'Chilli Powder 38g', category: 'Cupboard' },
  { canonical_product_id: 'muesli', canonical_name: 'Muesli', category: 'Breakfast' },
  { canonical_product_id: 'beans', canonical_name: 'Baked Beans 415g', category: 'Cupboard' },
];
const offer = (id: string, store: string, name: string, price: number) => ({
  canonical_product_id: id, canonical_name: catalogue.find(c => c.canonical_product_id === id)!.canonical_name, category: null,
  store_product_id: `${store}-${id}`, store, store_product_name: name, store_sku: `${store}-sku-${id}`, store_url: null, price,
  was_price: null, on_promotion: false, observed_at: at, source: `${store}_direct`, relationship_type: 'exact' as const, freshness_state: 'fresh' as const });
const CHILLI = [offer('chilli', 'tesco', 'Schwartz Mild Chilli Powder 38G', 3.5), offer('chilli', 'supervalu', 'Schwartz Chilli Powder Mild (38 g)', 3.35)];
const BEANS = [offer('beans', 'tesco', 'Heinz Beanz In Tomato Sauce 415G', 1.4), offer('beans', 'supervalu', 'Heinz Beanz (415 g)', 1.35)];
const MUESLI = [offer('muesli', 'tesco', "Flahavan's Hi8 Muesli Original 1kg", 5.5), offer('muesli', 'supervalu', 'Lifeforce Muesli (750 g)', 5.19)];

const line = (id: string, label: string) => ({ line_id: id, section_id: 'food', canonical_product_id: id, display_label: label, quantity: 1,
  unit_or_pack_expectation: 'one pack', reason: 'Weekly shop', purpose: 'cupboard' });
const shop = (ids: string[], rows: ReturnType<typeof offer>[], reviews: PairReview[]) => groundHouseholdShop({
  pair_reviews: reviews,
  proposal: { schema_version: HOUSEHOLD_SHOP_SCHEMA_VERSION,
    household: { adults: 2, children: 0, dietary_requirements: [], budget: null, planning_period: { days: 7, label: 'one week' }, assumptions_made: [] },
    sections: [{ id: 'food', label: 'Food and drink', kind: 'food' as const }],
    items: ids.map(id => line(id, catalogue.find(c => c.canonical_product_id === id)!.canonical_name)) },
  catalogue_products: catalogue, latest_prices: rows, comparison_retailers: ['tesco', 'supervalu'] });
const text = (s: HouseholdShopContract) => renderToStaticMarkup(createElement(HouseholdShopCard, { shop: s }))
  .replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

describe('HouseholdShopCard customer-facing comparison states', () => {
  it('verified exact match: names the cheapest verified basket and labels it', () => {
    const out = text(shop(['chilli', 'beans'], [...CHILLI, ...BEANS], [review('tesco-chilli', 'supervalu-chilli'), review('tesco-beans', 'supervalu-beans')]));
    expect(out).toContain('SuperValu is the cheapest verified one-store basket.');
    expect(out).toContain('Verified exact matches');
    expect(out).toContain('Schwartz Chilli Powder Mild (38 g)');
    expect(out).toMatch(/Tesco €3\.50 · Schwartz Mild Chilli Powder 38G · €92\.11\/kg · Exact match/);
  });
  it('unverified comparison: individual prices, titles and unit prices, totals indicative, no cheapest claim', () => {
    const out = text(shop(['chilli', 'beans'], [...CHILLI, ...BEANS], []));
    expect(out).not.toMatch(/cheapest/i);
    expect(out).toContain('Store totals are indicative.');
    expect(out).toContain('Indicative total');
    expect(out).toMatch(/Tesco €1\.40 · Heinz Beanz In Tomato Sauce 415G · €3\.37\/kg · Unverified/);
  });
  it('supported similar product: labelled Similar product and never a verified total', () => {
    const out = text(shop(['chilli', 'beans'], [...CHILLI, ...BEANS], [review('tesco-chilli', 'supervalu-chilli'), review('tesco-beans', 'supervalu-beans', 'comparable_alternative')]));
    expect(out).toContain('Similar product');
    // Neither side of a Similar pair is called an Exact match.
    expect(out).toMatch(/Tesco €1\.40 · Heinz Beanz In Tomato Sauce 415G · €3\.37\/kg · Similar product/);
    expect(out).not.toMatch(/cheapest/i);
    expect(out).not.toContain('Verified exact matches');
  });
  it('different product or pack: shown with its own title and excluded from store totals', () => {
    const out = text(shop(['chilli', 'muesli'], [...CHILLI, ...MUESLI], [review('tesco-chilli', 'supervalu-chilli')]));
    expect(out).toContain('Different product or pack');
    expect(out).toContain('Lifeforce Muesli (750 g)');
    expect(out).toContain("Flahavan's Hi8 Muesli Original 1kg");
    expect(out).toContain('different product(s) excluded');
    expect(out).not.toMatch(/cheapest/i);
  });
  it('incomplete basket: partial coverage, no cheapest claim, but prices still shown', () => {
    const out = text(shop(['chilli', 'beans'], [...CHILLI, BEANS[0]], [review('tesco-chilli', 'supervalu-chilli')]));
    expect(out).toContain('Partial coverage');
    expect(out).not.toMatch(/cheapest/i);
    expect(out).toContain('Heinz Beanz In Tomato Sauce 415G');
  });
  it('legacy single_retailer output (no verified coverage row) gets neutral wording', () => {
    const s = shop(['chilli'], CHILLI, []);
    const legacy = { ...s, recommended_retailer_strategy: { kind: 'single_retailer' as const, retailer: 'supervalu', rationale: 'supervalu has trusted current offers for every shop line.' } };
    const out = text(legacy);
    expect(out).toContain('SuperValu has a current offer for every line. Store totals are indicative.');
    expect(out).not.toMatch(/cheapest/i);
  });
});

/** Printed by `DEMO=1 npx vitest run src/components/__tests__/household-shop-card.test.ts` for the review report. */
if (process.env.DEMO) {
  const cases: Array<[string, HouseholdShopContract]> = [
    ['Verified exact', shop(['chilli', 'beans'], [...CHILLI, ...BEANS], [review('tesco-chilli', 'supervalu-chilli'), review('tesco-beans', 'supervalu-beans')])],
    ['Unverified', shop(['chilli', 'beans'], [...CHILLI, ...BEANS], [])],
    ['Similar', shop(['chilli', 'beans'], [...CHILLI, ...BEANS], [review('tesco-chilli', 'supervalu-chilli'), review('tesco-beans', 'supervalu-beans', 'comparable_alternative')])],
    ['Different product or pack', shop(['chilli', 'muesli'], [...CHILLI, ...MUESLI], [review('tesco-chilli', 'supervalu-chilli')])],
    ['Incomplete basket', shop(['chilli', 'beans'], [...CHILLI, BEANS[0]], [review('tesco-chilli', 'supervalu-chilli')])],
  ];
  for (const [name, s] of cases) console.log(`\n=== ${name} ===\n${text(s)}`);
}
