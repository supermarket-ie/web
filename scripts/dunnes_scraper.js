/**
 * Dunnes Stores Grocery - Product Search Scraper
 *
 * Uses the Instacart/Unata Storefront gateway API.
 * Requires Playwright to obtain Cloudflare clearance cookies.
 *
 * Usage:
 *   node dunnes_scraper.js "product name"
 *
 * Outputs JSON to stdout:
 *   { sku, name, brand, price, priceNumeric, pricePerUnit, url, available }
 *   or { error: "message" }
 */

const { chromium } = require('/home/ubuntu/.openclaw/workspace/supermarket-ie/node_modules/playwright');

const STORE_ID = 258;
const GATEWAY_BASE = 'https://storefrontgateway.dunnesstoresgrocery.com/api';
const SITE_URL = 'https://www.dunnesstoresgrocery.com';

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

async function searchProducts(query, take = 5) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'Accept-Language': 'en-IE,en;q=0.9' }
  });
  const page = await context.newPage();

  // Load home page to get Cloudflare clearance
  await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  const url = `${GATEWAY_BASE}/stores/${STORE_ID}/search?q=${encodeURIComponent(query)}&take=${take}&page=1&skip=0`;

  const result = await page.evaluate(async ({ url, correlationId, siteUrl }) => {
    const resp = await fetch(url, {
      headers: {
        'x-site-host': siteUrl,
        'x-site-location': 'HeadersBuilderInterceptor',
        'x-correlation-id': correlationId,
        'x-shopping-mode': '22222222-2222-2222-2222-222222222222',
        'Accept': 'application/json, text/plain, */*',
      },
      credentials: 'include'
    });
    const data = await resp.json();
    return { status: resp.status, data };
  }, { url, correlationId: generateUUID(), siteUrl: SITE_URL });

  await browser.close();

  if (!result.data || !result.data.items || result.data.items.length === 0) {
    return null;
  }

  // Return the first available product
  const item = result.data.items.find(i => i.available !== false) || result.data.items[0];

  // Detect promotion via tprPrice (Temporary Price Reduction)
  const activeTpr = (item.tprPrice || []).find(t => t.active === true);
  const onPromotion = !!activeTpr;
  // For Dunnes, tprPrice.markdown IS the sale price — we need the regular price.
  // The regular price isn't directly exposed when on TPR, but wholePrice = promo price when active.
  // Best signal: if tprPrice has an upcoming inactive entry with a higher price, use that.
  // Otherwise mark as on_promotion=true with was_price=null (we just know it's a deal).
  let wasPrice = null;
  if (activeTpr) {
    // Look for a future/past tprPrice entry to infer regular price — not reliable.
    // Instead flag it and leave was_price null; pipeline will handle.
    wasPrice = null;
  }

  return {
    sku: item.sku,
    name: item.name,
    brand: item.brand || '',
    price: item.price,
    priceNumeric: item.priceNumeric,
    pricePerUnit: item.pricePerUnit || '',
    available: item.available,
    onPromotion,
    wasPrice,
    promotionLabel: activeTpr ? activeTpr.label : null,
    url: `${SITE_URL}/sm/delivery/rsid/${STORE_ID}/product/details/${encodeURIComponent((item.name || '').toLowerCase().replace(/\s+/g, '-'))}/${item.sku}`,
  };
}

(async () => {
  const query = process.argv[2];
  if (!query) {
    console.log(JSON.stringify({ error: 'No query provided' }));
    process.exit(1);
  }

  try {
    const product = await searchProducts(query);
    if (!product) {
      console.log(JSON.stringify({ error: 'No products found' }));
    } else {
      console.log(JSON.stringify(product));
    }
  } catch (e) {
    console.log(JSON.stringify({ error: e.message }));
    process.exit(1);
  }
})();
