import { chromium } from 'playwright';

if (process.env.VERCEL_ENV !== 'preview') {
  console.log('[tesco-browser-probe] skipped: not preview');
  process.exit(0);
}

const target = 'https://www.tesco.ie/groceries/en-IE/search?query=Butter%20Unsalted%20250g';
let browser;

try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({
    locale: 'en-IE',
    viewport: { width: 1365, height: 768 },
  });
  const page = await context.newPage();
  const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(5000);

  const html = await page.content();
  const lower = html.toLowerCase();
  const result = {
    status: response?.status() ?? null,
    finalUrl: page.url(),
    title: await page.title(),
    bytes: html.length,
    blocked:
      lower.includes('access denied') ||
      lower.includes('security checks') ||
      lower.includes('akamai') ||
      lower.includes('captcha') ||
      (lower.includes('not right') && lower.includes('security')),
    hasProductHeading: lower.includes('product-heading'),
    hasPriceText: lower.includes('pricetext'),
    productLinks: await page.locator('a[href*="/products/"]').count().catch(() => 0),
  };

  console.log('[tesco-browser-probe]', JSON.stringify(result));
  await context.close();
} catch (error) {
  console.log('[tesco-browser-probe]', JSON.stringify({
    ok: false,
    name: error instanceof Error ? error.name : null,
    error: error instanceof Error ? error.message : String(error),
  }));
} finally {
  if (browser) await browser.close().catch(() => {});
}
