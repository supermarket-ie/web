import { describe, it, expect } from 'vitest';
import { TescoExtractor } from '../tesco';
import { DunnesExtractor } from '../dunnes';
import { SuperValuExtractor } from '../supervalu';
import { LidlExtractor } from '../lidl';
import { AldiExtractor } from '../aldi';
import { getExtractor } from '../index';

const TESCO_URL = 'https://www.tesco.ie/groceries/en-IE/products/123';
const DUNNES_URL = 'https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/product/milk-456';
const SUPERVALU_URL = 'https://shop.supervalu.ie/shopping/product/milk-789';
const LIDL_URL = 'https://www.lidl.ie/p/milk/p100';
const ALDI_URL = 'https://groceries.aldi.ie/en-GB/p-milk-200';

// --- JSON-LD shared test data ---

function makeJsonLdHtml(name: string, price: string): string {
  return `
    <html>
    <head>
      <script type="application/ld+json">
        {
          "@type": "Product",
          "name": "${name}",
          "offers": {
            "@type": "Offer",
            "price": "${price}",
            "priceCurrency": "EUR"
          }
        }
      </script>
    </head>
    <body><h1>${name}</h1></body>
    </html>
  `;
}

// --- Tesco ---

describe('TescoExtractor', () => {
  it('extracts price from data-value attribute', () => {
    const html = `
      <html>
      <head><meta property="og:title" content="Avonmore Fresh Milk 2L"></head>
      <body>
        <h1>Avonmore Fresh Milk 2L</h1>
        <span data-value="2.39">€2.39</span>
      </body>
      </html>
    `;
    const result = TescoExtractor.extract({ source_url: TESCO_URL, html, text: 'Avonmore Fresh Milk 2L\n€2.39' });
    expect(result).not.toBeNull();
    expect(result!.product_name).toBe('Avonmore Fresh Milk 2L');
    expect(result!.price).toBe(2.39);
    expect(result!.url).toBe(TESCO_URL);
  });

  it('extracts price from price class span', () => {
    const html = `
      <html>
      <head><meta property="og:title" content="Brennans Bread 800g"></head>
      <body>
        <span class="current-price">€1.89</span>
      </body>
      </html>
    `;
    const result = TescoExtractor.extract({ source_url: TESCO_URL, html, text: '' });
    expect(result).not.toBeNull();
    expect(result!.price).toBe(1.89);
  });

  it('detects was-price and promotion', () => {
    const html = `
      <html>
      <head><meta property="og:title" content="Kerrygold Butter 227g"></head>
      <body>
        <span data-value="2.99">€2.99</span>
        <span class="was-price">€3.49</span>
        <span class="offer-badge">Clubcard Price</span>
      </body>
      </html>
    `;
    const result = TescoExtractor.extract({ source_url: TESCO_URL, html, text: '' });
    expect(result).not.toBeNull();
    expect(result!.was_price).toBe(3.49);
    expect(result!.on_promotion).toBe(true);
  });

  it('falls back to text extraction', () => {
    const result = TescoExtractor.extract({
      source_url: TESCO_URL,
      html: '<html><body></body></html>',
      text: 'Some Milk Product\n€4.50\nwas €5.00',
    });
    expect(result).not.toBeNull();
    expect(result!.product_name).toBe('Some Milk Product');
    expect(result!.price).toBe(4.50);
  });

  it('returns null when no price found', () => {
    const result = TescoExtractor.extract({
      source_url: TESCO_URL,
      html: '<html><head><meta property="og:title" content="Test"></head><body></body></html>',
      text: 'No price here',
    });
    expect(result).toBeNull();
  });
});

// --- Dunnes ---

describe('DunnesExtractor', () => {
  it('extracts from JSON-LD', () => {
    const html = makeJsonLdHtml('Dunnes Own Brand Milk 2L', '1.99');
    const result = DunnesExtractor.extract({ source_url: DUNNES_URL, html, text: '' });
    expect(result).not.toBeNull();
    expect(result!.product_name).toBe('Dunnes Own Brand Milk 2L');
    expect(result!.price).toBe(1.99);
    expect(result!.url).toBe(DUNNES_URL);
  });

  it('falls back to HTML price class', () => {
    const html = `
      <html>
      <head><meta property="og:title" content="Free Range Eggs 12pk"></head>
      <body><span class="product-price">€3.50</span></body>
      </html>
    `;
    const result = DunnesExtractor.extract({ source_url: DUNNES_URL, html, text: '' });
    expect(result).not.toBeNull();
    expect(result!.price).toBe(3.50);
  });

  it('detects multi-buy promotion', () => {
    const html = `
      <html>
      <head><meta property="og:title" content="Coke 2L"></head>
      <body>
        <span class="price">€2.00</span>
        <span class="multi-buy badge">Buy 2 Save</span>
      </body>
      </html>
    `;
    const result = DunnesExtractor.extract({ source_url: DUNNES_URL, html, text: '' });
    expect(result).not.toBeNull();
    expect(result!.on_promotion).toBe(true);
  });
});

