import { describe, expect, it } from 'vitest';
import { buildShopCatalogue, searchShopCatalogue } from '../shop-builder-catalogue';
import { readShopDraft, shopBuilderPrompt, type ShopDraft } from '../shop-builder';
import { weeklyShopTotals } from '../weekly-shop';
import type { ProductPrice } from '../price-data';

const now = Date.parse('2026-09-26T12:00:00Z');
const id = 'fbf1ad4d-fecd-4303-9d12-0add3b6f6e6c';
const offer = (patch: Partial<ProductPrice> = {}): ProductPrice => ({
  canonical_product_id: id, canonical_name: 'Whole Milk 2L', category: 'Dairy',
  store: 'dunnes', price: 2.25, was_price: null, on_promotion: false,
  store_product_name: 'Dunnes Stores Whole Milk 2L', store_sku: '123', store_url: null,
  observed_at: '2026-09-25T12:00:00Z', source: 'direct', relationship_type: 'exact', freshness_state: 'fresh', ...patch,
});
const draft: ShopDraft = { items: [{ id, name: 'Whole Milk 2L', quantity: 3 }], adults: '2', children: '1', budget: '100', needs: 'Already have bread. No other items.', completeWeek: false };

describe('search landing shopping workspace', () => {
  it('keeps a product available with one retailer and excludes stale, zero and wrong-pack offers', () => {
    const products = buildShopCatalogue([
      offer(), offer({ store: 'tesco', observed_at: '2026-09-18T12:00:00Z' }),
      offer({ store: 'supervalu', price: 0 }),
      offer({ store: 'supervalu', store_product_name: 'Whole Milk 6 x 2L' }),
    ], now);
    expect(products).toHaveLength(1);
    expect(Object.keys(products[0].offers)).toEqual(['dunnes']);
    expect(weeklyShopTotals(products, { [id]: 3 })[1]).toMatchObject({ total: 6.75, pricedCount: 1 });
    expect(weeklyShopTotals(products, {})[1].subtotal).toBeNull();
  });

  it('never combines different canonical identities just because names are equal', () => {
    const products = buildShopCatalogue([offer(), offer({ canonical_product_id: 'b1ead794-7439-41c3-af84-38dbdb5c1b91', store: 'tesco' })], now);
    expect(products).toHaveLength(2);
    expect(products.every(product => Object.keys(product.offers).length === 1)).toBe(true);
  });

  it('rejects known produce/snack conflicts and keeps the newest valid offer', () => {
    const products = buildShopCatalogue([
      offer({ observed_at: '2026-09-24T12:00:00Z', price: 2.2 }), offer(),
      offer({ canonical_product_id: 'banana', canonical_name: 'Mini Bananas', category: 'Fruit', store_product_name: 'Banana Mini Puffs 8g' }),
    ], now);
    expect(products).toHaveLength(1);
    expect(products[0].offers.dunnes?.price).toBe(2.25);
  });

  it('finds all supplied product terms without treating punctuation as a database query', () => {
    const products = buildShopCatalogue([offer(), offer({ canonical_product_id: 'other', canonical_name: 'Low Fat Milk 1L', store_product_name: 'Low Fat Milk 1L' })], now);
    expect(searchShopCatalogue(products, 'milk 2l').map(product => product.id)).toEqual([id]);
    expect(searchShopCatalogue(products, '%')).toEqual([]);
    expect(searchShopCatalogue(products, '')).toEqual([]);
  });

  it('hands off edited quantities, household and scope without supplying authoritative prices', () => {
    const prompt = shopBuilderPrompt(draft);
    expect(prompt).toContain('3 × Whole Milk 2L');
    expect(prompt).toContain('2 adults and 1 child');
    expect(prompt).toContain('€100');
    expect(prompt).toContain('Already have bread');
    expect(prompt).toContain('do not add an unsolicited full weekly shop');
    expect(prompt).not.toContain('2.25');
    expect(prompt).not.toContain(id);
    expect(shopBuilderPrompt({ ...draft, completeWeek: true })).toContain('fill out the rest');
  });

  it('restores intentions while discarding cached prices and rejects expired or invalid drafts', () => {
    const raw = JSON.stringify({ ...draft, createdAt: now, items: [{ ...draft.items[0], offers: { dunnes: { price: 0.01 } } }] });
    expect(readShopDraft(raw, now)).toEqual(draft);
    expect(readShopDraft(raw, now + 31 * 60 * 1000)).toBeNull();
    expect(readShopDraft(JSON.stringify({ ...draft, createdAt: now, items: [{ ...draft.items[0], quantity: 100 }] }), now)).toBeNull();
    expect(readShopDraft(JSON.stringify({ ...draft, createdAt: now, items: [draft.items[0], draft.items[0]] }), now)).toBeNull();
    expect(readShopDraft('{broken', now)).toBeNull();
  });
});
