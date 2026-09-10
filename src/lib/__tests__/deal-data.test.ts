import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }));
import type { ProductPrice } from '@/lib/price-data';
import { isCurrentDeal, latestObservationAt } from '@/lib/deal-utils';
import { isDirectMappingCompatible, parseSupervaluProductPage } from '@/lib/supervalu-direct-worker';
import { choosePepestoCandidate } from '@/lib/pepesto-tesco';

function price(overrides: Partial<ProductPrice> = {}): ProductPrice {
  return {
    canonical_product_id: 'product-1',
    canonical_name: 'Example Product',
    category: 'Other',
    store: 'supervalu',
    price: 2,
    was_price: null,
    on_promotion: false,
    store_product_name: 'Example Product',
    store_sku: 'sku-1',
    store_url: 'https://example.com/product',
    observed_at: '2026-08-23T10:00:00.000Z',
    source: 'supervalu_direct',
    relationship_type: 'exact',
    freshness_state: 'fresh',
    ...overrides,
  };
}

describe('deal data', () => {
  it('does not present a retailer-marked offer as a confirmed deal without a previous price', () => {
    expect(isCurrentDeal(price({ on_promotion: true }))).toBe(false);
  });

  it('accepts a verified reduction with a higher previous price', () => {
    expect(isCurrentDeal(price({ was_price: 2.5 }))).toBe(true);
  });

  it('rejects ordinary current prices', () => {
    expect(isCurrentDeal(price())).toBe(false);
  });

  it('uses the latest real observation timestamp', () => {
    expect(latestObservationAt([
      price({ observed_at: '2026-08-22T10:00:00.000Z' }),
      price({ observed_at: '2026-08-23T11:00:00.000Z' }),
    ])).toBe('2026-08-23T11:00:00.000Z');
  });
});

describe('SuperValu promotion parsing', () => {
  it('extracts a structured current price and visible was price', () => {
    const candidate = parseSupervaluProductPage(`
      <script type="application/ld+json">
        {"@type":"Product","name":"Coffee 200g","offers":{"@type":"Offer","price":"4.00"}}
      </script>
      <span class="original-price">€5.50</span>
    `);

    expect(candidate).toMatchObject({
      name: 'Coffee 200g',
      price: 4,
      wasPrice: 5.5,
      onPromotion: true,
    });
  });

  it('does not mark an ordinary product page as a promotion', () => {
    const candidate = parseSupervaluProductPage(`
      <nav>Special Offers</nav>
      <script type="application/ld+json">
        {"@type":"Product","name":"Milk 2L","offers":{"@type":"Offer","price":"2.25"}}
      </script>
    `);

    expect(candidate).toMatchObject({ price: 2.25, wasPrice: null, onPromotion: false });
  });

  it('ignores generic promotion classes elsewhere on the page', () => {
    const candidate = parseSupervaluProductPage(`
      <div class="promotion-carousel">Other weekly offers</div>
      <script type="application/ld+json">
        {"@type":"Product","name":"Milk 2L","offers":{"@type":"Offer","price":"2.25"}}
      </script>
    `);

    expect(candidate).toMatchObject({ price: 2.25, wasPrice: null, onPromotion: false });
  });

  it('does not truncate double-quoted metadata at apostrophes', () => {
    const candidate = parseSupervaluProductPage(`
      <meta property="og:title" content="Ben's Original Pilau Rice Ready to Heat 220g">
      <meta property="product:price:amount" content="2.49">
    `);

    expect(candidate).toMatchObject({
      name: "Ben's Original Pilau Rice Ready to Heat 220g",
      price: 2.49,
    });
  });

  it('does not truncate single-quoted metadata at inch marks', () => {
    const candidate = parseSupervaluProductPage(`
      <meta content='SuperValu 10" Stonebaked Margherita Pizza 290g' property='og:title'>
      <meta content='4.00' property='product:price:amount'>
    `);

    expect(candidate).toMatchObject({
      name: 'SuperValu 10" Stonebaked Margherita Pizza 290g',
      price: 4,
    });
  });

  it('extracts the hydrated SuperValu product state before weak page fallbacks', () => {
    const candidate = parseSupervaluProductPage(`
      <script>
        window.__PRELOADED_STATE__ = {"product":{"name":"Flahavan's Quick Oats 500g","sku":"1000228000","price":"€3.25","wasPrice":"€4.00","isDiscounted":true,"promotions":[]}};
      </script>
      <title>Groceries - SuperValu</title>
    `);

    expect(candidate).toEqual({
      name: "Flahavan's Quick Oats 500g",
      sku: '1000228000',
      price: 3.25,
      wasPrice: 4,
      onPromotion: true,
    });
  });

  it('rejects a fetched product carrying a different retailer SKU', () => {
    expect(isDirectMappingCompatible({
      storeProductId: 'mapping-1',
      canonicalName: 'Pilau Rice 220g',
      storeProductName: "Ben's Original Pilau Rice 220g",
      storeUrl: 'https://shop.supervalu.ie/product/example',
      storeSku: 'expected-sku',
      previousPrice: 2.5,
    }, {
      name: "Ben's Original Pilau Rice 220g",
      sku: 'different-sku',
      price: 2.49,
      wasPrice: null,
      onPromotion: false,
    })).toBe(false);
  });
});

describe('Tesco Pepesto matching', () => {
  const product = {
    storeProductId: 'product-1',
    canonicalName: 'Example Coffee 200g',
    storeProductName: 'Example Coffee 200g',
    storeUrl: 'https://www.tesco.ie/groceries/en-IE/products/123456789',
    storeSku: '123456789',
    previousPrice: 5,
  };

  it('accepts an exact Tesco SKU', () => {
    const candidate = choosePepestoCandidate(product, {
      products: [{ product: {
        product_name: 'Example Coffee 200g',
        product_id: 'https://www.tesco.ie/groceries/en-IE/products/123456789',
        price: { price: 400 },
      } }],
    });
    expect(candidate?.product_id).toContain('/products/123456789');
  });

  it('rejects a plausible name match with a different Tesco SKU', () => {
    const candidate = choosePepestoCandidate(product, {
      products: [{ product: {
        product_name: 'Example Coffee 200g',
        product_id: 'https://www.tesco.ie/groceries/en-IE/products/987654321',
        price: { price: 400 },
      } }],
    });
    expect(candidate).toBeNull();
  });
});
