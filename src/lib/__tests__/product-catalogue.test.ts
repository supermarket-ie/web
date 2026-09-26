import { describe, expect, it } from 'vitest';
import { buildProductCatalogue, catalogueItemList, productStructuredData, type CatalogueRecord } from '../product-catalogue';
import { catalogueCategory, CATALOGUE_CATEGORIES } from '../catalogue-categories';
import { addProductToDraft, readShopDraft, type ShopDraft } from '../shop-builder';
import type { ProductPrice } from '../price-data';

const now = Date.parse('2026-09-26T12:00:00Z');
const id = 'fbf1ad4d-fecd-4303-9d12-0add3b6f6e6c';
const otherId = 'b1ead794-7439-41c3-af84-38dbdb5c1b91';
const record: CatalogueRecord = { id, canonical_name: 'Whole Milk 2L', category: 'Dairy', description: null, image_url: null, brand: null, created_at: '2026-01-01T00:00:00Z' };
const offer = (patch: Partial<ProductPrice> = {}): ProductPrice => ({
  canonical_product_id: id, canonical_name: record.canonical_name, category: 'Dairy', store: 'dunnes', price: 2.25,
  was_price: 2.5, on_promotion: true, store_product_name: 'Dunnes Stores Whole Milk 2L', store_sku: '123',
  store_url: 'https://www.dunnesstoresgrocery.com/product/milk-123', observed_at: '2026-09-25T12:00:00Z',
  source: 'dunnes_direct', relationship_type: 'exact', freshness_state: 'fresh', ...patch,
});
const draft: ShopDraft = { items: [{ id: otherId, name: 'Carrots 1kg', quantity: 1 }], adults: '2', children: '1', budget: '25', needs: 'Only these products', completeWeek: false };