// --- SuperValu ---

describe('SuperValuExtractor', () => {
  it('extracts from JSON-LD', () => {
    const html = makeJsonLdHtml('SuperValu Cheddar 200g', '2.49');
    const result = SuperValuExtractor.extract({ source_url: SUPERVALU_URL, html, text: '' });
    expect(result).not.toBeNull();
    expect(result!.product_name).toBe('SuperValu Cheddar 200g');
    expect(result!.price).toBe(2.49);
  });

  it('extracts from selling-price class', () => {
    const html = `
      <html>
      <head><meta property="og:title" content="Pasta 500g"></head>
      <body><span class="selling-price">€1.29</span></body>
      </html>
    `;
    const result = SuperValuExtractor.extract({ source_url: SUPERVALU_URL, html, text: '' });
    expect(result).not.toBeNull();
    expect(result!.price).toBe(1.29);
  });

  it('detects was/original price', () => {
    const html = `
      <html>
      <head><meta property="og:title" content="Rice 1kg"></head>
      <body>
        <span class="current-price">€1.99</span>
        <span class="original-price">€2.49</span>
      </body>
      </html>
    `;
    const result = SuperValuExtractor.extract({ source_url: SUPERVALU_URL, html, text: '' });
    expect(result).not.toBeNull();
    expect(result!.was_price).toBe(2.49);
  });
});

// --- Lidl ---

describe('LidlExtractor', () => {
  it('extracts from JSON-LD', () => {
    const html = makeJsonLdHtml('Lidl Wholemeal Bread 800g', '1.49');
    const result = LidlExtractor.extract({ source_url: LIDL_URL, html, text: '' });
    expect(result).not.toBeNull();
    expect(result!.product_name).toBe('Lidl Wholemeal Bread 800g');
    expect(result!.price).toBe(1.49);
  });

  it('extracts from pricebox class', () => {
    const html = `
      <html>
      <head><meta property="og:title" content="Bananas 5pk"></head>
      <body><span class="pricebox__price">€1.19</span></body>
      </html>
    `;
    const result = LidlExtractor.extract({ source_url: LIDL_URL, html, text: '' });
    expect(result).not.toBeNull();
    expect(result!.price).toBe(1.19);
  });

  it('extracts strikethrough was-price', () => {
    const html = `
      <html>
      <head><meta property="og:title" content="Chicken Fillets 400g"></head>
      <body>
        <span class="pricebox__price">€3.99</span>
        <span class="strikethrough-price">€4.99</span>
      </body>
      </html>
    `;
    const result = LidlExtractor.extract({ source_url: LIDL_URL, html, text: '' });
    expect(result).not.toBeNull();
    expect(result!.was_price).toBe(4.99);
  });
});

// --- Aldi ---

describe('AldiExtractor', () => {
  it('extracts from JSON-LD', () => {
    const html = makeJsonLdHtml('Aldi Irish Milk 2L', '1.79');
    const result = AldiExtractor.extract({ source_url: ALDI_URL, html, text: '' });
    expect(result).not.toBeNull();
    expect(result!.product_name).toBe('Aldi Irish Milk 2L');
    expect(result!.price).toBe(1.79);
  });

  it('extracts from product-price class', () => {
    const html = `
      <html>
      <head><meta property="og:title" content="Sourdough Loaf"></head>
      <body><span class="product-price">€2.29</span></body>
      </html>
    `;
    const result = AldiExtractor.extract({ source_url: ALDI_URL, html, text: '' });
    expect(result).not.toBeNull();
    expect(result!.price).toBe(2.29);
  });

  it('detects super savers promotion', () => {
    const html = `
      <html>
      <head><meta property="og:title" content="Toilet Paper 9pk"></head>
      <body>
        <span class="price">€3.99</span>
        <div class="super savers">Super Savers</div>
      </body>
      </html>
    `;
    const result = AldiExtractor.extract({ source_url: ALDI_URL, html, text: '' });
    expect(result).not.toBeNull();
    expect(result!.on_promotion).toBe(true);
  });

  it('returns null when no content extractable', () => {
    const result = AldiExtractor.extract({
      source_url: ALDI_URL,
      html: '<html><body>Empty page</body></html>',
      text: 'No useful content',
    });
    expect(result).toBeNull();
  });
});

// --- getExtractor registry ---

describe('getExtractor', () => {
  it.each(['tesco', 'dunnes', 'supervalu', 'lidl', 'aldi'] as const)(
    'returns an extractor for %s',
    (store) => {
      const extractor = getExtractor(store);
      expect(extractor).toBeDefined();
      expect(typeof extractor.extract).toBe('function');
    }
  );
});
