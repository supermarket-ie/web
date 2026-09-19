import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }));
import type { ProductPrice } from '@/lib/price-data';
import { isCurrentDeal, latestObservationAt } from '@/lib/deal-utils';
import {
  buildSupervaluSearchQueries,
  classifySupervaluProductPage,
  isDirectMappingCompatible,
  parseSupervaluProductPage,
  parseSupervaluSearchPage,
  selectSupervaluRemapCandidate,
} from '@/lib/supervalu-direct-worker';
import { buildDunnesSearchQueries, directResolvedCandidate, extractDunnesUrlSku } from '@/lib/dunnes-queue-worker';
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

describe('retailer recovery safeguards', () => {
  it('classifies an empty SuperValu product shell separately', () => {
    const result = classifySupervaluProductPage(`
      <meta itemprop="price" content="0">
      <script>window.__PRELOADED_STATE__ = {"product":{"name":"","price":null}}</script>
    `);
    expect(result).toEqual({ candidate: null, failureReason: 'empty_product_state' });
  });

  it('parses and uniquely selects a canonical-safe SuperValu search remap', () => {
    const product = {
      storeProductId: 'mapping-1',
      canonicalName: "Ben's Original Peri Peri Microwave Rice 220g",
      storeProductName: "Ben's Original Peri Peri Microwave Rice 220g",
      storeUrl: 'https://shop.supervalu.ie/sm/delivery/rsid/5550/product/product-id-old',
      storeSku: 'old',
      previousPrice: null,
    };
    expect(buildSupervaluSearchQueries(product)).toEqual(['ben peri peri microwave rice']);
    const candidates = parseSupervaluSearchPage(`
      <script>window.__PRELOADED_STATE__ = {"search":{"productCardDictionary":{
        "new":{"name":"Ben's Original Peri Peri Microwave Rice 220g","sku":"1886686001","price":"€2.50","promotions":[]},
        "wrong":{"name":"Ben's Original Pilau Microwave Rice 220g","sku":"1886686002","price":"€2.40","promotions":[]}
      }}};</script>
    `);
    expect(candidates[0].url).toContain('/ben-s-original-peri-peri-microwave-rice-220g-id-1886686001');
    expect(selectSupervaluRemapCandidate(product, candidates)?.sku).toBe('1886686001');
  });

  it('does not remap an ambiguous generic SuperValu product family', () => {
    const product = {
      storeProductId: 'mapping-1',
      canonicalName: 'Clementines',
      storeProductName: 'Clementines',
      storeUrl: 'https://shop.supervalu.ie/sm/delivery/rsid/5550/product/product-id-old',
      storeSku: 'old',
      previousPrice: null,
    };
    const candidates = [
      { name: 'SuperValu Clementines 500g', sku: 'one', price: 2, wasPrice: null, onPromotion: false, url: 'https://shop.supervalu.ie/product/one' },
      { name: 'SuperValu Clementines 1kg', sku: 'two', price: 3, wasPrice: null, onPromotion: false, url: 'https://shop.supervalu.ie/product/two' },
    ];
    expect(selectSupervaluRemapCandidate(product, candidates)).toBeNull();
  });

  it('accepts high-confidence retailer wording without weakening pack identity', () => {
    expect(isDirectMappingCompatible({
      storeProductId: 'mapping-1',
      canonicalName: 'Apples 6 Pack',
      storeProductName: 'SuperValu Apples 6 Pack',
      storeUrl: 'https://shop.supervalu.ie/product/apples',
      storeSku: '1008857001',
      previousPrice: null,
    }, {
      name: 'SuperValu Pink Lady Apples (6 Piece)',
      sku: '1008857001',
      price: 3.49,
      wasPrice: null,
      onPromotion: false,
    })).toBe(true);

    expect(isDirectMappingCompatible({
      storeProductId: 'mapping-2',
      canonicalName: 'Penne Pasta 500g',
      storeProductName: 'SuperValu Penne Pasta 500g',
      storeUrl: 'https://shop.supervalu.ie/product/penne',
      storeSku: '1612291003',
      previousPrice: null,
    }, {
      name: 'SuperValu Penne Pasta (400 g)',
      sku: '1612291003',
      price: 1.25,
      wasPrice: null,
      onPromotion: false,
    })).toBe(false);
  });

  it('uses retailer stopwords and simple inflections without accepting a wrong food type', () => {
    const celeryProduct = {
      storeProductId: 'mapping-1',
      canonicalName: 'Celery',
      storeProductName: 'Celery',
      storeUrl: 'https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/product/details/dunnes-stores-fresh-celery/100807380',
      storeSku: '100807380',
      previousPrice: null,
    };
    expect(directResolvedCandidate(celeryProduct, [{
      sku: '100807380', name: 'Dunnes Stores Fresh Celery', price: 1.29,
      wasPrice: null, onPromotion: false, url: null,
    }])?.sku).toBe('100807380');

    expect(directResolvedCandidate({
      ...celeryProduct,
      canonicalName: 'Chilli Peppers Red',
      storeProductName: 'Chilli Peppers Red',
      storeUrl: 'https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/product/details/gosh-pakora/100287669',
      storeSku: '100287669',
    }, [{
      sku: '100287669', name: 'Gosh Sweet Potato Pakora with Red Pepper Cumin & Chilli 171g', price: 3.5,
      wasPrice: null, onPromotion: false, url: null,
    }])).toBeNull();
  });

  it('accepts equivalent counted-pack wording while preserving variant and multipack rejection', () => {
    const product = {
      storeProductId: 'mapping-1',
      canonicalName: 'Brennans Be Good Plain Bagels 6 Pack',
      storeProductName: 'Brennans 6 Be Good Plain Bagels 270g',
      storeUrl: 'https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/product/details/brennans-6-be-good-plain-bagels-270g/100325489',
      storeSku: '100325489',
      previousPrice: null,
    };
    expect(directResolvedCandidate(product, [{
      sku: '100325489', name: 'Brennans 6 Be Good Plain Bagels 270g', price: 2.5,
      wasPrice: null, onPromotion: false, url: null,
    }])?.sku).toBe('100325489');

    expect(directResolvedCandidate({
      ...product,
      canonicalName: 'Glenisk Organic Kids Banana Yogurt 4 Pack',
      storeProductName: 'Glenisk Organic Kids Banana Yogurt 4 x 90g (360g)',
      storeSku: '100270889',
    }, [{
      sku: '100270889', name: 'Glenisk Organic Kids Banana Yogurt 4 x 90g (360g)', price: 2.49,
      wasPrice: null, onPromotion: false, url: null,
    }])?.sku).toBe('100270889');

    expect(directResolvedCandidate({
      ...product,
      canonicalName: 'Cadbury Dairy Milk Freddo Chocolate Bar 18g',
      storeProductName: 'Cadbury Dairy Milk Freddo Chocolate Bar 18g',
    }, [{
      sku: '100325489', name: 'Cadbury Dairy Milk Freddo Chocolate Bar 4 Pack Multipack 72g (4 x 18g)', price: 2.5,
      wasPrice: null, onPromotion: false, url: null,
    }])).toBeNull();

    expect(directResolvedCandidate({
      ...product,
      canonicalName: 'Kerrygold Unsalted Butter 227g',
      storeProductName: 'Kerrygold Unsalted Butter 227g',
    }, [{
      sku: '100325489', name: 'Kerrygold Salted Butter 227g', price: 2.5,
      wasPrice: null, onPromotion: false, url: null,
    }])).toBeNull();
  });

  it('adds the current Dunnes URL title as a bounded recovery query', () => {
    const queries = buildDunnesSearchQueries({
      storeProductId: 'mapping-1',
      canonicalName: 'Avonmore Unsalted Irish Butter 227g',
      storeProductName: 'Unsalted Butter 227g',
      storeUrl: 'https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/product/details/avonmore-pure-irish-unsalted-butter-227g/100131015',
      storeSku: '100131015',
      previousPrice: null,
    });
    expect(queries).toEqual([
      'Unsalted Butter 227g',
      'avonmore pure irish unsalted butter 227g',
      'Avonmore Unsalted Irish Butter 227g',
    ]);
  });

  it('uses a compatible Dunnes URL identity when the stored SKU has drifted', () => {
    const storeUrl = 'https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/product/details/7up-zero/100324568';
    expect(extractDunnesUrlSku(storeUrl)).toBe('100324568');
    const candidate = directResolvedCandidate({
      storeProductId: 'mapping-1',
      canonicalName: '7UP Zero Sugar Pink Lemonade Bottle 500ml',
      storeProductName: '7UP Zero Sugar Pink Lemonade Bottle 500ml',
      storeUrl,
      storeSku: 'old-barcode',
      previousPrice: null,
    }, [{
      sku: '100324568', name: '7UP Zero Sugar Pink Lemonade Bottle 500ml', price: 1.9,
      wasPrice: null, onPromotion: false, url: null,
    }]);
    expect(candidate?.sku).toBe('100324568');
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