describe('public product discovery and evidence', () => {
  it('publishes useful single-store prices and excludes expired, zero and conflicting packs', () => {
    const [product] = buildProductCatalogue([record], [offer(), offer({ store: 'tesco', observed_at: '2026-09-18T00:00:00Z' }), offer({ store: 'supervalu', price: 0 }), offer({ store: 'supervalu', store_product_name: 'Whole Milk 6 x 2L' })], now);
    expect(Object.keys(product.offers)).toEqual(['dunnes']);
    expect(product.updatedAt).toBe('2026-09-25T12:00:00Z');
    expect(product.offers.dunnes).toMatchObject({ price: 2.25, wasPrice: 2.5, name: 'Dunnes Stores Whole Milk 2L' });
    const schema = productStructuredData(product, 'https://supermarket.ie');
    expect(schema.offers).toMatchObject({ '@type': 'Offer', price: '2.25', priceCurrency: 'EUR' });
    expect(JSON.stringify(schema)).not.toMatch(/InStock|priceValidUntil/);
  });

  it('keeps an existing URL when prices expire without creating zero or stale offers', () => {
    const [fresh] = buildProductCatalogue([record], [offer()], now);
    const [expired] = buildProductCatalogue([record], [offer()], now + 8 * 86400000);
    expect(expired.slug).toBe(fresh.slug);
    expect(expired.offers).toEqual({});
    expect(expired.updatedAt).toBeNull();
    expect(productStructuredData(expired, 'https://supermarket.ie')).not.toHaveProperty('offers');
  });

  it('rejects the observed chicken/turkey and ordinary/manuka honey mapping conflicts', () => {
    const records = [{ ...record, canonical_name: 'Chicken Mince', category: 'Meat' }, { ...record, id: otherId, canonical_name: '100% Pure Honey', category: 'Condiments' }];
    const rows = [
      offer({ canonical_name: 'Chicken Mince', category: 'Meat', store_product_name: "Hogan's Farm Turkey Breast Mince 454g" }),
      offer({ canonical_product_id: otherId, canonical_name: '100% Pure Honey', category: 'Condiments', store_product_name: 'Boyne Valley Pure Manuka New Zealand Honey 100+ MG 150g' }),
      offer({ canonical_product_id: otherId, canonical_name: '100% Pure Honey', category: 'Condiments', store: 'tesco', store_product_name: 'Molaga 100% Pure Honey' }),
    ];
    const products = buildProductCatalogue(records, rows, now);
    expect(products.find(product => product.id === id)?.offers).toEqual({});
    expect(Object.keys(products.find(product => product.id === otherId)!.offers)).toEqual(['tesco']);
    const [renamed] = buildProductCatalogue([{ ...record, canonical_name: 'Low Fat Milk 2L' }], [offer()], now);
    expect(renamed.offers).toEqual({});
  });

  it('uses stable distinct URLs and never merges offers when product names collide', () => {
    const second = { ...record, id: otherId, created_at: '2026-02-01T00:00:00Z' };
    const catalogue = buildProductCatalogue([second, record], [offer(), offer({ canonical_product_id: otherId, store: 'tesco', price: 3 })], now);
    const first = catalogue.find(product => product.id === id)!;
    const other = catalogue.find(product => product.id === otherId)!;
    expect(first.slug).toBe('whole-milk-2l');
    expect(other.slug).toBe(`whole-milk-2l-${otherId}`);
    expect(Object.keys(first.offers)).toEqual(['dunnes']);
    expect(Object.keys(other.offers)).toEqual(['tesco']);
  });

  it('marks up only visible offers and links every listed identity to its own page', () => {
    const products = buildProductCatalogue([record], [offer(), offer({ store: 'tesco', price: 2.1 })], now);
    expect(productStructuredData(products[0], 'https://supermarket.ie').offers).toMatchObject({ '@type': 'AggregateOffer', offerCount: 2, lowPrice: '2.10', highPrice: '2.25' });
    expect(catalogueItemList(products, 'Dairy', '/shop/dairy', 'https://supermarket.ie').itemListElement[0].url).toBe('https://supermarket.ie/browse/whole-milk-2l');
    const [unsafe] = buildProductCatalogue([{ ...record, image_url: 'javascript:alert(1)' }], [offer({ store_url: 'javascript:alert(1)', was_price: 2 })], now);
    expect(unsafe.imageUrl).toBeNull();
    expect(unsafe.offers.dunnes).toMatchObject({ storeUrl: null, wasPrice: null });
  });

  it('resolves every catalogue category and historical space/ampersand link to one route', () => {
    for (const category of CATALOGUE_CATEGORIES) expect(catalogueCategory(category.name)?.slug).toBe(category.slug);
    expect(catalogueCategory('pasta-&-rice')?.slug).toBe('pasta-and-rice');
    expect(catalogueCategory('dairy alternatives')?.slug).toBe('dairy-alternatives');
    expect(catalogueCategory('not-a-category')).toBeUndefined();
    expect(catalogueCategory('dairy%20alternatives')?.slug).toBe('dairy-alternatives');
    expect(catalogueCategory('%invalid')).toBeUndefined();
  });
});

describe('product to household shop', () => {
  it('adds the requested quantity while preserving the visitor’s existing household and list', () => {
    const next = addProductToDraft(draft, { id, name: record.canonical_name, quantity: 3 }, '/browse/whole-milk-2l');
    expect(next).toMatchObject({ ...draft, items: [draft.items[0], { id, name: record.canonical_name, quantity: 3 }], entryPath: '/browse/whole-milk-2l' });
    expect(readShopDraft(JSON.stringify({ ...next, createdAt: now }), now)).toEqual(next);
    const again = addProductToDraft(next, { id, name: record.canonical_name, quantity: 2 }, '/browse/another-product');
    expect(again.items[1].quantity).toBe(5);
    expect(again.items).toHaveLength(2);
    expect(again.entryPath).toBe('/browse/whole-milk-2l');
    expect(draft.items).toHaveLength(1);
  });

  it('enforces list limits without silently dropping a visitor’s selected items', () => {
    expect(() => addProductToDraft(draft, { ...draft.items[0], quantity: 20 }, '/browse/carrots-1kg')).toThrow(/20 units/);
    expect(() => addProductToDraft({ ...draft, items: Array.from({ length: 50 }, (_, i) => ({ id: `item-${i}`, name: 'Product', quantity: 1 })) }, { id, name: record.canonical_name, quantity: 1 }, '/browse/whole-milk-2l')).toThrow(/50 products/);
    const raw = JSON.stringify({ ...draft, createdAt: now, entryPath: 'https://example.com/private?text=hello' });
    expect(readShopDraft(raw, now)).not.toHaveProperty('entryPath');
  });
});
