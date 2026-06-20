const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    locale: 'en-IE',
    viewport: { width: 1920, height: 1080 },
    extraHTTPHeaders: { 'Accept-Language': 'en-IE,en;q=0.9' },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
  });

  const page = await context.newPage();
  
  // Capture all API requests
  const apiCalls = [];
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('api') || url.includes('search') || url.includes('product') || url.includes('graphql')) {
      if (!url.includes('.js') && !url.includes('.css') && !url.includes('analytics') && !url.includes('nr-data')) {
        apiCalls.push({ method: req.method(), url: url.substring(0, 200), headers: Object.keys(req.headers()) });
      }
    }
  });
  
  page.on('response', (resp) => {
    const url = resp.url();
    if (url.includes('api') || url.includes('search') || url.includes('product') || url.includes('graphql')) {
      if (!url.includes('.js') && !url.includes('.css') && !url.includes('analytics') && !url.includes('nr-data')) {
        apiCalls.push({ type: 'response', url: url.substring(0, 200), status: resp.status() });
      }
    }
  });

  // Load homepage
  console.log('Loading homepage...');
  await page.goto('https://www.tesco.ie/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(8000);
  
  console.log('\nAPI calls on homepage:');
  apiCalls.forEach(c => console.log(`  ${c.type === 'response' ? `← ${c.status}` : `→ ${c.method}`} ${c.url}`));
  
  // Clear and try search
  apiCalls.length = 0;
  console.log('\nNavigating to search...');
  await page.goto('https://www.tesco.ie/shop/en-IE/search?query=milk', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(6000);
  
  console.log('\nAPI calls on search page:');
  apiCalls.forEach(c => console.log(`  ${c.type === 'response' ? `← ${c.status}` : `→ ${c.method}`} ${c.url}`));
  
  // Even if blocked, let's see if the page source references any API endpoints
  const html = await page.content();
  const apiPatterns = html.match(/https?:\/\/[^"'\s]+(?:api|graphql|search)[^"'\s]*/g) || [];
  console.log('\nAPI URLs found in page source:');
  [...new Set(apiPatterns)].slice(0, 20).forEach(u => console.log(`  ${u.substring(0, 150)}`));
  
  await browser.close();
})();
